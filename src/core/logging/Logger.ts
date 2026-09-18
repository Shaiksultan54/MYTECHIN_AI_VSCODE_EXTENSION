import * as vscode from 'vscode';
import { OUTPUT_CHANNEL } from '../../shared/constants/index.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

const REDACTIONS: [RegExp, string][] = [
  [/\b(sk-[A-Za-z0-9_-]{8,})\b/g, 'sk-***'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, '$1***'],
  [/("?(api[-_]?key|token|password|secret|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1***']
];

/**
 * Output-channel logger. Never writes file contents or credentials: every line
 * runs through a redaction pass first, and payloads are only rendered at debug
 * level and above.
 */
export class Logger {
  private static instance: Logger | undefined;
  private readonly channel: vscode.OutputChannel;
  private level: LogLevel = 'info';

  private constructor() {
    this.channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  }

  static get(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }

  error(message: string, detail?: unknown): void {
    this.write('error', message, detail);
  }
  warn(message: string, detail?: unknown): void {
    this.write('warn', message, detail);
  }
  info(message: string, detail?: unknown): void {
    this.write('info', message, detail);
  }
  debug(message: string, detail?: unknown): void {
    this.write('debug', message, detail);
  }
  trace(message: string, detail?: unknown): void {
    this.write('trace', message, detail);
  }

  private write(level: LogLevel, message: string, detail?: unknown): void {
    if (ORDER[level] > ORDER[this.level]) {
      return;
    }
    const stamp = new Date().toISOString().slice(11, 23);
    let line = `[${stamp}] ${level.toUpperCase().padEnd(5)} ${message}`;
    if (detail !== undefined && ORDER[this.level] >= ORDER.debug) {
      line += ` ${Logger.stringify(detail)}`;
    }
    this.channel.appendLine(Logger.redact(line));
  }

  static redact(input: string): string {
    return REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), input);
  }

  private static stringify(value: unknown): string {
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    try {
      const text = JSON.stringify(value);
      return text && text.length > 2000 ? `${text.slice(0, 2000)}…` : text ?? String(value);
    } catch {
      return String(value);
    }
  }
}
