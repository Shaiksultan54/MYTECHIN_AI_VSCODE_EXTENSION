import { describe, expect, it } from 'vitest';
import { AgentOrchestrator } from '../core/agent/AgentOrchestrator.js';
import { AgentState } from '../core/agent/AgentState.js';
import type { AIStreamEvent } from '../core/providers/ProviderTypes.js';

type Call = { id: string; name: string; arguments: Record<string, unknown> };

const RISK: Record<string, 'safe' | 'ask'> = { read_file: 'safe', search_code: 'safe', write_file: 'ask' };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Options {
  /** What the fake model asks for on its first turn. */
  calls: Call[];
  delays?: Record<string, number>;
  approvalMode?: string;
  autoApproveSafeTools?: boolean;
  maxToolIterations?: number;
}

/** Runs the real orchestrator loop against fake collaborators and records what happened. */
async function harness(options: Options) {
  const log = { active: 0, maxActive: 0, started: [] as string[], finished: [] as string[], activeAtWrite: -1 };
  const turns: any[] = [];
  const requests: any[][] = [];

  const provider = {
    name: 'fake',
    isCloud: false,
    supportsTools: () => true,
    supportsVision: () => false,
    async stream(req: any, onEvent: (e: AIStreamEvent) => void) {
      requests.push(req.messages);
      if (requests.length === 1) {
        for (const call of options.calls) onEvent({ type: 'tool_call', call });
      } else {
        onEvent({ type: 'text', delta: 'All done.' });
      }
      onEvent({ type: 'done', finishReason: 'stop' });
    }
  };

  const executor = {
    async execute(name: string, input: Record<string, unknown>) {
      const label = `${name}:${String(input.path ?? input.query ?? '')}`;
      log.started.push(label);
      log.active++;
      if (name === 'write_file') log.activeAtWrite = log.active - 1;
      log.maxActive = Math.max(log.maxActive, log.active);
      await sleep(options.delays?.[label] ?? 30);
      log.active--;
      log.finished.push(label);
      return {
        result: { success: true, toolName: name, summary: `did ${label}`, output: { label } },
        risk: RISK[name] ?? 'safe',
        title: label,
        approved: true,
        automatic: true,
        durationMs: 0
      };
    }
  };

  const conversations = {
    id: 'conv',
    task: [],
    modelTurns: turns,
    addMessage: () => undefined,
    addModelTurn: (t: any) => void turns.push(t),
    upsertToolCall: () => undefined,
    updateMessage: () => undefined,
    noteTaskFact: () => undefined,
    persist: async () => undefined
  };

  const state = new AgentState(() => undefined, '/tmp', 's');
  const token = state.start('go');

  const orchestrator = new AgentOrchestrator({
    provider: async () => provider as any,
    registry: { get: (n: string) => ({ risk: RISK[n] ?? 'safe' }), all: () => [], schemas: () => [] } as any,
    executor: executor as any,
    conversations: conversations as any,
    context: {
      build: async () => ({ pieces: [], tokens: 0 }),
      summary: () => undefined,
      preEditImpact: async () => undefined
    } as any,
    attachments: { list: () => [] } as any,
    vision: { getImagesAsDataUrls: async () => [] } as any,
    memory: { retrieve: async () => [] } as any,
    settings: {
      read: () => ({
        planBeforeExecute: false,
        maxToolIterations: options.maxToolIterations ?? 20,
        approvalMode: options.approvalMode ?? 'askForRisky',
        autoApproveSafeTools: options.autoApproveSafeTools ?? true,
        verifyAfterEdit: false,
        temperature: 0.2,
        maxTokens: 1000,
        model: 'm'
      })
    } as any,
    checkpoints: { endTurn: async () => undefined, beginTurn: () => undefined } as any,
    events: { emit: () => undefined } as any,
    state,
    verification: {} as any,
    requestPlanApproval: async () => undefined
  });

  await orchestrator.run('do it', token);
  return { log, turns, requests };
}

const reads: Call[] = [
  { id: 'id-a', name: 'read_file', arguments: { path: 'a.ts' } },
  { id: 'id-b', name: 'read_file', arguments: { path: 'b.ts' } },
  { id: 'id-q', name: 'search_code', arguments: { query: 'foo' } }
];

const manyReads: Call[] = Array.from({ length: 9 }, (_, index) => ({
  id: `id-${index}`,
  name: 'read_file',
  arguments: { path: `${index}.ts` }
}));

describe('AgentOrchestrator parallel tool calls', () => {
  it('runs independent read-only calls concurrently', async () => {
    const { log } = await harness({ calls: reads });
    expect(log.maxActive).toBe(3);
    expect(log.started).toHaveLength(3);
  });

  it('bounds a large read-only batch to four concurrent tools', async () => {
    const { log } = await harness({ calls: manyReads, delays: Object.fromEntries(manyReads.map((call) => [`read_file:${String(call.arguments.path)}`, 40])) });
    expect(log.maxActive).toBe(4);
    expect(log.started).toHaveLength(9);
  });

  it('runs a write alone, after the reads, never alongside them', async () => {
    const { log } = await harness({
      calls: [...reads.slice(0, 2), { id: 'id-w', name: 'write_file', arguments: { path: 'c.ts' } }]
    });
    expect(log.activeAtWrite).toBe(0);
    expect(log.finished.at(-1)).toBe('write_file:c.ts');
    expect(log.maxActive).toBe(2);
  });

  it('falls back to one-at-a-time when safe tools would need approval', async () => {
    const { log } = await harness({ calls: reads, approvalMode: 'alwaysAsk' });
    expect(log.maxActive).toBe(1);
    expect(log.started).toEqual(['read_file:a.ts', 'read_file:b.ts', 'search_code:foo']);
  });

  it('also serialises when autoApproveSafeTools is off', async () => {
    const { log } = await harness({ calls: reads, autoApproveSafeTools: false });
    expect(log.maxActive).toBe(1);
  });

  it('records results in the order the model asked, even when they finish out of order', async () => {
    const { log, turns } = await harness({ calls: reads, delays: { 'read_file:a.ts': 120, 'read_file:b.ts': 10 } });
    expect(log.finished[0]).not.toBe('read_file:a.ts'); // a really did finish late

    const assistant = turns.find((t) => t.role === 'assistant' && String(t.content).includes('<tool'));
    expect([...String(assistant.content).matchAll(/id="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'id-a',
      'id-b',
      'id-q'
    ]);
    const results = turns.filter((t) => t.role === 'tool');
    expect(results.map((t) => t.toolCallId)).toEqual(['id-a', 'id-b', 'id-q']);
    expect(results[0].content).toContain('a.ts');
  });

  it('sends the whole batch and every result back to the model on the next turn', async () => {
    const { requests } = await harness({ calls: reads });
    const second = requests[1];
    expect(second.filter((m: any) => m.role === 'tool')).toHaveLength(3);
    expect(second.filter((m: any) => m.role === 'assistant')).toHaveLength(1);
  });

  it('executes an identical call repeated within one batch only once', async () => {
    const { log, turns } = await harness({
      calls: [
        { id: 'id-1', name: 'read_file', arguments: { path: 'a.ts' } },
        { id: 'id-2', name: 'read_file', arguments: { path: 'a.ts' } }
      ]
    });
    expect(log.started).toEqual(['read_file:a.ts']);
    const results = turns.filter((t) => t.role === 'tool');
    expect(results).toHaveLength(2);
    expect(results[1].content).toContain('already ran');
  });

  it('trims a batch that would exceed the iteration budget', async () => {
    const { log, turns } = await harness({ calls: reads, maxToolIterations: 2 });
    expect(log.started).toHaveLength(2);
    expect(turns.filter((t) => t.role === 'tool')).toHaveLength(2);
    const assistant = turns.find((t) => t.role === 'assistant' && String(t.content).includes('<tool'));
    expect(String(assistant.content)).not.toContain('id-q');
  });
});
