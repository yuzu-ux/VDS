// Filesystem-as-API project store, matching Open Design's ethos: a project IS
// a portable directory. No database — project.json + files + .uio/ metadata.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Fidelity, ProjectFile, ProjectMeta, TranscriptEntry } from '../../shared/types';

const PREVIEWABLE = new Set(['.html', '.htm', '.svg']);

export function defaultProjectsRoot(): string {
  return path.join(os.homedir(), 'UIO Projects');
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'design';
}

export class ProjectStore {
  constructor(private root: string) {}

  setRoot(root: string) {
    this.root = root;
  }

  getRoot(): string {
    return this.root;
  }

  private metaPath(dir: string): string {
    return path.join(dir, 'project.json');
  }

  workspaceOf(meta: ProjectMeta): string {
    return meta.dir;
  }

  /** Resolve a relative path inside a workspace, refusing traversal outside it. */
  resolveInside(meta: ProjectMeta, relPath: string): string {
    const abs = path.resolve(meta.dir, relPath);
    const rootWithSep = path.resolve(meta.dir) + path.sep;
    if (abs !== path.resolve(meta.dir) && !abs.startsWith(rootWithSep)) {
      throw new Error(`Path escapes project workspace: ${relPath}`);
    }
    return abs;
  }

  async list(): Promise<ProjectMeta[]> {
    await fs.mkdir(this.root, { recursive: true });
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const metas: ProjectMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.root, entry.name);
      try {
        const raw = await fs.readFile(this.metaPath(dir), 'utf8');
        const meta = JSON.parse(raw) as ProjectMeta;
        meta.dir = dir; // dir on disk is authoritative (folder may have been moved)
        metas.push(meta);
      } catch {
        // not a project folder; skip
      }
    }
    metas.sort((a, b) => b.updatedAt - a.updatedAt);
    return metas;
  }

  async get(id: string): Promise<ProjectMeta | null> {
    const metas = await this.list();
    return metas.find((m) => m.id === id) ?? null;
  }

  async create(input: {
    name: string;
    skillId: string;
    designSystemId: string | null;
    fidelity: Fidelity;
  }): Promise<ProjectMeta> {
    await fs.mkdir(this.root, { recursive: true });
    const slug = slugify(input.name);
    let dirName = slug;
    let counter = 2;
    while (true) {
      try {
        await fs.access(path.join(this.root, dirName));
        dirName = `${slug}-${counter++}`;
      } catch {
        break;
      }
    }
    const dir = path.join(this.root, dirName);
    await fs.mkdir(path.join(dir, '.uio'), { recursive: true });
    const meta: ProjectMeta = {
      id: dirName,
      name: input.name.trim() || 'Untitled design',
      skillId: input.skillId,
      designSystemId: input.designSystemId,
      fidelity: input.fidelity,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dir,
      runtimeSessions: {},
    };
    await this.save(meta);
    return meta;
  }

  async save(meta: ProjectMeta): Promise<void> {
    meta.updatedAt = Date.now();
    await fs.writeFile(this.metaPath(meta.dir), JSON.stringify(meta, null, 2));
  }

  async listFiles(meta: ProjectMeta): Promise<ProjectFile[]> {
    const out: ProjectFile[] = [];
    const walk = async (dir: string, rel: string) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'project.json' || entry.name === 'node_modules') continue;
        const abs = path.join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(abs, relPath);
        } else {
          try {
            const stat = await fs.stat(abs);
            out.push({
              path: relPath,
              size: stat.size,
              mtime: stat.mtimeMs,
              previewable: PREVIEWABLE.has(path.extname(entry.name).toLowerCase()),
            });
          } catch {}
        }
      }
    };
    await walk(meta.dir, '');
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  async readFile(meta: ProjectMeta, relPath: string): Promise<string> {
    return fs.readFile(this.resolveInside(meta, relPath), 'utf8');
  }

  // -- transcript ----------------------------------------------------------

  private transcriptPath(meta: ProjectMeta): string {
    return path.join(meta.dir, '.uio', 'chat.jsonl');
  }

  async appendTranscript(meta: ProjectMeta, entry: TranscriptEntry): Promise<void> {
    await fs.mkdir(path.join(meta.dir, '.uio'), { recursive: true });
    await fs.appendFile(this.transcriptPath(meta), JSON.stringify(entry) + '\n');
  }

  async readTranscript(meta: ProjectMeta): Promise<TranscriptEntry[]> {
    try {
      const raw = await fs.readFile(this.transcriptPath(meta), 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as TranscriptEntry;
          } catch {
            return null;
          }
        })
        .filter((x): x is TranscriptEntry => x !== null);
    } catch {
      return [];
    }
  }
}
