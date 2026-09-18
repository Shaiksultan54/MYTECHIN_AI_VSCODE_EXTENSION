import type { JSX } from 'react';
import type { ContextAttachment } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';
import { attachmentDetail, attachmentIcon, attachmentLabel } from '../../utils/format.js';

export interface AttachmentBarProps {
  attachments: ContextAttachment[];
  removable?: boolean;
}

/** The chips above the composer, and the read-only echo inside a sent message. */
export function AttachmentBar({ attachments, removable = true }: AttachmentBarProps): JSX.Element | null {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="attachments" role="list">
      {attachments.map((attachment) => {
        const detail = attachmentDetail(attachment);
        return (
          <span
            key={attachment.id}
            role="listitem"
            className={`chip${attachment.sensitive ? ' chip-warn' : ''}${attachment.status === 'error' ? ' chip-error' : ''}`}
            title={attachment.error ?? attachment.relativePath ?? attachment.type}
          >
            <Icon name={attachmentIcon(attachment)} className="chip-icon" />
            <span className="chip-label">{attachmentLabel(attachment)}</span>
            {detail ? <span className="chip-detail">{detail}</span> : null}
            {attachment.sensitive ? <Icon name="shield" className="chip-warn-icon" title="Sensitive file" /> : null}
            {removable ? (
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${attachmentLabel(attachment)}`}
                onClick={() => post({ type: 'removeAttachment', attachmentId: attachment.id })}
              >
                <Icon name="close" />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
