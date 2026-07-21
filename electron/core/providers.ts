// Direct-API / hosted execution profile. No child process, no file tools in
// the model loop: we call the provider's streaming endpoint ourselves, show
// the model's prose live, then extract the returned HTML artifact and write it
// into the project workspace so preview/export behave exactly like a CLI run.
//
// Three ways this is reached, all sharing this code:
//   • byok + anthropic  → POST <base>/v1/messages           (x-api-key: userKey)
//   • byok + openai      → POST <base>/v1/chat/completions   (Bearer userKey)
//   • hosted             → POST <endpoint>/v1/design/stream  (Bearer usageToken)
//     the owner's proxy injects the real key and relays Anthropic-style SSE.
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { EngineEvent, ProviderKind } from '../../shared/types';
import { extractArtifact, safeVisiblePrefixEnd } from './artifact';
import type { RunCallbacks, RunHandle } from './engine';

export interface ProviderTurnOptions {
  wire: 'anthropic' | 'openai'; // SSE dialect to parse
  url: string; // fully-resolved endpoint
  headers: Record<string, string>;
  model: string;
  systemPrompt: string;
  userText: string;
  workspace: string;
  entry: string; // canonical deliverable filename, e.g. index.html
  maxTokens?: number;
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
}

export function openaiHeaders(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
}

export function joinUrl(base: string, suffix: string): string {
  return base.replace(/\/+$/, '') + suffix;
}

export async function runProviderTurn(opts: ProviderTurnOptions, cb: RunCallbacks): Promise<RunHandle> {
  const runId = randomUUID();
  const controller = new AbortController();
  const maxTokens = opts.maxTokens ?? 16000;

  const body =
    opts.wire === 'anthropic'
      ? {
          model: opts.model,
          max_tokens: maxTokens,
          stream: true,
          system: opts.systemPrompt,
          messages: [{ role: 'user', content: opts.userText }],
        }
      : {
          model: opts.model,
          max_tokens: maxTokens,
          stream: true,
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: opts.userText },
          ],
        };

  cb.onEvent({ type: 'status', state: 'starting', detail: describeUrl(opts.url) });

  void (async () => {
    let full = '';
    let emitted = 0;
    let flushedTool = false;

    const flushProse = (final: boolean) => {
      const end = final ? boundaryOrEnd(full) : safeVisiblePrefixEnd(full);
      if (end === null || end <= emitted) return;
      const chunk = full.slice(emitted, end);
      emitted = end;
      if (chunk.trim()) cb.onEvent({ type: 'assistant-text', text: chunk });
    };

    try {
      const res = await fetch(opts.url, {
        method: 'POST',
        headers: opts.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await safeText(res);
        cb.onEvent({ type: 'status', state: 'error', detail: friendlyHttpError(res.status, errText) });
        cb.onExit(1);
        return;
      }
      cb.onEvent({ type: 'status', state: 'working', detail: opts.model });

      for await (const data of sseData(res.body)) {
        if (data === '[DONE]') break;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = opts.wire === 'anthropic' ? anthropicDelta(json) : openaiDelta(json);
        if (delta) {
          full += delta;
          flushProse(false);
          // As soon as the model starts emitting the document, show a Write chip.
          if (!flushedTool && safeVisiblePrefixEnd(full) === null) {
            flushedTool = true;
            cb.onEvent({ type: 'tool', id: 'artifact', name: 'Write', detail: opts.entry, state: 'running' });
          }
        }
        const err = anthropicError(json);
        if (err) {
          cb.onEvent({ type: 'status', state: 'error', detail: err });
          cb.onExit(1);
          return;
        }
      }

      flushProse(true);

      const artifact = extractArtifact(full);
      if (!artifact) {
        // Model answered but produced no document (e.g. it asked questions).
        if (!full.trim()) cb.onEvent({ type: 'assistant-text', text: '(empty response)' });
        cb.onEvent({ type: 'result', summary: '' });
        cb.onEvent({ type: 'status', state: 'done' });
        cb.onExit(0);
        return;
      }

      const target = path.join(opts.workspace, opts.entry);
      await fs.writeFile(target, artifact.content, 'utf8');
      cb.onEvent({ type: 'tool', id: 'artifact', name: 'Write', detail: opts.entry, state: 'done' });
      cb.onEvent({ type: 'file', path: opts.entry, action: 'written' });
      const summary = artifact.prose || `Wrote ${opts.entry} (${artifact.content.length.toLocaleString()} bytes).`;
      cb.onEvent({ type: 'result', summary });
      cb.onEvent({ type: 'status', state: 'done' });
      cb.onExit(0);
    } catch (err) {
      if (controller.signal.aborted) {
        cb.onEvent({ type: 'status', state: 'cancelled' });
        cb.onExit(null);
      } else {
        cb.onEvent({ type: 'status', state: 'error', detail: `Request failed: ${(err as Error).message}` });
        cb.onExit(1);
      }
    }
  })();

  return {
    runId,
    cancel() {
      controller.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// SSE + delta parsing

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    // SSE events are separated by a blank line; a data field may span lines.
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trim();
}

function anthropicDelta(json: any): string {
  if (json?.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
    return String(json.delta.text ?? '');
  }
  return '';
}

function anthropicError(json: any): string | null {
  if (json?.type === 'error') return String(json.error?.message ?? 'provider error');
  return null;
}

function openaiDelta(json: any): string {
  const choice = json?.choices?.[0];
  return String(choice?.delta?.content ?? '');
}

// ---------------------------------------------------------------------------

/** For the final flush: emit everything up to the artifact boundary (or all). */
function boundaryOrEnd(full: string): number {
  const artifactAt = full.search(/<artifact\b/i);
  const fenceAt = full.indexOf('```');
  const htmlAt = full.search(/<!doctype html>|<html\b/i);
  const marks = [artifactAt, fenceAt, htmlAt].filter((n) => n >= 0);
  return marks.length ? Math.min(...marks) : full.length;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 600);
  } catch {
    return '';
  }
}

function friendlyHttpError(status: number, body: string): string {
  if (status === 401 || status === 403) return `Auth rejected (${status}). Check the API key / usage token.`;
  if (status === 429) return `Rate limited or out of quota (429). ${extractMessage(body)}`.trim();
  if (status >= 500) return `Provider error (${status}). Try again shortly.`;
  return `Request failed (${status}). ${extractMessage(body)}`.trim();
}

function extractMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    return String(j.error?.message ?? j.message ?? '').slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function describeUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'provider';
  }
}
