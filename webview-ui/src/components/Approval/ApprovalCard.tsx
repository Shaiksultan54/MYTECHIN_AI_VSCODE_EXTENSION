import { useState, type JSX } from 'react';
import type { ApprovalRequestView } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';
import { riskLabel } from '../../utils/format.js';
import { DiffViewer } from '../DiffViewer/DiffViewer.js';

/**
 * The gate in front of every non-safe tool. Nothing here auto-dismisses: the
 * agent waits until the person answers or presses Stop.
 */
export function ApprovalCard({ request }: { request: ApprovalRequestView }): JSX.Element {
  const [remember, setRemember] = useState(false);
  const strong = request.risk === 'strong';

  const answer = (approved: boolean): void =>
    post({
      type: 'approveTool',
      requestId: request.requestId,
      approved,
      rememberForTask: approved && remember && !strong
    });

  return (
    <div className={`approval${strong ? ' approval-strong' : ''}`} role="alertdialog" aria-label="Approval required">
      <div className="approval-head">
        <Icon name={strong ? 'warning' : 'shield'} />
        <span className="approval-title">{request.title}</span>
        <span className="approval-risk">{riskLabel(request.risk)}</span>
      </div>

      {request.detail ? <p className="approval-detail">{request.detail}</p> : null}

      {request.command ? (
        <pre className="approval-command">
          <code>{request.command}</code>
        </pre>
      ) : null}

      {request.diff ? <DiffViewer patch={request.diff} /> : null}

      <div className="approval-actions">
        {request.diff ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              post({
                type: 'openDiff',
                uri: request.path ?? '',
                patch: request.diff ?? '',
                title: request.path ?? request.toolName
              })
            }
          >
            <Icon name="diff" /> Open diff
          </button>
        ) : null}
        <span className="spacer" />
        {!strong ? (
          <label className="approval-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Allow for this task
          </label>
        ) : null}
        <button type="button" className="button-secondary" onClick={() => answer(false)}>
          Reject
        </button>
        <button type="button" className="button-primary" onClick={() => answer(true)}>
          {request.command ? 'Run' : 'Approve'}
        </button>
      </div>
    </div>
  );
}

