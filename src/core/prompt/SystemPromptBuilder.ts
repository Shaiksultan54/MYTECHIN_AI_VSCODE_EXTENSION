import type { BuiltContext, ContextPiece } from '../context/ContextTypes.js';
import type { ApprovalMode } from '../../shared/types.js';
import type { ToolDefinition } from '../tools/ToolTypes.js';

export interface PromptSection {
  heading: string;
  body: string;
}

/** ROLE and CAPABILITIES. */
export class RolePromptBuilder {
  build(): PromptSection[] {
    return [
      {
        heading: 'ROLE',
        body: [
          'You are Mytechin AI, a coding agent working inside the user\'s VS Code workspace.',
          'You inspect real code before answering questions about it, and you make changes through tools rather than by pasting code for the user to copy.',
          'You are talking to a working developer: be concise, concrete and specific about files and line numbers.'
        ].join('\n')
      },
      {
        heading: 'CAPABILITIES',
        body: [
          'You can read files, search the repository, list directories, read the open editor and its selection, read the Problems panel, edit and create files, delete files, and run shell commands.',
          'You cannot browse the internet, and you cannot see anything outside the open workspace folders.'
        ].join('\n')
      }
    ];
  }
}

/** SAFETY RULES. */
export class SafetyPromptBuilder {
  build(approvalMode: ApprovalMode, isCloud: boolean, providerName: string): PromptSection {
    const lines = [
      'Only touch paths inside the open workspace. Never construct paths with `..` to escape it.',
      'Never read or write credential files (.env, *.pem, *.key, credentials.*, secrets.*) unless the user attached one explicitly.',
      'Never print API keys, tokens or passwords you happen to see, even in a summary.',
      'Destructive shell commands are refused by the extension. Do not try to work around approval prompts.',
      'Prefer the smallest edit that solves the problem. Do not reformat or restructure code the user did not ask you to change.'
    ];

    if (approvalMode === 'alwaysAsk') {
      lines.push('Every tool call is shown to the user for approval, including reads. Keep the number of calls low.');
    } else if (approvalMode === 'autonomous') {
      lines.push('The user has enabled autonomous mode. Be correspondingly careful: double-check a change before writing it.');
    } else {
      lines.push('File edits, deletions and shell commands are shown to the user for approval before they run.');
    }

    if (isCloud) {
      lines.push(
        `Code you read is sent to ${providerName}, which is a remote service. Do not read more of the repository than the task needs.`
      );
    }

    return { heading: 'SAFETY RULES', body: lines.map((l) => `- ${l}`).join('\n') };
  }
}

/** WORKSPACE, CURRENT EDITOR, USER CONTEXT, ATTACHMENTS. */
export class WorkspaceContextBuilder {
  build(context: BuiltContext, projectMemory: import('../../shared/types.js').MemoryEntry[]): PromptSection[] {
    const sections: PromptSection[] = [];
    const group = (predicate: (p: ContextPiece) => boolean): ContextPiece[] =>
      context.pieces.filter(predicate);

    const workspaceMap = group((p) => p.source === 'workspace-map');
    if (workspaceMap.length > 0) {
      sections.push({ heading: 'WORKSPACE', body: workspaceMap.map((p) => p.body).join('\n') });
    }

    if (projectMemory.length > 0) {
      sections.push({
        heading: 'PROJECT MEMORY',
        body: projectMemory.map((entry) => `[${entry.category.toUpperCase()}]\n${entry.content}`).join('\n\n')
      });
    }

    const editor = group((p) => p.source === 'current-editor');
    if (editor.length > 0) {
      sections.push({ heading: 'CURRENT EDITOR', body: editor.map((p) => p.body).join('\n\n') });
    }

    const attached = group(
      (p) => p.source === 'attachment' || p.source === 'selection' || p.source === 'mention'
    );
    if (attached.length > 0) {
      sections.push({
        heading: 'ATTACHMENTS',
        body: [
          'The user attached or mentioned these. Treat them as the primary material for this request.',
          '',
          attached.map((p) => p.body).join('\n\n')
        ].join('\n')
      });
    }

    const problems = group((p) => p.kind === 'problems');
    if (problems.length > 0) {
      sections.push({ heading: 'PROBLEMS', body: problems.map((p) => p.body).join('\n\n') });
    }

    const found = group((p) => p.source === 'search' || p.source === 'symbol');
    if (found.length > 0) {
      sections.push({
        heading: 'POSSIBLY RELEVANT CODE',
        body: [
          'These came from an automatic repository search and may be irrelevant. Verify before relying on them, and read more of a file when you need it.',
          '',
          found.map((p) => p.body).join('\n\n')
        ].join('\n')
      });
    }

    const terminal = group((p) => p.kind === 'terminal');
    if (terminal.length > 0) {
      sections.push({ heading: 'TERMINAL OUTPUT', body: terminal.map((p) => p.body).join('\n\n') });
    }

    if (context.droppedCount > 0) {
      sections.push({
        heading: 'CONTEXT NOTE',
        body: `${context.droppedCount} candidate files did not fit the context budget. Use search_code and read_file if you need more.`
      });
    }

    return sections;
  }
}

/** AVAILABLE TOOLS and TOOL RULES. */
export class ToolPromptBuilder {
  /**
   * Describes the text tool protocol. Used for every provider, because local
   * models frequently advertise tool support they do not reliably honour; when
   * a provider does support native calls the agent accepts both.
   */
  build(tools: ToolDefinition[], nativeToolCalling: boolean): PromptSection[] {
    const catalogue = tools
      .map((tool) => {
        const required = tool.parameters.required ?? [];
        const args = Object.entries(tool.parameters.properties)
          .map(([name, schema]) => {
            const spec = schema as { type?: string; description?: string };
            const flag = required.includes(name) ? '' : '?';
            return `    ${name}${flag}: ${spec.type ?? 'any'}${spec.description ? ` — ${spec.description}` : ''}`;
          })
          .join('\n');
        return `- ${tool.name}: ${tool.description}\n${args}`;
      })
      .join('\n');

    const sections: PromptSection[] = [{ heading: 'AVAILABLE TOOLS', body: catalogue }];

    const rules = [
      'Call a tool only when you need information you do not have, or when the user asked you to change something. A general programming question needs no tools.',
      'Search before reading. `search_code` narrows the repository; `read_file` then reads what matters.',
      'Read a file before editing it. Never edit a file whose current contents you have not seen in this conversation.',
      'Prefer `apply_patch` with find/replace blocks over `write_file`. The find text must appear exactly once and must match the file byte for byte, indentation included.',
      'One tool call per message. Wait for the result before deciding the next step.',
      'After editing, verify: read the changed region back, and check `get_problems` when the language has a compiler or linter.',
      'When a tool fails, read the error and adjust. Do not call the same tool with the same arguments twice.',
      'When you have finished, reply with prose only — no tool call. Say exactly which files you changed and what changed in them.'
    ];

    if (nativeToolCalling) {
      rules.unshift('Use the function-calling interface provided by the API to call tools.');
    } else {
      rules.unshift(
        [
          'To call a tool, emit exactly this block and nothing after it:',
          '',
          '<tool name="tool_name">',
          '{"argument": "value"}',
          '</tool>',
          '',
          'The body must be a single valid JSON object. Write any explanation before the block, never after it.'
        ].join('\n')
      );
    }

    sections.push({ heading: 'TOOL RULES', body: rules.map((r) => `- ${r}`).join('\n') });
    return sections;
  }
}

/** TASK. */
export class TaskPromptBuilder {
  build(prompt: string, taskMemory: string[], iteration: number, maxIterations: number): PromptSection {
    const lines = [prompt];
    if (taskMemory.length > 0) {
      lines.push('', 'Notes from earlier in this task:', ...taskMemory.map((n) => `- ${n}`));
    }
    if (iteration > 0) {
      lines.push(
        '',
        `(Tool call ${iteration} of at most ${maxIterations} for this task. If you have what you need, answer now.)`
      );
    }
    return { heading: 'TASK', body: lines.join('\n') };
  }
}

/** Assembles the sections into the final system prompt. */
export class SystemPromptBuilder {
  private readonly role = new RolePromptBuilder();
  private readonly safety = new SafetyPromptBuilder();
  private readonly workspace = new WorkspaceContextBuilder();
  private readonly toolPrompt = new ToolPromptBuilder();

  build(options: {
    context: BuiltContext;
    tools: ToolDefinition[];
    nativeToolCalling: boolean;
    approvalMode: ApprovalMode;
    isCloud: boolean;
    providerName: string;
    projectMemory: import('../../shared/types.js').MemoryEntry[];
  }): string {
    const sections: PromptSection[] = [
      ...this.role.build(),
      this.safety.build(options.approvalMode, options.isCloud, options.providerName),
      ...this.workspace.build(options.context, options.projectMemory),
      ...this.toolPrompt.build(options.tools, options.nativeToolCalling)
    ];

    return sections.map((section) => `# ${section.heading}\n${section.body}`).join('\n\n');
  }
}
