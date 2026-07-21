import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, RuntimeInfo } from '../shared/types';
import { uio } from './bridge';
import { Home } from './screens/Home';
import { Studio } from './screens/Studio';
import { SettingsModal } from './components/SettingsModal';
import { TabBar } from './components/TabBar';

export function App() {
  const [view, setView] = useState<'home' | 'studio'>('home');
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [openProjectName, setOpenProjectName] = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);
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

  const openProject = useCallback((id: string, name: string, prompt?: string) => {
    setOpenProjectId(id);
    setOpenProjectName(name);
    setInitialPrompt(prompt);
    setView('studio');
  }, []);

  const goHome = useCallback(() => setView('home'), []);
  const closeProject = useCallback(() => {
    setOpenProjectId(null);
    setOpenProjectName(null);
    setView('home');
  }, []);

  return (
    <div className="app">
      <TabBar
        view={view}
        projectName={openProjectName}
        onHome={() => (openProjectId && view === 'home' ? setView('studio') : goHome())}
        onNew={goHome}
        onCloseProject={closeProject}
        onOpenSettings={() => setShowSettings(true)}
      />

      {view === 'home' ? (
        <Home
          runtimes={runtimes}
          settings={settings}
          onOpenProject={(id, name, prompt) => openProject(id, name, prompt)}
          onOpenSettings={() => setShowSettings(true)}
        />
      ) : (
        openProjectId && (
          <Studio
            projectId={openProjectId}
            initialPrompt={initialPrompt}
            onConsumedInitialPrompt={() => setInitialPrompt(undefined)}
            runtimes={runtimes}
            settings={settings}
            onBack={goHome}
          />
        )
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
