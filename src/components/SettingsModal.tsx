import { useEffect, useState } from 'react';
import type {
  AppSettings,
  DesignSystemInfo,
  EngineCheck,
  EngineSource,
  ProviderKind,
  RuntimeInfo,
  SecretStatus,
} from '../../shared/types';
import { vds } from '../bridge';

type NavKey = 'engine' | 'systems' | 'locations' | 'about';

const NAV: { key: NavKey; label: string; icon: string }[] = [
  { key: 'engine', label: 'Execution mode', icon: '⚙' },
  { key: 'systems', label: 'Design systems', icon: '◈' },
  { key: 'locations', label: 'Project locations', icon: '▤' },
  { key: 'about', label: 'About', icon: 'ⓘ' },
];

const TITLES: Record<NavKey, { h: string; sub: string }> = {
  engine: { h: 'Execution mode', sub: 'Choose Local CLI, your API key, or hosted.' },
  systems: { h: 'Design systems', sub: 'Brand contracts your agent designs against.' },
  locations: { h: 'Project locations', sub: 'Where your projects live on disk.' },
  about: { h: 'About', sub: 'VDS — Visual Design Studio, open-source & local-first.' },
};

const SOURCES: { id: EngineSource; label: string }[] = [
  { id: 'local-cli', label: 'Local CLI' },
  { id: 'byok', label: 'Your API key' },
  { id: 'hosted', label: 'Hosted' },
];

export function SettingsModal(props: {
  runtimes: RuntimeInfo[];
  settings: AppSettings;
  onClose: () => void;
  onRefreshRuntimes: () => void;
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}) {
  const { runtimes, settings, onClose, onRefreshRuntimes, onSaveSettings } = props;
  const [nav, setNav] = useState<NavKey>('engine');
  const [source, setSource] = useState<EngineSource>(settings.engineSource);
  const [byokProvider, setByokProvider] = useState<ProviderKind>(settings.byokProvider);
  const [byokBaseUrl, setByokBaseUrl] = useState(settings.byokBaseUrl);
  const [byokModel, setByokModel] = useState(settings.byokModel);
  const [hostedEndpoint, setHostedEndpoint] = useState(settings.hostedEndpoint);
  const [hostedModel, setHostedModel] = useState(settings.hostedModel);
  const [byokKey, setByokKey] = useState('');
  const [hostedToken, setHostedToken] = useState('');
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [systems, setSystems] = useState<DesignSystemInfo[]>([]);
  const [check, setCheck] = useState<EngineCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    void vds().getSecretStatus().then(setSecretStatus);
    void vds().listDesignSystems().then(setSystems);
  }, []);

  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(''), 1800);
  };
  const persist = (patch: Partial<AppSettings>) => onSaveSettings(patch);

  const pickSource = async (id: EngineSource) => {
    setSource(id);
    setCheck(null);
    await persist({ engineSource: id });
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await vds().checkEngine(source));
    } finally {
      setChecking(false);
    }
  };

  const saveKey = async () => {
    if (!byokKey.trim()) return;
    setSecretStatus(await vds().setSecret('byokKey', byokKey.trim()));
    setByokKey('');
    flash('Key stored securely');
  };
  const saveToken = async () => {
    if (!hostedToken.trim()) return;
    setSecretStatus(await vds().setSecret('hostedToken', hostedToken.trim()));
    setHostedToken('');
    flash('Token stored securely');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-top">
          <div>
            <div className="st-eyebrow">Settings</div>
            <h2>{TITLES[nav].h}</h2>
          </div>
          <span className="st-sub">{TITLES[nav].sub}</span>
          <div style={{ flex: 1 }} />
          <button className="st-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="settings-split">
          <nav className="settings-nav">
            {NAV.map((n) => (
              <button key={n.key} className={nav === n.key ? 'active' : ''} onClick={() => setNav(n.key)}>
                <span style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          <div className="settings-main">
            {nav === 'engine' && (
              <>
                <div className="seg-large">
                  {SOURCES.map((s) => (
                    <button key={s.id} className={source === s.id ? 'active' : ''} onClick={() => void pickSource(s.id)}>
                      {s.label}
                    </button>
                  ))}
                </div>

                {source === 'local-cli' && (
                  <LocalCliPanel
                    runtimes={runtimes}
                    defaultRuntimeId={settings.defaultRuntimeId}
                    onMakeDefault={(id) => void persist({ defaultRuntimeId: id })}
                    onRescan={onRefreshRuntimes}
                  />
                )}

                {source === 'byok' && (
                  <div className="engine-config" style={{ border: 'none', paddingTop: 0 }}>
                    <div className="section-hint">Call a provider directly with your own key. Everything but the model call stays local.</div>
                    <div className="row2">
                      <div className="field">
                        <label>Provider</label>
                        <select value={byokProvider} onChange={(e) => setByokProvider(e.target.value as ProviderKind)}>
                          <option value="anthropic">Anthropic</option>
                          <option value="openai">OpenAI-compatible</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Model</label>
                        <input type="text" value={byokModel} onChange={(e) => setByokModel(e.target.value)} />
                      </div>
                    </div>
                    <div className="field">
                      <label>Base URL</label>
                      <input type="text" value={byokBaseUrl} onChange={(e) => setByokBaseUrl(e.target.value)} />
                    </div>
                    <button className="btn small" onClick={() => void persist({ byokProvider, byokBaseUrl: byokBaseUrl.trim(), byokModel: byokModel.trim() }).then(() => flash('Saved'))}>
                      Save config
                    </button>
                    <div className="field" style={{ marginTop: 16 }}>
                      <label>API key {secretStatus?.byokKeyConfigured && <span className="badge ok">stored</span>}</label>
                      <div className="row2">
                        <input type="password" placeholder={secretStatus?.byokKeyConfigured ? '•••••••• (stored)' : 'sk-…'} value={byokKey} onChange={(e) => setByokKey(e.target.value)} />
                        <div className="btn-inline">
                          <button className="btn primary small" onClick={() => void saveKey()} disabled={!byokKey.trim()}>Save</button>
                          {secretStatus?.byokKeyConfigured && (
                            <button className="btn small" onClick={async () => { setSecretStatus(await vds().clearSecret('byokKey')); flash('Removed'); }}>Clear</button>
                          )}
                        </div>
                      </div>
                      <div className="hint-line">Encrypted with macOS Keychain. Never shown again or sent anywhere but the provider.</div>
                    </div>
                  </div>
                )}

                {source === 'hosted' && (
                  <div className="engine-config" style={{ border: 'none', paddingTop: 0 }}>
                    <div className="hosted-explainer">
                      No plan of your own? Point this at a VDS proxy running under the app owner's account. You send only a usage token —
                      the real key stays on the server, and your projects, preview, and export stay on your Mac.
                    </div>
                    <div className="row2">
                      <div className="field" style={{ flex: 2 }}>
                        <label>Hosted endpoint</label>
                        <input type="text" placeholder="https://vds-proxy.example.com" value={hostedEndpoint} onChange={(e) => setHostedEndpoint(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>Model label</label>
                        <input type="text" value={hostedModel} onChange={(e) => setHostedModel(e.target.value)} />
                      </div>
                    </div>
                    <button className="btn small" onClick={() => void persist({ hostedEndpoint: hostedEndpoint.trim(), hostedModel: hostedModel.trim() || 'default' }).then(() => flash('Saved'))}>
                      Save config
                    </button>
                    <div className="field" style={{ marginTop: 16 }}>
                      <label>Usage token {secretStatus?.hostedTokenConfigured && <span className="badge ok">stored</span>}</label>
                      <div className="row2">
                        <input type="password" placeholder={secretStatus?.hostedTokenConfigured ? '•••••••• (stored)' : 'vds_… from the app owner'} value={hostedToken} onChange={(e) => setHostedToken(e.target.value)} />
                        <div className="btn-inline">
                          <button className="btn primary small" onClick={() => void saveToken()} disabled={!hostedToken.trim()}>Save</button>
                          {secretStatus?.hostedTokenConfigured && (
                            <button className="btn small" onClick={async () => { setSecretStatus(await vds().clearSecret('hostedToken')); flash('Removed'); }}>Clear</button>
                          )}
                        </div>
                      </div>
                      <div className="hint-line">Encrypted with macOS Keychain. Your monthly quota is enforced by the proxy.</div>
                    </div>
                  </div>
                )}

                {secretStatus && !secretStatus.encryptionAvailable && source !== 'local-cli' && (
                  <div className="warn-line">OS secure storage is unavailable, so secrets can't be saved on this machine.</div>
                )}
              </>
            )}

            {nav === 'systems' && (
              <div className="settings-list">
                {systems.map((s) => (
                  <div className="cli-card" key={s.id}>
                    <div className="cli-name">{s.name}</div>
                    <div className="cli-meta" style={{ fontFamily: 'var(--sans)', fontSize: 12.5 }}>{s.description}</div>
                    <div className="swatch-row" style={{ marginTop: 10 }}>
                      {s.swatches.map((c, i) => <div key={i} className="swatch" style={{ background: c }} />)}
                    </div>
                  </div>
                ))}
                <div className="hint-line">Add your own: drop a folder with a DESIGN.md into <code>~/VDS Library/design-systems/</code>.</div>
              </div>
            )}

            {nav === 'locations' && (
              <div className="field">
                <label>Projects folder</label>
                <input type="text" value={settings.projectsRoot} readOnly />
                <div className="hint-line">Each project is a plain folder here. Move the folder to relocate it; VDS follows.</div>
              </div>
            )}

            {nav === 'about' && (
              <div>
                <div className="cli-card">
                  <div className="cli-name">VDS <span className="sub">v0.1 · Apache-2.0</span></div>
                  <div className="cli-meta" style={{ fontFamily: 'var(--sans)', fontSize: 13 }}>
                    The open-source Claude Design alternative. Your coding agents become the design engine — local-first, macOS.
                  </div>
                  <div className="agent-actions" style={{ marginTop: 12 }}>
                    <button className="btn small" onClick={() => void vds().openExternal('https://github.com/yuzu-ux/VDS')}>GitHub</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="settings-foot">
          <div className="check-area">
            {nav === 'engine' && (
              <button className="btn small" onClick={() => void runCheck()} disabled={checking}>
                {checking ? 'Checking…' : 'Test engine'}
              </button>
            )}
            {check && <span className={`check-result ${check.ok ? 'ok' : 'bad'}`}>{check.ok ? '✓' : '✕'} {check.detail}</span>}
            {note && <span className="saved-note">{note}</span>}
          </div>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function LocalCliPanel(props: {
  runtimes: RuntimeInfo[];
  defaultRuntimeId: string | null;
  onMakeDefault: (id: string) => void;
  onRescan: () => void;
}) {
  const { runtimes, defaultRuntimeId, onMakeDefault, onRescan } = props;
  const available = runtimes.filter((r) => r.available).length;
  return (
    <>
      <div className="section-hint">Pick the CLI that runs your prompts.</div>
      <div className="section-row">
        <h4>Your CLIs ({available})</h4>
        <button className="btn small" onClick={onRescan}>↻ Rescan</button>
      </div>
      {runtimes.map((r) => (
        <div className={`cli-card ${defaultRuntimeId === r.id && r.available ? 'selected' : ''}`} key={r.id}>
          <div className="cli-top">
            <div className="cli-logo">{glyph(r.id)}</div>
            <div className="cli-info">
              <div className="cli-name">
                {r.name}
                {r.available ? <span className="badge accent">detected</span> : <span className="badge">not found</span>}
              </div>
              <div className="cli-meta">{r.available ? `${r.version ?? ''} · ${r.resolvedPath ?? ''}` : 'Install and authenticate this CLI, then Rescan.'}</div>
            </div>
            <div className="cli-right">
              {defaultRuntimeId === r.id && r.available && <span className="badge ok">default</span>}
              {r.available && defaultRuntimeId !== r.id && (
                <button className="btn small" onClick={() => onMakeDefault(r.id)}>Make default</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function glyph(id: string): string {
  if (id === 'claude') return '✳';
  if (id === 'codex') return '⌘';
  if (id === 'gemini') return '✦';
  if (id === 'cursor-agent') return '▸';
  return '▹';
}
