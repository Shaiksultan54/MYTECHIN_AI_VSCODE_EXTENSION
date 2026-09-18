import * as vscode from 'vscode';
import type { ProviderId } from '../../shared/types.js';

/**
 * Thin wrapper over VS Code SecretStorage. Secret values never cross the
 * webview boundary — the UI only learns whether a secret exists.
 */
export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  private key(providerId: ProviderId): string {
    return `mytechin.secret.${providerId}`;
  }

  async get(providerId: ProviderId): Promise<string | undefined> {
    return this.secrets.get(this.key(providerId));
  }

  async has(providerId: ProviderId): Promise<boolean> {
    const value = await this.get(providerId);
    return typeof value === 'string' && value.length > 0;
  }

  async set(providerId: ProviderId, value: string): Promise<void> {
    await this.secrets.store(this.key(providerId), value);
  }

  async clear(providerId: ProviderId): Promise<void> {
    await this.secrets.delete(this.key(providerId));
  }
}
