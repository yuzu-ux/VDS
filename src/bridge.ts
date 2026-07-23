// Typed access to the main-process bridge. In Electron, preload exposes
// window.vds. In a plain browser (vite dev for UI work) we install a mock so
// every screen renders and the chat flow can be exercised without Electron.
import type {
  DesignSystemInfo,
  EngineEventEnvelope,
  ProjectMeta,
  RuntimeInfo,
  SkillInfo,
  TranscriptEntry,
  VdsBridge,
} from '../shared/types';

declare global {
  interface Window {
    vds?: VdsBridge;
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.vds;

export function vds(): VdsBridge {
  if (window.vds) return window.vds;
  return mock;
}

// ---------------------------------------------------------------------------
// Browser mock (UI development / demo mode)

const mockSkills: SkillInfo[] = [
  { id: 'web-prototype', name: 'Web prototype', description: 'Single self-contained HTML page.', mode: 'prototype', entry: 'index.html', dir: '' },
  { id: 'slide-deck', name: 'Slide deck', description: 'Paged HTML presentation.', mode: 'deck', entry: 'deck.html', dir: '' },
];

const mockSystems: DesignSystemInfo[] = [
  { id: 'neutral-modern', name: 'Neutral Modern', description: 'Quiet, precise, software-native. Linear/Vercel lineage.', swatches: ['#fafafa', '#ffffff', '#18181b', '#71717a', '#e4e4e7', '#2563eb'], fontLabel: 'System sans · mono details', dir: '' },
  { id: 'editorial-serif', name: 'Editorial Serif', description: 'Print-magazine feel — paper, ink, one warm red accent.', swatches: ['#f7f4ec', '#fffdf8', '#191817', '#6b665c', '#ddd6c8', '#a33327'], fontLabel: 'Serif display · sans body', dir: '' },
  { id: 'mono-terminal', name: 'Mono Terminal', description: 'Dark, monospaced, phosphor-green accent.', swatches: ['#0c0e0c', '#141714', '#e6ede6', '#7d877d', '#232823', '#33d17a'], fontLabel: 'Mono everywhere', dir: '' },
];

const demoHtml = `<!doctype html><html><head><style>
body{font:16px/1.6 -apple-system,sans-serif;background:#f7f4ec;color:#191817;margin:0}
.wrap{max-width:900px;margin:0 auto;padding:64px 32px}
.eyebrow{font-family:Menlo,monospace;font-size:12px;letter-spacing:.14em;color:#a33327;text-transform:uppercase}
h1{font-family:Georgia,serif;font-size:56px;line-height:1.05;font-weight:500;margin:16px 0 20px}
p.lede{font-size:19px;color:#6b665c;max-width:56ch}
.btn{display:inline-block;margin-top:28px;background:#a33327;color:#fff;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:600}
section{border-top:1px solid #ddd6c8;margin-top:64px;padding-top:48px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px}
.card{background:#fffdf8;border:1px solid #ddd6c8;border-radius:12px;padding:24px}
.card h3{margin:0 0 8px;font-size:16px}.card p{margin:0;font-size:14px;color:#6b665c}
</style></head><body><div class="wrap">
<div data-vds-id="hero"><div class="eyebrow">Demo mode</div>
<h1>This is the browser mock preview.</h1>
<p class="lede">Run the real app with <b>npm start</b> — your local coding agent will generate designs as real files, previewed here live.</p>
<a class="btn" href="#">Primary action</a></div>
<section data-vds-id="features"><div class="eyebrow">Features</div><div class="grid">
<div class="card"><h3>Agent-native</h3><p>claude / codex on your PATH become the design engine.</p></div>
<div class="card"><h3>Local-first</h3><p>Projects are plain folders. No cloud, no lock-in.</p></div>
<div class="card"><h3>Open format</h3><p>SKILL.md and DESIGN.md, compatible with the ecosystem.</p></div>
</div></section></div></body></html>`;

const mem = {
  projects: [] as ProjectMeta[],
  transcripts: new Map<string, TranscriptEntry[]>(),
  files: new Map<string, Map<string, string>>(),
  listeners: new Set<(e: EngineEventEnvelope) => void>(),
  fileListeners: new Set<(i: { projectId: string; path: string }) => void>(),
  settings: {
    defaultRuntimeId: 'claude',
    defaultModel: null,
    projectsRoot: '~/VDS Projects',
    engineSource: 'local-cli',
    byokProvider: 'anthropic',
    byokBaseUrl: 'https://api.anthropic.com',
    byokModel: 'claude-sonnet-4-5',
    hostedEndpoint: '',
    hostedModel: 'default',
  } as import('../shared/types').AppSettings,
  secrets: { byokKeyConfigured: false, hostedTokenConfigured: false },
};

function emit(envelope: EngineEventEnvelope) {
  mem.transcripts.get(envelope.projectId)?.push({ kind: 'event', event: envelope.event, at: Date.now() });
  mem.listeners.forEach((cb) => cb(envelope));
}

const mock: VdsBridge = {
  async listRuntimes() {
    const infos: RuntimeInfo[] = [
      { id: 'claude', name: 'Claude Code', bin: 'claude', available: true, version: 'browser mock', resolvedPath: '/mock/claude', models: [{ id: 'default', label: 'Default model' }, { id: 'opus', label: 'Opus' }], supportsResume: true },
      { id: 'codex', name: 'Codex CLI', bin: 'codex', available: false, models: [{ id: 'default', label: 'Default model' }], supportsResume: true },
    ];
    return infos;
  },
  async listSkills() { return mockSkills; },
  async listDesignSystems() { return mockSystems; },
  async readDesignSystem() { return '# Mock design system'; },

  async listProjects() { return [...mem.projects].sort((a, b) => b.updatedAt - a.updatedAt); },
  async createProject(input) {
    const id = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design'}-${mem.projects.length + 1}`;
    const meta: ProjectMeta = { id, name: input.name || 'Untitled design', skillId: input.skillId, designSystemId: input.designSystemId, fidelity: input.fidelity, createdAt: Date.now(), updatedAt: Date.now(), dir: `/mock/${id}`, runtimeSessions: {} };
    mem.projects.push(meta);
    mem.transcripts.set(id, []);
    mem.files.set(id, new Map());
    return meta;
  },
  async getProject(id) { return mem.projects.find((p) => p.id === id) ?? null; },
  async deleteProject(id) {
    mem.projects = mem.projects.filter((p) => p.id !== id);
  },
  async listFiles(projectId) {
    const files = mem.files.get(projectId) ?? new Map<string, string>();
    return [...files.keys()].map((path) => ({ path, size: files.get(path)!.length, mtime: Date.now(), previewable: path.endsWith('.html') }));
  },
  async readFile(projectId, relPath) { return mem.files.get(projectId)?.get(relPath) ?? ''; },
  async getTranscript(projectId) { return mem.transcripts.get(projectId) ?? []; },

  async startTurn(req) {
    const runId = `mock-${Date.now()}`;
    const project = mem.projects.find((p) => p.id === req.projectId);
    const entry = mockSkills.find((s) => s.id === project?.skillId)?.entry ?? 'index.html';
    mem.transcripts.get(req.projectId)?.push({ kind: 'user', text: req.prompt, at: Date.now() });
    const ev = (event: EngineEventEnvelope['event'], delay: number) =>
      setTimeout(() => emit({ runId, projectId: req.projectId, event }), delay);
    ev({ type: 'status', state: 'working', detail: 'mock model' }, 200);
    ev({ type: 'assistant-text', text: 'Directions considered: Editorial — paper + ink + warm red; Modern minimal — greyscale + cobalt; Warm soft — cream + gentle radii. Taking Editorial: it fits the brief best.' }, 900);
    ev({ type: 'todos', items: [{ text: 'Read skill seed and design system', state: 'completed' }, { text: 'Build page structure', state: 'in_progress' }, { text: 'Fill real copy and self-check', state: 'pending' }] }, 1600);
    ev({ type: 'tool', id: 't1', name: 'Write', detail: entry, state: 'running' }, 2300);
    setTimeout(() => {
      mem.files.get(req.projectId)?.set(entry, demoHtml);
      mem.fileListeners.forEach((cb) => cb({ projectId: req.projectId, path: entry }));
    }, 2900);
    ev({ type: 'tool', id: 't1', name: 'Write', detail: entry, state: 'done' }, 3000);
    ev({ type: 'file', path: entry, action: 'written' }, 3050);
    ev({ type: 'todos', items: [{ text: 'Read skill seed and design system', state: 'completed' }, { text: 'Build page structure', state: 'completed' }, { text: 'Fill real copy and self-check', state: 'completed' }] }, 3400);
    ev({ type: 'result', summary: `Built ${entry} with an editorial hero, a three-card feature grid, and a closing CTA. (Browser mock — run the Electron app for real generations.)`, durationMs: 3600 }, 3700);
    ev({ type: 'status', state: 'done' }, 3800);
    return { runId };
  },
  async cancelTurn() {},
  onEngineEvent(cb) {
    mem.listeners.add(cb);
    return () => mem.listeners.delete(cb);
  },
  onFileChanged(cb) {
    mem.fileListeners.add(cb);
    return () => mem.fileListeners.delete(cb);
  },

  async exportHtml() { alert('Export works in the Electron app.'); return { savedTo: null }; },
  async exportPdf() { alert('Export works in the Electron app.'); return { savedTo: null }; },
  async openInFinder() {},
  async openExternal(url) { window.open(url, '_blank'); },

  async getSettings() { return { ...mem.settings }; },
  async setSettings(patch) { mem.settings = { ...mem.settings, ...patch }; return { ...mem.settings }; },

  async getSecretStatus() { return { ...mem.secrets, encryptionAvailable: true }; },
  async setSecret(name) { if (name === 'byokKey') mem.secrets.byokKeyConfigured = true; else mem.secrets.hostedTokenConfigured = true; return { ...mem.secrets, encryptionAvailable: true }; },
  async clearSecret(name) { if (name === 'byokKey') mem.secrets.byokKeyConfigured = false; else mem.secrets.hostedTokenConfigured = false; return { ...mem.secrets, encryptionAvailable: true }; },
  async checkEngine(source) {
    const src = source ?? mem.settings.engineSource;
    if (src === 'local-cli') return { source: src, ok: true, detail: 'Claude Code (browser mock)' };
    if (src === 'byok') return { source: src, ok: mem.secrets.byokKeyConfigured, detail: mem.secrets.byokKeyConfigured ? `${mem.settings.byokProvider} · ${mem.settings.byokModel}` : 'No API key set.' };
    return { source: src, ok: mem.secrets.hostedTokenConfigured, detail: mem.secrets.hostedTokenConfigured ? 'Reachable (mock)' : 'No usage token set.' };
  },
};
