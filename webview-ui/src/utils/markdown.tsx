import type { JSX, ReactNode } from 'react';

/**
 * A small markdown renderer that emits React elements directly.
 *
 * Model output is untrusted, so nothing here goes through innerHTML. Anything
 * the parser does not recognise falls through as plain text, which is the safe
 * failure mode for a partially streamed response.
 */

type Block =
  | { kind: 'code'; language: string; content: string; closed: boolean }
  | { kind: 'heading'; level: number; content: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; content: string }
  | { kind: 'rule' }
  | { kind: 'paragraph'; content: string };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s{0,3}[-*+]\s+(.*)$/;
const ORDERED = /^\s{0,3}\d+[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])\s*(\1\s*){2,}$/;

export function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', content: paragraph.join('\n') });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE.exec(line);

    if (fence) {
      flushParagraph();
      const marker = fence[1];
      const content: string[] = [];
      let closed = false;
      i += 1;
      for (; i < lines.length; i += 1) {
        if (lines[i].trimStart().startsWith(marker)) {
          closed = true;
          break;
        }
        content.push(lines[i]);
      }
      blocks.push({ kind: 'code', language: fence[2] ?? '', content: content.join('\n'), closed });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: heading[1].length, content: heading[2] });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      const parts = [quote[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        i += 1;
        parts.push(QUOTE.exec(lines[i])?.[1] ?? '');
      }
      blocks.push({ kind: 'quote', content: parts.join('\n') });
      continue;
    }

    const unordered = UNORDERED.exec(line);
    const ordered = ORDERED.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const items = [(unordered ?? ordered)![1]];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextMatch = isOrdered ? ORDERED.exec(nextLine) : UNORDERED.exec(nextLine);
        if (nextMatch) {
          items.push(nextMatch[1]);
          i += 1;
          continue;
        }
        // A continuation line belongs to the previous item.
        if (/^\s{2,}\S/.test(nextLine) && items.length > 0) {
          items[items.length - 1] += ` ${nextLine.trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

const INLINE =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Inline spans: code, bold, italic and links. Links render as plain text. */
export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }
    const [full, , code, boldStar, boldUnderscore, italicStar, italicUnderscore, linkText] = match;

    if (code !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-${key++}`} className="md-inline-code">
          {code}
        </code>
      );
    } else if (boldStar ?? boldUnderscore) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{boldStar ?? boldUnderscore}</strong>);
    } else if (italicStar ?? italicUnderscore) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{italicStar ?? italicUnderscore}</em>);
    } else if (linkText !== undefined) {
      nodes.push(<span key={`${keyPrefix}-${key++}`}>{linkText}</span>);
    } else {
      nodes.push(full);
    }
    lastIndex = index + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export interface MarkdownProps {
  text: string;
  onCopyCode?: (code: string) => void;
}

export function Markdown({ text, onCopyCode }: MarkdownProps): JSX.Element {
  const blocks = parseBlocks(text);

  return (
    <div className="md">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'code':
            return (
              <div className="md-code" key={index}>
                <div className="md-code-head">
                  <span className="md-code-lang">{block.language || 'code'}</span>
                  {onCopyCode && block.closed ? (
                    <button
                      type="button"
                      className="icon-button"
                      title="Copy code"
                      onClick={() => onCopyCode(block.content)}
                    >
                      <span className="codicon codicon-copy" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <pre>
                  <code>{block.content}</code>
                </pre>
              </div>
            );

          case 'heading': {
            const Tag = `h${Math.min(block.level + 2, 6)}` as keyof JSX.IntrinsicElements;
            return <Tag key={index}>{renderInline(block.content, `h${index}`)}</Tag>;
          }

          case 'list':
            return block.ordered ? (
              <ol key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item, `l${index}-${i}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item, `l${index}-${i}`)}</li>
                ))}
              </ul>
            );

          case 'quote':
            return (
              <blockquote key={index}>{renderInline(block.content, `q${index}`)}</blockquote>
            );

          case 'rule':
            return <hr key={index} />;

          default:
            return <p key={index}>{renderInline(block.content, `p${index}`)}</p>;
        }
      })}
    </div>
  );
}
