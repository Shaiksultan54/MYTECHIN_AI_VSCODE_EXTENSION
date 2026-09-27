import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import { fail, ok, requireString, type ToolDefinition } from '../ToolTypes.js';

export const getImpactTool: ToolDefinition = {
  name: 'get_impact',
  risk: TOOL_RISK.get_impact,
  description:
    'Show best-effort files imported by a file and files that import it. Use before changing exported APIs or shared modules.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Workspace-relative source file path.' } },
    required: ['path']
  },
  title: (input) => `Analyze impact of ${String(input.path ?? 'file')}`,
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'get_impact');
    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('get_impact', `${resolved.relativePath} does not exist.`);
    }
    const impact = await ctx.graph.impact(path);
    return ok(
      'get_impact',
      `${impact.path}: ${impact.dependencies.length} dependencies, ${impact.dependents.length} dependents.`,
      impact
    );
  }
};
