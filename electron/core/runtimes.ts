// Runtime registry: one definition per supported coding-agent CLI.
// Follows the RuntimeAgentDef pattern from Open Design (Apache-2.0) — each def
// declares how to launch, how to deliver the prompt, and which stream parser
// applies. The engine performs the shared lifecycle.
import { execFile, spawn } from 'node:child_process';
import type { RuntimeInfo, RuntimeModelOption } from '../../shared/types';

export type StreamFormat = 'claude-json' | 'codex-json' | 'text';

export interface RuntimeDef {
  id: string;
  name: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  models: RuntimeModelOption[];
  streamFormat: StreamFormat;
  supportsResume: boolean;
  /** True for defs we ship but have not been able to test against a real install. */
  experimental?: boolean;
  buildArgs(opts: {
    model?: string;
    resumeSessionId?: string;
    newSessionId?: string;
  }): string[];
  /** How the prompt reaches the process. 'stdin' is preferred (no argv caps). */
  promptDelivery: 'stdin' | 'arg';
}

const DEFAULT_MODEL: RuntimeModelOption = { id: 'default', label: 'Default model' };

export const RUNTIME_DEFS: RuntimeDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    models: [
      DEFAULT_MODEL,
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
      { id: 'haiku', label: 'Haiku' },
    ],
    streamFormat: 'claude-json',
    supportsResume: true,
    promptDelivery: 'stdin',
    buildArgs: ({ model, resumeSessionId, newSessionId }) => {
      const args = ['-p', '--output-format', 'stream-json', '--verbose'];
      if (model && model !== 'default') args.push('--model', model);
      if (resumeSessionId) args.push('--resume', resumeSessionId);
      else if (newSessionId) args.push('--session-id', newSessionId);
      // The project workspace is the sandbox: the agent runs with its cwd
      // pinned there and full tool access inside it.
      args.push('--permission-mode', 'bypassPermissions');
      return args;
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    bin: 'codex',
    versionArgs: ['--version'],
    models: [DEFAULT_MODEL],
    streamFormat: 'codex-json',
    supportsResume: true,
    promptDelivery: 'stdin',
    buildArgs: ({ model, resumeSessionId }) => {
      const args = ['exec'];
      if (resumeSessionId) args.push('resume', resumeSessionId);
      args.push('--json', '--skip-git-repo-check', '--sandbox', 'workspace-write');
      if (model && model !== 'default') args.push('--model', model);
      args.push('-'); // read prompt from stdin
      return args;
    },
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    versionArgs: ['--version'],
    models: [DEFAULT_MODEL],
    streamFormat: 'text',
    supportsResume: false,
    experimental: true,
    promptDelivery: 'arg',
    buildArgs: () => ['-p', '--output-format', 'text', '--force'],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    bin: 'gemini',
    versionArgs: ['--version'],
    models: [DEFAULT_MODEL],
    streamFormat: 'text',
    supportsResume: false,
    experimental: true,
    promptDelivery: 'stdin',
    buildArgs: () => ['--yolo'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    bin: 'opencode',
    versionArgs: ['--version'],
    models: [DEFAULT_MODEL],
    streamFormat: 'text',
    supportsResume: false,
    experimental: true,
    promptDelivery: 'arg',
    buildArgs: () => ['run'],
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    versionArgs: ['--version'],
    models: [DEFAULT_MODEL],
    streamFormat: 'text',
    supportsResume: false,
    experimental: true,
    promptDelivery: 'stdin',
    buildArgs: () => ['--yolo'],
  },
];

// ---------------------------------------------------------------------------
// Login-shell PATH. GUI apps launched from Finder inherit a minimal PATH that
// misses ~/.local/bin, homebrew, nvm, etc. Resolve the user's real PATH once.
//
// The env is also scrubbed of agent-session markers: if VDS (or its smoke
// test) is itself launched from inside a coding-agent session, inherited vars
// like CLAUDECODE / CLAUDE_CODE_* make the spawned CLI think it is a nested
// session with host-managed auth and it reports "not logged in" instead of
// using the user's own credentials. Children should behave exactly like a
// fresh terminal. CLAUDE_CODE_OAUTH_TOKEN is kept — that one is a legitimate
// user-supplied credential (CI, headless setups).

const SCRUB_EXACT = new Set(['CLAUDECODE', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_EFFORT']);
const SCRUB_PREFIXES = ['CLAUDE_CODE_', 'CLAUDE_PREVIEW_'];
const SCRUB_KEEP = new Set(['CLAUDE_CODE_OAUTH_TOKEN']);

export function scrubAgentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (SCRUB_KEEP.has(key)) {
      out[key] = value;
      continue;
    }
    if (SCRUB_EXACT.has(key)) continue;
    if (SCRUB_PREFIXES.some((p) => key.startsWith(p))) continue;
    out[key] = value;
  }
  return out;
}

let cachedEnv: NodeJS.ProcessEnv | null = null;

export async function loginShellEnv(): Promise<NodeJS.ProcessEnv> {
  if (cachedEnv) return cachedEnv;
  const shell = process.env.SHELL || '/bin/zsh';
  let env: NodeJS.ProcessEnv;
  try {
    const path = await new Promise<string>((resolve, reject) => {
      execFile(shell, ['-ilc', 'echo -n "$PATH"'], { timeout: 8000 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout.trim()),
      );
    });
    env = { ...process.env, PATH: path || process.env.PATH };
  } catch {
    env = { ...process.env };
  }
  cachedEnv = scrubAgentEnv(env);
  return cachedEnv;
}

async function resolveBin(env: NodeJS.ProcessEnv, bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/usr/bin/which', [bin], { env, timeout: 4000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

async function probeVersion(env: NodeJS.ProcessEnv, binPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binPath, args, { env, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const out = (stdout || stderr || '').trim().split('\n')[0];
      resolve(out || 'unknown');
    });
  });
}

let cachedRuntimes: RuntimeInfo[] | null = null;

export async function detectRuntimes(refresh = false): Promise<RuntimeInfo[]> {
  if (cachedRuntimes && !refresh) return cachedRuntimes;
  const env = await loginShellEnv();
  const infos = await Promise.all(
    RUNTIME_DEFS.map(async (def): Promise<RuntimeInfo> => {
      const bins = [def.bin, ...(def.fallbackBins ?? [])];
      for (const bin of bins) {
        const resolved = await resolveBin(env, bin);
        if (!resolved) continue;
        const version = await probeVersion(env, resolved, def.versionArgs);
        if (version) {
          return {
            id: def.id,
            name: def.name,
            bin,
            available: true,
            version,
            resolvedPath: resolved,
            models: def.models,
            supportsResume: def.supportsResume,
          };
        }
      }
      return {
        id: def.id,
        name: def.name,
        bin: def.bin,
        available: false,
        models: def.models,
        supportsResume: def.supportsResume,
      };
    }),
  );
  cachedRuntimes = infos;
  return infos;
}

export function getDef(id: string): RuntimeDef {
  const def = RUNTIME_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown runtime: ${id}`);
  return def;
}

export function spawnRuntime(opts: {
  def: RuntimeDef;
  resolvedPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  model?: string;
  resumeSessionId?: string;
  newSessionId?: string;
}) {
  const { def, resolvedPath, cwd, env, prompt } = opts;
  const args = def.buildArgs({
    model: opts.model,
    resumeSessionId: opts.resumeSessionId,
    newSessionId: opts.newSessionId,
  });
  if (def.promptDelivery === 'arg') args.push(prompt);
  const child = spawn(resolvedPath, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (def.promptDelivery === 'stdin') {
    child.stdin.write(prompt);
    child.stdin.end();
  } else {
    child.stdin.end();
  }
  return child;
}
