import { ToolDefinition } from '../tools/ToolTypes.js';
import { McpServerConfig, McpServerState, McpServerStatusView } from '../../shared/types.js';

export { McpServerConfig, McpServerState };

export interface McpServerStatus extends Omit<McpServerStatusView, 'tools'> {
  tools: ToolDefinition[];
}
