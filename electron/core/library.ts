// Library loader: bundled skills + design systems, shadowable by user entries
// in ~/VDS Library (same id wins), mirroring Open Design's two-root registry.
//
// Formats are intentionally compatible with the Open Design ecosystem:
//   skills/<id>/SKILL.md          — YAML-ish frontmatter + instructions
//   design-systems/<id>/DESIGN.md — brand contract injected into every run
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { DesignSystemInfo, SkillInfo } from '../../shared/types';

export function userLibraryRoot(): string {
  return path.join(os.homedir(), 'VDS Library');
}

interface Frontmatter {
  [key: string]: string;
}

/** Minimal flat frontmatter parser: `key: value` lines between --- fences. */
export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: raw };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1);
  const fm: Frontmatter = {};
  for (const line of header.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (key) fm[key] = value;
  }
  return { fm, body };
}

async function scanDirs(roots: string[], subdir: string): Promise<Map<string, string>> {
  // Later roots shadow earlier ones (user overrides bundled).
  const found = new Map<string, string>();
  for (const root of roots) {
    const base = path.join(root, subdir);
    let entries;
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) found.set(entry.name, path.join(base, entry.name));
    }
  }
  return found;
}

export class Library {
  constructor(private bundledRoot: string) {}

  private roots(): string[] {
    return [this.bundledRoot, userLibraryRoot()];
  }

  async listSkills(): Promise<SkillInfo[]> {
    const dirs = await scanDirs(this.roots(), 'skills');
    const skills: SkillInfo[] = [];
    for (const [id, dir] of dirs) {
      try {
        const raw = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
        const { fm } = parseFrontmatter(raw);
        skills.push({
          id,
          name: fm.name || id,
          description: fm.description || '',
          mode: fm.mode === 'deck' ? 'deck' : 'prototype',
          entry: fm.entry || 'index.html',
          dir,
        });
      } catch {}
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return skills;
  }

  async listDesignSystems(): Promise<DesignSystemInfo[]> {
    const dirs = await scanDirs(this.roots(), 'design-systems');
    const systems: DesignSystemInfo[] = [];
    for (const [id, dir] of dirs) {
      try {
        const raw = await fs.readFile(path.join(dir, 'DESIGN.md'), 'utf8');
        const { fm } = parseFrontmatter(raw);
        systems.push({
          id,
          name: fm.name || id,
          description: fm.description || '',
          swatches: (fm.swatches || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 6),
          fontLabel: fm.font || undefined,
          dir,
        });
      } catch {}
    }
    systems.sort((a, b) => a.name.localeCompare(b.name));
    return systems;
  }

  async getSkill(id: string): Promise<SkillInfo | null> {
    return (await this.listSkills()).find((s) => s.id === id) ?? null;
  }

  async getDesignSystem(id: string): Promise<DesignSystemInfo | null> {
    return (await this.listDesignSystems()).find((s) => s.id === id) ?? null;
  }

  async readDesignSystemContract(id: string): Promise<string> {
    const ds = await this.getDesignSystem(id);
    if (!ds) throw new Error(`Unknown design system: ${id}`);
    return fs.readFile(path.join(ds.dir, 'DESIGN.md'), 'utf8');
  }

  /**
   * The skill's seed HTML (assets/*.html). Needed by the direct-API profile,
   * which has no file tools and must receive the seed inline in the prompt.
   */
  async readSkillSeed(id: string): Promise<string> {
    const skill = await this.getSkill(id);
    if (!skill) return '';
    const assets = path.join(skill.dir, 'assets');
    try {
      const files = await fs.readdir(assets);
      const html = files.find((f) => f.endsWith('.html'));
      if (html) return await fs.readFile(path.join(assets, html), 'utf8');
    } catch {}
    return '';
  }

  /**
   * Copy the chosen skill (and design system contract) into the project
   * workspace under .vds/ so the agent can read everything with its own file
   * tools — the filesystem is the interface, no long prompts needed.
   */
  async installIntoWorkspace(workspace: string, skillId: string, designSystemId: string | null): Promise<void> {
    const skill = await this.getSkill(skillId);
    if (!skill) throw new Error(`Unknown skill: ${skillId}`);
    const target = path.join(workspace, '.vds', 'skill');
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(skill.dir, target, { recursive: true });
    if (designSystemId) {
      const contract = await this.readDesignSystemContract(designSystemId);
      await fs.writeFile(path.join(workspace, '.vds', 'DESIGN.md'), contract);
    }
  }
}
