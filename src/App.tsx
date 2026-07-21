import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, RuntimeInfo } from '../shared/types';
import { uio } from './bridge';
import { Home } from './screens/Home';
import { Studio } from './screens/Studio';

type View = { name: 'home' } | { name: 'studio'; projectId: string };

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const refreshRuntimes = useCallback(async (force = false) => {
    setRuntimes(await uio().listRuntimes(force));
  }, []);

  useEffect(() => {
    void refreshRuntimes();
    void uio().getSettings().then(setSettings);
  }, [refreshRuntimes]);

  const openProject = useCallback((projectId: string) => setView({ name: 'studio', projectId }), []);
  const goHome = useCallback(() => setView({ name: 'home' }), []);

  return (
    <div className="app">
      <div className="drag-strip" />
      {view.name === 'home' ? (
        <Home
          runtimes={runtimes}
          settings={settings}
          onOpenProject={openProject}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        <Studio
          projectId={view.projectId}
          runtimes={runtimes}
          settings={settings}
          onBack={goHome}
        />
      )}
      {showSettings && settings && (
        <SettingsModal
          runtimes={runtimes}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onRefreshRuntimes={() => refreshRuntimes(true)}
          onSave={async (patch) => setSettings(await uio().setSettings(patch))}
        />
      )}
    </div>
  );
}

function SettingsModal(props: {
  runtimes: RuntimeInfo[];
  settings: AppSettings;
  onClose: () => void;
  onRefreshRuntimes: () => void;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { runtimes, settings, onClose, onRefreshRuntimes, onSave } = props;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="field">
          <label>Design engines (agent CLIs on your PATH)</label>
          <div className="settings-list">
            {runtimes.map((r) => (
              <div className="runtime-row" key={r.id}>
                <span className={`chip`} style={{ borderColor: 'transparent', padding: 0 }}>
                  <span className={`dot ${r.available ? '' : 'off'}`} />
                </span>
                <div className="info">
                  <div className="name">{r.name}</div>
                  <div className="ver">{r.available ? `${r.resolvedPath} · ${r.version}` : 'not detected'}</div>
                </div>
                {settings.defaultRuntimeId === r.id && <span className="badge">default</span>}
                {r.available && settings.defaultRuntimeId !== r.id && (
                  <button className="btn small" onClick={() => void onSave({ defaultRuntimeId: r.id })}>
                    Make default
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Projects folder</label>
          <input type="text" value={settings.projectsRoot} readOnly title="Change by moving the folder; configurable path UI coming" />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button className="btn" onClick={onRefreshRuntimes}>Re-detect engines</button>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
