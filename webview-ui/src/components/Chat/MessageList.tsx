import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { ApprovalRequestView, ChatMessage } from '../../../../src/shared/types.js';
import { Message } from './Message.js';
import { ApprovalCard } from '../Approval/ApprovalCard.js';
import { Icon } from '../Icon.js';

/**
 * Renders only a tail window of the conversation. A long task can produce
 * hundreds of messages, and a sidebar does not need to hold them all in the DOM.
 */
const WINDOW = 60;

export interface MessageListProps {
  messages: ChatMessage[];
  approvals: ApprovalRequestView[];
  phaseLabel: string;
  busy: boolean;
}

export function MessageList({ messages, approvals, phaseLabel, busy }: MessageListProps): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const hidden = showAll ? 0 : Math.max(0, messages.length - WINDOW);
  const visible = hidden > 0 ? messages.slice(hidden) : messages;

  useLayoutEffect(() => {
    if (pinned && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  });

  useEffect(() => {
    const element = scroller.current;
    if (!element) {
      return;
    }
    const onScroll = (): void => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      setPinned(distance < 48);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="messages" ref={scroller} role="log" aria-live="polite">
      {hidden > 0 ? (
        <button type="button" className="link-button load-older" onClick={() => setShowAll(true)}>
          Show {hidden} earlier message{hidden === 1 ? '' : 's'}
        </button>
      ) : null}

      {visible
        .filter((message) => !(message.role === 'assistant' && !message.text && !message.toolCalls?.length && message.streaming))
        .map((message) => (
        <Message key={message.id} message={message} />
      ))}

      {approvals.map((request) => (
        <ApprovalCard key={request.requestId} request={request} />
      ))}

      {busy && phaseLabel ? (
        <p className="phase">
          <Icon name="loading" spin /> {phaseLabel}
        </p>
      ) : null}

      {!pinned ? (
        <button
          type="button"
          className="scroll-bottom"
          onClick={() => {
            setPinned(true);
            if (scroller.current) {
              scroller.current.scrollTop = scroller.current.scrollHeight;
            }
          }}
        >
          <Icon name="arrow-down" /> Latest
        </button>
      ) : null}
    </div>
  );
}
