// Dev lifecycle: build electron main/preload, start Vite, launch Electron
// pointed at the Vite dev server. Ctrl-C tears everything down.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const buildMain = spawn('node', ['scripts/build-electron.mjs'], { stdio: 'inherit' });
await new Promise((resolve, reject) => {
  buildMain.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('electron build failed'))));
});

const vite = await createServer();
await vite.listen();
const url = vite.resolvedUrls.local[0];
console.log(`[dev] vite at ${url}`);

const electron = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
electron.on('exit', async () => {
  await vite.close();
  process.exit(0);
});
