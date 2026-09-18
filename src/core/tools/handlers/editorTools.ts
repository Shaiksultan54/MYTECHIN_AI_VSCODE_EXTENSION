import * as vscode from 'vscode';
import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import { fail, ok, optionalString, requireString, type ToolDefinition } from '../ToolTypes.js';
import { toRelative } from '../../workspace/PathSecurity.js';

export const getCurrentFileTool: ToolDefinition = {
  name: 'get_current_file',
  risk: TOOL_RISK.get_current_file,
  description: 'Get the path, language and visible range of the file the user is looking at.',
  parameters: { type: 'object', properties: {} },
  title: () => 'Check the open editor',
  async execute(_input, ctx) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return ok('get_current_file', 'No file is open in the editor.', { open: false });
    }
    const roots = ctx.workspace.rootPaths();
    const visible = editor.visibleRanges[0];
    return ok('get_current_file', `Open: ${toRelative(roots, editor.document.uri.fsPath)}`, {
      open: true,
      path: toRelative(roots, editor.document.uri.fsPath),
      language: editor.document.languageId,
      totalLines: editor.document.lineCount,
      cursorLine: editor.selection.active.line + 1,
      visibleStartLine: visible ? visible.start.line + 1 : 1,
      visibleEndLine: visible ? visible.end.line + 1 : editor.document.lineCount,
      isDirty: editor.document.isDirty
    });
  }
};

export const getSelectionTool: ToolDefinition = {
  name: 'get_selection',
  risk: TOOL_RISK.get_selection,
  description: 'Get the code the user has selected in the editor.',
  parameters: { type: 'object', properties: {} },
  title: () => 'Read the editor selection',
  async execute(_input, ctx) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return ok('get_selection', 'Nothing is selected in the editor.', { hasSelection: false });
    }
    const roots = ctx.workspace.rootPaths();
    const text = editor.document.getText(editor.selection);
    return ok(
      'get_selection',
      `Selection: ${toRelative(roots, editor.document.uri.fsPath)} lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1}`,
      {
        hasSelection: true,
        path: toRelative(roots, editor.document.uri.fsPath),
        language: editor.document.languageId,
        startLine: editor.selection.start.line + 1,
        endLine: editor.selection.end.line + 1,
        text: text.slice(0, 20000)
      }
    );
  }
};

export const getProblemsTool: ToolDefinition = {
  name: 'get_problems',
  risk: TOOL_RISK.get_problems,
  description:
    'Read the VS Code Problems panel: compiler and linter errors and warnings, with file, line and code.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Limit to one file.' },
      severity: { type: 'string', enum: ['error', 'warning', 'all'] }
    }
  },
  title: (input) => (input.path ? `Check problems in ${String(input.path)}` : 'Check Problems panel'),
  async execute(input, ctx) {
    const severity = optionalString(input, 'severity') ?? 'all';
    const only = optionalString(input, 'path');
    const roots = ctx.workspace.rootPaths();

    let entries = vscode.languages.getDiagnostics();
    if (only) {
      const resolved = ctx.workspace.resolve(only);
      entries = entries.filter(([uri]) => uri.fsPath === resolved.fsPath);
    }

    const problems: unknown[] = [];
    let errorCount = 0;
    let warningCount = 0;

    for (const [uri, diagnostics] of entries) {
      for (const diagnostic of diagnostics) {
        const isError = diagnostic.severity === vscode.DiagnosticSeverity.Error;
        const isWarning = diagnostic.severity === vscode.DiagnosticSeverity.Warning;
        if (severity === 'error' && !isError) {
          continue;
        }
        if (severity === 'warning' && !isWarning) {
          continue;
        }
        if (isError) {
          errorCount++;
        } else if (isWarning) {
          warningCount++;
        }
        if (problems.length >= 120) {
          continue;
        }
        problems.push({
          path: toRelative(roots, uri.fsPath),
          line: diagnostic.range.start.line + 1,
          column: diagnostic.range.start.character + 1,
          severity: vscode.DiagnosticSeverity[diagnostic.severity].toLowerCase(),
          code: typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code,
          source: diagnostic.source,
          message: diagnostic.message
        });
      }
    }

    const summary =
      problems.length === 0
        ? 'No problems reported.'
        : `${errorCount} errors, ${warningCount} warnings`;
    return ok('get_problems', summary, { errorCount, warningCount, problems });
  }
};

export const getTerminalOutputTool: ToolDefinition = {
  name: 'get_terminal_output',
  risk: TOOL_RISK.get_terminal_output,
  description: 'Read the output of the most recent command the agent ran.',
  parameters: { type: 'object', properties: {} },
  title: () => 'Read terminal output',
  async execute(_input, ctx) {
    const last = ctx.terminal.lastOutput();
    if (!last) {
      return ok('get_terminal_output', 'No command has been run in this session yet.', { hasOutput: false });
    }
    return ok('get_terminal_output', `Output of "${last.command}" (exit ${last.exitCode})`, last);
  }
};

export const askUserTool: ToolDefinition = {
  name: 'ask_user',
  risk: TOOL_RISK.ask_user,
  description:
    'Ask the user a question when the task is genuinely ambiguous. Use sparingly — prefer inspecting the code.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, description: 'Suggested answers.' }
    },
    required: ['question']
  },
  title: (input) => `Ask: ${String(input.question ?? '').slice(0, 60)}`,
  async execute(input, ctx) {
    const question = requireString(input, 'question', 'ask_user');
    const options = Array.isArray(input.options)
      ? (input.options as unknown[]).filter((o): o is string => typeof o === 'string')
      : undefined;
    const answer = await ctx.askUser(question, options);
    if (!answer) {
      return fail('ask_user', 'The user did not answer.');
    }
    return ok('ask_user', 'The user answered.', { question, answer });
  }
};
