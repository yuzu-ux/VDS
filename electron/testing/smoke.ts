// Engine smoke test: exercises the full generation pipeline against a real
// agent CLI, no Electron involved. Usage (via scripts/test-engine.mjs):
//   node smoke.cjs <bundled-library-dir> <workspace-root> [runtimeId]
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Library } from '../core/library';
import { ProjectStore } from '../core/projects';
import { composeTurnPrompt } from '../core/prompt';
import { detectRuntimes } from '../core/runtimes';
import { startRun } from '../core/engine';

async function main() {
  const [libraryDir, workspaceRoot, runtimeId = 'claude'] = process.argv.slice(2);
  if (!libraryDir || !workspaceRoot) {
    console.error('usage: smoke <library-dir> <workspace-root> [runtimeId]');
    process.exit(2);
  }

  const library = new Library(libraryDir);
  const store = new ProjectStore(workspaceRoot);
  const project = await store.create({
    name: 'smoke-bean-there',
    skillId: 'web-prototype',
    designSystemId: 'editorial-serif',
    fidelity: 'high',
  });
  await library.installIntoWorkspace(project.dir, project.skillId, project.designSystemId);
  console.log(`[smoke] workspace: ${project.dir}`);

  const skill = await library.getSkill('web-prototype');
  const prompt = composeTurnPrompt({
    project,
    skill: skill!,
    hasDesignSystem: true,
    isFirstTurn: true,
    userPrompt:
      "A one-screen landing page for 'Bean There', a specialty coffee cart in Bangkok. Hero, one three-card row (single origin beans / slow bar / find the cart), closing CTA. Keep it compact.",
  });

  const runtimes = await detectRuntimes();
  const runtime = runtimes.find((r) => r.id === runtimeId && r.available);
  if (!runtime?.resolvedPath) {
    console.error(`[smoke] runtime ${runtimeId} not available`);
    process.exit(3);
  }
  console.log(`[smoke] engine: ${runtime.name} ${runtime.version}`);

  const done = new Promise<number | null>((resolve) => {
    void startRun(
      {
        runtimeId: runtime.id,
        resolvedPath: runtime.resolvedPath!,
        cwd: project.dir,
        prompt,
      },
      {
        onEvent: (event) => {
          switch (event.type) {
            case 'status':
              console.log(`[status] ${event.state}${event.detail ? ` — ${event.detail}` : ''}`);
              break;
            case 'assistant-text':
              console.log(`[text] ${event.text.slice(0, 160).replace(/\n/g, ' ')}`);
              break;
            case 'tool':
              console.log(`[tool] ${event.name} ${event.detail} (${event.state})`);
              break;
            case 'todos':
              console.log(`[todos] ${event.items.map((t) => `${t.state[0]}:${t.text.slice(0, 30)}`).join(' | ')}`);
              break;
            case 'file':
              console.log(`[file] ${event.path}`);
              break;
            case 'result':
              console.log(`[result] ${event.durationMs}ms $${event.costUsd ?? '?'} — ${event.summary.slice(0, 120).replace(/\n/g, ' ')}`);
              break;
          }
        },
        onSession: (id) => console.log(`[session] ${id}`),
        onExit: (code) => resolve(code),
      },
    ).then((handle) => {
      setTimeout(() => {
        console.error('[smoke] TIMEOUT after 8 minutes, cancelling');
        handle.cancel();
      }, 8 * 60 * 1000).unref();
    });
  });

  const code = await done;
  const entryPath = path.join(project.dir, 'index.html');
  try {
    const html = await fs.readFile(entryPath, 'utf8');
    const hasIds = html.includes('data-uio-id');
    const selfContained = !/https?:\/\/[^"' ]+\.(png|jpg|css|js|woff)/i.test(html);
    console.log(`[verify] index.html: ${html.length} bytes · data-uio-id: ${hasIds} · self-contained: ${selfContained}`);
    if (code === 0 && hasIds) {
      console.log('[smoke] PASS');
      process.exit(0);
    }
    console.log(`[smoke] PARTIAL (exit ${code})`);
    process.exit(hasIds ? 0 : 1);
  } catch {
    console.error(`[verify] index.html missing (exit ${code})`);
    process.exit(1);
  }
}

void main();
