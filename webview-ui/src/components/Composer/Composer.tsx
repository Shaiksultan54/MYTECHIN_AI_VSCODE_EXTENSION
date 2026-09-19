import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type JSX,
  type KeyboardEvent
} from 'react';
import type { ContextAttachment, MentionItem } from '../../../../src/shared/types.js';
import { SLASH_COMMANDS } from '../../../../src/shared/constants/index.js';
import { useDispatch } from '../../state/store.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';
import { AttachmentBar } from '../Attachments/AttachmentBar.js';
import { MentionPopup } from './MentionPopup.js';

export interface ComposerProps {
  attachments: ContextAttachment[];
  busy: boolean;
  mentions: { requestId: string; items: MentionItem[] };
  prefill: { text: string; at: number } | undefined;
  onPrefillConsumed: () => void;
  modelSlot: JSX.Element;
}

const MENTION_TRIGGER = /(^|\s)@([\w./\\-]*)$/;
const SLASH_TRIGGER = /^\/(\w*)$/;

export function Composer({
  attachments,
  busy,
  mentions,
  prefill,
  onPrefillConsumed,
  modelSlot
}: ComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [popup, setPopup] = useState<{ query: string; requestId: string } | undefined>();
  const [highlight, setHighlight] = useState(0);
  const dispatch = useDispatch();
  const input = useRef<HTMLTextAreaElement>(null);
  const debounce = useRef<number | undefined>(undefined);

  const resize = useCallback((): void => {
    const element = input.current;
    if (!element) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, []);

  useLayoutEffect(resize, [text, resize]);

  useEffect(() => {
    if (prefill) {
      setText((current) => (prefill.text ? prefill.text : current));
      input.current?.focus();
      onPrefillConsumed();
    }
  }, [prefill, onPrefillConsumed]);

  const slashMatches = (() => {
    const match = SLASH_TRIGGER.exec(text);
    if (!match) {
      return [];
    }
    return SLASH_COMMANDS.filter((command) => command.command.startsWith(`/${match[1]}`));
  })();

  const updateText = (next: string): void => {
    setText(next);
    const caret = input.current?.selectionStart ?? next.length;
    const before = next.slice(0, caret);
    const mention = MENTION_TRIGGER.exec(before);

    if (mention) {
      const query = mention[2];
      const requestId = `m${Date.now().toString(36)}`;
      setPopup({ query, requestId });
      setHighlight(0);
      window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(() => {
        post({ type: 'searchMentions', query, requestId });
      }, 140);
    } else {
      setPopup(undefined);
    }
  };

  const applyMention = (item: MentionItem): void => {
    const caret = input.current?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(MENTION_TRIGGER, (_full, lead: string) => `${lead}`);
    const next = `${before}${item.insert} ${text.slice(caret)}`;
    setPopup(undefined);
    setText(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      const position = before.length + item.insert.length + 1;
      input.current?.setSelectionRange(position, position);
    });
  };

  const send = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) {
      return;
    }
    const slash = /^\/(\w+)\s*([\s\S]*)$/.exec(trimmed);
    const command = slash ? SLASH_COMMANDS.find((c) => c.command === `/${slash[1]}`) : undefined;
    post({ type: 'sendPrompt', text: command ? command.expand(slash?.[2] ?? '').trim() : trimmed });
    setText('');
    setPopup(undefined);
    dispatch({ kind: 'setPanel', panel: 'chat' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const items = popup ? mentions.items : [];

    if (popup && items.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((value) => (value + 1) % items.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((value) => (value - 1 + items.length) % items.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applyMention(items[highlight]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setPopup(undefined);
        return;
      }
    }

    if (slashMatches.length > 0 && event.key === 'Tab') {
      event.preventDefault();
      setText(`${slashMatches[0].command} `);
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }

    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      post({ type: 'stopAgent' });
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    // Handle image paste
    const items = event.clipboardData.items;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        hasImage = true;
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (e) => {
             const dataUrl = e.target?.result as string;
             post({ type: 'attachDataUrl', name: `Pasted Image.png`, dataUrl, mimeType: blob.type });
          };
          reader.readAsDataURL(blob);
        }
      }
    }
    
    if (hasImage) {
      event.preventDefault();
      return;
    }

    const pasted = event.clipboardData.getData('text');
    // Long multi-line pastes become an attachment rather than flooding the box.
    if (pasted.split('\n').length > 12 && pasted.length > 400) {
      event.preventDefault();
      post({ type: 'attachPastedCode', text: pasted });
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);

    // Handle dropping image files directly
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const files = Array.from(event.dataTransfer.files);
      const images = files.filter(f => f.type.startsWith('image/'));
      if (images.length > 0) {
        for (const file of images) {
          const reader = new FileReader();
          reader.onload = (e) => {
             const dataUrl = e.target?.result as string;
             post({ type: 'attachDataUrl', name: file.name, dataUrl, mimeType: file.type });
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }

    const uriList =
      event.dataTransfer.getData('text/uri-list') ||
      event.dataTransfer.getData('resourceurls') ||
      '';
    const uris = uriList
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        try {
          // VS Code's `resourceurls` payload is a JSON array of quoted URIs.
          return line.startsWith('[') ? (JSON.parse(line) as string[]) : [line];
        } catch {
          return [line];
        }
      })
      .flat();

    if (uris.length > 0) {
      post({ type: 'attachUris', uris });
      return;
    }

    const dropped = event.dataTransfer.getData('text');
    if (dropped.trim().length > 0) {
      post({ type: 'attachPastedCode', text: dropped });
    }
  };

  return (
    <div
      className={`composer${dragging ? ' composer-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <AttachmentBar attachments={attachments} />

      <div className="composer-tools">
        <div className="attach-menu">
          <button
            type="button"
            className="icon-button"
            title="Attach context"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <Icon name="add" />
          </button>
          {menuOpen ? (
            <div className="menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button type="button" role="menuitem" onClick={() => { post({ type: 'pickAttachment', kind: 'file' }); setMenuOpen(false); }}>
                <Icon name="file-code" /> Files…
              </button>
              <button type="button" role="menuitem" onClick={() => { post({ type: 'pickAttachment', kind: 'folder' }); setMenuOpen(false); }}>
                <Icon name="folder" /> Folder…
              </button>
              <button type="button" role="menuitem" onClick={() => { post({ type: 'attachSpecial', kind: 'currentFile' }); setMenuOpen(false); }}>
                <Icon name="go-to-file" /> Current file
              </button>
              <button type="button" role="menuitem" onClick={() => { post({ type: 'attachSpecial', kind: 'selection' }); setMenuOpen(false); }}>
                <Icon name="selection" /> Selection
              </button>
              <button type="button" role="menuitem" onClick={() => { post({ type: 'attachSpecial', kind: 'problems' }); setMenuOpen(false); }}>
                <Icon name="warning" /> Problems
              </button>
              <button type="button" role="menuitem" onClick={() => { post({ type: 'attachSpecial', kind: 'terminal' }); setMenuOpen(false); }}>
                <Icon name="terminal" /> Terminal output
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="icon-button"
          title="Mention a file, folder or @problems"
          onClick={() => {
            updateText(`${text}${text.endsWith(' ') || text.length === 0 ? '' : ' '}@`);
            input.current?.focus();
          }}
        >
          <Icon name="mention" />
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            post({ type: 'requestContext' });
            dispatch({ kind: 'setPanel', panel: 'context' });
          }}
          title="See exactly what was sent to the model"
        >
          Context
        </button>
      </div>

      <div className="composer-input-wrap">
        {popup && mentions.items.length > 0 ? (
          <MentionPopup
            items={mentions.items}
            highlight={highlight}
            onPick={applyMention}
            onHover={setHighlight}
          />
        ) : null}

        {slashMatches.length > 0 ? (
          <div className="menu slash-menu" role="listbox">
            {slashMatches.map((command) => (
              <button
                key={command.command}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  setText(`${command.command} `);
                  input.current?.focus();
                }}
              >
                <span className="slash-name">{command.command}</span>
                <span className="slash-detail">{command.detail}</span>
              </button>
            ))}
          </div>
        ) : null}

        <textarea
          ref={input}
          className="composer-input"
          rows={2}
          placeholder="Ask Mytechin AI…  @ to mention, / for commands"
          aria-label="Message"
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>

      <div className="composer-footer">
        {modelSlot}
        <span className="spacer" />
        {busy ? (
          <button type="button" className="button-secondary" onClick={() => post({ type: 'stopAgent' })}>
            <Icon name="debug-stop" /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="button-primary"
            disabled={text.trim().length === 0}
            onClick={send}
          >
            <Icon name="send" /> Send
          </button>
        )}
      </div>
    </div>
  );
}
