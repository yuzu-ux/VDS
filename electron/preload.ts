import { contextBridge, ipcRenderer } from 'electron';
import type { EngineEventEnvelope, StartTurnRequest, VdsBridge } from '../shared/types';

const bridge: VdsBridge = {
  listRuntimes: (refresh) => ipcRenderer.invoke('runtimes:list', refresh),
  listSkills: () => ipcRenderer.invoke('library:skills'),
  listDesignSystems: () => ipcRenderer.invoke('library:design-systems'),
  readDesignSystem: (id) => ipcRenderer.invoke('library:design-system-read', id),

  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input) => ipcRenderer.invoke('projects:create', input),
  getProject: (id) => ipcRenderer.invoke('projects:get', id),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  listFiles: (id) => ipcRenderer.invoke('projects:files', id),
  readFile: (id, relPath) => ipcRenderer.invoke('projects:read-file', id, relPath),
  getTranscript: (id) => ipcRenderer.invoke('projects:transcript', id),

  startTurn: (req: StartTurnRequest) => ipcRenderer.invoke('engine:start', req),
  cancelTurn: (runId) => ipcRenderer.invoke('engine:cancel', runId),
  onEngineEvent: (cb) => {
    const listener = (_e: unknown, envelope: EngineEventEnvelope) => cb(envelope);
    ipcRenderer.on('engine:event', listener);
    return () => ipcRenderer.removeListener('engine:event', listener);
  },
  onFileChanged: (cb) => {
    const listener = (_e: unknown, info: { projectId: string; path: string }) => cb(info);
    ipcRenderer.on('file:changed', listener);
    return () => ipcRenderer.removeListener('file:changed', listener);
  },

  exportHtml: (id, entry) => ipcRenderer.invoke('export:html', id, entry),
  exportPdf: (id, entry) => ipcRenderer.invoke('export:pdf', id, entry),
  openInFinder: (id) => ipcRenderer.invoke('shell:reveal', id),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  getSecretStatus: () => ipcRenderer.invoke('secrets:status'),
  setSecret: (name, value) => ipcRenderer.invoke('secrets:set', name, value),
  clearSecret: (name) => ipcRenderer.invoke('secrets:clear', name),
  checkEngine: (source) => ipcRenderer.invoke('engine:check', source),
};

contextBridge.exposeInMainWorld('vds', bridge);
