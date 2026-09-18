import type { Intent } from './ContextTypes.js';

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','if','then','else','for','while','to','of','in','on','at','by',
  'with','from','is','are','was','were','be','been','do','does','did','can','could','should',
  'would','will','my','our','your','this','that','these','those','it','its','i','we','you','me',
  'please','help','explain','show','tell','how','what','why','where','when','which','who','code',
  'file','files','project','repo','repository','function','method','class','error','errors','fix',
  'make','change','add','update','write','create','need','want','like','use','using','about','all',
  'some','any','not','no','yes','also','just','now','get','set','new','old','here','there'
]);

const MODIFY_VERBS = /\b(change|update|modify|set|rename|refactor|replace|add|remove|delete|implement|migrate|rewrite|bump|increase|decrease|extract|move)\b/i;
const FIX_VERBS = /\b(fix|broken|failing|fails|crash|exception|stack ?trace|error|bug|500|404|null reference|undefined|not working|regression)\b/i;
const FIND_VERBS = /\b(where|find|locate|which file|search|look for|who calls|references?)\b/i;
const EXPLAIN_VERBS = /\b(explain|what does|how does|walk me through|describe|summar(y|ise|ize)|review|understand)\b/i;
const RUN_VERBS = /\b(run|execute|build|compile|test|npm|dotnet|yarn|pnpm|pytest|gradle|maven|go test|cargo)\b/i;
const GENERAL_KNOWLEDGE =
  /^\s*(what|who|when|why|how)\b.*\b(is|are|does|do)\b(?!.*\b(my|our|this|the file|the project|the repo|here)\b)/i;

/**
 * Works out what the user wants and which terms are worth searching for. This
 * is what stops the agent reading the repository for "what is dependency
 * injection?" while still inspecting code for "why does my AuthService fail?".
 */
export class ContextRanker {
  analyze(prompt: string, hasAttachments: boolean): Intent {
    const text = prompt.trim();

    let kind: Intent['kind'] = 'general-question';
    if (FIX_VERBS.test(text)) {
      kind = 'fix-error';
    } else if (MODIFY_VERBS.test(text)) {
      kind = 'modify-code';
    } else if (RUN_VERBS.test(text)) {
      kind = 'run-task';
    } else if (FIND_VERBS.test(text)) {
      kind = 'find-code';
    } else if (EXPLAIN_VERBS.test(text)) {
      kind = hasAttachments ? 'explain-code' : 'find-code';
    }

    // A bare conceptual question with no project nouns needs no workspace context.
    const looksGeneral =
      kind === 'general-question' &&
      !hasAttachments &&
      GENERAL_KNOWLEDGE.test(text) &&
      ContextRanker.keywords(text).length <= 1;

    const needsWorkspace = !looksGeneral;
    const searchTerms = needsWorkspace ? ContextRanker.searchTerms(text) : [];

    return {
      kind,
      searchTerms,
      needsWorkspace,
      needsProblems: kind === 'fix-error' || /@problems/.test(text)
    };
  }

  /** Identifier-shaped tokens first, then meaningful words. */
  static searchTerms(text: string): string[] {
    const terms: string[] = [];

    // Quoted phrases are intentional and go first.
    for (const match of text.matchAll(/["'`]([^"'`\n]{3,60})["'`]/g)) {
      terms.push(match[1]);
    }

    // Identifiers: CamelCase, snake_case, dotted paths, file names.
    for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*(?:[._/-][\w$]+)+|[A-Z][a-z]+[A-Z]\w*)\b/g)) {
      if (match[1].length >= 4) {
        terms.push(match[1]);
      }
    }

    for (const word of ContextRanker.keywords(text)) {
      terms.push(word);
    }

    const unique: string[] = [];
    for (const term of terms) {
      const normalized = term.trim();
      if (normalized.length >= 3 && !unique.some((u) => u.toLowerCase() === normalized.toLowerCase())) {
        unique.push(normalized);
      }
      if (unique.length >= 6) {
        break;
      }
    }
    return unique;
  }

  private static keywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  }
}
