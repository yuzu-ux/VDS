import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  DesignSystemInfo,
  ElementComment,
  ProjectFile,
  ProjectMeta,
  RuntimeInfo,
  SkillInfo,
  TranscriptEntry,
} from '../../shared/types';
import { vds } from '../bridge';
import { ChatPane } from '../components/ChatPane';
import { CanvasPane } from '../components/CanvasPane';

function glyphFor(id?: string): string {
  if (id === 'claude') return '✳';
  if (id === 'codex') return '⌘';
  if (id === 'gemini') return '✦';
  if (id === 'cursor-agent') return '▸';
  if (id === 'opencode') return '◇';
  return '✳';
}

function FinderGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden style={{ marginRight: 1 }}>
      <path d="M2.5 2.5h11v11h-11z" stroke="currentColor" strokeWidth="1.2" opacity=".55" />
      <path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.2" opacity=".55" />
    </svg>
  );
}

export function Studio(props: {
  projectId: string;
  initialPrompt?: string;
  onConsumedInitialPrompt?: () => void;
  runtimes: RuntimeInfo[];
  settings: AppSettings | null;
  onBack: () => void;
}) {
  const { projectId, initialPrompt, onConsumedInitialPrompt, runtimes, settings, onBack } = props;
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  const [system, setSystem] = useState<DesignSystemInfo | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [comments, setComments] = useState<ElementComment[]>([]);
  const [commentMode, setCommentMode] = useState(false);
  const [runtimeId, setRuntimeId] = useState<string | null>(null);
  const [model, setModel] = useState('default');
  const [headerPop, setHeaderPop] = useState<'engine' | 'model' | null>(null);

  const availableRuntimes = useMemo(() => runtimes.filter((r) => r.available), [runtimes]);
  // Prefer a CLI that is actually logged in — an installed-but-unauthenticated
  // CLI (e.g. claude before /login) would fail every run. Even an explicit
  // selection is skipped while it reads "login required" (Rescan re-probes).
  const explicitRuntime = availableRuntimes.find((r) => r.id === runtimeId);
  const activeRuntime =
    (explicitRuntime && explicitRuntime.authenticated !== false ? explicitRuntime : undefined) ??
    availableRuntimes.find((r) => r.authenticated !== false) ??
    availableRuntimes[0] ??
    null;
  const source = settings?.engineSource ?? 'local-cli';
  const isProvider = source !== 'local-cli';
  const canSend = isProvider || !!activeRuntime;
  const engineLabel = source === 'byok' ? 'Your API key' : source === 'hosted' ? 'Hosted' : activeRuntime?.name ?? 'No engine';
  const models = activeRuntime?.models ?? [{ id: 'default', label: 'Default model' }];
  const currentModelLabel = models.find((m) => m.id === model)?.label ?? 'Default model';

  // initial load
  useEffect(() => {
    let alive = true;
    void (async () => {
      const meta = await vds().getProject(projectId);
      if (!alive || !meta) return;
      setProject(meta);
      const [skills, systems, transcript] = await Promise.all([
        vds().listSkills(),
        vds().listDesignSystems(),
        vds().getTranscript(projectId),
      ]);
      if (!alive) return;
      setSkill(skills.find((s) => s.id === meta.skillId) ?? null);
      setSystem(systems.find((s) => s.id === meta.designSystemId) ?? null);
      setEntries(transcript);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (settings?.defaultRuntimeId) setRuntimeId((prev) => prev ?? settings.defaultRuntimeId);
  }, [settings]);

  const refreshFiles = useCallback(async () => {
    const list = await vds().listFiles(projectId);
    setFiles(list);
    setActiveFile((prev) => {
      if (prev && list.some((f) => f.path === prev)) return prev;
      const entry = skill?.entry;
      const preferred = list.find((f) => f.path === entry) ?? list.find((f) => f.previewable);
      return preferred?.path ?? null;
    });
  }, [projectId, skill]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles, refreshTick]);

  // engine + file events
  useEffect(() => {
    const offEngine = vds().onEngineEvent(({ projectId: pid, event }) => {
      if (pid !== projectId) return;
      setEntries((prev) => [...prev, { kind: 'event', event, at: Date.now() }]);
      if (event.type === 'status') {
        if (event.state === 'done' || event.state === 'error' || event.state === 'cancelled') {
          setRunning(false);
          setRunId(null);
          setRefreshTick((t) => t + 1);
        }
      }
      if (event.type === 'file') setRefreshTick((t) => t + 1);
    });
    const debounce = { timer: 0 as ReturnType<typeof setTimeout> | 0 };
    const offFiles = vds().onFileChanged(({ projectId: pid }) => {
      if (pid !== projectId) return;
      if (debounce.timer) clearTimeout(debounce.timer);
      debounce.timer = setTimeout(() => setRefreshTick((t) => t + 1), 250);
    });
    return () => {
      offEngine();
      offFiles();
      if (debounce.timer) clearTimeout(debounce.timer);
    };
  }, [projectId]);

  const send = useCallback(
    async (text: string) => {
      if (!canSend || running || (!text.trim() && comments.length === 0)) return;
      setEntries((prev) => [...prev, { kind: 'user', text: text.trim() || 'Apply the pinned comments to the design.', at: Date.now() }]);
      setRunning(true);
      setRunStartedAt(Date.now());
      setCommentMode(false);
      const toSend = comments;
      setComments([]);
      try {
        const { runId: id } = await vds().startTurn({
          projectId,
          prompt: text,
          runtimeId: activeRuntime?.id ?? 'claude', // ignored by provider sources
          model: !isProvider && model !== 'default' ? model : undefined,
          comments: toSend.length ? toSend : undefined,
        });
        setRunId(id);
      } catch (err) {
        setRunning(false);
        setEntries((prev) => [
          ...prev,
          { kind: 'event', event: { type: 'status', state: 'error', detail: String((err as Error).message ?? err) }, at: Date.now() },
        ]);
      }
    },
    [canSend, isProvider, activeRuntime, running, projectId, model, comments],
  );

  // Auto-send the prompt typed on the Home launcher, exactly once.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (sentInitial.current || !initialPrompt || !project) return;
    if (!canSend) return; // wait until an engine is ready
    sentInitial.current = true;
    void send(initialPrompt);
    onConsumedInitialPrompt?.();
  }, [initialPrompt, project, canSend, send, onConsumedInitialPrompt]);

  const stop = useCallback(() => {
    if (runId) void vds().cancelTurn(runId);
  }, [runId]);

  const addComment = useCallback((c: ElementComment) => {
    setComments((prev) => [...prev, c]);
  }, []);

  if (!project) {
    return (
      <div className="studio">
        <div className="studio-header">
          <button className="back" onClick={onBack}>←</button>
          <div className="title">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="studio">
      <header className="studio-header">
        <button className="back" onClick={onBack} title="Back to designs">←</button>
        <div>
          <div className="title">{project.name}</div>
          <div className="subtitle">
            {system?.name ?? 'Freeform'} · {skill?.name ?? project.skillId}
          </div>
        </div>
        <div className="spacer" />
        {isProvider ? (
          <span className="chip" title="Engine source (change in Settings)">
            <span className="dot" /> {engineLabel}
          </span>
        ) : (
          <>
            <div className="pop-anchor">
              <button
                className="hdr-select"
                onClick={() => setHeaderPop((p) => (p === 'engine' ? null : 'engine'))}
                title="Design engine"
              >
                <span className="hs-glyph">{glyphFor(activeRuntime?.id)}</span>
                <span className="hs-name">{activeRuntime?.name ?? 'No engine'}</span>
                {activeRuntime && (
                  <span className={`hs-dot ${activeRuntime.authenticated === false ? 'warn' : 'ok'}`} />
                )}
                <span className="hs-caret">▾</span>
              </button>
              {headerPop === 'engine' && (
                <div className="popover engine-pop">
                  <div className="agp-label">CODE AGENT</div>
                  {availableRuntimes.length === 0 && (
                    <div className="hs-empty">No engine detected. Install a CLI, then Rescan in Settings.</div>
                  )}
                  {availableRuntimes.map((r) => (
                    <button
                      key={r.id}
                      className={`agp-agent ${activeRuntime?.id === r.id ? 'active' : ''}`}
                      onClick={() => {
                        setRuntimeId(r.id);
                        setHeaderPop(null);
                      }}
                    >
                      <span className="glyph">{glyphFor(r.id)}</span>
                      <span className="aname">{r.name}</span>
                      <span className={`ameta ${r.authenticated === false ? 'warn' : ''}`}>
                        {r.authenticated === false ? 'login required' : r.version ?? 'ready'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="pop-anchor">
              <button
                className="hdr-select"
                onClick={() => setHeaderPop((p) => (p === 'model' ? null : 'model'))}
                title="Model"
              >
                <span className="hs-name subtle">{currentModelLabel}</span>
                <span className="hs-caret">▾</span>
              </button>
              {headerPop === 'model' && (
                <div className="popover model-pop">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      className={`mode-row ${model === m.id ? 'active' : ''}`}
                      onClick={() => {
                        setModel(m.id);
                        setHeaderPop(null);
                      }}
                    >
                      <span className="mlabel">{m.label}</span>
                      {model === m.id && <span className="mcheck">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        <button className="btn small ghost" onClick={() => void vds().openInFinder(projectId)} title="Show this project in Finder">
          <FinderGlyph /> Reveal
        </button>
        {headerPop && <div className="pop-backdrop" onClick={() => setHeaderPop(null)} />}
      </header>

      <div className="studio-body">
        <ChatPane
          entries={entries}
          running={running}
          runStartedAt={runStartedAt}
          engineName={isProvider ? engineLabel : activeRuntime?.name ?? null}
          engineGlyph={isProvider ? '◎' : glyphFor(activeRuntime?.id)}
          comments={comments}
          onRemoveComment={(i) => setComments((prev) => prev.filter((_, idx) => idx !== i))}
          onSend={send}
          onStop={stop}
          onOpenFile={(p) => setActiveFile(p)}
        />
        <CanvasPane
          projectId={projectId}
          files={files}
          activeFile={activeFile}
          onSelectFile={setActiveFile}
          refreshTick={refreshTick}
          onManualRefresh={() => setRefreshTick((t) => t + 1)}
          commentMode={commentMode}
          onToggleCommentMode={() => setCommentMode((v) => !v)}
          onAddComment={addComment}
          deckMode={skill?.mode === 'deck'}
        />
      </div>
    </div>
  );
}
