import * as vscode from 'vscode';
import { McpServerConfig, McpServerStatus } from './McpTypes.js';
import { McpClient } from './McpClient.js';
import { McpConfigStore } from './McpConfigStore.js';
import { McpToolAdapter } from './McpToolAdapter.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';


export class McpServerManager implements vscode.Disposable {
  private clients = new Map<string, McpClient>();
  private statuses = new Map<string, McpServerStatus>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly configStore: McpConfigStore,
    private readonly registry: ToolRegistry
  ) {
    this.disposables.push(
      this.configStore.onDidChange(() => {
        void this.syncServers();
      })
    );
  }

  async initialize(): Promise<void> {
    await this.syncServers();
  }

  getStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values());
  }

  getStatusesView(): import('../../shared/types.js').McpServerStatusView[] {
    return this.getStatuses().map(status => ({
      ...status,
      tools: status.tools.map(t => ({ name: t.name, description: t.description }))
    }));
  }

  async syncServers(): Promise<void> {
    const configs = await this.configStore.read();
    
    // Disconnect removed servers
    const configIds = new Set(configs.map(c => c.id));
    for (const [id] of this.clients.entries()) {
      if (!configIds.has(id)) {
        await this.disconnect(id);
      }
    }

    // Connect new/updated servers
    for (const config of configs) {
      if (config.disabled) {
        if (this.clients.has(config.id)) {
          await this.disconnect(config.id);
        }
        this.updateStatus(config.id, {
          id: config.id,
          config,
          state: 'disconnected',
          tools: []
        });
        continue;
      }

      if (!this.clients.has(config.id)) {
        void this.connect(config);
      }
    }
    
    this.emitter.fire();
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.id)) {
      await this.disconnect(config.id);
    }

    this.updateStatus(config.id, {
      id: config.id,
      config,
      state: 'connecting',
      tools: []
    });

    const client = new McpClient(config);
    this.clients.set(config.id, client);

    try {
      await client.connect();
      const mcpTools = await client.getTools();
      
      const tools = mcpTools.map(t => new McpToolAdapter(client, t).toToolDefinition());
      
      // Register tools
      for (const tool of tools) {
        // If it exists in registry (from a previous connection), we might need to overwrite it, 
        // but registry currently throws if it exists. So let's add a clear or update method.
        // Actually, ToolRegistry throws on duplicate. 
        // We need to handle this by checking if it exists, or extending ToolRegistry to support unregistering.
        if (!this.registry.has(tool.name)) {
          this.registry.register(tool);
        }
      }

      this.updateStatus(config.id, {
        id: config.id,
        config,
        state: 'connected',
        tools
      });
    } catch (error: any) {
      this.updateStatus(config.id, {
        id: config.id,
        config,
        state: 'error',
        error: error.message,
        tools: []
      });
    }
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
      
      // Unregister tools from this client
      const status = this.statuses.get(id);
      if (status && status.tools) {
        for (const tool of status.tools) {
          if (this.registry.has(tool.name)) {
             this.registry.unregister?.(tool.name);
          }
        }
      }
    }
    const status = this.statuses.get(id);
    if (status) {
      this.updateStatus(id, {
        ...status,
        state: 'disconnected',
        tools: []
      });
    }
  }

  async restart(id: string): Promise<void> {
    const status = this.statuses.get(id);
    if (status) {
      await this.connect(status.config);
    }
  }

  private updateStatus(id: string, status: McpServerStatus): void {
    this.statuses.set(id, status);
    this.emitter.fire();
  }

  dispose(): void {
    for (const client of this.clients.values()) {
      void client.disconnect();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
