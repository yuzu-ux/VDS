// Bundle + run the provider smoke test (fake Anthropic SSE, no real key).
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist-electron', 'provider-smoke.cjs');

await build({
  entryPoints: [path.join(root, 'electron', 'testing', 'provider-smoke.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'warning',
});

const child = spawn('node', [outfile], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
