// Shared contracts between the Electron main process ("the daemon") and the
// renderer. Mirrors the split Open Design keeps in packages/contracts.

export const APP_NAME = 'UIO';
export const APP_TAGLINE = 'UI, Open — your coding agents become the design engine.';

// ---------------------------------------------------------------------------
// Runtimes (agent CLIs)

export interface RuntimeModelOption {
  id: string;
  label: string;
}

export interface RuntimeInfo {
  id: string;
  name: string;
  bin: string;
  available: boolean;
  version?: string;
  resolvedPath?: string;
  models: RuntimeModelOption[];
  /** Whether the CLI can resume a session for cross-turn working memory. */
  supportsResume: boolean;
}

// ---------------------------------------------------------------------------
// Library: skills (rendering templates) + design systems

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  /** 'prototype' | 'deck' — determines preview + export behavior. */
  mode: 'prototype' | 'deck';
  /** Canonical previewable file the skill instructs the agent to write. */
  entry: string;
  dir: string;
}

export interface DesignSystemInfo {
  id: string;
  name: string;
  description: string;
  /** Representative token swatches for the picker UI. */
  swatches: string[];
  fontLabel?: string;
  dir: string;
}

// ---------------------------------------------------------------------------
// Projects

export type Fidelity = 'wireframe' | 'high';

export interface ProjectMeta {
  id: string;
  name: string;
  skillId: string;
  designSystemId: string | null;
  fidelity: Fidelity;
  createdAt: number;
  updatedAt: number;
  /** Workspace directory on disk (the project IS a folder). */
  dir: string;
  /** Per-runtime session ids for CLIs that support resume. */
  runtimeSessions: Record<string, string>;
}

export interface ProjectFile {
  path: string; // relative to workspace
  size: number;
  mtime: number;
  previewable: boolean;
}

// ---------------------------------------------------------------------------
// Engine: normalized streaming events (the SSE equivalent, over IPC)

export type TodoState = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  text: string;
  state: TodoState;
}

export type EngineEvent =
  | { type: 'status'; state: 'starting' | 'working' | 'done' | 'error' | 'cancelled'; detail?: string }
  | { type: 'assistant-text'; text: string }
  | { type: 'tool'; id: string; name: string; detail: string; state: 'running' | 'done' | 'error' }
  | { type: 'todos'; items: TodoItem[] }
  | { type: 'file'; path: string; action: 'written' | 'changed' }
  | { type: 'result'; summary: string; durationMs?: number; costUsd?: number }
  | { type: 'raw'; text: string };

export interface EngineEventEnvelope {
  runId: string;
  projectId: string;
  event: EngineEvent;
}

export interface StartTurnRequest {
  projectId: string;
  prompt: string;
  runtimeId: string;
  model?: string;
  /** Inline comments captured on preview elements, folded into the prompt. */
  comments?: ElementComment[];
}

export interface ElementComment {
  selector: string;
  elementLabel: string;
  note: string;
}

// ---------------------------------------------------------------------------
// Transcript persisted per project (chat history across app restarts)

export type TranscriptEntry =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'event'; event: EngineEvent; at: number };

// ---------------------------------------------------------------------------
// Settings

export interface AppSettings {
  defaultRuntimeId: string | null;
  defaultModel: string | null;
  projectsRoot: string;
}

// ---------------------------------------------------------------------------
// The bridge exposed to the renderer as window.uio

export interface UioBridge {
  listRuntimes(refresh?: boolean): Promise<RuntimeInfo[]>;
  listSkills(): Promise<SkillInfo[]>;
  listDesignSystems(): Promise<DesignSystemInfo[]>;
  readDesignSystem(id: string): Promise<string>;

  listProjects(): Promise<ProjectMeta[]>;
  createProject(input: {
    name: string;
    skillId: string;
    designSystemId: string | null;
    fidelity: Fidelity;
  }): Promise<ProjectMeta>;
  getProject(id: string): Promise<ProjectMeta | null>;
  deleteProject(id: string): Promise<void>;
  listFiles(projectId: string): Promise<ProjectFile[]>;
  readFile(projectId: string, relPath: string): Promise<string>;
  getTranscript(projectId: string): Promise<TranscriptEntry[]>;

  startTurn(req: StartTurnRequest): Promise<{ runId: string }>;
  cancelTurn(runId: string): Promise<void>;
  onEngineEvent(cb: (envelope: EngineEventEnvelope) => void): () => void;
  onFileChanged(cb: (info: { projectId: string; path: string }) => void): () => void;

  exportHtml(projectId: string, entry: string): Promise<{ savedTo: string | null }>;
  exportPdf(projectId: string, entry: string): Promise<{ savedTo: string | null }>;
  openInFinder(projectId: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
}
