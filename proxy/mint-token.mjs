// Mint a usage token for a user and append it to tokens.json.
// Usage:  node mint-token.mjs "alice" 5           # $5/month cap, default model
//         node mint-token.mjs "bob" 20 best       # $20/month, forced to 'best'
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const TOKENS_FILE = process.env.TOKENS_FILE || new URL('./tokens.json', import.meta.url).pathname;
const [, , label, limitArg, model] = process.argv;

if (!label) {
  console.error('usage: node mint-token.mjs "<label>" [monthlyUsd] [modelLabel]');
  process.exit(2);
}

const tokens = existsSync(TOKENS_FILE) ? JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) : {};
const token = 'vds_' + randomBytes(24).toString('base64url');
tokens[token] = {
  label,
  monthlyLimitUsd: Number(limitArg || 5),
  ...(model ? { model } : {}),
  createdAt: new Date().toISOString(),
};
writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));

console.log(`Minted token for "${label}" — $${tokens[token].monthlyLimitUsd}/month${model ? ` (model: ${model})` : ''}`);
console.log(`\n  ${token}\n`);
console.log('Give this to the user. In VDS: Settings → Engine → Hosted → Usage token.');
