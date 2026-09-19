import type { JSX } from 'react';
import type { ChatMessage } from '../../../../src/shared/types.js';
import { Markdown } from '../../utils/markdown.js';
import { AttachmentBar } from '../Attachments/AttachmentBar.js';
import { ToolEventList } from '../ToolExecution/ToolEvent.js';
import { Icon } from '../Icon.js';
import { timeOfDay } from '../../utils/format.js';

export function Message({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user';

  return (
    <article className={`message message-${message.role}`} aria-label={`${message.role} message`}>
      <header className="message-head">
        <span className="message-role">
          <Icon name={isUser ? 'account' : 'sparkle'} />
          {isUser ? 'You' : 'Mytechin AI'}
        </span>
        <time className="message-time">{timeOfDay(message.createdAt)}</time>
      </header>

      {message.attachments?.length ? (
        <AttachmentBar attachments={message.attachments} removable={false} />
      ) : null}

      {message.toolCalls?.length ? <ToolEventList calls={message.toolCalls} /> : null}

      {message.text ? (
        isUser ? (
          <p className="message-text">{message.text}</p>
        ) : (
          <Markdown text={message.text} onCopyCode={(code) => void navigator.clipboard?.writeText(code)} />
        )
      ) : null}



      {message.error ? (
        <p className="message-error">
          <Icon name="error" /> {message.error}
        </p>
      ) : null}
    </article>
  );
}
