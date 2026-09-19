import { applyPatch, createTwoFilesPatch } from 'diff';
import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import {
  fail,
  ok,
  optionalString,
  requireString,
  type ApprovalPreview,
  type ToolContext,
  type ToolDefinition
} from '../ToolTypes.js';

interface EditBlock {
  find: string;
  replace: string;
}

function parseEdits(input: Record<string, unknown>): EditBlock[] {
  const raw = input.edits;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: EditBlock[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object') {
      const item = entry as { find?: unknown; replace?: unknown };
      if (typeof item.find === 'string') {
        out.push({ find: item.find, replace: typeof item.replace === 'string' ? item.replace : '' });
      }
    }
  }
  return out;
}

/** Applies find/replace blocks. Each `find` must match exactly once. */
function applyEdits(original: string, edits: EditBlock[]): { content: string; error?: string } {
  let content = original.replace(/\r\n/g, '\n');
  for (const [index, edit] of edits.entries()) {
    const find = edit.find.replace(/\r\n/g, '\n');
    const replace = edit.replace.replace(/\r\n/g, '\n');
    if (find === '') {
      return { content: original, error: `Edit ${index + 1} has an empty "find" string.` };
    }
    const first = content.indexOf(find);
    if (first === -1) {
      return {
        content: original,
        error: `Edit ${index + 1} did not match. The "find" text is not in the file. Read the file again and copy the exact text, including indentation.`
      };
    }
    if (content.indexOf(find, first + find.length) !== -1) {
      return {
        content: original,
        error: `Edit ${index + 1} matched more than once. Include more surrounding lines so the "find" text is unique.`
      };
    }
    content = content.slice(0, first) + replace + content.slice(first + find.length);
  }
  if (original.includes('\r\n')) {
    content = content.replace(/\n/g, '\r\n');
  }
  return { content };
}

async function buildDiffPreview(
  ctx: ToolContext,
  path: string,
  proposed: string,
  title: string
): Promise<ApprovalPreview> {
  const resolved = ctx.workspace.resolve(path);
  const current = (await ctx.writer.readCurrent(resolved)) ?? '';
  const patch = createTwoFilesPatch(
    resolved.relativePath,
    resolved.relativePath,
    current,
    proposed,
    'current',
    'proposed',
    { context: 3 }
  );
  const changed = proposed.split('\n').length - current.split('\n').length;
  return {
    title,
    detail: `${resolved.relativePath}${changed === 0 ? '' : ` · ${changed > 0 ? '+' : ''}${changed} lines`}`,
    diff: patch,
    path: resolved.relativePath
  };
}

/** Writes the file and verifies the result landed on disk. */
async function commit(
  ctx: ToolContext,
  toolName: string,
  path: string,
  content: string,
  label: string
) {
  const resolved = ctx.workspace.resolve(path);
  if (resolved.sensitive) {
    return fail(toolName, `${resolved.relativePath} holds credentials and will not be written by the agent.`);
  }

  const before = await ctx.writer.readCurrent(resolved);
  await ctx.checkpoints.captureBeforeChange(ctx.conversationId, resolved, before, label);

  const result = await ctx.writer.write(resolved, content);

  const verified = await ctx.writer.readCurrent(resolved);
  if (verified !== content) {
    return fail(toolName, `${resolved.relativePath} did not match the expected content after writing.`);
  }

  ctx.report(`Saved ${resolved.relativePath}`);
  return ok(
    toolName,
    `${result.created ? 'Created' : 'Updated'} ${resolved.relativePath} (${result.linesAfter} lines)`,
    {
      path: resolved.relativePath,
      created: result.created,
      linesAfter: result.linesAfter,
      bytesWritten: result.bytesWritten
    }
  );
}

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  risk: TOOL_RISK.write_file,
  description:
    'Replace the entire contents of an existing file. Prefer apply_patch for small changes — only rewrite when most of the file changes.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string', description: 'The complete new file contents.' }
    },
    required: ['path', 'content']
  },
  title: (input) => `Rewrite ${String(input.path ?? 'file')}`,
  async preview(input, ctx) {
    return buildDiffPreview(
      ctx,
      requireString(input, 'path', 'write_file'),
      typeof input.content === 'string' ? input.content : '',
      'Rewrite this file'
    );
  },
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'write_file');
    const content = typeof input.content === 'string' ? input.content : '';
    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('write_file', `${resolved.relativePath} does not exist. Use create_file for new files.`);
    }
    return commit(ctx, 'write_file', path, content, 'write_file');
  }
};

export const createFileTool: ToolDefinition = {
  name: 'create_file',
  risk: TOOL_RISK.create_file,
  description: 'Create a new file, making parent directories as needed.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content']
  },
  title: (input) => `Create ${String(input.path ?? 'file')}`,
  async preview(input, ctx) {
    const path = requireString(input, 'path', 'create_file');
    const content = typeof input.content === 'string' ? input.content : '';
    const preview = await buildDiffPreview(ctx, path, content, 'Create this file');
    return { ...preview, detail: `${preview.path} · new file, ${content.split('\n').length} lines` };
  },
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'create_file');
    const resolved = ctx.workspace.resolve(path);
    if (await ctx.workspace.exists(resolved)) {
      return fail('create_file', `${resolved.relativePath} already exists. Use apply_patch or write_file.`);
    }
    const content = typeof input.content === 'string' ? input.content : '';
    return commit(ctx, 'create_file', path, content, 'create_file');
  }
};

export const applyPatchTool: ToolDefinition = {
  name: 'apply_patch',
  risk: TOOL_RISK.apply_patch,
  description:
    'Make a targeted change to a file. Preferred way to edit. Either pass "edits" as find/replace blocks (recommended — the find text must appear exactly once), or pass "diff" as a unified diff.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      edits: {
        type: 'array',
        description: 'Find/replace blocks applied in order.',
        items: {
          type: 'object',
          properties: {
            find: { type: 'string', description: 'Exact existing text, including indentation.' },
            replace: { type: 'string', description: 'Replacement text. Empty string deletes.' }
          },
          required: ['find']
        }
      },
      diff: { type: 'string', description: 'A unified diff, as an alternative to edits.' }
    },
    required: ['path']
  },
  title: (input) => {
    const count = Array.isArray(input.edits) ? input.edits.length : 1;
    return `Edit ${String(input.path ?? 'file')}${count > 1 ? ` (${count} changes)` : ''}`;
  },
  async preview(input, ctx) {
    const path = requireString(input, 'path', 'apply_patch');
    const resolved = ctx.workspace.resolve(path);
    const current = (await ctx.writer.readCurrent(resolved)) ?? '';
    const proposed = applyPatchInput(input, current);
    if (proposed.error) {
      return { title: 'Edit cannot be applied', detail: proposed.error, path: resolved.relativePath };
    }
    return buildDiffPreview(ctx, path, proposed.content, 'Apply this edit');
  },
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'apply_patch');
    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('apply_patch', `${resolved.relativePath} does not exist. Use create_file instead.`);
    }
    const current = (await ctx.writer.readCurrent(resolved)) ?? '';
    const proposed = applyPatchInput(input, current);
    if (proposed.error) {
      return fail('apply_patch', proposed.error);
    }
    if (proposed.content === current) {
      return fail('apply_patch', 'The edit produced no change. The file already contains that text.');
    }
    return commit(ctx, 'apply_patch', path, proposed.content, 'apply_patch');
  }
};

function applyPatchInput(
  input: Record<string, unknown>,
  current: string
): { content: string; error?: string } {
  const edits = parseEdits(input);
  if (edits.length > 0) {
    return applyEdits(current, edits);
  }
  const diff = optionalString(input, 'diff');
  if (!diff) {
    return { content: current, error: 'apply_patch needs either "edits" or "diff".' };
  }
  const patched = applyPatch(current, diff);
  if (patched === false) {
    return {
      content: current,
      error:
        'The unified diff did not apply cleanly. Read the file again and retry with "edits" find/replace blocks instead.'
    };
  }
  return { content: patched };
}

export const deleteFileTool: ToolDefinition = {
  name: 'delete_file',
  risk: TOOL_RISK.delete_file,
  description: 'Delete a file. Moves it to the trash rather than removing it permanently.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, reason: { type: 'string' } },
    required: ['path']
  },
  title: (input) => `Delete ${String(input.path ?? 'file')}`,
  async preview(input, ctx) {
    const resolved = ctx.workspace.resolve(requireString(input, 'path', 'delete_file'));
    const current = (await ctx.writer.readCurrent(resolved)) ?? '';
    return {
      title: 'Delete this file',
      detail: `${resolved.relativePath} · ${current.split('\n').length} lines. It goes to the trash and can be restored.`,
      diff: createTwoFilesPatch(resolved.relativePath, '/dev/null', current, '', 'current', 'deleted', {
        context: 0
      }),
      path: resolved.relativePath
    };
  },
  async execute(input, ctx) {
    const resolved = ctx.workspace.resolve(requireString(input, 'path', 'delete_file'));
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('delete_file', `${resolved.relativePath} does not exist.`);
    }
    if (await ctx.workspace.isDirectory(resolved)) {
      return fail('delete_file', `${resolved.relativePath} is a directory. Directory deletion is not supported.`);
    }
    const before = await ctx.writer.readCurrent(resolved);
    await ctx.checkpoints.captureBeforeChange(ctx.conversationId, resolved, before, 'delete_file');
    await ctx.writer.delete(resolved);
    return ok('delete_file', `Deleted ${resolved.relativePath}`, { path: resolved.relativePath });
  }
};

export const multiApplyPatchTool: ToolDefinition = {
  name: 'multi_apply_patch',
  risk: TOOL_RISK.multi_apply_patch,
  description:
    'Make targeted changes to multiple files simultaneously. Pass "changes" as an array of objects, where each object has a "path" and an array of find/replace "edits".',
  parameters: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            edits: {
              type: 'array',
              description: 'Find/replace blocks applied in order to this file.',
              items: {
                type: 'object',
                properties: {
                  find: { type: 'string', description: 'Exact existing text, including indentation.' },
                  replace: { type: 'string', description: 'Replacement text. Empty string deletes.' }
                },
                required: ['find']
              }
            }
          },
          required: ['path', 'edits']
        }
      }
    },
    required: ['changes']
  },
  title: (input) => {
    const changes = Array.isArray(input.changes) ? input.changes : [];
    return `Edit ${changes.length} file${changes.length === 1 ? '' : 's'}`;
  },
  async preview(input, ctx) {
    const changes = Array.isArray(input.changes) ? input.changes : [];
    if (changes.length === 0) {
      return { title: 'No changes', detail: 'No files to edit.', path: '' };
    }
    
    let combinedDiff = '';
    let totalLinesChanged = 0;
    
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const path = typeof (change as any).path === 'string' ? (change as any).path : '';
      if (!path) continue;
      
      const resolved = ctx.workspace.resolve(path);
      const current = (await ctx.writer.readCurrent(resolved)) ?? '';
      
      const proposed = applyPatchInput(change as any, current);
      if (proposed.error) {
        return { title: `Edit cannot be applied to ${path}`, detail: proposed.error, path: resolved.relativePath };
      }
      
      const patch = createTwoFilesPatch(
        resolved.relativePath,
        resolved.relativePath,
        current,
        proposed.content,
        'current',
        'proposed',
        { context: 3 }
      );
      
      combinedDiff += patch + '\n';
      totalLinesChanged += Math.abs(proposed.content.split('\n').length - current.split('\n').length);
    }
    
    return {
      title: `Apply edits to ${changes.length} files`,
      detail: `${changes.length} files · ${totalLinesChanged > 0 ? '+' : ''}${totalLinesChanged} lines`,
      diff: combinedDiff,
      path: ''
    };
  },
  async execute(input, ctx) {
    const changes = Array.isArray(input.changes) ? input.changes : [];
    if (changes.length === 0) {
      return fail('multi_apply_patch', 'No changes provided.');
    }

    // Pre-flight check
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const path = typeof (change as any).path === 'string' ? (change as any).path : '';
      if (!path) return fail('multi_apply_patch', 'A change is missing a path.');
      
      const resolved = ctx.workspace.resolve(path);
      if (!(await ctx.workspace.exists(resolved))) {
        return fail('multi_apply_patch', `${resolved.relativePath} does not exist. Use create_file instead.`);
      }
      const current = (await ctx.writer.readCurrent(resolved)) ?? '';
      const proposed = applyPatchInput(change as any, current);
      if (proposed.error) {
        return fail('multi_apply_patch', `Error in ${resolved.relativePath}: ${proposed.error}`);
      }
    }

    const results = [];
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const path = (change as any).path as string;
      const resolved = ctx.workspace.resolve(path);
      const current = (await ctx.writer.readCurrent(resolved)) ?? '';
      const proposed = applyPatchInput(change as any, current);
      
      if (proposed.content !== current) {
        await commit(ctx, 'multi_apply_patch', path, proposed.content, 'multi_apply_patch');
        results.push(resolved.relativePath);
      }
    }

    return ok('multi_apply_patch', `Edited ${results.length} files`, { files: results });
  }
};
