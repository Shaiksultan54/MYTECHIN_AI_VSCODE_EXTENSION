import { describe, expect, it } from 'vitest';
import { ApprovalPolicy } from '../core/approval/ApprovalPolicy.js';
import type { ApprovalMode, ToolRisk } from '../shared/types.js';
import { TOOL_RISK } from '../shared/schemas/tools.js';

function policy(mode: ApprovalMode, autoSafe = true): ApprovalPolicy {
  return new ApprovalPolicy(
    () => mode,
    () => autoSafe
  );
}

const RISKS: ToolRisk[] = ['safe', 'ask', 'strong'];

describe('ApprovalPolicy', () => {
  it('asks for everything in alwaysAsk, including reads', () => {
    const p = policy('alwaysAsk');
    for (const risk of RISKS) {
      expect(p.decide(risk)).toBe('ask');
    }
  });

  it('approves everything in autonomous mode', () => {
    const p = policy('autonomous');
    for (const risk of RISKS) {
      expect(p.decide(risk)).toBe('auto-approve');
    }
  });

  describe('askForRisky (the default)', () => {
    const p = policy('askForRisky');

    it('runs read-only tools without a prompt', () => {
      expect(p.decide('safe')).toBe('auto-approve');
    });

    it('asks before writing or running commands', () => {
      expect(p.decide('ask')).toBe('ask');
      expect(p.decide('strong')).toBe('ask');
    });

    it('asks even for reads when auto-approve is turned off', () => {
      expect(policy('askForRisky', false).decide('safe')).toBe('ask');
    });
  });

  describe('autoApproveSafe', () => {
    const p = policy('autoApproveSafe');

    it('lets edits through', () => {
      expect(p.decide('ask')).toBe('auto-approve');
    });

    it('still stops at destructive actions', () => {
      expect(p.decide('strong')).toBe('ask');
    });
  });

  it('never auto-approves a destructive tool outside autonomous mode', () => {
    for (const mode of ['alwaysAsk', 'askForRisky', 'autoApproveSafe'] as ApprovalMode[]) {
      expect(policy(mode).decide('strong')).toBe('ask');
    }
  });

  it('flags only strong risk as high risk', () => {
    const p = policy('askForRisky');
    expect(p.isHighRisk('strong')).toBe(true);
    expect(p.isHighRisk('ask')).toBe(false);
    expect(p.isHighRisk('safe')).toBe(false);
  });
});

describe('tool risk classification', () => {
  it('marks every read-only tool safe', () => {
    for (const name of [
      'read_file',
      'read_files',
      'search_code',
      'list_directory',
      'get_file_metadata',
      'get_current_file',
      'get_selection',
      'get_problems',
      'get_terminal_output'
    ] as const) {
      expect(TOOL_RISK[name]).toBe('safe');
    }
  });

  it('marks deletion and shell commands as the strongest risk', () => {
    expect(TOOL_RISK.delete_file).toBe('strong');
    expect(TOOL_RISK.run_command).toBe('strong');
  });

  it('marks edits as needing approval', () => {
    for (const name of ['write_file', 'create_file', 'apply_patch'] as const) {
      expect(TOOL_RISK[name]).toBe('ask');
    }
  });
});
