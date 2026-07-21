// Export: standalone HTML (the artifact already is one) and PDF via a hidden
// window's printToPDF — decks use CSS @page so each slide becomes a PDF page.
import { BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ProjectMeta } from '../../shared/types';

export async function exportHtml(meta: ProjectMeta, entryAbs: string): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export HTML',
    defaultPath: `${meta.id}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;
  await fs.copyFile(entryAbs, filePath);
  return filePath;
}

export async function exportPdf(meta: ProjectMeta, entryAbs: string): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export PDF',
    defaultPath: `${meta.id}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadFile(entryAbs);
    // Give web fonts/layout a beat to settle before printing.
    await new Promise((r) => setTimeout(r, 600));
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await fs.writeFile(filePath, buffer);
    return filePath;
  } finally {
    win.destroy();
  }
}

export function entryAbsPath(meta: ProjectMeta, entry: string): string {
  const abs = path.resolve(meta.dir, entry);
  const rootWithSep = path.resolve(meta.dir) + path.sep;
  if (!abs.startsWith(rootWithSep)) throw new Error('entry escapes workspace');
  return abs;
}
