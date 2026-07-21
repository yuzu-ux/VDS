import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  DesignSystemInfo,
  EngineCheck,
  Fidelity,
  ProjectMeta,
  RuntimeInfo,
  SkillInfo,
} from '../../shared/types';
import { uio } from '../bridge';

interface TemplateDef {
  key: string;
  title: string;
  desc: string;
  skillId: string;
  fidelity: Fidelity;
  icon: JSX.Element;
}

export function Home(props: {
  runtimes: RuntimeInfo[];
  settings: AppSettings | null;
  onOpenProject: (id: string, name: string, initialPrompt?: string) => void;
  onOpenSettings: () => void;
}) {
  const { settings, onOpenProject, onOpenSettings } = props;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [systems, setSystems] = useState<DesignSystemInfo[]>([]);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);

  const [prompt, setPrompt] = useState('');
  const [skillId, setSkillId] = useState('web-prototype');
  const [designSystemId, setDesignSystemId] = useState('');
  const [fidelity, setFidelity] = useState<Fidelity>('high');
  const [activeTpl, setActiveTpl] = useState<string>('prototype');
  const [creating, setCreating] = useState(false);
  const [engineCheck, setEngineCheck] = useState<EngineCheck | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const engineSource = settings?.engineSource ?? 'local-cli';

  const refresh = async () => {
    const [sk, ds, pr] = await Promise.all([uio().listSkills(), uio().listDesignSystems(), uio().listProjects()]);
    setSkills(sk);
    setSystems(ds);
    setProjects(pr);
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    void uio().checkEngine(engineSource).then(setEngineCheck);
  }, [engineSource]);

  const templates = useMemo<TemplateDef[]>(
    () => buildTemplates(skills),
    [skills],
  );

  const engineLabel = useMemo(() => {
    const kind = engineSource === 'local-cli' ? 'Local CLI' : engineSource === 'byok' ? 'Your API key' : 'Hosted';
    return kind;
  }, [engineSource]);

  const pickTemplate = (t: TemplateDef) => {
    setActiveTpl(t.key);
    setSkillId(t.skillId);
    setFidelity(t.fidelity);
    textareaRef.current?.focus();
  };

  const nameFromPrompt = (text: string) => {
    const words = text.trim().split(/\s+/).slice(0, 6).join(' ');
    return words.slice(0, 48) || 'Untitled design';
  };

  const create = async (withPrompt: boolean) => {
    if (creating) return;
    if (withPrompt && !prompt.trim()) return;
    setCreating(true);
    try {
      const name = withPrompt ? nameFromPrompt(prompt) : `${skills.find((s) => s.id === skillId)?.name ?? 'New'} design`;
      const meta = await uio().createProject({
        name,
        skillId,
        designSystemId: designSystemId || null,
        fidelity,
      });
      onOpenProject(meta.id, meta.name, withPrompt ? prompt.trim() : undefined);
    } finally {
      setCreating(false);
    }
  };

  const removeProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Move this project to the Trash?')) return;
    await uio().deleteProject(id);
    void refresh();
  };

  const systemName = (id: string | null) => (id ? systems.find((s) => s.id === id)?.name ?? id : null);
  const recent = projects.slice(0, 8);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="brand-hero">
          <span className="brand-mark">
            <ClockMark />
          </span>
          <span className="brand-word">UIO</span>
        </div>
        <h1 className="hero-h1">What will you design with your agent today?</h1>
        <p className="hero-sub">The open-source Claude Design alternative — local-first, macOS.</p>

        <div className="composer-hero">
          <textarea
            ref={textareaRef}
            placeholder="Describe a prototype, a slide deck, a dashboard…"
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
            <span className="mini select-pill" title="What to build">
              <span className="val">{skills.find((s) => s.id === skillId)?.name ?? 'Template'}</span>
              <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                {skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </span>
            <span className="mini select-pill" title="Fidelity">
              <span>✦</span>
              <span className="val">{fidelity === 'high' ? 'High fidelity' : 'Wireframe'}</span>
              <select value={fidelity} onChange={(e) => setFidelity(e.target.value as Fidelity)}>
                <option value="high">High fidelity</option>
                <option value="wireframe">Wireframe</option>
              </select>
            </span>
            <div className="spacer" />
            <button className="mini" title="Engine — open Settings" onClick={onOpenSettings}>
              <span className={`dot ${engineCheck?.ok ? '' : 'off'}`} style={{ width: 7, height: 7, borderRadius: '50%', background: engineCheck?.ok ? 'var(--ok)' : 'var(--faint)' }} />
              <span className="val">{engineLabel}</span>
            </button>
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

        <div className="tpl-label">Start with a template…</div>
        <div className="tpl-row">
          {templates.map((t) => (
            <button key={t.key} className={`tpl-card ${activeTpl === t.key ? 'active' : ''}`} onClick={() => pickTemplate(t)}>
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
                  <div className="recent-thumb">▤</div>
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
  const hasDeck = skills.some((s) => s.id === 'slide-deck');
  const list: TemplateDef[] = [
    { key: 'website', title: 'Website clone', desc: 'Source-first site reproduction', skillId: 'web-prototype', fidelity: 'high', icon: <IconBrowserArrow /> },
    ...(hasDeck ? [{ key: 'deck', title: 'Slide deck', desc: 'Presentations & pitch decks', skillId: 'slide-deck', fidelity: 'high' as Fidelity, icon: <IconDeck /> }] : []),
    { key: 'prototype', title: 'Prototype', desc: 'Interactive page mockups', skillId: 'web-prototype', fidelity: 'high', icon: <IconBrowser /> },
    { key: 'wireframe', title: 'Wireframe', desc: 'Lo-fi screens & flows', skillId: 'web-prototype', fidelity: 'wireframe', icon: <IconWireframe /> },
    { key: 'landing', title: 'Landing page', desc: 'Marketing hero & sections', skillId: 'web-prototype', fidelity: 'high', icon: <IconLanding /> },
  ];
  return list.filter((t) => skills.some((s) => s.id === t.skillId));
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
function IconLanding() {
  return (
    <svg viewBox="0 0 80 54" {...stroke}>
      <rect x="10" y="8" width="60" height="38" rx="4" />
      <rect x="20" y="16" width="26" height="5" rx="2.5" {...accentFill} stroke="none" />
      <path d="M20 26h40M20 32h30" />
      <rect x="20" y="37" width="14" height="5" rx="2.5" />
    </svg>
  );
}
