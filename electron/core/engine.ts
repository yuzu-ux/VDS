// The generation engine: spawns a runtime in the project workspace, parses its
// stream into normalized EngineEvents (the IPC equivalent of Open Design's SSE
// stream), and reports session ids for CLIs that support resume.
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { EngineEvent } from '../../shared/types';
import { getDef, loginShellEnv, spawnRuntime, type RuntimeDef } from './runtimes';

export interface RunHandle {
  runId: string;
  cancel(): void;
}

export interface RunCallbacks {
  onEvent(event: EngineEvent): void;
  /** Called when the CLI reports its own session id (claude init / codex thread.started). */
  onSession(sessionId: string): void;
  onExit(code: number | null): void;
}

interface RunOptions {
  runtimeId: string;
  resolvedPath: string;
  cwd: string;
  prompt: string;
  model?: string;
  resumeSessionId?: string;
}

export async function startRun(opts: RunOptions, cb: RunCallbacks): Promise<RunHandle> {
  const def = getDef(opts.runtimeId);
  const env = await loginShellEnv();
  const runId = randomUUID();
  const newSessionId = def.id === 'claude' && !opts.resumeSessionId ? randomUUID() : undefined;

  const child = spawnRuntime({
    def,
    resolvedPath: opts.resolvedPath,
    cwd: opts.cwd,
    env,
    prompt: opts.prompt,
    model: opts.model,
    resumeSessionId: opts.resumeSessionId,
    newSessionId,
  });

  if (newSessionId) cb.onSession(newSessionId);
  cb.onEvent({ type: 'status', state: 'starting', detail: def.name });

  let cancelled = false;
  let sawAnyEvent = false;

  const feed = makeParser(def, {
    emit: (event) => {
      sawAnyEvent = true;
      cb.onEvent(event);
    },
    onSession: cb.onSession,
  });

  wireLines(child, feed);

  let stderrTail = '';
  child.stderr.on('data', (buf: Buffer) => {
    stderrTail = (stderrTail + buf.toString()).slice(-4000);
  });

  child.on('error', (err) => {
    cb.onEvent({ type: 'status', state: 'error', detail: `Failed to launch ${def.name}: ${err.message}` });
    cb.onExit(-1);
  });

  child.on('close', (code) => {
    if (cancelled) {
      cb.onEvent({ type: 'status', state: 'cancelled' });
    } else if (code === 0) {
      cb.onEvent({ type: 'status', state: 'done' });
    } else {
      const detail = sawAnyEvent
        ? `${def.name} exited with code ${code}`
        : `${def.name} exited with code ${code}: ${stderrTail.trim().slice(-600) || 'no output'}`;
      cb.onEvent({ type: 'status', state: 'error', detail });
    }
    cb.onExit(code);
  });

  return {
    runId,
    cancel() {
      cancelled = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 3000).unref();
      } catch {}
    },
  };
}

function wireLines(child: ChildProcess, onLine: (line: string) => void) {
  let buffer = '';
  child.stdout!.on('data', (buf: Buffer) => {
    buffer += buf.toString();
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) onLine(line);
    }
  });
  child.stdout!.on('end', () => {
    const line = buffer.trim();
    if (line) onLine(line);
  });
}

// ---------------------------------------------------------------------------
// Stream parsers

interface ParserSink {
  emit(event: EngineEvent): void;
  onSession(sessionId: string): void;
}

function makeParser(def: RuntimeDef, sink: ParserSink): (line: string) => void {
  switch (def.streamFormat) {
    case 'claude-json':
      return claudeParser(sink);
    case 'codex-json':
      return codexParser(sink);
    default:
      return (line) => sink.emit({ type: 'raw', text: line });
  }
}

/** Claude Code `--output-format stream-json` (JSONL). */
function claudeParser(sink: ParserSink): (line: string) => void {
  const runningTools = new Map<string, string>(); // tool_use_id -> name
  return (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      sink.emit({ type: 'raw', text: line });
      return;
    }
    switch (msg.type) {
      case 'system': {
        if (msg.subtype === 'init') {
          if (typeof msg.session_id === 'string') sink.onSession(msg.session_id);
          sink.emit({ type: 'status', state: 'working', detail: msg.model });
        }
        break;
      }
      case 'assistant': {
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type === 'text' && block.text?.trim()) {
            sink.emit({ type: 'assistant-text', text: block.text });
          } else if (block.type === 'tool_use') {
            if (block.name === 'TodoWrite' && Array.isArray(block.input?.todos)) {
              sink.emit({
                type: 'todos',
                items: block.input.todos.map((t: any) => ({
                  text: String(t.content ?? t.activeForm ?? ''),
                  state: (t.status ?? 'pending') as 'pending' | 'in_progress' | 'completed',
                })),
              });
            } else {
              runningTools.set(block.id, block.name);
              sink.emit({
                type: 'tool',
                id: block.id,
                name: block.name,
                detail: describeToolInput(block.name, block.input),
                state: 'running',
              });
              const filePath = block.input?.file_path;
              if ((block.name === 'Write' || block.name === 'Edit') && typeof filePath === 'string') {
                sink.emit({ type: 'file', path: filePath, action: 'written' });
              }
            }
          }
        }
        break;
      }
      case 'user': {
        const content = msg.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type === 'tool_result' && runningTools.has(block.tool_use_id)) {
            sink.emit({
              type: 'tool',
              id: block.tool_use_id,
              name: runningTools.get(block.tool_use_id)!,
              detail: '',
              state: block.is_error ? 'error' : 'done',
            });
            runningTools.delete(block.tool_use_id);
          }
        }
        break;
      }
      case 'result': {
        if (typeof msg.session_id === 'string') sink.onSession(msg.session_id);
        const summary = typeof msg.result === 'string' ? msg.result : '';
        if (/not logged in/i.test(summary)) {
          sink.emit({
            type: 'status',
            state: 'error',
            detail:
              'Claude Code has no CLI login on this Mac. Open Terminal, run `claude`, complete /login once, then retry here.',
          });
          break;
        }
        sink.emit({
          type: 'result',
          summary,
          durationMs: msg.duration_ms,
          costUsd: msg.total_cost_usd,
        });
        break;
      }
      default:
        break; // stream_event and friends: ignore quietly
    }
  };
}

function describeToolInput(name: string, input: any): string {
  if (!input) return '';
  if (typeof input.file_path === 'string') return shortenPath(input.file_path);
  if (typeof input.command === 'string') return input.command.slice(0, 120);
  if (typeof input.pattern === 'string') return input.pattern.slice(0, 120);
  if (typeof input.url === 'string') return input.url.slice(0, 120);
  if (typeof input.description === 'string') return input.description.slice(0, 120);
  return '';
}

function shortenPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : p;
}

/** Codex CLI `exec --json` (JSONL, tolerant across versions). */
function codexParser(sink: ParserSink): (line: string) => void {
  let toolSeq = 0;
  return (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      sink.emit({ type: 'raw', text: line });
      return;
    }
    // Newer shape: { type: 'thread.started' | 'item.started' | 'item.completed' | 'turn.completed', ... }
    const type: string = msg.type ?? msg.msg?.type ?? '';
    if (type === 'thread.started' && typeof msg.thread_id === 'string') {
      sink.onSession(msg.thread_id);
      sink.emit({ type: 'status', state: 'working' });
      return;
    }
    const item = msg.item ?? null;
    if ((type === 'item.started' || type === 'item.completed') && item) {
      const done = type === 'item.completed';
      switch (item.type) {
        case 'agent_message':
          if (done && typeof item.text === 'string' && item.text.trim()) {
            sink.emit({ type: 'assistant-text', text: item.text });
          }
          return;
        case 'reasoning':
          return; // keep chat clean
        case 'command_execution':
          sink.emit({
            type: 'tool',
            id: String(item.id ?? `codex-${toolSeq++}`),
            name: 'Shell',
            detail: String(item.command ?? '').slice(0, 120),
            state: done ? (item.status === 'failed' ? 'error' : 'done') : 'running',
          });
          return;
        case 'file_change': {
          const changes = Array.isArray(item.changes) ? item.changes : [];
          for (const change of changes) {
            if (typeof change.path === 'string') {
              sink.emit({ type: 'file', path: change.path, action: 'written' });
            }
          }
          if (done) {
            sink.emit({
              type: 'tool',
              id: String(item.id ?? `codex-${toolSeq++}`),
              name: 'Edit',
              detail: changes.map((c: any) => shortenPath(String(c.path ?? ''))).join(', ').slice(0, 120),
              state: 'done',
            });
          }
          return;
        }
        case 'todo_list':
          if (Array.isArray(item.items)) {
            sink.emit({
              type: 'todos',
              items: item.items.map((t: any) => ({
                text: String(t.text ?? t.content ?? ''),
                state: t.completed ? 'completed' : 'pending',
              })),
            });
          }
          return;
        default:
          return;
      }
    }
    if (type === 'turn.completed') {
      sink.emit({ type: 'result', summary: '' });
      return;
    }
    if (type === 'error') {
      sink.emit({ type: 'status', state: 'error', detail: String(msg.message ?? 'codex error') });
      return;
    }
    // Older shape: { msg: { type: 'agent_message', message: '...' } }
    if (msg.msg?.type === 'agent_message' && typeof msg.msg.message === 'string') {
      sink.emit({ type: 'assistant-text', text: msg.msg.message });
    }
  };
}
