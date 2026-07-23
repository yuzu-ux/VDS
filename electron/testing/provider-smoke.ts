// Verifies the direct-API execution profile end to end without a real key:
// stand up a fake Anthropic /v1/messages SSE server, run a provider turn
// against it, and assert the HTML artifact is extracted and written to the
// workspace with the expected events.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { EngineEvent } from '../../shared/types';
import { anthropicHeaders, joinUrl, runProviderTurn } from '../core/providers';
import { extractArtifact } from '../core/artifact';

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`[provider-smoke] FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[provider-smoke] ok: ${msg}`);
}

// --- unit: artifact extraction in all three forms ---
const tagForm = extractArtifact('Prose.\n<artifact type="text/html" title="x"><!doctype html><html><body><section data-vds-id="a">Hi</section></body></html></artifact>');
assert(tagForm && tagForm.content.includes('data-vds-id') && tagForm.prose === 'Prose.', 'extract <artifact> tag form');
const fenceForm = extractArtifact('Here:\n```html\n<!doctype html><html><body>Y</body></html>\n```');
assert(fenceForm && fenceForm.content.includes('<!doctype html>'), 'extract ```html fence form');
const rawForm = extractArtifact('sure\n<!doctype html><html><head></head><body>Z</body></html>\ndone');
assert(rawForm && rawForm.extension === '.html' && rawForm.content.includes('body>Z'), 'extract raw html form');

// --- fake Anthropic streaming server ---
const HTML = '<!doctype html><html><head><title>Bean There</title></head><body><section data-vds-id="hero"><h1>Bean There</h1></section></body></html>';
const CHUNKS = [
  'Direction: editorial paper + ink — fits a specialty coffee cart.\n\n',
  '<artifact identifier="index" type="text/html" title="Bean There">\n',
  HTML.slice(0, 60),
  HTML.slice(60),
  '\n</artifact>',
];

function sse(obj: unknown) {
  return `event: x\ndata: ${JSON.stringify(obj)}\n\n`;
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    // sanity: our client must send system + a user message
    if (typeof parsed.system !== 'string' || !Array.isArray(parsed.messages)) {
      res.writeHead(400).end('bad');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(sse({ type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 1 } } }));
    for (const text of CHUNKS) res.write(sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }));
    res.write(sse({ type: 'message_delta', usage: { output_tokens: 900 } }));
    res.write(sse({ type: 'message_stop' }));
    res.end();
  });
});

server.listen(0, async () => {
  const port = (server.address() as any).port;
  const workspace = mkdtempSync(path.join(tmpdir(), 'vds-prov-'));
  const events: EngineEvent[] = [];

  const done = new Promise<number | null>((resolve) => {
    void runProviderTurn(
      {
        wire: 'anthropic',
        url: joinUrl(`http://127.0.0.1:${port}`, '/v1/messages'),
        headers: anthropicHeaders('test-key'),
        model: 'claude-sonnet-4-5',
        systemPrompt: 'You are the design engine.',
        userText: 'A landing page for Bean There.',
        workspace,
        entry: 'index.html',
      },
      {
        onEvent: (e) => {
          events.push(e);
          const tag = e.type === 'assistant-text' ? `: ${e.text.slice(0, 40).replace(/\n/g, ' ')}` : e.type === 'status' ? `: ${e.state}` : '';
          console.log(`[event] ${e.type}${tag}`);
        },
        onSession: () => {},
        onExit: (code) => resolve(code),
      },
    );
  });

  const code = await done;
  server.close();

  const wrote = readFileSync(path.join(workspace, 'index.html'), 'utf8');
  assert(code === 0, 'provider run exited 0');
  assert(wrote === HTML, 'index.html equals the artifact HTML exactly');
  assert(events.some((e) => e.type === 'assistant-text' && /editorial/.test((e as any).text)), 'streamed the direction prose');
  assert(events.some((e) => e.type === 'file' && (e as any).path === 'index.html'), 'emitted file event');
  assert(events.some((e) => e.type === 'tool' && (e as any).name === 'Write' && (e as any).state === 'done'), 'emitted Write tool done');
  assert(events.some((e) => e.type === 'result'), 'emitted result');
  assert(!events.some((e) => e.type === 'assistant-text' && /<artifact|doctype/i.test((e as any).text)), 'did not leak artifact/code into chat prose');
  console.log('[provider-smoke] PASS');
  process.exit(0);
});
