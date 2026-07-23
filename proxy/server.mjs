// VDS hosted proxy — the ONLY server-side component of VDS.
//
// It lets people who have no Claude plan of their own design through the app
// owner's provider account. The real provider API key lives here, never on the
// client. Each user gets a usage token (Bearer) with a monthly USD cap; the
// proxy meters spend from the model's own token-usage events and refuses once
// the cap is hit.
//
// Zero dependencies — Node 20+ only (built-in http + global fetch).
//
// IMPORTANT (policy): back this with a commercial Anthropic **API key**
// (billed per token). Do NOT wire it to a personal Claude Pro/Max seat —
// consumer subscriptions are single-user, share one rate limit, and their
// terms do not permit reselling/sharing access. See README.md.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8787);
const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const TOKENS_FILE = process.env.TOKENS_FILE || new URL('./tokens.json', import.meta.url).pathname;
const USAGE_FILE = process.env.USAGE_FILE || new URL('./usage.json', import.meta.url).pathname;
const MAX_TOKENS_CEILING = Number(process.env.MAX_TOKENS_CEILING || 20000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Model label (what the client sends) -> real upstream model. The client never
// picks the real model; the owner controls cost here.
const MODEL_MAP = {
  default: 'claude-sonnet-4-5',
  fast: 'claude-haiku-4-5',
  best: 'claude-opus-4-5',
  ...(process.env.MODEL_MAP ? JSON.parse(process.env.MODEL_MAP) : {}),
};

// Approx USD per 1M tokens, for quota metering only (not billing-accurate).
const PRICE = {
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-opus-4-5': { in: 15, out: 75 },
};
const FALLBACK_PRICE = { in: 3, out: 15 };

if (!API_KEY) {
  console.error('[vds-proxy] ANTHROPIC_API_KEY is required'); process.exit(1);
}

function loadJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
function monthKey(d = new Date()) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }

// usage.json shape: { "<token>": { "<YYYY-MM>": { usd: number, calls: number } } }
let usageLock = Promise.resolve();
function recordSpend(token, usd) {
  usageLock = usageLock.then(() => {
    const usage = loadJson(USAGE_FILE, {});
    const m = monthKey();
    usage[token] = usage[token] || {};
    usage[token][m] = usage[token][m] || { usd: 0, calls: 0 };
    usage[token][m].usd += usd;
    usage[token][m].calls += 1;
    writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
  }).catch((e) => console.error('[vds-proxy] usage write failed', e));
  return usageLock;
}
function spentThisMonth(token) {
  const usage = loadJson(USAGE_FILE, {});
  return usage[token]?.[monthKey()]?.usd || 0;
}

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': ALLOWED_ORIGIN });
  res.end(JSON.stringify(obj));
}
function apiError(res, status, message) { json(res, status, { error: { message } }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 2_000_000) { reject(new Error('body too large')); req.destroy(); } data += c; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': ALLOWED_ORIGIN,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
    });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'vds-proxy', models: Object.keys(MODEL_MAP) });
  }

  if (req.method === 'POST' && url.pathname === '/v1/design/stream') {
    return handleDesignStream(req, res);
  }

  return apiError(res, 404, 'Not found');
});

async function handleDesignStream(req, res) {
  // --- auth ---
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const tokens = loadJson(TOKENS_FILE, {});
  const record = tokens[token];
  if (!token || !record || record.disabled) return apiError(res, 401, 'Invalid or disabled usage token.');

  // --- quota ---
  const limit = Number(record.monthlyLimitUsd ?? 0);
  const spent = spentThisMonth(token);
  if (limit > 0 && spent >= limit) {
    return apiError(res, 429, `Monthly limit reached ($${spent.toFixed(2)} of $${limit.toFixed(2)}). Resets on the 1st (UTC).`);
  }

  // --- request ---
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return apiError(res, 400, 'Invalid JSON body.'); }
  const realModel = record.model || MODEL_MAP[body.model] || MODEL_MAP.default;
  const maxTokens = Math.min(Number(body.max_tokens || 8000), MAX_TOKENS_CEILING);
  const payload = {
    model: realModel,
    max_tokens: maxTokens,
    stream: true,
    system: typeof body.system === 'string' ? body.system : undefined,
    messages: Array.isArray(body.messages) ? body.messages : [],
  };

  // --- forward + relay SSE ---
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM_BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return apiError(res, 502, `Upstream unreachable: ${e.message}`);
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return apiError(res, upstream.status, `Upstream error: ${text.slice(0, 300)}`);
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': ALLOWED_ORIGIN,
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = '';
  let inputTokens = 0;
  let outputTokens = 0;

  // Relay chunks verbatim (so the app's Anthropic SSE parser is unchanged),
  // sniffing only usage counters line-by-line without retaining content.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    res.write(chunk);
    lineBuf += chunk;
    let idx;
    while ((idx = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, idx);
      lineBuf = lineBuf.slice(idx + 1);
      if (line.startsWith('data:') && line.includes('"usage"')) {
        try {
          const evt = JSON.parse(line.slice(5).trim());
          const u = evt?.message?.usage || evt?.usage;
          if (u) {
            if (typeof u.input_tokens === 'number' && u.input_tokens) inputTokens = u.input_tokens;
            if (typeof u.output_tokens === 'number') outputTokens = u.output_tokens;
          }
        } catch {}
      }
    }
  }
  res.end();

  const price = PRICE[realModel] || FALLBACK_PRICE;
  const usd = (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
  await recordSpend(token, usd);
  console.log(`[vds-proxy] token=${token.slice(0, 8)}… model=${realModel} in=${inputTokens} out=${outputTokens} $${usd.toFixed(4)} (month $${(spent + usd).toFixed(2)}/${limit || '∞'})`);
}

server.listen(PORT, () => {
  if (!existsSync(TOKENS_FILE)) console.warn(`[vds-proxy] no tokens file at ${TOKENS_FILE} — run: node mint-token.mjs "name" <monthlyUsd>`);
  console.log(`[vds-proxy] listening on :${PORT} → ${UPSTREAM_BASE} · models: ${Object.keys(MODEL_MAP).join(', ')}`);
});
