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
import { uio } from '../bridge';
import { ChatPane } from '../components/ChatPane';
import { CanvasPane } from '../components/CanvasPane';

export function Studio(props: {
  projectId: string;
  runtimes: RuntimeInfo[];
  settings: AppSettings | null;
  onBack: () => void;
}) {
  const { projectId, runtimes, settings, onBack } = props;
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

  const availableRuntimes = useMemo(() => runtimes.filter((r) => r.available), [runtimes]);
  const activeRuntime = availableRuntimes.find((r) => r.id === runtimeId) ?? availableRuntimes[0] ?? null;

  // initial load
  useEffect(() => {
    let alive = true;
    void (async () => {
      const meta = await uio().getProject(projectId);
      if (!alive || !meta) return;
      setProject(meta);
      const [skills, systems, transcript] = await Promise.all([
        uio().listSkills(),
        uio().listDesignSystems(),
        uio().getTranscript(projectId),
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
    const list = await uio().listFiles(projectId);
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
    const offEngine = uio().onEngineEvent(({ projectId: pid, event }) => {
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
    const offFiles = uio().onFileChanged(({ projectId: pid }) => {
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
      if (!activeRuntime || running) return;
      setEntries((prev) => [...prev, { kind: 'user', text, at: Date.now() }]);
      setRunning(true);
      setRunStartedAt(Date.now());
      setCommentMode(false);
      const toSend = comments;
      setComments([]);
      try {
        const { runId: id } = await uio().startTurn({
          projectId,
          prompt: text,
          runtimeId: activeRuntime.id,
          model: model !== 'default' ? model : undefined,
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
    [activeRuntime, running, projectId, model, comments],
  );

  const stop = useCallback(() => {
    if (runId) void uio().cancelTurn(runId);
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
        <select className="btn small" value={activeRuntime?.id ?? ''} onChange={(e) => setRuntimeId(e.target.value)} title="Design engine">
          {availableRuntimes.length === 0 && <option value="">No engine detected</option>}
          {availableRuntimes.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <select className="btn small" value={model} onChange={(e) => setModel(e.target.value)} title="Model">
          {(activeRuntime?.models ?? [{ id: 'default', label: 'Default model' }]).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button className="btn small" onClick={() => void uio().openInFinder(projectId)}>Reveal in Finder</button>
      </header>

      <div className="studio-body">
        <ChatPane
          entries={entries}
          running={running}
          runStartedAt={runStartedAt}
          engineName={activeRuntime?.name ?? null}
          comments={comments}
          onRemoveComment={(i) => setComments((prev) => prev.filter((_, idx) => idx !== i))}
          onSend={send}
          onStop={stop}
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
