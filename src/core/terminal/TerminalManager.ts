import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { Logger } from '../logging/Logger.js';

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

const MAX_CAPTURE = 60_000;

/**
 * Runs commands the agent asks for. Output is captured so the model can read
 * it, and mirrored into a VS Code terminal-style output channel so the user can
 * see exactly what ran.
 */
export class TerminalManager implements vscode.Disposable {
  private last: CommandResult | undefined;
  private readonly channel: vscode.OutputChannel;

  constructor(private readonly timeoutMs: () => number) {
    this.channel = vscode.window.createOutputChannel('Mytechin AI Commands');
  }

  lastOutput(): CommandResult | undefined {
    return this.last;
  }

  async run(
    command: string,
    cwd: string,
    token: vscode.CancellationToken,
    onChunk?: (text: string) => void
  ): Promise<CommandResult> {
    const started = Date.now();
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];

    this.channel.appendLine(`\n$ ${command}`);
    this.channel.appendLine(`  (in ${cwd})`);
    Logger.get().info(`Running command in ${cwd}`, { command });

    return new Promise<CommandResult>((resolve) => {
      const child = spawn(shell, args, {
        cwd,
        windowsHide: true,
        env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1', CI: '1' }
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (target: 'out' | 'err', text: string): void => {
        this.channel.append(text);
        onChunk?.(text);
        if (stdout.length + stderr.length > MAX_CAPTURE) {
          truncated = true;
          return;
        }
        if (target === 'out') {
          stdout += text;
        } else {
          stderr += text;
        }
      };

      const finish = (exitCode: number): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const result: CommandResult = {
          command,
          cwd,
          exitCode,
          stdout: stdout.slice(0, MAX_CAPTURE),
          stderr: stderr.slice(0, MAX_CAPTURE),
          durationMs: Date.now() - started,
          timedOut,
          truncated
        };
        this.last = result;
        this.channel.appendLine(`\n[exit ${exitCode} after ${result.durationMs}ms]`);
        resolve(result);
      };

      const timeout = this.timeoutMs();
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000);
      }, timeout > 0 ? timeout : 120_000);

      const cancellation = token.onCancellationRequested(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000);
      });

      child.stdout.on('data', (chunk: Buffer) => append('out', chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => append('err', chunk.toString('utf8')));
      child.on('error', (error) => {
        stderr += `\n${error.message}`;
        finish(-1);
      });
      child.on('close', (code) => {
        cancellation.dispose();
        finish(code ?? -1);
      });
    });
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
