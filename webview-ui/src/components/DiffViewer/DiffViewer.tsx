import type { JSX } from 'react';

export type DiffTone = 'add' | 'del' | 'meta' | 'ctx';

export function diffTone(line: string): DiffTone {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
    return 'meta';
  }
  if (line.startsWith('+')) {
    return 'add';
  }
  if (line.startsWith('-')) {
    return 'del';
  }
  return 'ctx';
}

export interface DiffViewerProps {
  patch: string;
  maxLines?: number;
}

/**
 * Inline unified-diff rendering for the approval card. VS Code's real diff
 * editor is one click away; this is the at-a-glance version.
 */
export function DiffViewer({ patch, maxLines = 400 }: DiffViewerProps): JSX.Element {
  const lines = patch.split('\n');
  const shown = lines.slice(0, maxLines);

  return (
    <pre className="approval-diff">
      <code>
        {shown.map((line, index) => (
          <span key={index} className={`diff-line diff-${diffTone(line)}`}>
            {line}
            {'\n'}
          </span>
        ))}
        {lines.length > maxLines ? (
          <span className="diff-line diff-meta">… {lines.length - maxLines} more lines</span>
        ) : null}
      </code>
    </pre>
  );
}
