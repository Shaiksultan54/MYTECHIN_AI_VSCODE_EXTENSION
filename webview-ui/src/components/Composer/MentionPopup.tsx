import type { JSX } from 'react';
import type { MentionItem } from '../../../../src/shared/types.js';
import { Icon } from '../Icon.js';

export interface MentionPopupProps {
  items: MentionItem[];
  highlight: number;
  onPick: (item: MentionItem) => void;
  onHover: (index: number) => void;
}

function icon(kind: MentionItem['kind']): string {
  switch (kind) {
    case 'folder':
      return 'folder';
    case 'special':
      return 'symbol-keyword';
    default:
      return 'file-code';
  }
}

export function MentionPopup({ items, highlight, onPick, onHover }: MentionPopupProps): JSX.Element {
  return (
    <div className="menu mention-menu" role="listbox" aria-label="Mention suggestions">
      {items.map((item, index) => (
        <button
          key={`${item.kind}-${item.insert}-${index}`}
          type="button"
          role="option"
          aria-selected={index === highlight}
          className={index === highlight ? 'menu-item-active' : undefined}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
        >
          <Icon name={icon(item.kind)} />
          <span className="mention-label">{item.label}</span>
          {item.detail ? <span className="mention-detail">{item.detail}</span> : null}
        </button>
      ))}
    </div>
  );
}
