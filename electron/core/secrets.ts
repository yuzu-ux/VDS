// Secret storage for API keys and the hosted usage token. Values are
// encrypted at rest with Electron safeStorage (Keychain-backed on macOS) and
// never returned to the renderer — the UI only learns whether each is set.
import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SecretName, SecretStatus } from '../../shared/types';

type Vault = Partial<Record<SecretName, string>>;

export class SecretStore {
  private file: string;
  constructor(userDataDir: string) {
    this.file = path.join(userDataDir, 'secrets.enc');
  }

  private encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private async load(): Promise<Vault> {
    try {
      const raw = await fs.readFile(this.file);
      if (!this.encryptionAvailable()) return {};
      const json = safeStorage.decryptString(raw);
      return JSON.parse(json) as Vault;
    } catch {
      return {};
    }
  }

  private async persist(vault: Vault): Promise<void> {
    if (!this.encryptionAvailable()) {
      throw new Error('OS secure storage is unavailable; cannot store secrets safely.');
    }
    const enc = safeStorage.encryptString(JSON.stringify(vault));
    await fs.writeFile(this.file, enc, { mode: 0o600 });
  }

  async get(name: SecretName): Promise<string | null> {
    const vault = await this.load();
    return vault[name] ?? null;
  }

  async set(name: SecretName, value: string): Promise<SecretStatus> {
    const vault = await this.load();
    const trimmed = value.trim();
    if (trimmed) vault[name] = trimmed;
    else delete vault[name];
    await this.persist(vault);
    return this.status();
  }

  async clear(name: SecretName): Promise<SecretStatus> {
    const vault = await this.load();
    delete vault[name];
    await this.persist(vault);
    return this.status();
  }

  async status(): Promise<SecretStatus> {
    const vault = await this.load();
    return {
      byokKeyConfigured: !!vault.byokKey,
      hostedTokenConfigured: !!vault.hostedToken,
      encryptionAvailable: this.encryptionAvailable(),
    };
  }
}
