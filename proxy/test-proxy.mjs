// Proxy verification: fake Anthropic upstream + real proxy child process.
// Checks: token auth (401), SSE relay + metering (200 + usage.json), and
// monthly-cap enforcement (429).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}: ${msg}`);
  if (!cond) failures++;
};

function sse(obj) { return `event: x\ndata: ${JSON.stringify(obj)}\n\n`; }

// --- fake upstream emulating Anthropic /v1/messages streaming ---
const upstream = createServer((req, res) => {
  check(req.headers['x-api-key'] === 'server-side-key', 'upstream receives server-side key, not client token');
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write(sse({ type: 'message_start', message: { usage: { input_tokens: 1000, output_tokens: 1 } } }));
  res.write(sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: '<artifact type="text/html"><!doctype html><html><body>hi</body></html></artifact>' } }));
  res.write(sse({ type: 'message_delta', usage: { output_tokens: 1000 } }));
  res.write(sse({ type: 'message_stop' }));
  res.end();
});

async function main() {
  await new Promise((r) => upstream.listen(0, r));
  const upstreamPort = upstream.address().port;

  const dir = mkdtempSync(path.join(tmpdir(), 'uio-proxy-test-'));
  const tokensFile = path.join(dir, 'tokens.json');
  const usageFile = path.join(dir, 'usage.json');
  const GOOD = 'uio_good_token';
  const OVER = 'uio_over_token';
  writeFileSync(tokensFile, JSON.stringify({
    [GOOD]: { label: 'good', monthlyLimitUsd: 100 },
    [OVER]: { label: 'over', monthlyLimitUsd: 1 },
  }));
  // Pre-seed the OVER token as already over its cap this month. (A fresh token
  // always gets its first call — cost isn't known until after the call — so
  // the 429 path only triggers once recorded spend exceeds the limit.)
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  writeFileSync(usageFile, JSON.stringify({ [OVER]: { [month]: { usd: 5, calls: 3 } } }));

  const proxyPort = 8799;
  const child = spawn('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'server.mjs')], {
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'server-side-key',
      UPSTREAM_BASE: `http://127.0.0.1:${upstreamPort}`,
      TOKENS_FILE: tokensFile,
      USAGE_FILE: usageFile,
      PORT: String(proxyPort),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const base = `http://127.0.0.1:${proxyPort}`;
  await waitFor(`${base}/health`);

  // health
  const health = await fetch(`${base}/health`).then((r) => r.json());
  check(health.ok === true, 'GET /health ok');

  // 401 on bad/missing token
  const noAuth = await fetch(`${base}/v1/design/stream`, { method: 'POST', body: '{}' });
  check(noAuth.status === 401, 'missing token → 401');

  // 200 + relay + metering on good token
  const body = JSON.stringify({ model: 'default', max_tokens: 4000, system: 's', messages: [{ role: 'user', content: 'hi' }] });
  const good = await fetch(`${base}/v1/design/stream`, {
    method: 'POST',
    headers: { authorization: `Bearer ${GOOD}`, 'content-type': 'application/json' },
    body,
  });
  check(good.status === 200, 'good token → 200');
  const text = await good.text();
  check(text.includes('<artifact') && text.includes('message_stop'), 'SSE relayed verbatim to client');
  // usage ledger updated (input 1000 * $3/M + output 1000 * $15/M = $0.018)
  await sleep(150);
  const usage = JSON.parse(readFileSync(usageFile, 'utf8'));
  const spentMonth = Object.keys(usage[GOOD] || {})[0];
  const spent = usage[GOOD]?.[spentMonth]?.usd || 0;
  check(Math.abs(spent - 0.018) < 1e-6, `metered spend recorded ($${spent.toFixed(4)})`);

  // 429 when over the cap
  const over = await fetch(`${base}/v1/design/stream`, {
    method: 'POST',
    headers: { authorization: `Bearer ${OVER}`, 'content-type': 'application/json' },
    body,
  });
  check(over.status === 429, 'over-cap token → 429');

  child.kill();
  upstream.close();
  console.log(failures === 0 ? '\n[test-proxy] PASS' : `\n[test-proxy] ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(100);
  }
  throw new Error(`server never came up at ${url}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
