import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import { fail, ok, optionalNumber, optionalString, requireString, type ToolDefinition } from '../ToolTypes.js';

function shellQuote(value: string): string {
  return process.platform === 'win32'
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function gitCwd(ctx: Parameters<ToolDefinition['execute']>[1]): string | undefined {
  return ctx.workspace.rootPaths()[0];
}

async function runGit(
  ctx: Parameters<ToolDefinition['execute']>[1],
  args: string
): Promise<{ stdout: string; stderr: string; exitCode: number } | undefined> {
  const cwd = gitCwd(ctx);
  if (!cwd) return undefined;
  const result = await ctx.terminal.run(`git ${args}`, cwd, ctx.token);
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function commandFailure(name: string, result: { stderr: string; exitCode: number }) {
  return fail(name, `git exited ${result.exitCode}: ${result.stderr.trim() || 'unknown error'}`);
}

export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  risk: TOOL_RISK.git_status,
  description: 'Show the working tree status, including staged and unstaged changes.',
  parameters: { type: 'object', properties: {} },
  title: () => 'Show Git status',
  async execute(_input, ctx) {
    const result = await runGit(ctx, 'status --short --branch');
    if (!result) return fail('git_status', 'No workspace folder is open.');
    if (result.exitCode !== 0) return commandFailure('git_status', result);
    return ok('git_status', 'Git status retrieved.', { stdout: result.stdout });
  }
};

export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  risk: TOOL_RISK.git_diff,
  description: 'Show the Git diff, optionally limited to a workspace-relative path.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Optional workspace-relative path.' } }
  },
  title: (input) => `Show Git diff${input.path ? ` for ${String(input.path)}` : ''}`,
  async execute(input, ctx) {
    const path = optionalString(input, 'path');
    const args = `diff -- ${path ? shellQuote(ctx.workspace.resolve(path).relativePath) : ''}`.trim();
    const result = await runGit(ctx, args);
    if (!result) return fail('git_diff', 'No workspace folder is open.');
    if (result.exitCode !== 0) return commandFailure('git_diff', result);
    return ok('git_diff', 'Git diff retrieved.', { path, diff: result.stdout });
  }
};

export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  risk: TOOL_RISK.git_log,
  description: 'Show a bounded list of recent Git commits.',
  parameters: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Maximum commits to show, from 1 to 50.' } }
  },
  title: (input) => `Show last ${String(input.limit ?? 10)} Git commits`,
  async execute(input, ctx) {
    const limit = Math.min(50, Math.max(1, optionalNumber(input, 'limit') ?? 10));
    const result = await runGit(ctx, `log -n ${limit} --date=iso --pretty=format:%h%x09%ad%x09%an%x09%s`);
    if (!result) return fail('git_log', 'No workspace folder is open.');
    if (result.exitCode !== 0) return commandFailure('git_log', result);
    return ok('git_log', `Retrieved ${limit} recent Git commits.`, { limit, log: result.stdout });
  }
};

export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  risk: TOOL_RISK.git_commit,
  description: 'Stage the specified workspace-relative files and create a Git commit.',
  parameters: {
    type: 'object',
    properties: {
      paths: { type: 'array', description: 'Workspace-relative files to stage.' },
      message: { type: 'string', description: 'Commit message.' }
    },
    required: ['paths', 'message']
  },
  title: (input) => `Commit ${Array.isArray(input.paths) ? input.paths.length : 0} file(s)`,
  async preview(input, ctx) {
    const paths = Array.isArray(input.paths) ? input.paths.filter((value): value is string => typeof value === 'string') : [];
    const message = requireString(input, 'message', 'git_commit');
    return {
      title: 'Create Git commit',
      detail: `Files to stage:\n${paths.join('\n') || '(none)'}\n\nMessage:\n${message}`,
      command: `git add -- ${paths.map((path) => shellQuote(ctx.workspace.resolve(path).relativePath)).join(' ')} && git commit -m ${shellQuote(message)}`,
      cwd: '.'
    };
  },
  async execute(input, ctx) {
    const paths = Array.isArray(input.paths) ? input.paths.filter((value): value is string => typeof value === 'string') : [];
    const message = requireString(input, 'message', 'git_commit');
    if (paths.length === 0) return fail('git_commit', 'Provide at least one path to stage.');
    const relativePaths = paths.map((path) => ctx.workspace.resolve(path).relativePath);
    const add = await runGit(ctx, `add -- ${relativePaths.map(shellQuote).join(' ')}`);
    if (!add) return fail('git_commit', 'No workspace folder is open.');
    if (add.exitCode !== 0) return commandFailure('git_commit', add);
    const commit = await runGit(ctx, `commit -m ${shellQuote(message)}`);
    if (!commit) return fail('git_commit', 'No workspace folder is open.');
    if (commit.exitCode !== 0) return commandFailure('git_commit', commit);
    return ok('git_commit', 'Git commit created.', { paths: relativePaths, message, output: commit.stdout });
  }
};

export const gitBranchTool: ToolDefinition = {
  name: 'git_branch',
  risk: TOOL_RISK.git_branch,
  description: 'Create and switch to a Git branch.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'New branch name.' } },
    required: ['name']
  },
  title: (input) => `Switch to Git branch ${String(input.name ?? '')}`,
  async preview(input) {
    const name = requireString(input, 'name', 'git_branch');
    return { title: 'Create and switch Git branch', detail: `Branch: ${name}`, command: `git switch -c ${shellQuote(name)}`, cwd: '.' };
  },
  async execute(input, ctx) {
    const name = requireString(input, 'name', 'git_branch');
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith('-') || name.includes('..')) {
      return fail('git_branch', 'Invalid branch name.');
    }
    const result = await runGit(ctx, `switch -c ${shellQuote(name)}`);
    if (!result) return fail('git_branch', 'No workspace folder is open.');
    if (result.exitCode !== 0) return commandFailure('git_branch', result);
    return ok('git_branch', `Created and switched to ${name}.`, { name, output: result.stdout });
  }
};
