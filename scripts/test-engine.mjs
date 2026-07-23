// Bundles the smoke test (core modules only, no electron) and runs it against
// a real agent CLI. Workspace defaults to a temp dir; override with SMOKE_ROOT.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'dist-electron', 'smoke.cjs');

await build({
  entryPoints: [path.join(root, 'electron', 'testing', 'smoke.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  logLevel: 'warning',
});

const workspaceRoot = process.env.SMOKE_ROOT || mkdtempSync(path.join(tmpdir(), 'vds-smoke-'));
const runtimeId = process.argv[2] || 'claude';
const child = spawn('node', [outfile, path.join(root, 'library'), workspaceRoot, runtimeId], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
