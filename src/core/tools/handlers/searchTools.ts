import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import { fail, ok, optionalBoolean, optionalNumber, optionalString, requireString, type ToolDefinition } from '../ToolTypes.js';

export const searchCodeTool: ToolDefinition = {
  name: 'search_code',
  risk: TOOL_RISK.search_code,
  description:
    'Search the repository. mode "text" greps file contents, "filename" matches paths, "symbol" asks the language server for definitions. Start here before reading files.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for.' },
      mode: { type: 'string', enum: ['text', 'filename', 'symbol'], description: 'Defaults to text.' },
      includeGlob: { type: 'string', description: 'Restrict to a glob, e.g. **/*.cs' },
      isRegex: { type: 'boolean' },
      caseSensitive: { type: 'boolean' },
      maxResults: { type: 'number' }
    },
    required: ['query']
  },
  title: (input) => `Search "${String(input.query ?? '')}"`,
  async execute(input, ctx) {
    const query = requireString(input, 'query', 'search_code');
    const mode = optionalString(input, 'mode') ?? 'text';
    const maxResults = Math.min(optionalNumber(input, 'maxResults') ?? 40, 120);

    if (mode === 'filename') {
      const files = await ctx.searcher.findFiles(query, maxResults);
      return files.length === 0
        ? ok('search_code', `No file names match "${query}"`, { files: [] })
        : ok('search_code', `${files.length} files match "${query}"`, { files });
    }

    if (mode === 'symbol') {
      const matches = await ctx.searcher.searchSymbols(query, maxResults);
      return matches.length === 0
        ? ok('search_code', `No symbols named "${query}". Try mode "text".`, { matches: [] })
        : ok('search_code', `${matches.length} symbols match "${query}"`, { matches });
    }

    const result = await ctx.searcher.searchText({
      query,
      isRegex: optionalBoolean(input, 'isRegex') ?? false,
      caseSensitive: optionalBoolean(input, 'caseSensitive') ?? false,
      includeGlob: optionalString(input, 'includeGlob'),
      maxResults,
      token: ctx.token
    });

    if (result.matches.length === 0) {
      return ok('search_code', `No matches for "${query}"`, { matches: [], files: [] });
    }
    return ok(
      'search_code',
      `${result.matches.length} matches in ${result.files.length} files${result.truncated ? ' (truncated)' : ''}`,
      { matches: result.matches, files: result.files, truncated: result.truncated }
    );
  }
};

export const openFileTool: ToolDefinition = {
  name: 'open_file',
  risk: TOOL_RISK.open_file,
  description: 'Open a file in the editor for the user to look at. Does not return file contents.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, line: { type: 'number' } },
    required: ['path']
  },
  title: (input) => `Open ${String(input.path ?? 'file')}`,
  async execute(input, ctx) {
    const resolved = ctx.workspace.resolve(requireString(input, 'path', 'open_file'));
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('open_file', `${resolved.relativePath} does not exist.`);
    }
    await ctx.diffs.openFile(resolved.uri, optionalNumber(input, 'line'));
    return ok('open_file', `Opened ${resolved.relativePath}`);
  }
};

export const openDiffTool: ToolDefinition = {
  name: 'open_diff',
  risk: TOOL_RISK.open_diff,
  description: 'Show the user a side-by-side diff between a file on disk and proposed content.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content']
  },
  title: (input) => `Show diff for ${String(input.path ?? 'file')}`,
  async execute(input, ctx) {
    const resolved = ctx.workspace.resolve(requireString(input, 'path', 'open_diff'));
    const content = requireString(input, 'content', 'open_diff');
    await ctx.diffs.showProposedDiff(resolved, content);
    return ok('open_diff', `Opened a diff for ${resolved.relativePath}`);
  }
};
