import { useState, type JSX } from 'react';
import type { ToolCallView } from '../../../../src/shared/types.js';
import { Icon } from '../Icon.js';
import { toolIcon } from '../../utils/format.js';

function statusIcon(status: ToolCallView['status']): { name: string; spin: boolean; tone: string } {
  switch (status) {
    case 'running':
      return { name: 'loading', spin: true, tone: 'running' };
    case 'success':
      return { name: 'check', spin: false, tone: 'ok' };
    case 'rejected':
      return { name: 'circle-slash', spin: false, tone: 'muted' };
    default:
      return { name: 'error', spin: false, tone: 'bad' };
  }
}

export function ToolEvent({ call }: { call: ToolCallView }): JSX.Element {
  const [open, setOpen] = useState(false);
  const status = statusIcon(call.status);
  const hasDetail = Boolean(call.output ?? call.error ?? call.detail);

  return (
    <div className={`tool-event tool-${status.tone}`}>
      <button
        type="button"
        className="tool-event-head"
        onClick={() => hasDetail && setOpen((value) => !value)}
        aria-expanded={hasDetail ? open : undefined}
        disabled={!hasDetail}
      >
        <Icon name={status.name} spin={status.spin} className="tool-status" />
        <Icon name={toolIcon(call.toolName)} className="tool-kind" />
        <span className="tool-title">{call.title}</span>
        {call.summary && call.status !== 'running' ? (
          <span className="tool-summary">{call.summary}</span>
        ) : null}
        {hasDetail ? <Icon name={open ? 'chevron-up' : 'chevron-down'} className="tool-chevron" /> : null}
      </button>

      {open && hasDetail ? (
        <div className="tool-event-body">
          {call.error ? <p className="tool-error">{call.error}</p> : null}
          {call.detail ? <p className="tool-detail">{call.detail}</p> : null}
          {call.output ? (
            <pre className="tool-output">
              <code>{call.output}</code>
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolEventList({ calls }: { calls: ToolCallView[] }): JSX.Element | null {
  if (calls.length === 0) {
    return null;
  }
  return (
    <div className="tool-events">
      {calls.map((call) => (
        <ToolEvent key={call.callId} call={call} />
      ))}
    </div>
  );
}
