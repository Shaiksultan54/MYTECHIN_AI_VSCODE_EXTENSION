import * as vscode from 'vscode';
import * as path from 'node:path';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import { Logger } from '../logging/Logger.js';

export interface FileDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source?: string;
}

export interface VerificationResult {
  passed: boolean;
  diagnostics: FileDiagnostic[];
  errorsCount: number;
  warningsCount: number;
  selectedTests: string[];
  testOutput?: string;
  repairRequired: boolean;
  repairPrompt?: string;
}

/**
 * Automated post-modification verification engine.
 * Validates compiler/linter diagnostics on touched files, selects targeted tests,
 * and formulates actionable repair prompts when issues are detected.
 */
export class VerificationLoop {
  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly terminal?: TerminalManager
  ) {}

  /**
   * Optionally executes targeted tests using the terminal manager.
   */
  async runTargetedTest(command: string, cwd: string, token: vscode.CancellationToken): Promise<string | undefined> {
    if (!this.terminal) return undefined;
    const res = await this.terminal.run(command, cwd, token);
    return res.stdout + (res.stderr ? `\n${res.stderr}` : '');
  }

  /**
   * Inspects compiler and linter diagnostics for all files modified during a task.
   */
  async inspectDiagnostics(modifiedFiles: string[]): Promise<FileDiagnostic[]> {
    const diagnostics: FileDiagnostic[] = [];

    for (const file of modifiedFiles) {
      try {
        const resolved = this.workspace.resolve(file);
        const entries = vscode.languages.getDiagnostics(resolved.uri);

        for (const d of entries) {
          diagnostics.push({
            file,
            line: d.range.start.line + 1,
            column: d.range.start.character + 1,
            severity:
              d.severity === vscode.DiagnosticSeverity.Error
                ? 'error'
                : d.severity === vscode.DiagnosticSeverity.Warning
                  ? 'warning'
                  : 'info',
            message: d.message,
            source: d.source
          });
        }
      } catch {
        // file might have been deleted or outside workspace
      }
    }

    return diagnostics;
  }

  /**
   * Identifies candidate test files corresponding to modified source files.
   */
  async selectTargetedTests(modifiedFiles: string[]): Promise<string[]> {
    const selected = new Set<string>();
    const exclude = this.workspace.ignoreRules.excludeGlob();

    for (const file of modifiedFiles) {
      const baseName = path.basename(file, path.extname(file));
      const testPatterns = [
        `**/${baseName}.test.*`,
        `**/${baseName}.spec.*`,
        `**/${baseName}Test.*`,
        `**/${baseName}Tests.*`,
        `**/test_${baseName}.*`
      ];

      for (const pattern of testPatterns) {
        const found = await vscode.workspace.findFiles(pattern, exclude, 5);
        for (const uri of found) {
          selected.add(vscode.workspace.asRelativePath(uri, false));
        }
      }
    }

    return Array.from(selected);
  }

  /**
   * Runs the verification pipeline on modified files.
   */
  async verify(
    modifiedFiles: string[],
    _token: vscode.CancellationToken
  ): Promise<VerificationResult> {
    const diagnostics = await this.inspectDiagnostics(modifiedFiles);
    const errors = diagnostics.filter((d) => d.severity === 'error');
    const warnings = diagnostics.filter((d) => d.severity === 'warning');
    const selectedTests = await this.selectTargetedTests(modifiedFiles);

    const hasErrors = errors.length > 0;
    let repairPrompt: string | undefined;

    if (hasErrors) {
      const errorLines = errors
        .map((e) => `- ${e.file}:${e.line}:${e.column} [${e.source ?? 'compiler'}]: ${e.message}`)
        .join('\n');

      repairPrompt = `The recent file modifications introduced compilation/lint errors that must be resolved:\n${errorLines}\n\nPlease inspect the code at these locations and apply the necessary fixes.`;
    }

    Logger.get().info(
      `Verification complete: ${errors.length} errors, ${warnings.length} warnings, ${selectedTests.length} tests identified.`
    );

    return {
      passed: !hasErrors,
      diagnostics,
      errorsCount: errors.length,
      warningsCount: warnings.length,
      selectedTests,
      repairRequired: hasErrors,
      repairPrompt
    };
  }
}
