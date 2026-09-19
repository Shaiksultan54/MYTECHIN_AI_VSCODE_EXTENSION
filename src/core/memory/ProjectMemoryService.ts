import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Logger } from '../../logging/Logger.js';
import type { MemoryEntry } from '../../shared/types.js';

export class ProjectMemoryService {
  private memoryPath: string | undefined;
  private entries: MemoryEntry[] = [];

  constructor(workspaceUri: vscode.Uri | undefined, private readonly logger: Logger) {
    if (workspaceUri && (workspaceUri.scheme === 'file' || workspaceUri.path)) {
      try {
        this.memoryPath = vscode.Uri.joinPath(workspaceUri, '.mytechin', 'memory.md').fsPath;
      } catch (e) {
        this.logger.warn('ProjectMemoryService: could not resolve memory path', e);
        this.memoryPath = undefined;
      }
    }
  }

  async load(): Promise<void> {
    if (!this.memoryPath) {
      this.entries = [];
      return;
    }
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      this.entries = this.parseMemoryFile(data);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.entries = [];
      } else {
        this.logger.warn('ProjectMemoryService: Failed to load memory', e);
      }
    }
  }

  async save(): Promise<void> {
    if (!this.memoryPath) {
      return;
    }
    try {
      await fs.mkdir(path.dirname(this.memoryPath), { recursive: true });
      const data = this.formatMemoryFile(this.entries);
      await fs.writeFile(this.memoryPath, data, 'utf8');
    } catch (e) {
      this.logger.warn('ProjectMemoryService: Failed to save memory', e);
    }
  }

  getEntries(): MemoryEntry[] {
    return this.entries ?? [];
  }

  addEntry(category: MemoryEntry['category'], content: string): void {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.entries.push({ id, category, content: content.trim() });
  }

  removeEntry(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
  }

  updateEntry(id: string, content: string): void {
    const entry = this.entries.find(e => e.id === id);
    if (entry) {
      entry.content = content.trim();
    }
  }

  /**
   * Extremely simple parser for markdown sections.
   */
  private parseMemoryFile(content: string): MemoryEntry[] {
    const entries: MemoryEntry[] = [];
    const lines = content.split('\n');
    let currentCategory: MemoryEntry['category'] | undefined;
    let currentContent: string[] = [];
    let currentId = '';

    const finalizeEntry = () => {
      if (currentCategory && currentContent.length > 0) {
        entries.push({
          id: currentId || Date.now().toString(36) + Math.random().toString(36).slice(2),
          category: currentCategory,
          content: currentContent.join('\n').trim()
        });
      }
    };

    for (const line of lines) {
      const catMatch = line.match(/^##\s*(Rules|Architecture|Decisions|Knowledge)/i);
      if (catMatch) {
        finalizeEntry();
        currentCategory = catMatch[1].toLowerCase() as MemoryEntry['category'];
        currentContent = [];
        currentId = '';
      } else if (line.match(/^<!-- id: (.*?) -->/)) {
        currentId = line.match(/^<!-- id: (.*?) -->/)![1];
      } else if (currentCategory) {
        // Only collect text if we are under a category heading
        if (line.trim().startsWith('- ')) {
          // If a new bullet point starts, treat it as a new entry if we already have content
          if (currentContent.length > 0) {
            finalizeEntry();
            currentId = '';
          }
          currentContent = [line.replace(/^- /, '')];
        } else {
          currentContent.push(line);
        }
      }
    }
    finalizeEntry();
    return entries;
  }

  private formatMemoryFile(entries: MemoryEntry[]): string {
    let result = '# Project Memory\n\nThis file is automatically maintained by Mytechin AI to retain context across sessions.\n\n';
    
    const categories: MemoryEntry['category'][] = ['rules', 'architecture', 'decisions', 'knowledge'];
    
    for (const cat of categories) {
      const catEntries = entries.filter(e => e.category === cat);
      if (catEntries.length > 0) {
        result += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
        for (const entry of catEntries) {
          result += `<!-- id: ${entry.id} -->\n- ${entry.content.replace(/\n/g, '\n  ')}\n\n`;
        }
      }
    }
    return result;
  }
}
