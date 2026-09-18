import { DESTRUCTIVE_COMMAND_PATTERNS, TOOL_RISK } from '../../../shared/schemas/tools.js';
import { fail, ok, optionalString, requireString, type ToolDefinition } from '../ToolTypes.js';

export const runCommandTool: ToolDefinition = {
  name: 'run_command',
  risk: TOOL_RISK.run_command,
  description:
    'Run a shell command in the workspace and read its output. Use for builds, tests and version control queries. Keep commands short-running; never start dev servers or watchers.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command line to run.' },
      cwd: { type: 'string', description: 'Workspace-relative directory. Defaults to the workspace root.' },
      reason: { type: 'string', description: 'Why this command is needed.' }
    },
    required: ['command']
  },
  title: (input) => `Run ${String(input.command ?? '')}`,
  async preview(input, ctx) {
    const command = requireString(input, 'command', 'run_command');
    const cwd = optionalString(input, 'cwd');
    const resolvedCwd = cwd ? ctx.workspace.resolve(cwd) : undefined;
    const destructive = DESTRUCTIVE_COMMAND_PATTERNS.some((p) => p.test(command));
    return {
      title: destructive ? 'Run this command — it can destroy data' : 'Run this command',
      detail: optionalString(input, 'reason'),
      command,
      cwd: resolvedCwd?.relativePath ?? '.',
      riskOverride: destructive ? 'strong' : undefined
    };
  },
  async execute(input, ctx) {
    const command = requireString(input, 'command', 'run_command');
    const roots = ctx.workspace.rootPaths();
    if (roots.length === 0) {
      return fail('run_command', 'No workspace folder is open, so there is nowhere to run the command.');
    }
    const cwdInput = optionalString(input, 'cwd');
    const cwd = cwdInput ? ctx.workspace.resolve(cwdInput).fsPath : roots[0];

    ctx.report(`Running ${command}`);
    const result = await ctx.terminal.run(command, cwd, ctx.token);

    const summary = result.timedOut
      ? `"${command}" timed out after ${Math.round(result.durationMs / 1000)}s`
      : `"${command}" exited ${result.exitCode} in ${Math.round(result.durationMs)}ms`;

    return {
      success: result.exitCode === 0 && !result.timedOut,
      toolName: 'run_command',
      summary,
      output: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
        stdout: result.stdout,
        stderr: result.stderr
      },
      error: result.exitCode === 0 ? undefined : result.stderr.slice(0, 2000) || `exit code ${result.exitCode}`
    };
  }
};

export { ok };
