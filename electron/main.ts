// UIO main process — plays the role Open Design gives its local daemon:
// project persistence, library registries, runtime detection, run lifecycle,
// and export. The renderer talks to it over typed IPC (see preload.ts).
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import type {
  AppSettings,
  EngineEvent,
  EngineEventEnvelope,
  ProjectMeta,
  StartTurnRequest,
} from '../shared/types';
import { startRun, type RunHandle } from './core/engine';
import { entryAbsPath, exportHtml, exportPdf } from './core/exporter';
import { Library } from './core/library';
import { defaultProjectsRoot, ProjectStore } from './core/projects';
import { detectRuntimes } from './core/runtimes';
import { composeTurnPrompt } from './core/prompt';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
const store = new ProjectStore(defaultProjectsRoot());
const library = new Library(path.join(app.getAppPath(), 'library'));
const activeRuns = new Map<string, RunHandle>();
const watchers = new Map<string, FSWatcher>();

// ---------------------------------------------------------------------------
// Settings

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

async function loadSettings(): Promise<AppSettings> {
  const defaults: AppSettings = {
    defaultRuntimeId: null,
    defaultModel: null,
    projectsRoot: defaultProjectsRoot(),
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
  const runtimes = await detectRuntimes();
  const runtime = runtimes.find((r) => r.id === req.runtimeId);
  if (!runtime?.available || !runtime.resolvedPath) {
    throw new Error(`Runtime not available: ${req.runtimeId}`);
  }

  const transcript = await store.readTranscript(meta);
  const isFirstTurn = !transcript.some((t) => t.kind === 'user');

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

  await store.appendTranscript(meta, { kind: 'user', text: req.prompt, at: Date.now() });
  ensureWatcher(meta);

  const persistEvent = (event: EngineEvent) => {
    if (event.type === 'raw') return;
    void store.appendTranscript(meta, { kind: 'event', event, at: Date.now() });
  };

  const handle = await startRun(
    {
      runtimeId: req.runtimeId,
      resolvedPath: runtime.resolvedPath,
      cwd: meta.dir,
      prompt,
      model: req.model,
      resumeSessionId: runtime.supportsResume ? meta.runtimeSessions[req.runtimeId] : undefined,
    },
    {
      onEvent: (event) => {
        persistEvent(event);
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
    },
  );
  activeRuns.set(handle.runId, handle);
  return { runId: handle.runId };
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
