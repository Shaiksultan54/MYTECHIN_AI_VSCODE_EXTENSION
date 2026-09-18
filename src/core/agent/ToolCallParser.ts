export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** Set when the block was well-formed enough to find but not to parse. */
  parseError?: string;
  raw: string;
}

export interface ParseChunk {
  /** Text safe to show the user right now. */
  text: string;
  /** Present once a complete tool block has been seen. */
  call?: ParsedToolCall;
}

const OPEN = '<tool';
const CLOSE = '</tool>';

/**
 * Extracts `<tool name="…">{json}</tool>` blocks from a token stream.
 *
 * This is the transport that works on every model, including local ones with no
 * native function calling. It is incremental: text before a block streams to
 * the UI immediately, and text that might be the start of a block is held back
 * so a partial `<to` never flashes on screen.
 */
export class ToolCallParser {
  private buffer = '';
  private inBlock = false;
  private blockBuffer = '';
  private done = false;

  /** True once a complete tool call has been emitted. */
  get finished(): boolean {
    return this.done;
  }

  reset(): void {
    this.buffer = '';
    this.blockBuffer = '';
    this.inBlock = false;
    this.done = false;
  }

  push(chunk: string): ParseChunk {
    if (this.done) {
      return { text: '' };
    }

    if (this.inBlock) {
      this.blockBuffer += chunk;
      return this.tryCloseBlock();
    }

    this.buffer += chunk;
    let released = '';
    let searchFrom = 0;

    for (;;) {
      const openIndex = this.buffer.indexOf(OPEN, searchFrom);

      if (openIndex === -1) {
        // Hold back anything that could still become `<tool`, plus a possible
        // opening code fence directly before it.
        const hold = ToolCallParser.holdbackLength(this.buffer);
        released += this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        return { text: released };
      }

      const verdict = ToolCallParser.looksLikeHeader(this.buffer.slice(openIndex));

      if (verdict === 'unknown') {
        // Not enough characters yet to tell `<tool name=` from `<toolbar`.
        released += this.buffer.slice(0, openIndex);
        this.buffer = this.buffer.slice(openIndex);
        return { text: released };
      }

      if (verdict === 'no') {
        // A word that merely starts with `<tool`. Emit it and keep scanning.
        searchFrom = openIndex + OPEN.length;
        continue;
      }

      released += ToolCallParser.stripTrailingFence(this.buffer.slice(0, openIndex));
      this.blockBuffer = this.buffer.slice(openIndex);
      this.buffer = '';
      this.inBlock = true;

      const closed = this.tryCloseBlock();
      return { text: released + closed.text, call: closed.call };
    }
  }

  /** Call when the stream ends, to release any held-back text. */
  flush(): ParseChunk {
    if (this.done) {
      return { text: '' };
    }
    if (this.inBlock) {
      // Stream ended mid-block: try to salvage a call from what arrived.
      const raw = this.blockBuffer;
      const salvaged = this.parseBlock(raw + CLOSE);
      this.blockBuffer = '';
      this.inBlock = false;
      if (salvaged) {
        this.done = true;
        return { text: '', call: salvaged };
      }
      // Never silently drop text: what looked like a block was just prose.
      return { text: raw };
    }
    const text = this.buffer;
    this.buffer = '';
    return { text };
  }

  private tryCloseBlock(): ParseChunk {
    const closeIndex = this.blockBuffer.indexOf(CLOSE);
    if (closeIndex === -1) {
      return { text: '' };
    }
    const raw = this.blockBuffer.slice(0, closeIndex + CLOSE.length);
    this.blockBuffer = '';
    this.inBlock = false;

    const call = this.parseBlock(raw);
    if (call) {
      this.done = true;
      return { text: '', call };
    }
    // Not actually a tool block; surface it as ordinary text.
    return { text: raw };
  }

  private parseBlock(raw: string): ParsedToolCall | undefined {
    const header = /^<tool\s+name\s*=\s*["']?([A-Za-z0-9_]+)["']?\s*>/.exec(raw);
    if (!header) {
      return undefined;
    }
    const name = header[1];
    let body = raw.slice(header[0].length);
    const closeIndex = body.indexOf(CLOSE);
    if (closeIndex >= 0) {
      body = body.slice(0, closeIndex);
    }

    body = body.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

    if (body.length === 0) {
      return { name, arguments: {}, raw };
    }

    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { name, arguments: parsed as Record<string, unknown>, raw };
      }
      return { name, arguments: { value: parsed }, raw };
    } catch {
      const repaired = ToolCallParser.repairJson(body);
      if (repaired) {
        return { name, arguments: repaired, raw };
      }
      return {
        name,
        arguments: {},
        raw,
        parseError:
          'The tool arguments were not valid JSON. Send the block again with a single valid JSON object, escaping newlines inside strings as \\n.'
      };
    }
  }

  /**
   * Local models sometimes emit trailing commas or unescaped newlines inside
   * string values. One repair attempt is cheaper than a wasted round trip.
   */
  private static repairJson(body: string): Record<string, unknown> | undefined {
    const attempts = [
      body.replace(/,(\s*[}\]])/g, '$1'),
      body.replace(/,(\s*[}\]])/g, '$1').replace(/'/g, '"')
    ];
    for (const attempt of attempts) {
      try {
        const parsed = JSON.parse(attempt) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Try the next repair.
      }
    }
    return undefined;
  }

  /**
   * Decides whether text starting at `<tool` is really a tool header.
   * `<toolbar>` is not; `<tool name="x">` is; `<tool` alone is still undecided.
   */
  private static looksLikeHeader(candidate: string): 'yes' | 'no' | 'unknown' {
    if (candidate.length <= OPEN.length) {
      return 'unknown';
    }
    return /\s/.test(candidate.charAt(OPEN.length)) ? 'yes' : 'no';
  }

  /** How many trailing characters could still become an opening marker. */
  private static holdbackLength(buffer: string): number {
    const max = Math.min(OPEN.length - 1, buffer.length);
    for (let length = max; length > 0; length--) {
      if (OPEN.startsWith(buffer.slice(buffer.length - length))) {
        return length;
      }
    }
    return 0;
  }

  /** Removes a code fence the model opened just to wrap the tool block. */
  private static stripTrailingFence(text: string): string {
    return text.replace(/```(?:xml|tool|html)?\s*$/i, '');
  }
}
