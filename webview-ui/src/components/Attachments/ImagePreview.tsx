import type { JSX } from 'react';
import type { ContextAttachment } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';
import { formatBytes, fileName } from '../../utils/format.js';

export function ImagePreview({ attachment, removable = true }: { attachment: ContextAttachment; removable?: boolean }): JSX.Element {
  return (
    <div className="image-preview" style={{ position: 'relative', display: 'inline-block', margin: 4 }}>
      <div 
        className="image-thumbnail"
        style={{ 
          width: 64, 
          height: 64, 
          borderRadius: 4, 
          background: 'var(--vscode-editor-background)', 
          border: '1px solid var(--vscode-widget-border)', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          overflow: 'hidden'
        }}
        title={fileName(attachment.relativePath)}
      >
        {/* Real thumbnails require converting VS Code URIs to webview URIs via the host,
            so we use a placeholder icon for the preview to avoid CSP violations. */}
        <Icon name="file-media" style={{ fontSize: 24, color: 'var(--vscode-textPreformat-foreground)' }} />
      </div>
      {removable ? (
        <button
          type="button"
          className="icon-button"
          style={{ 
            position: 'absolute', 
            top: -6, 
            right: -6, 
            background: 'var(--vscode-button-background)', 
            color: 'var(--vscode-button-foreground)', 
            borderRadius: '50%', 
            padding: 2, 
            width: 20,
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            border: '1px solid var(--vscode-widget-border)'
          }}
          onClick={() => post({ type: 'removeAttachment', attachmentId: attachment.id })}
          title={`Remove ${fileName(attachment.relativePath)}`}
        >
          <Icon name="close" style={{ fontSize: 12 }} />
        </button>
      ) : null}
      <div 
        style={{ 
          fontSize: 10, 
          textAlign: 'center', 
          marginTop: 4, 
          color: 'var(--vscode-descriptionForeground)',
          maxWidth: 64,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
        title={fileName(attachment.relativePath)}
      >
        {fileName(attachment.relativePath)}
      </div>
      <div style={{ fontSize: 9, textAlign: 'center', color: 'var(--vscode-descriptionForeground)', opacity: 0.8 }}>
        {formatBytes(attachment.sizeBytes)}
      </div>
    </div>
  );
}
