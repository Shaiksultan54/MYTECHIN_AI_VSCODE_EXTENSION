import { ToolDefinition, ToolContext, ToolResult, ApprovalPreview } from '../tools/ToolTypes.js';
import { McpClient } from './McpClient.js';

export class McpToolAdapter {
  constructor(private readonly client: McpClient, private readonly mcpTool: any) {}

  toToolDefinition(): ToolDefinition {
    const inputSchema = this.mcpTool.inputSchema;
    
    return {
      name: `mcp_${this.client.config.id}_${this.mcpTool.name}`,
      description: this.mcpTool.description || `MCP Tool from ${this.client.config.id}`,
      risk: 'ask', // Default to ask for MCP tools
      source: 'mcp',
      parameters: {
        type: 'object',
        properties: inputSchema?.properties || {},
        required: inputSchema?.required || []
      },
      title: (_input: any) => `MCP ${this.mcpTool.name} on ${this.client.config.id}`,
      preview: async (input: any, _ctx: ToolContext): Promise<ApprovalPreview> => {
        return {
          title: `Run ${this.mcpTool.name} via ${this.client.config.id}`,
          detail: `Parameters: \n${JSON.stringify(input, null, 2)}`,
        };
      },
      execute: async (input: any, ctx: ToolContext): Promise<ToolResult> => {
        ctx.report(`Running ${this.mcpTool.name}...`);
        try {
          const result = await this.client.callTool(this.mcpTool.name, input);
          if (result.isError) {
             return {
               success: false,
               toolName: this.mcpTool.name,
               summary: `MCP tool failed: ${result.content?.[0]?.text || 'Unknown error'}`,
               error: result.content?.[0]?.text || 'Unknown error'
             };
          }
          const outputText = result.content?.map((c: any) => c.text).join('\n') || '';
          return {
            success: true,
            toolName: this.mcpTool.name,
            summary: `Executed ${this.mcpTool.name}`,
            output: outputText
          };
        } catch (error: any) {
          return {
            success: false,
            toolName: this.mcpTool.name,
            summary: `Failed to execute MCP tool: ${error.message}`,
            error: error.message
          };
        }
      }
    };
  }
}
