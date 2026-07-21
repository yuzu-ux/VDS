import { useEffect, useMemo, useState } from 'react';
import type {
  AppSettings,
  DesignSystemInfo,
  Fidelity,
  ProjectMeta,
  RuntimeInfo,
  SkillInfo,
} from '../../shared/types';
import { isElectron, uio } from '../bridge';

export function Home(props: {
  runtimes: RuntimeInfo[];
  settings: AppSettings | null;
  onOpenProject: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const { runtimes, settings, onOpenProject, onOpenSettings } = props;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [systems, setSystems] = useState<DesignSystemInfo[]>([]);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [mainTab, setMainTab] = useState<'designs' | 'systems'>('designs');
  const [search, setSearch] = useState('');

  // create form
  const [skillId, setSkillId] = useState<string>('');
  const [name, setName] = useState('');
  const [designSystemId, setDesignSystemId] = useState<string>('');
  const [fidelity, setFidelity] = useState<Fidelity>('high');
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    const [sk, ds, pr] = await Promise.all([uio().listSkills(), uio().listDesignSystems(), uio().listProjects()]);
    setSkills(sk);
    setSystems(ds);
    setProjects(pr);
    setSkillId((prev) => prev || sk[0]?.id || '');
  };

  useEffect(() => {
    void refresh();
  }, []);

  const activeRuntime = useMemo(() => {
    const preferred = runtimes.find((r) => r.id === settings?.defaultRuntimeId && r.available);
    return preferred ?? runtimes.find((r) => r.available) ?? null;
  }, [runtimes, settings]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, search]);

  const create = async () => {
    if (!skillId || creating) return;
    setCreating(true);
    try {
      const meta = await uio().createProject({
        name: name.trim() || 'Untitled design',
        skillId,
        designSystemId: designSystemId || null,
        fidelity,
      });
      onOpenProject(meta.id);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Move this project to the Trash?')) return;
    await uio().deleteProject(id);
    void refresh();
  };

  const systemName = (id: string | null) =>
    id ? systems.find((s) => s.id === id)?.name ?? id : 'freeform';

  return (
    <div className="home">
      <aside className="home-left">
        <div className="brand-row" style={{ marginTop: isElectron ? 26 : 0 }}>
          <div className="brand-mark">U</div>
          <div>
            <div className="brand-name">
              UIO <span className="badge">open source</span>
            </div>
            <div className="brand-sub">UI, Open — by you and your agents</div>
          </div>
        </div>

        <div className="create-card">
          <div className="create-tabs">
            {skills.map((s) => (
              <button key={s.id} className={skillId === s.id ? 'active' : ''} onClick={() => setSkillId(s.id)}>
                {s.name}
              </button>
            ))}
          </div>

          <div className="field">
            <label>New {skills.find((s) => s.id === skillId)?.mode === 'deck' ? 'deck' : 'prototype'}</label>
            <input
              type="text"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
          </div>

          <div className="field">
            <label>Design system</label>
            <select value={designSystemId} onChange={(e) => setDesignSystemId(e.target.value)}>
              <option value="">None — freeform</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Fidelity</label>
            <div className="fidelity-row">
              <div
                className={`fidelity-opt ${fidelity === 'wireframe' ? 'active' : ''}`}
                onClick={() => setFidelity('wireframe')}
                role="button"
              >
                <div className="thumb" />
                <span>Wireframe</span>
              </div>
              <div
                className={`fidelity-opt hifi ${fidelity === 'high' ? 'active' : ''}`}
                onClick={() => setFidelity('high')}
                role="button"
              >
                <div className="thumb" />
                <span>High fidelity</span>
              </div>
            </div>
          </div>

          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => void create()} disabled={creating || !skillId}>
            ✦ Create
          </button>
          <div className="create-note">Projects are plain folders on your Mac. Yours, forever.</div>
        </div>

        <div className="foot">
          <span className="chip" title={activeRuntime?.resolvedPath ?? 'No engine detected'}>
            <span className={`dot ${activeRuntime ? '' : 'off'}`} />
            {activeRuntime ? `Local CLI · ${activeRuntime.name} · ${activeRuntime.version}` : 'No design engine detected'}
          </span>
          <button className="btn ghost small" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </aside>

      <main className="home-main">
        <div className="home-main-header">
          <button className={`tab ${mainTab === 'designs' ? 'active' : ''}`} onClick={() => setMainTab('designs')}>
            Designs
          </button>
          <button className={`tab ${mainTab === 'systems' ? 'active' : ''}`} onClick={() => setMainTab('systems')}>
            Design systems
          </button>
          <div className="search">
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="grid-scroll">
          {mainTab === 'designs' ? (
            filteredProjects.length === 0 ? (
              <div className="empty-state">
                <div className="big">Nothing here yet.</div>
                <div>Name a project on the left and press Create — your agent does the rest.</div>
              </div>
            ) : (
              <div className="cards-grid">
                {filteredProjects.map((p) => (
                  <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)}>
                    <div className="thumb">▤</div>
                    <div className="meta">
                      <div className="name">{p.name}</div>
                      <div className="sub">
                        <span className="ds">{systemName(p.designSystemId)}</span> · {timeAgo(p.updatedAt)}
                        <button
                          className="btn ghost small danger-text"
                          style={{ float: 'right', marginTop: -4 }}
                          title="Move to Trash"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(p.id);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="cards-grid">
              {systems.map((s) => (
                <div key={s.id} className="ds-card">
                  <div className="name">{s.name}</div>
                  <div className="desc">{s.description}</div>
                  <div className="swatch-row">
                    {s.swatches.map((c, i) => (
                      <div key={i} className="swatch" style={{ background: c }} title={c} />
                    ))}
                  </div>
                  {s.fontLabel && <div className="font-label">Aa · {s.fontLabel}</div>}
                </div>
              ))}
              <div className="ds-card" style={{ borderStyle: 'dashed', background: 'transparent' }}>
                <div className="name">Add your own</div>
                <div className="desc">
                  Drop a folder with a DESIGN.md into <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>~/UIO Library/design-systems/</span> — same format as the Open Design ecosystem.
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
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
