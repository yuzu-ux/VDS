# UIO Hosted Proxy

The one server-side piece of UIO. Run this if you want people **without their
own Claude/agent plan** to design using *your* provider account — they install
UIO, choose **Engine → Hosted**, paste a usage token you give them, and go.
Everything else in UIO stays on their Mac; only the model call leaves it.

```
UIO app (user)  ──Bearer usageToken──▶  this proxy  ──x-api-key──▶  Anthropic
   no API key                       your API key here          real model
```

- **Real key stays server-side.** Clients only ever hold a usage token.
- **Per-user monthly caps** in USD, metered from the model's own token counts.
- **You control the model.** Clients send a label (`default`/`fast`/`best`);
  the proxy maps it to a real model, so a user can't opt into your priciest one.
- **Zero dependencies.** Node 20+ and the built-in HTTP server.

## ⚠️ Use a commercial API key, not a personal subscription

Back this with an **Anthropic API key** from the [Anthropic Console](https://console.anthropic.com)
(pay-per-token, billed to you). That is the supported, allowed way to resell or
share access.

Do **not** point it at a personal **Claude Pro/Max** login. Consumer
subscriptions are single-user, share one rate limit, and their terms don't
permit sharing/reselling access — you'd risk the account and get one shared
throttle for everyone. The proxy talks the Anthropic **API** protocol on
purpose. (OpenAI-compatible upstreams work too — set `UPSTREAM_BASE`.)

## Run it

```bash
cd proxy
export ANTHROPIC_API_KEY=sk-ant-...        # your commercial API key
node mint-token.mjs "alice" 5              # $5/month token for Alice
npm start                                  # listens on :8787
```

`mint-token.mjs` prints a `uio_…` token — hand that to the user along with your
endpoint URL. In UIO: **Settings → Engine → Hosted**, set the endpoint and paste
the token.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — (required) | Your commercial provider key |
| `PORT` | `8787` | Listen port |
| `UPSTREAM_BASE` | `https://api.anthropic.com` | Provider base (Anthropic-compatible) |
| `MODEL_MAP` | see below | JSON: label → real model |
| `MAX_TOKENS_CEILING` | `20000` | Hard cap on `max_tokens` per call |
| `TOKENS_FILE` | `./tokens.json` | Usage-token store |
| `USAGE_FILE` | `./usage.json` | Monthly spend ledger |
| `ALLOWED_ORIGIN` | `*` | CORS origin |

Default model map: `{ "default": "claude-sonnet-4-5", "fast": "claude-haiku-4-5", "best": "claude-opus-4-5" }`.

## Token store

`tokens.json` (git-ignored) maps each token to a policy. See
`tokens.example.json`:

```json
{
  "uio_abc123…": { "label": "alice", "monthlyLimitUsd": 5, "model": "default", "disabled": false }
}
```

Set `"disabled": true` to cut a user off. Set `"model"` to pin a token to one
model. Spend resets on the 1st (UTC); metering is approximate (from streamed
token usage × a price table) and is for quota control, not exact billing.

## Endpoints

- `GET /health` → `{ ok: true, models: [...] }` (UIO's "Test engine" pings this).
- `POST /v1/design/stream` → Bearer-authed; relays the provider's SSE stream
  verbatim so the app parses it exactly like a direct Anthropic call.

## Deploy notes

Put it behind HTTPS (a reverse proxy or a platform that terminates TLS) —
UIO refuses non-`https` hosted endpoints except `localhost`. Keep
`/v1/design/stream` unbuffered so streaming works (disable proxy buffering).
For anything beyond a handful of users, move `tokens.json`/`usage.json` to a
real datastore; the JSON files are fine for small groups and demos.
