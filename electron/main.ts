// UIO main process — plays the role Open Design gives its local daemon:
// project persistence, library registries, runtime detection, run lifecycle,
// and export. The renderer talks to it over typed IPC (see preload.ts).
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import type {
  AppSettings,
  EngineCheck,
  EngineEvent,
  EngineEventEnvelope,
  EngineSource,
  ProjectMeta,
  SecretName,
  StartTurnRequest,
} from '../shared/types';
import { startRun, type RunCallbacks, type RunHandle } from './core/engine';
import { entryAbsPath, exportHtml, exportPdf } from './core/exporter';
import { Library } from './core/library';
import { defaultProjectsRoot, ProjectStore } from './core/projects';
import { detectRuntimes } from './core/runtimes';
import { composeProviderPrompt, composeTurnPrompt } from './core/prompt';
import { anthropicHeaders, joinUrl, openaiHeaders, runProviderTurn, type ProviderTurnOptions } from './core/providers';
import { SecretStore } from './core/secrets';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
const store = new ProjectStore(defaultProjectsRoot());
const library = new Library(path.join(app.getAppPath(), 'library'));
const activeRuns = new Map<string, RunHandle>();
const watchers = new Map<string, FSWatcher>();
let secrets: SecretStore; // constructed after app is ready (needs userData path)

// ---------------------------------------------------------------------------
// Settings

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

async function loadSettings(): Promise<AppSettings> {
  const defaults: AppSettings = {
    defaultRuntimeId: null,
    defaultModel: null,
    projectsRoot: defaultProjectsRoot(),
    engineSource: 'local-cli',
    byokProvider: 'anthropic',
    byokBaseUrl: 'https://api.anthropic.com',
    byokModel: 'claude-sonnet-4-5',
    hostedEndpoint: '',
    hostedModel: 'default',
  };
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return { ...defaults, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return defaults;
  }
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------------------
// File watching (per project, lazy)

function ensureWatcher(meta: ProjectMeta) {
  if (watchers.has(meta.id)) return;
  try {
    const watcher = watch(meta.dir, { recursive: true }, (_event, filename) => {
      if (!filename || !mainWindow) return;
      const rel = String(filename);
      if (rel.startsWith('.uio') || rel === 'project.json' || rel.startsWith('.')) return;
      mainWindow.webContents.send('file:changed', { projectId: meta.id, path: rel });
    });
    watchers.set(meta.id, watcher);
  } catch {
    // watching is best-effort; the UI can still refresh manually
  }
}

// ---------------------------------------------------------------------------
// Engine wiring

function sendEngineEvent(envelope: EngineEventEnvelope) {
  mainWindow?.webContents.send('engine:event', envelope);
}

async function handleStartTurn(req: StartTurnRequest): Promise<{ runId: string }> {
  const meta = await store.get(req.projectId);
  if (!meta) throw new Error(`Unknown project: ${req.projectId}`);
  const skill = await library.getSkill(meta.skillId);
  if (!skill) throw new Error(`Unknown skill: ${meta.skillId}`);

  const settings = await loadSettings();
  const source: EngineSource = req.source ?? settings.engineSource ?? 'local-cli';

  const transcript = await store.readTranscript(meta);
  const isFirstTurn = !transcript.some((t) => t.kind === 'user');

  await store.appendTranscript(meta, { kind: 'user', text: req.prompt, at: Date.now() });
  ensureWatcher(meta);

  // Shared per-run bookkeeping. `handle` is captured lazily: the engines emit
  // their first event synchronously, before returning, at which point the
  // renderer keys off projectId (not runId), so a 'pending' id is harmless.
  let handle: RunHandle;
  const callbacks = (): RunCallbacks => ({
    onEvent: (event) => {
      if (event.type !== 'raw') void store.appendTranscript(meta, { kind: 'event', event, at: Date.now() });
      sendEngineEvent({ runId: handle?.runId ?? 'pending', projectId: meta.id, event });
      if (event.type === 'file' || event.type === 'result') void store.save(meta);
    },
    onSession: (sessionId) => {
      meta.runtimeSessions[req.runtimeId] = sessionId;
      void store.save(meta);
    },
    onExit: () => {
      activeRuns.delete(handle?.runId ?? '');
    },
  });

  if (source === 'local-cli') {
    handle = await startLocalCliTurn(req, meta, skill, isFirstTurn, callbacks());
  } else {
    handle = await startProviderTurn(source, settings, meta, skill, isFirstTurn, req, callbacks());
  }
  activeRuns.set(handle.runId, handle);
  return { runId: handle.runId };
}

async function startLocalCliTurn(
  req: StartTurnRequest,
  meta: ProjectMeta,
  skill: Awaited<ReturnType<typeof library.getSkill>> & object,
  isFirstTurn: boolean,
  cb: RunCallbacks,
): Promise<RunHandle> {
  const runtimes = await detectRuntimes();
  const runtime = runtimes.find((r) => r.id === req.runtimeId) ?? runtimes.find((r) => r.available);
  if (!runtime?.available || !runtime.resolvedPath) {
    throw new Error('No local agent CLI is available. Install one (e.g. `claude`) or switch the engine to your API key / hosted in Settings.');
  }
  // Refresh skill/design-system copies so library edits reach existing projects.
  await library.installIntoWorkspace(meta.dir, meta.skillId, meta.designSystemId);
  const prompt = composeTurnPrompt({
    project: meta,
    skill,
    hasDesignSystem: !!meta.designSystemId,
    isFirstTurn,
    userPrompt: req.prompt,
    comments: req.comments,
  });
  return startRun(
    {
      runtimeId: runtime.id,
      resolvedPath: runtime.resolvedPath,
      cwd: meta.dir,
      prompt,
      model: req.model,
      resumeSessionId: runtime.supportsResume ? meta.runtimeSessions[runtime.id] : undefined,
    },
    cb,
  );
}

async function startProviderTurn(
  source: Exclude<EngineSource, 'local-cli'>,
  settings: AppSettings,
  meta: ProjectMeta,
  skill: Awaited<ReturnType<typeof library.getSkill>> & object,
  isFirstTurn: boolean,
  req: StartTurnRequest,
  cb: RunCallbacks,
): Promise<RunHandle> {
  const seedHtml = await library.readSkillSeed(meta.skillId);
  const designSystemContract = meta.designSystemId
    ? await library.readDesignSystemContract(meta.designSystemId).catch(() => null)
    : null;
  const currentFileContent = isFirstTurn ? null : await readEntryIfExists(meta, skill.entry);

  const { system, user } = composeProviderPrompt({
    skill,
    seedHtml,
    designSystemContract,
    fidelity: meta.fidelity,
    isFirstTurn,
    currentFileContent,
    userPrompt: req.prompt,
    comments: req.comments,
  });

  const opts = await buildProviderOptions(source, settings, meta, skill.entry);
  return runProviderTurn({ ...opts, systemPrompt: system, userText: user }, cb);
}

async function readEntryIfExists(meta: ProjectMeta, entry: string): Promise<string | null> {
  try {
    return await store.readFile(meta, entry);
  } catch {
    return null;
  }
}

async function buildProviderOptions(
  source: Exclude<EngineSource, 'local-cli'>,
  settings: AppSettings,
  meta: ProjectMeta,
  entry: string,
): Promise<Omit<ProviderTurnOptions, 'systemPrompt' | 'userText'>> {
  const base = { workspace: meta.dir, entry };
  if (source === 'byok') {
    const key = await secrets.get('byokKey');
    if (!key) throw new Error('No API key set. Add one in Settings → Engine → Your API key.');
    if (settings.byokProvider === 'openai') {
      const url = validateHttpUrl(joinUrl(settings.byokBaseUrl, '/v1/chat/completions'));
      return { ...base, wire: 'openai', url, headers: openaiHeaders(key), model: settings.byokModel };
    }
    const url = validateHttpUrl(joinUrl(settings.byokBaseUrl, '/v1/messages'));
    return { ...base, wire: 'anthropic', url, headers: anthropicHeaders(key), model: settings.byokModel };
  }
  // hosted: the owner's proxy holds the real key; we send only a usage token.
  const token = await secrets.get('hostedToken');
  if (!token) throw new Error('No usage token set. Add the token from your provider in Settings → Engine → Hosted.');
  if (!settings.hostedEndpoint) throw new Error('No hosted endpoint set in Settings → Engine → Hosted.');
  const url = validateHttpUrl(joinUrl(settings.hostedEndpoint, '/v1/design/stream'));
  return {
    ...base,
    wire: 'anthropic',
    url,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    model: settings.hostedModel || 'default',
  };
}

/** Reject non-http(s) and obvious internal hosts before we ever send a key. */
function validateHttpUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid endpoint URL: ${raw}`);
  }
  if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    throw new Error('Endpoint must use https (localhost may use http).');
  }
  return u.toString();
}

async function checkEngine(source: EngineSource): Promise<EngineCheck> {
  try {
    if (source === 'local-cli') {
      const runtimes = await detectRuntimes();
      const available = runtimes.filter((r) => r.available);
      return available.length
        ? { source, ok: true, detail: available.map((r) => r.name).join(', ') }
        : { source, ok: false, detail: 'No agent CLI found on PATH. Install `claude` or `codex`, or use a different engine.' };
    }
    const settings = await loadSettings();
    const status = await secrets.status();
    if (source === 'byok') {
      if (!status.byokKeyConfigured) return { source, ok: false, detail: 'No API key set.' };
      return { source, ok: true, detail: `${settings.byokProvider} · ${settings.byokModel}` };
    }
    // hosted: verify token + a reachable /health endpoint.
    if (!status.hostedTokenConfigured) return { source, ok: false, detail: 'No usage token set.' };
    if (!settings.hostedEndpoint) return { source, ok: false, detail: 'No hosted endpoint set.' };
    try {
      const url = validateHttpUrl(joinUrl(settings.hostedEndpoint, '/health'));
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      return res.ok
        ? { source, ok: true, detail: `Reachable · ${settings.hostedModel}` }
        : { source, ok: false, detail: `Endpoint returned ${res.status}.` };
    } catch (err) {
      return { source, ok: false, detail: `Cannot reach endpoint: ${(err as Error).message}` };
    }
  } catch (err) {
    return { source, ok: false, detail: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// IPC surface (mirrors shared/types.ts UioBridge)

function registerIpc() {
  ipcMain.handle('runtimes:list', (_e, refresh?: boolean) => detectRuntimes(!!refresh));
  ipcMain.handle('library:skills', () => library.listSkills());
  ipcMain.handle('library:design-systems', () => library.listDesignSystems());
  ipcMain.handle('library:design-system-read', (_e, id: string) => library.readDesignSystemContract(id));

  ipcMain.handle('projects:list', () => store.list());
  ipcMain.handle('projects:get', (_e, id: string) => store.get(id));
  ipcMain.handle('projects:create', async (_e, input) => {
    const meta = await store.create(input);
    await library.installIntoWorkspace(meta.dir, meta.skillId, meta.designSystemId);
    return meta;
  });
  ipcMain.handle('projects:delete', async (_e, id: string) => {
    const meta = await store.get(id);
    if (!meta) return;
    watchers.get(id)?.close();
    watchers.delete(id);
    await shell.trashItem(meta.dir); // recoverable: goes to macOS Trash
  });
  ipcMain.handle('projects:files', async (_e, id: string) => {
    const meta = await store.get(id);
    if (!meta) return [];
    ensureWatcher(meta);
    return store.listFiles(meta);
  });
  ipcMain.handle('projects:read-file', async (_e, id: string, relPath: string) => {
    const meta = await store.get(id);
    if (!meta) throw new Error('Unknown project');
    return store.readFile(meta, relPath);
  });
  ipcMain.handle('projects:transcript', async (_e, id: string) => {
    const meta = await store.get(id);
    return meta ? store.readTranscript(meta) : [];
  });

  ipcMain.handle('engine:start', (_e, req: StartTurnRequest) => handleStartTurn(req));
  ipcMain.handle('engine:cancel', (_e, runId: string) => {
    activeRuns.get(runId)?.cancel();
  });

  ipcMain.handle('export:html', async (_e, id: string, entry: string) => {
    const meta = await store.get(id);
    if (!meta) throw new Error('Unknown project');
    return { savedTo: await exportHtml(meta, entryAbsPath(meta, entry)) };
  });
  ipcMain.handle('export:pdf', async (_e, id: string, entry: string) => {
    const meta = await store.get(id);
    if (!meta) throw new Error('Unknown project');
    return { savedTo: await exportPdf(meta, entryAbsPath(meta, entry)) };
  });

  ipcMain.handle('shell:reveal', async (_e, id: string) => {
    const meta = await store.get(id);
    if (meta) shell.showItemInFolder(path.join(meta.dir, 'project.json'));
  });
  ipcMain.handle('shell:open-external', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', async (_e, patch: Partial<AppSettings>) => {
    const next = { ...(await loadSettings()), ...patch };
    await saveSettings(next);
    store.setRoot(next.projectsRoot);
    return next;
  });

  ipcMain.handle('secrets:status', () => secrets.status());
  ipcMain.handle('secrets:set', (_e, name: SecretName, value: string) => secrets.set(name, value));
  ipcMain.handle('secrets:clear', (_e, name: SecretName) => secrets.clear(name));
  ipcMain.handle('engine:check', async (_e, source?: EngineSource) => {
    const src = source ?? (await loadSettings()).engineSource;
    return checkEngine(src);
  });
}

// ---------------------------------------------------------------------------
// Window

async function createWindow() {
  const settings = await loadSettings();
  store.setRoot(settings.projectsRoot);

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 640,
    title: 'UIO',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#faf9f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  secrets = new SecretStore(app.getPath('userData'));
  registerIpc();
  await createWindow();
  // Warm the runtime cache so Home shows the engine chip quickly.
  void detectRuntimes();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  for (const handle of activeRuns.values()) handle.cancel();
  for (const watcher of watchers.values()) watcher.close();
  app.quit();
});
