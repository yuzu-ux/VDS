import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  DesignSystemInfo,
  EngineCheck,
  EngineSource,
  Fidelity,
  ProjectMeta,
  RuntimeInfo,
  SkillInfo,
} from '../../shared/types';
import { vds } from '../bridge';

type DesignMode = 'ask' | 'plan' | 'design';

interface TemplateDef {
  key: string;
  title: string;
  desc: string;
  skillId: string;
  fidelity: Fidelity;
  /** Guidance folded into the first prompt so any skill can serve the type. */
  hint?: string;
  icon: JSX.Element;
}

const PLACEHOLDERS = [
  'Turn my notes into a presentation',
  'Draft a one-page project brief',
  'Clone the hero of my favorite site',
  'Design a mobile onboarding flow',
  'Make a launch deck for VDS',
  'Do one anti-AI-feel polish pass',
];

export function Home(props: {
  runtimes: RuntimeInfo[];
  settings: AppSettings | null;
  onOpenProject: (id: string, name: string, initialPrompt?: string) => void;
  onOpenSettings: () => void;
  onRescanRuntimes: () => void;
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}) {
  const { runtimes, settings, onOpenProject, onOpenSettings, onRescanRuntimes, onSaveSettings } = props;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [systems, setSystems] = useState<DesignSystemInfo[]>([]);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const [prompt, setPrompt] = useState('');
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [designSystemId, setDesignSystemId] = useState('');
  const [mode, setMode] = useState<DesignMode>('design');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [engineCheck, setEngineCheck] = useState<EngineCheck | null>(null);
  const [openPop, setOpenPop] = useState<'template' | 'agent' | 'mode' | null>(null);
  const [tplQuery, setTplQuery] = useState('');
  const [ph, setPh] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const engineSource = settings?.engineSource ?? 'local-cli';

  const refresh = async () => {
    const [sk, ds, pr] = await Promise.all([vds().listSkills(), vds().listDesignSystems(), vds().listProjects()]);
    setSkills(sk);
    setSystems(ds);
    setProjects(pr);
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    void vds().checkEngine(engineSource).then(setEngineCheck);
  }, [engineSource, runtimes]);

  // Animated typing placeholder, like the reference launcher.
  useEffect(() => {
    let phrase = 0;
    let chars = 0;
    let dir: 1 | -1 = 1;
    const t = setInterval(() => {
      const cur = PLACEHOLDERS[phrase % PLACEHOLDERS.length];
      chars += dir;
      if (chars >= cur.length + 14) dir = -1; // hold, then delete
      if (chars <= 0 && dir === -1) {
        dir = 1;
        phrase++;
      }
      setPh(cur.slice(0, Math.max(0, Math.min(cur.length, chars))));
    }, 55);
    return () => clearInterval(t);
  }, []);

  // Thumbnails for recents (cached main-side; cheap to re-ask).
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const p of projects.slice(0, 8)) {
        const url = await vds().getThumbnail(p.id).catch(() => null);
        if (!alive) return;
        if (url) setThumbs((prev) => (prev[p.id] === url ? prev : { ...prev, [p.id]: url }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [projects]);

  const templates = useMemo<TemplateDef[]>(() => buildTemplates(skills), [skills]);
  const activeTemplate = templates.find((t) => t.key === templateKey) ?? null;

  const availableRuntimes = runtimes.filter((r) => r.available);
  const readyRuntimes = availableRuntimes.filter((r) => r.authenticated !== false);
  // An explicit default only wins while it can actually run — a stored default
  // that later reads "login required" falls back to a ready CLI.
  const explicitRuntime = availableRuntimes.find((r) => r.id === settings?.defaultRuntimeId);
  const currentRuntime =
    (explicitRuntime && explicitRuntime.authenticated !== false ? explicitRuntime : undefined) ??
    readyRuntimes[0] ??
    availableRuntimes[0] ??
    null;

  const modeMeta: Record<DesignMode, { label: string; effort: string }> = {
    ask: { label: 'Ask', effort: 'Light' },
    plan: { label: 'Plan', effort: 'Standard' },
    design: { label: 'Design', effort: 'Heavy' },
  };

  const nameFromPrompt = (text: string) => {
    const words = text.trim().split(/\s+/).slice(0, 6).join(' ');
    return words.slice(0, 48) || 'Untitled design';
  };

  const composedPrompt = (raw: string): string => {
    const parts: string[] = [];
    if (activeTemplate?.hint) parts.push(activeTemplate.hint);
    if (mode === 'ask') parts.push('Ask mode: answer and advise in chat — do not create or modify files unless explicitly asked.');
    if (mode === 'plan') parts.push('Plan mode: produce a lo-fi structural pass first — boxes, hierarchy and flows over polish.');
    parts.push(raw.trim());
    return parts.join('\n\n');
  };

  const create = async (withPrompt: boolean) => {
    if (creating) return;
    if (withPrompt && !prompt.trim()) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const skillId = activeTemplate?.skillId ?? 'web-prototype';
      const fidelity: Fidelity = mode === 'plan' ? 'wireframe' : activeTemplate?.fidelity ?? 'high';
      const name = withPrompt ? nameFromPrompt(prompt) : `${activeTemplate?.title ?? 'New'} design`;
      const meta = await vds().createProject({ name, skillId, designSystemId: designSystemId || null, fidelity });
      onOpenProject(meta.id, meta.name, withPrompt ? composedPrompt(prompt) : undefined);
    } catch (err) {
      // Never fail silently — a swallowed IPC rejection looks like a dead button.
      setCreateErr(String((err as Error)?.message ?? err));
    } finally {
      setCreating(false);
    }
  };

  const removeProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Move this project to the Trash?')) return;
    await vds().deleteProject(id);
    void refresh();
  };

  const pickAgent = async (id: string) => {
    await onSaveSettings({ defaultRuntimeId: id, engineSource: 'local-cli' });
    setOpenPop(null);
  };
  const pickSource = async (source: EngineSource) => {
    await onSaveSettings({ engineSource: source });
    if (source !== 'local-cli') setOpenPop(null);
  };

  const systemName = (id: string | null) => (id ? systems.find((s) => s.id === id)?.name ?? id : null);
  const recent = projects.slice(0, 8);
  const filteredTemplates = templates.filter(
    (t) => !tplQuery.trim() || (t.title + ' ' + t.desc).toLowerCase().includes(tplQuery.toLowerCase()),
  );

  return (
    <div className="home" onClick={() => setOpenPop(null)}>
      <div className="home-inner">
        <div className="brand-hero">
          <span className="brand-mark">
            <ClockMark />
          </span>
          <span className="brand-word">VDS</span>
        </div>
        <h1 className="hero-h1">What will you design with your agent today?</h1>
        <p className="hero-sub">Visual Design Studio — the open-source Claude Design alternative.</p>

        <div className="composer-hero" onClick={(e) => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            placeholder={ph}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void create(true);
              }
            }}
          />
          <div className="composer-toolbar">
            <span className="pop-anchor">
              <button className="mini" title="Template" onClick={() => setOpenPop(openPop === 'template' ? null : 'template')}>
                <GridIcon />
                <span className="lbl">Template</span>
                <span className="val accent">{activeTemplate?.title ?? 'None'}</span>
                <Chevron />
              </button>
              {openPop === 'template' && (
                <div className="popover tpl-pop">
                  <div className="tplp-head">
                    <input
                      autoFocus
                      placeholder="Search templates"
                      value={tplQuery}
                      onChange={(e) => setTplQuery(e.target.value)}
                    />
                    <button className="mini" onClick={() => { setTemplateKey(null); setTplQuery(''); setOpenPop(null); }}>Clear</button>
                  </div>
                  <div className="tplp-label">PROJECT TYPES</div>
                  <div className="tplp-grid">
                    {filteredTemplates.map((t) => (
                      <button
                        key={t.key}
                        className={`tplp-card ${templateKey === t.key ? 'active' : ''}`}
                        onClick={() => {
                          setTemplateKey(t.key);
                          setOpenPop(null);
                          textareaRef.current?.focus();
                        }}
                      >
                        <div className="tpl-icon">{t.icon}</div>
                        <div className="t">{t.title}</div>
                        <div className="d">{t.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </span>
            <div className="spacer" />
            <span className="pop-anchor">
              <button className="mini" title="Design mode" onClick={() => setOpenPop(openPop === 'mode' ? null : 'mode')}>
                <SparkIcon />
                <span className="val">{modeMeta[mode].label}</span>
                <Chevron />
              </button>
              {openPop === 'mode' && (
                <div className="popover mode-pop">
                  {(['ask', 'plan', 'design'] as DesignMode[]).map((m) => (
                    <button key={m} className={`mode-row ${mode === m ? 'active' : ''}`} onClick={() => { setMode(m); setOpenPop(null); }}>
                      <span className="mlabel">{modeMeta[m].label}</span>
                      <span className="meffort">{modeMeta[m].effort}</span>
                      {mode === m && <span className="mcheck">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </span>
            <span className="pop-anchor">
              <button className="mini agent-btn" title="Engine" onClick={() => setOpenPop(openPop === 'agent' ? null : 'agent')}>
                <span className={`dot ${engineCheck?.ok ? 'on' : 'off'}`} />
                <span className="val">
                  {engineSource === 'byok' ? 'Your API key' : engineSource === 'hosted' ? 'Hosted' : currentRuntime?.name ?? 'No engine'}
                </span>
                <Chevron />
              </button>
              {openPop === 'agent' && (
                <div className="popover agent-pop">
                  <div className="agp-head">
                    <div className="agp-title">{engineSource === 'local-cli' ? 'Local CLI' : engineSource === 'byok' ? 'Your API key' : 'Hosted'}</div>
                    <div className="agp-sub">
                      {engineSource === 'local-cli'
                        ? currentRuntime
                          ? `${currentRuntime.name} · ${currentRuntime.version ?? ''}`
                          : 'No CLI detected'
                        : engineCheck?.detail ?? ''}
                    </div>
                  </div>
                  <button className={`agp-row ${engineSource === 'local-cli' ? 'active' : ''}`} onClick={() => void pickSource('local-cli')}>
                    <span>Use Local CLI</span>
                    {engineSource === 'local-cli' && <span className="mcheck">✓</span>}
                  </button>
                  <button className={`agp-row ${engineSource === 'byok' ? 'active' : ''}`} onClick={() => void pickSource('byok')}>
                    <span>Use API · BYOK</span>
                    {engineSource === 'byok' && <span className="mcheck">✓</span>}
                  </button>
                  <button className={`agp-row ${engineSource === 'hosted' ? 'active' : ''}`} onClick={() => void pickSource('hosted')}>
                    <span>Use Hosted</span>
                    {engineSource === 'hosted' && <span className="mcheck">✓</span>}
                  </button>
                  <div className="agp-label">CODE AGENT</div>
                  {runtimes.map((r) => (
                    <button
                      key={r.id}
                      className={`agp-agent ${currentRuntime?.id === r.id && engineSource === 'local-cli' ? 'active' : ''}`}
                      disabled={!r.available}
                      onClick={() => void pickAgent(r.id)}
                    >
                      <span className="glyph">{agentGlyph(r.id)}</span>
                      <span className="aname">{r.name}</span>
                      <span className="ameta">
                        {!r.available ? 'not found' : r.authenticated === false ? 'login required' : r.version ?? ''}
                      </span>
                    </button>
                  ))}
                  <div className="agp-foot">
                    <button className="agp-row" onClick={() => { onRescanRuntimes(); }}>↻ Rescan PATH</button>
                    <button className="agp-row" onClick={() => { setOpenPop(null); onOpenSettings(); }}>⚙ Open execution settings</button>
                  </div>
                </div>
              )}
            </span>
            <button className="send-btn" onClick={() => void create(true)} disabled={creating || !prompt.trim()}>
              <SendIcon /> Send
            </button>
          </div>
        </div>

        <div className="hero-subrow">
          <span className="subrow-item" title="Design system">
            <PaletteIcon />
            {systemName(designSystemId) ?? 'No design system'}
            <select value={designSystemId} onChange={(e) => setDesignSystemId(e.target.value)}>
              <option value="">No design system</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </span>
          <span className="subrow-sep" />
          <button className="subrow-item" style={{ paddingRight: 0 }} onClick={onOpenSettings} title="Project locations">
            <FolderMini />
            {settings ? shortPath(settings.projectsRoot) : 'Projects folder'}
          </button>
        </div>

        {engineCheck && !engineCheck.ok && (
          <div className="engine-warn" onClick={onOpenSettings} title="Open execution settings">
            ⚠ {engineCheck.detail}
          </div>
        )}
        {createErr && <div className="engine-warn">⚠ Could not create the project: {createErr}</div>}

        <div className="tpl-label">Start with a template…</div>
        <div className="tpl-row">
          {templates.map((t) => (
            <button
              key={t.key}
              className={`tpl-card ${templateKey === t.key ? 'active' : ''}`}
              onClick={() => {
                setTemplateKey(t.key);
                textareaRef.current?.focus();
              }}
            >
              <div className="tpl-icon">{t.icon}</div>
              <div className="tpl-body">
                <div className="t">{t.title}</div>
                <div className="d">{t.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="blank-link">
          <button onClick={() => void create(false)} disabled={creating}>…or start a blank project ›</button>
        </div>

        <div className="recent">
          <div className="recent-head">
            <h3>Recent projects</h3>
          </div>
          {recent.length === 0 ? (
            <div className="empty-recent">Nothing yet — send a prompt above and your agent gets to work.</div>
          ) : (
            <div className="recent-row">
              {recent.map((p) => (
                <div key={p.id} className="recent-card" onClick={() => onOpenProject(p.id, p.name)}>
                  <div className="recent-thumb">
                    {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" draggable={false} /> : <span className="ph">▤</span>}
                  </div>
                  <div className="recent-meta">
                    <div style={{ minWidth: 0 }}>
                      <div className="rm-name">{p.name}</div>
                      <div className="rm-sub">{systemName(p.designSystemId) ?? 'freeform'} · {timeAgo(p.updatedAt)}</div>
                    </div>
                    <button className="rm-x" title="Move to Trash" onClick={(e) => void removeProject(e, p.id)}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function buildTemplates(skills: SkillInfo[]): TemplateDef[] {
  const has = (id: string) => skills.some((s) => s.id === id);
  const web = has('web-prototype');
  const deck = has('slide-deck');
  const list: TemplateDef[] = [
    { key: 'website', title: 'Website clone', desc: 'Source-first site reproduction', skillId: 'web-prototype', fidelity: 'high', hint: 'Website clone: faithfully reproduce the referenced site’s look — structure, spacing, typography — as one self-contained page.', icon: <IconBrowserArrow /> },
    ...(deck ? [{ key: 'deck', title: 'Slide deck', desc: 'Presentations & pitch decks', skillId: 'slide-deck', fidelity: 'high' as Fidelity, icon: <IconDeck /> }] : []),
    { key: 'prototype', title: 'Prototype', desc: 'Interactive app mockups', skillId: 'web-prototype', fidelity: 'high', icon: <IconBrowser /> },
    { key: 'wireframe', title: 'Wireframe', desc: 'Lo-fi screens & flows', skillId: 'web-prototype', fidelity: 'wireframe', icon: <IconWireframe /> },
    { key: 'mobile', title: 'Mobile app', desc: 'iOS & Android screens', skillId: 'web-prototype', fidelity: 'high', hint: 'Mobile app UI: design phone-width screens (~390px frames) side by side — status bar, nav patterns, thumb-reach layout.', icon: <IconPhone /> },
    { key: 'document', title: 'Document', desc: 'Resumes, reports & PDFs', skillId: 'web-prototype', fidelity: 'high', hint: 'Document layout: a print-ready A4-style page — clear typographic hierarchy, generous margins, no app chrome.', icon: <IconDoc /> },
    { key: 'hyperframes', title: 'HyperFrames', desc: 'Motion graphics & reveals', skillId: 'web-prototype', fidelity: 'high', hint: 'Motion-graphics page: CSS keyframe animation and scroll-triggered reveals; movement is the design.', icon: <IconMotion /> },
    { key: 'webgl', title: 'WebGL experience', desc: 'Canvas & shader scenes', skillId: 'web-prototype', fidelity: 'high', hint: 'Canvas/WebGL experience: an animated generative scene with inline JS only (no external libraries).', icon: <IconGL /> },
    { key: 'live', title: 'Live artifact', desc: 'Data-backed live UI', skillId: 'web-prototype', fidelity: 'high', hint: 'Live artifact: a self-updating UI driven by inline mock data and JS timers — dashboards, tickers, feeds.', icon: <IconLive /> },
  ];
  return list.filter((t) => (t.skillId === 'web-prototype' ? web : true));
}

function shortPath(p: string): string {
  const parts = p.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || p;
}
function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function agentGlyph(id: string): string {
  if (id === 'claude') return '✳';
  if (id === 'codex') return '⌘';
  if (id === 'gemini') return '✦';
  if (id === 'cursor-agent') return '▸';
  if (id === 'opencode') return '◇';
  return '▹';
}

// ---- icons ----
function ClockMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.2 6.3L21 10l-6.8 1.7L12 18l-2.2-6.3L3 10l6.8-1.7z" />
    </svg>
  );
}
function PaletteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="1.3" /><circle cx="17" cy="11" r="1.3" /><circle cx="8" cy="7.5" r="1.3" /><circle cx="6.5" cy="12.5" r="1.3" />
      <path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H16a6 6 0 0 0 6-6c0-4.4-4.5-8-10-8z" />
    </svg>
  );
}
function FolderMini() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H3z" />
    </svg>
  );
}
const stroke = { fill: 'none', stroke: 'var(--muted)', strokeWidth: 1.5 } as const;
const accentFill = { fill: 'var(--accent)' } as const;
function IconBrowserArrow() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="6" y="8" width="54" height="38" rx="4" />
      <path d="M6 18h54" /><circle cx="13" cy="13" r="1.4" {...accentFill} stroke="none" />
      <rect x="14" y="26" width="20" height="4" rx="2" {...accentFill} stroke="none" />
      <path d="M60 27h14M68 21l6 6-6 6" />
    </svg>
  );
}
function IconDeck() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="16" y="6" width="46" height="30" rx="3" />
      <rect x="10" y="14" width="46" height="30" rx="3" fill="var(--surface)" />
      <rect x="18" y="22" width="16" height="4" rx="2" {...accentFill} stroke="none" />
      <path d="M18 30h30" />
    </svg>
  );
}
function IconBrowser() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="10" y="8" width="60" height="38" rx="4" />
      <path d="M10 18h60" /><circle cx="17" cy="13" r="1.4" {...accentFill} stroke="none" />
      <rect x="18" y="26" width="18" height="4" rx="2" {...accentFill} stroke="none" />
      <path d="M18 34h34M18 40h24" />
    </svg>
  );
}
function IconWireframe() {
  return (
    <svg viewBox="0 0 80 54" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3">
      <rect x="10" y="8" width="60" height="38" rx="4" />
      <path d="M10 20h60M28 20v26" />
      <rect x="34" y="26" width="18" height="4" rx="2" fill="var(--accent)" stroke="none" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="30" y="4" width="20" height="46" rx="4" />
      <path d="M36 8h8" />
      <rect x="34" y="16" width="12" height="4" rx="2" {...accentFill} stroke="none" />
      <path d="M34 26h12M34 32h9" />
    </svg>
  );
}
function IconDoc() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <path d="M26 4h20l8 8v38H26z" />
      <path d="M46 4v8h8" />
      <rect x="32" y="20" width="14" height="4" rx="2" {...accentFill} stroke="none" />
      <path d="M32 28h16M32 34h16M32 40h10" />
    </svg>
  );
}
function IconMotion() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="10" y="10" width="44" height="30" rx="4" />
      <rect x="22" y="16" width="44" height="30" rx="4" fill="var(--surface)" />
      <path d="M38 31l10-6v12z" {...accentFill} stroke="none" />
    </svg>
  );
}
function IconGL() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <path d="M40 6l24 14v14L40 48 16 34V20z" />
      <path d="M40 6v20M16 20l24 6 24-6M40 48V26" />
      <circle cx="40" cy="26" r="3" {...accentFill} stroke="none" />
    </svg>
  );
}
function IconLive() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="10" y="8" width="60" height="38" rx="4" />
      <path d="M16 34l10-8 8 5 10-12 10 7" stroke="var(--accent)" />
      <circle cx="62" cy="14" r="2.5" {...accentFill} stroke="none" />
    </svg>
  );
}
