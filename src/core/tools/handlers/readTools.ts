import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import { FileTooLargeError } from '../../workspace/FileReader.js';
import {
  fail,
  ok,
  optionalNumber,
  optionalString,
  requireString,
  type ToolDefinition
} from '../ToolTypes.js';

const MAX_LINES_PER_READ = 1200;

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  risk: TOOL_RISK.read_file,
  description:
    'Read a text file from the workspace. Pass startLine and endLine to read part of a large file. Always give a short reason.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path.' },
      startLine: { type: 'number', description: '1-based first line.' },
      endLine: { type: 'number', description: '1-based last line.' },
      reason: { type: 'string', description: 'Why this file is needed.' }
    },
    required: ['path']
  },
  title: (input) => {
    const range =
      input.startLine !== undefined ? ` (${input.startLine}–${input.endLine ?? 'end'})` : '';
    return `Read ${String(input.path ?? 'file')}${range}`;
  },
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'read_file');
    const resolved = ctx.workspace.resolve(path);

    if (await ctx.workspace.isDirectory(resolved)) {
      return fail('read_file', `${resolved.relativePath} is a directory. Use list_directory instead.`);
    }
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('read_file', `${resolved.relativePath} does not exist.`);
    }

    const startLine = optionalNumber(input, 'startLine');
    let endLine = optionalNumber(input, 'endLine');
    if (startLine !== undefined && endLine === undefined) {
      endLine = startLine + MAX_LINES_PER_READ;
    }

    try {
      const result = await ctx.reader.read(resolved, {
        startLine,
        endLine,
        reason: optionalString(input, 'reason') ?? 'agent requested',
        source: 'agent'
      });
      const range = result.truncated
        ? ` lines ${result.startLine}–${result.endLine} of ${result.totalLines}`
        : ` (${result.totalLines} lines)`;
      return ok('read_file', `Read ${result.relativePath}${range}`, {
        path: result.relativePath,
        language: result.language,
        startLine: result.startLine,
        endLine: result.endLine,
        totalLines: result.totalLines,
        truncated: result.truncated,
        content: result.content
      });
    } catch (error) {
      if (error instanceof FileTooLargeError) {
        return fail(
          'read_file',
          `${error.metadata.relativePath} is ${Math.round(error.metadata.sizeBytes / 1024)} KB (${error.metadata.totalLines || 'many'} lines). Call read_file again with startLine and endLine.`
        );
      }
      return fail('read_file', (error as Error).message);
    }
  }
};

export const readFilesTool: ToolDefinition = {
  name: 'read_files',
  risk: TOOL_RISK.read_files,
  description: 'Read several small files at once. Use for up to 6 related files.',
  parameters: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths.' },
      reason: { type: 'string' }
    },
    required: ['paths']
  },
  title: (input) => `Read ${(input.paths as string[] | undefined)?.length ?? 0} files`,
  async execute(input, ctx) {
    const raw = input.paths;
    const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
    if (paths.length === 0) {
      return fail('read_files', 'read_files needs a "paths" array of workspace-relative paths.');
    }

    const files: unknown[] = [];
    const errors: string[] = [];
    for (const path of paths.slice(0, 6)) {
      if (ctx.token.isCancellationRequested) {
        break;
      }
      try {
        const resolved = ctx.workspace.resolve(path);
        const result = await ctx.reader.read(resolved, {
          endLine: 600,
          reason: optionalString(input, 'reason') ?? 'agent requested',
          source: 'agent'
        });
        files.push({
          path: result.relativePath,
          language: result.language,
          totalLines: result.totalLines,
          truncated: result.truncated,
          content: result.content
        });
      } catch (error) {
        errors.push(`${path}: ${(error as Error).message}`);
      }
    }

    if (files.length === 0) {
      return fail('read_files', errors.join('; ') || 'No files could be read.');
    }
    return ok(
      'read_files',
      `Read ${files.length} files${errors.length ? `, ${errors.length} failed` : ''}`,
      { files, errors }
    );
  }
};

export const getFileMetadataTool: ToolDefinition = {
  name: 'get_file_metadata',
  risk: TOOL_RISK.get_file_metadata,
  description: 'Get size, line count and language of a file without reading its contents.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path']
  },
  title: (input) => `Inspect ${String(input.path ?? 'file')}`,
  async execute(input, ctx) {
    const resolved = ctx.workspace.resolve(requireString(input, 'path', 'get_file_metadata'));
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('get_file_metadata', `${resolved.relativePath} does not exist.`);
    }
    const metadata = await ctx.reader.metadata(resolved);
    return ok('get_file_metadata', `${metadata.relativePath}: ${Math.round(metadata.sizeBytes / 1024)} KB`, metadata);
  }
};

export const listDirectoryTool: ToolDefinition = {
  name: 'list_directory',
  risk: TOOL_RISK.list_directory,
  description: 'List files and folders in a workspace directory. Ignored paths are omitted.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory. Use "." for the root.' },
      recursive: { type: 'boolean', description: 'Include one level of subdirectories.' }
    },
    required: ['path']
  },
  title: (input) => `List ${String(input.path ?? '.')}`,
  async execute(input, ctx) {
    const path = optionalString(input, 'path') ?? '.';
    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.isDirectory(resolved))) {
      return fail('list_directory', `${resolved.relativePath} is not a directory.`);
    }

    const entries = await ctx.workspace.listDirectory(resolved);
    const recursive = input.recursive === true;
    const tree: Record<string, unknown> = { path: resolved.relativePath, entries };

    if (recursive) {
      const children: Record<string, unknown> = {};
      for (const entry of entries.filter((e) => e.type === 'directory').slice(0, 12)) {
        const child = ctx.workspace.resolve(entry.relativePath);
        children[entry.name] = (await ctx.workspace.listDirectory(child)).map((e) => e.name);
      }
      tree.children = children;
    }

    return ok('list_directory', `${resolved.relativePath}: ${entries.length} entries`, tree);
  }
};
