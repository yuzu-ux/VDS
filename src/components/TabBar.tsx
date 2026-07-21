import { uio } from '../bridge';

// The macOS-style top chrome: Home tab + the open project's tab, a new-tab
// button, and a right cluster (repo star + settings). The whole bar is the
// window drag region; interactive bits opt out via .no-drag CSS.
export function TabBar(props: {
  view: 'home' | 'studio';
  projectName: string | null;
  onHome: () => void;
  onNew: () => void;
  onCloseProject: () => void;
  onOpenSettings: () => void;
}) {
  const { view, projectName, onHome, onNew, onCloseProject, onOpenSettings } = props;
  return (
    <div className="tabbar">
      <div className="tabs">
        <button className={`tab-pill ${view === 'home' ? 'active' : ''}`} onClick={onHome} title="Home">
          <HomeIcon />
          <span className="tp-name">Home</span>
        </button>
        {projectName && (
          <div className={`tab-pill ${view === 'studio' ? 'active' : ''}`}>
            <FolderIcon />
            <span className="tp-name">{projectName}</span>
            <button className="tp-close" title="Back to home" onClick={onCloseProject}>
              ✕
            </button>
          </div>
        )}
        <button className="tab-add" title="New design" onClick={onNew}>
          +
        </button>
      </div>
      <div className="spacer" />
      <div className="bar-right">
        <button
          className="star-link"
          title="UIO on GitHub"
          onClick={() => void uio().openExternal('https://github.com/')}
        >
          <GhIcon />
          <span>Star</span>
          <span className="k">· open source</span>
        </button>
        <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
          <GearIcon />
        </button>
      </div>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H3z" />
    </svg>
  );
}
function GhIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.22-3.37-1.22-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
