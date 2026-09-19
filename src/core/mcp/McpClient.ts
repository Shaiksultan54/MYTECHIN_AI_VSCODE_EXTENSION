import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServerConfig } from './McpTypes.js';
import { Logger } from '../logging/Logger.js';

export class McpClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  
  constructor(public readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    try {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: (this.config.env ? { ...process.env, ...this.config.env } : process.env) as Record<string, string>
      });

      this.client = new Client({
        name: 'mytechin-ai',
        version: '0.1.0'
      }, {
        capabilities: {}
      });

      await this.client.connect(this.transport);
      Logger.get().info(`MCP Client connected to ${this.config.id}`);
    } catch (error) {
      Logger.get().error(`MCP Client failed to connect to ${this.config.id}`, error);
      throw error;
    }
  }

  async getTools(): Promise<any[]> {
    if (!this.client) {
      return [];
    }
    try {
      const response = await this.client.listTools();
      return response.tools || [];
    } catch (error) {
      Logger.get().error(`Failed to list tools for ${this.config.id}`, error);
      return [];
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    if (!this.client) {
      throw new Error(`MCP Client not connected for ${this.config.id}`);
    }
    return await this.client.callTool({
      name,
      arguments: args
    });
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (e) {
        // Ignore
      }
      this.transport = undefined;
    }
    this.client = undefined;
  }
}
