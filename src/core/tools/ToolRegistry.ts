import type { AIToolSchema } from '../providers/ProviderTypes.js';
import type { ToolName } from '../../shared/schemas/tools.js';
import { ALL_TOOLS } from './handlers/index.js';
import type { ToolDefinition } from './ToolTypes.js';

/**
 * Strongly typed registry. Tools are registered once at startup; the agent
 * looks them up by name and never constructs them.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(definitions: ToolDefinition[] = ALL_TOOLS) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered.`);
    }
    this.tools.set(definition.name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): ToolName[] {
    return Array.from(this.tools.keys()) as ToolName[];
  }

  all(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** JSON Schema list for providers with native tool calling. */
  schemas(): AIToolSchema[] {
    return this.all().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  /**
   * Suggests a correction when the model invents a tool name. Cheap Levenshtein
   * against the registry beats a bare "unknown tool" error in the loop.
   */
  suggest(name: string): string | undefined {
    let best: { name: string; distance: number } | undefined;
    for (const candidate of this.tools.keys()) {
      const distance = ToolRegistry.editDistance(name.toLowerCase(), candidate.toLowerCase());
      if (!best || distance < best.distance) {
        best = { name: candidate, distance };
      }
    }
    return best && best.distance <= 4 ? best.name : undefined;
  }

  private static editDistance(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    let previous = Array.from({ length: cols }, (_, i) => i);
    for (let i = 1; i < rows; i++) {
      const current = [i];
      for (let j = 1; j < cols; j++) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[cols - 1];
  }
}
