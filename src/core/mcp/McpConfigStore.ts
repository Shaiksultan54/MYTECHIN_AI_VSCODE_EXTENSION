import * as vscode from 'vscode';

import { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import { FileWriter } from '../workspace/FileWriter.js';
import { FileReader } from '../workspace/FileReader.js';
import { McpServerConfig } from './McpTypes.js';
import { Logger } from '../logging/Logger.js';
import { SettingsStore } from '../storage/SettingsStore.js';

export class McpConfigStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
    private readonly settings: SettingsStore
  ) {}

  private get configPath(): string {
    return this.settings.read().mcpConfigPath || '.mytechin/mcp.json';
  }

  async read(): Promise<McpServerConfig[]> {
    if (!this.workspace.hasWorkspace) {
      return [];
    }

    try {
      const resolved = this.workspace.resolve(this.configPath);
      const result = await this.reader.read(resolved, {
        reason: 'Read MCP configuration',
        source: 'agent'
      });

      const parsed = JSON.parse(result.content);
      if (Array.isArray(parsed)) {
        return parsed as McpServerConfig[];
      }
      if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
        // Claude Desktop style format
        const servers: McpServerConfig[] = [];
        for (const [id, config] of Object.entries(parsed.mcpServers)) {
          const cfg = config as any;
          servers.push({
            id,
            command: cfg.command,
            args: cfg.args,
            env: cfg.env,
            disabled: cfg.disabled
          });
        }
        return servers;
      }
      return [];
    } catch (error: any) {
      if (error.code === 'FileNotFound' || error.message?.includes('ENOENT')) {
        return [];
      }
      Logger.get().warn('Failed to parse MCP config', error);
      return [];
    }
  }

  async write(configs: McpServerConfig[]): Promise<void> {
    if (!this.workspace.hasWorkspace) {
      throw new Error('No workspace open');
    }

    const resolved = this.workspace.resolve(this.configPath);
    await this.writer.write(resolved, JSON.stringify(configs, null, 2));
    this.emitter.fire();
  }

  async addServer(config: McpServerConfig): Promise<void> {
    const configs = await this.read();
    const index = configs.findIndex(c => c.id === config.id);
    if (index >= 0) {
      configs[index] = config;
    } else {
      configs.push(config);
    }
    await this.write(configs);
  }

  async removeServer(id: string): Promise<void> {
    const configs = await this.read();
    const filtered = configs.filter(c => c.id !== id);
    if (filtered.length !== configs.length) {
      await this.write(filtered);
    }
  }
}
