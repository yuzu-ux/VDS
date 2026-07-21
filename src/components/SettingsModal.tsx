import { useEffect, useState } from 'react';
import type {
  AppSettings,
  EngineCheck,
  EngineSource,
  ProviderKind,
  RuntimeInfo,
  SecretStatus,
} from '../../shared/types';
import { uio } from '../bridge';

const SOURCES: { id: EngineSource; label: string; blurb: string }[] = [
  { id: 'local-cli', label: 'Local CLI', blurb: 'Use an agent (claude, codex…) on your Mac. Fully local, filesystem-native.' },
  { id: 'byok', label: 'Your API key', blurb: 'Call a provider directly with your own key. Local except the model call.' },
  { id: 'hosted', label: 'Hosted', blurb: "No plan of your own? Borrow the app owner's subscription via a usage token." },
];

export function SettingsModal(props: {
  runtimes: RuntimeInfo[];
  settings: AppSettings;
  onClose: () => void;
  onRefreshRuntimes: () => void;
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}) {
  const { runtimes, settings, onClose, onRefreshRuntimes, onSaveSettings } = props;
  const [source, setSource] = useState<EngineSource>(settings.engineSource);
  const [byokProvider, setByokProvider] = useState<ProviderKind>(settings.byokProvider);
  const [byokBaseUrl, setByokBaseUrl] = useState(settings.byokBaseUrl);
  const [byokModel, setByokModel] = useState(settings.byokModel);
  const [hostedEndpoint, setHostedEndpoint] = useState(settings.hostedEndpoint);
  const [hostedModel, setHostedModel] = useState(settings.hostedModel);
  const [byokKey, setByokKey] = useState('');
  const [hostedToken, setHostedToken] = useState('');
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [check, setCheck] = useState<EngineCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [savedNote, setSavedNote] = useState('');

  useEffect(() => {
    void uio().getSecretStatus().then(setSecretStatus);
  }, []);

  const note = (msg: string) => {
    setSavedNote(msg);
    setTimeout(() => setSavedNote(''), 1800);
  };

  const persist = async (patch: Partial<AppSettings>) => {
    await onSaveSettings(patch);
  };

  const pickSource = async (id: EngineSource) => {
    setSource(id);
    setCheck(null);
    await persist({ engineSource: id });
  };

  const saveByokConfig = async () => {
    await persist({ byokProvider, byokBaseUrl: byokBaseUrl.trim(), byokModel: byokModel.trim() });
    note('Saved');
  };
  const saveHostedConfig = async () => {
    await persist({ hostedEndpoint: hostedEndpoint.trim(), hostedModel: hostedModel.trim() || 'default' });
    note('Saved');
  };

  const saveKey = async () => {
    if (!byokKey.trim()) return;
    setSecretStatus(await uio().setSecret('byokKey', byokKey.trim()));
    setByokKey('');
    note('Key stored securely');
  };
  const clearKey = async () => {
    setSecretStatus(await uio().clearSecret('byokKey'));
    note('Key removed');
  };
  const saveToken = async () => {
    if (!hostedToken.trim()) return;
    setSecretStatus(await uio().setSecret('hostedToken', hostedToken.trim()));
    setHostedToken('');
    note('Token stored securely');
  };
  const clearToken = async () => {
    setSecretStatus(await uio().clearSecret('hostedToken'));
    note('Token removed');
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await uio().checkEngine(source));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Engine &amp; settings</h2>

        <div className="field">
          <label>Where designs are generated</label>
          <div className="source-cards">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                className={`source-card ${source === s.id ? 'active' : ''}`}
                onClick={() => void pickSource(s.id)}
              >
                <div className="src-label">{s.label}</div>
                <div className="src-blurb">{s.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        {source === 'local-cli' && (
          <div className="field">
            <label>Detected agent CLIs</label>
            <div className="settings-list">
              {runtimes.map((r) => (
                <div className="runtime-row" key={r.id}>
                  <span className="chip" style={{ borderColor: 'transparent', padding: 0 }}>
                    <span className={`dot ${r.available ? '' : 'off'}`} />
                  </span>
                  <div className="info">
                    <div className="name">{r.name}</div>
                    <div className="ver">{r.available ? `${r.resolvedPath} · ${r.version}` : 'not detected'}</div>
                  </div>
                  {settings.defaultRuntimeId === r.id && <span className="badge">default</span>}
                  {r.available && settings.defaultRuntimeId !== r.id && (
                    <button className="btn small" onClick={() => void persist({ defaultRuntimeId: r.id })}>
                      Make default
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button className="btn small" style={{ marginTop: 8 }} onClick={onRefreshRuntimes}>
              Re-detect engines
            </button>
          </div>
        )}

        {source === 'byok' && (
          <div className="engine-config">
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
            <button className="btn small" onClick={() => void saveByokConfig()}>Save config</button>

            <div className="field" style={{ marginTop: 14 }}>
              <label>
                API key {secretStatus?.byokKeyConfigured && <span className="badge ok">stored</span>}
              </label>
              <div className="row2">
                <input
                  type="password"
                  placeholder={secretStatus?.byokKeyConfigured ? '•••••••• (stored)' : 'sk-…'}
                  value={byokKey}
                  onChange={(e) => setByokKey(e.target.value)}
                />
                <div className="btn-inline">
                  <button className="btn primary small" onClick={() => void saveKey()} disabled={!byokKey.trim()}>Save</button>
                  {secretStatus?.byokKeyConfigured && <button className="btn small" onClick={() => void clearKey()}>Clear</button>}
                </div>
              </div>
              <div className="hint-line">Encrypted with macOS Keychain. Never shown again or sent anywhere but the provider.</div>
            </div>
          </div>
        )}

        {source === 'hosted' && (
          <div className="engine-config">
            <div className="hosted-explainer">
              Point this at a UIO proxy running under someone else's provider account. You send only a usage token — the
              real key stays on the server. Everything else (your projects, files, preview, export) stays on your Mac.
            </div>
            <div className="row2">
              <div className="field" style={{ flex: 2 }}>
                <label>Hosted endpoint</label>
                <input type="text" placeholder="https://uio-proxy.example.com" value={hostedEndpoint} onChange={(e) => setHostedEndpoint(e.target.value)} />
              </div>
              <div className="field">
                <label>Model label</label>
                <input type="text" value={hostedModel} onChange={(e) => setHostedModel(e.target.value)} />
              </div>
            </div>
            <button className="btn small" onClick={() => void saveHostedConfig()}>Save config</button>

            <div className="field" style={{ marginTop: 14 }}>
              <label>
                Usage token {secretStatus?.hostedTokenConfigured && <span className="badge ok">stored</span>}
              </label>
              <div className="row2">
                <input
                  type="password"
                  placeholder={secretStatus?.hostedTokenConfigured ? '•••••••• (stored)' : 'uio_… token from the app owner'}
                  value={hostedToken}
                  onChange={(e) => setHostedToken(e.target.value)}
                />
                <div className="btn-inline">
                  <button className="btn primary small" onClick={() => void saveToken()} disabled={!hostedToken.trim()}>Save</button>
                  {secretStatus?.hostedTokenConfigured && <button className="btn small" onClick={() => void clearToken()}>Clear</button>}
                </div>
              </div>
              <div className="hint-line">Encrypted with macOS Keychain. Your quota is enforced by the proxy.</div>
            </div>
          </div>
        )}

        {secretStatus && !secretStatus.encryptionAvailable && (source === 'byok' || source === 'hosted') && (
          <div className="warn-line">OS secure storage is unavailable, so secrets can't be saved on this machine.</div>
        )}

        <div className="modal-foot">
          <div className="check-area">
            <button className="btn small" onClick={() => void runCheck()} disabled={checking}>
              {checking ? 'Checking…' : 'Test engine'}
            </button>
            {check && <span className={`check-result ${check.ok ? 'ok' : 'bad'}`}>{check.ok ? '✓' : '✕'} {check.detail}</span>}
            {savedNote && <span className="saved-note">{savedNote}</span>}
          </div>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
