import type { ContextItemView } from '../../shared/types.js';

/** Where a piece of context came from. Drives priority ordering. */
export type ContextSource =
  | 'attachment'
  | 'selection'
  | 'current-editor'
  | 'mention'
  | 'problems'
  | 'search'
  | 'symbol'
  | 'project-config'
  | 'documentation'
  | 'workspace-map'
  | 'memory'
  | 'semantic'
  | 'image'
  | 'mcp'
  | 'browser';

/** Priority order from the spec. Lower wins when the budget is tight. */
export const SOURCE_PRIORITY: Record<ContextSource, number> = {
  attachment: 1,
  selection: 2,
  'current-editor': 3,
  mention: 4,
  search: 5,
  symbol: 6,
  'project-config': 7,
  documentation: 8,
  problems: 2.5,
  'workspace-map': 0,
  memory: 1.5,
  semantic: 4.5,
  image: 1.1,
  mcp: 1.2,
  browser: 1.3
};

export interface ContextPiece {
  id: string;
  source: ContextSource;
  kind: ContextItemView['kind'];
  label: string;
  detail?: string;
  uri?: string;
  /** Rendered into the prompt verbatim. */
  body: string;
  tokens: number;
  reason: string;
  /** Extra weight from relevance scoring, added to the source priority. */
  score?: number;
}

export interface Intent {
  /** What the user is asking for, used to decide how much context to gather. */
  kind: 'general-question' | 'explain-code' | 'find-code' | 'fix-error' | 'modify-code' | 'run-task';
  /** Terms to feed the repository search. */
  searchTerms: string[];
  needsWorkspace: boolean;
  needsProblems: boolean;
}

export interface BuiltContext {
  pieces: ContextPiece[];
  droppedCount: number;
  totalTokens: number;
  budgetTokens: number;
  intent: Intent;
}
