import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, RuntimeInfo } from '../shared/types';
import { uio } from './bridge';
import { Home } from './screens/Home';
import { Studio } from './screens/Studio';
import { SettingsModal } from './components/SettingsModal';

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
          onSaveSettings={async (patch) => {
            const next = await uio().setSettings(patch);
            setSettings(next);
            return next;
          }}
        />
      )}
    </div>
  );
}
