import type { ContextAttachment, ToolRisk } from '../../../src/shared/types.js';

export function fileName(path: string | undefined): string {
  if (!path) {
    return '';
  }
  return path.split('/').pop() ?? path;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative day grouping for the history list. */
export function dayGroup(timestamp: number): string {
  const now = new Date();
  const then = new Date(timestamp);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;

  if (timestamp >= startOfToday) {
    return 'Today';
  }
  if (timestamp >= startOfYesterday) {
    return 'Yesterday';
  }
  if (timestamp >= startOfToday - 6 * 86_400_000) {
    return then.toLocaleDateString(undefined, { weekday: 'long' });
  }
  return 'Older';
}

export function timeOfDay(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function attachmentIcon(attachment: ContextAttachment): string {
  switch (attachment.type) {
    case 'folder':
      return 'folder';
    case 'selection':
      return 'selection';
    case 'problems':
      return 'warning';
    case 'terminal':
      return 'terminal';
    case 'image':
      return 'file-media';
    default:
      return 'file-code';
  }
}

export function attachmentLabel(attachment: ContextAttachment): string {
  switch (attachment.type) {
    case 'problems':
      return 'Problems';
    case 'terminal':
      return 'Terminal output';
    case 'selection':
      return fileName(attachment.relativePath) || 'Selection';
    default:
      return fileName(attachment.relativePath) || 'Attachment';
  }
}

export function attachmentDetail(attachment: ContextAttachment): string | undefined {
  if (attachment.type === 'selection' && attachment.lineStart && attachment.lineEnd) {
    return `lines ${attachment.lineStart}–${attachment.lineEnd}`;
  }
  if (attachment.type === 'folder') {
    return attachment.relativePath;
  }
  if (attachment.relativePath && attachment.relativePath.includes('/')) {
    return attachment.relativePath;
  }
  return formatBytes(attachment.sizeBytes) || undefined;
}

export function riskLabel(risk: ToolRisk): string {
  switch (risk) {
    case 'strong':
      return 'Destructive';
    case 'ask':
      return 'Needs approval';
    default:
      return 'Read-only';
  }
}

/** Codicon name for each tool, so activity rows read at a glance. */
export function toolIcon(toolName: string): string {
  switch (toolName) {
    case 'read_file':
    case 'read_files':
    case 'get_file_metadata':
      return 'file-code';
    case 'search_code':
      return 'search';
    case 'list_directory':
      return 'folder-opened';
    case 'get_current_file':
    case 'get_selection':
      return 'editor-layout';
    case 'get_problems':
      return 'warning';
    case 'get_terminal_output':
    case 'run_command':
      return 'terminal';
    case 'write_file':
    case 'create_file':
    case 'apply_patch':
      return 'edit';
    case 'delete_file':
      return 'trash';
    case 'open_file':
      return 'go-to-file';
    case 'open_diff':
      return 'diff';
    case 'ask_user':
      return 'question';
    default:
      return 'tools';
  }
}
