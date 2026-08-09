import { describe, it, expect } from 'vitest';

import { runConsolidateToTerminal } from './kb-consolidate';

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MINOR 2 (route-works != feature-works): the Knowledge page's
// Consolidate button dispatched op=consolidate and showed a static "session
// started" for 6s — it never read r.data.runId, never polled
// getAgentFixStatus(runId) to terminal, and never refreshed the KB health, so
// the operator got no completion / cleared-count / updated health (and the WI-4
// kb-maintain journey has nothing terminal to observe). The async poll logic is
// extracted to this pure-ish helper (deps injected) so it is unit-pinnable
// without SSR-driving the client page — the same pattern WI-2 used for
// resolveDevelopStartCeilingToSend.
// ---------------------------------------------------------------------------

const noSleep = async (): Promise<void> => {};

describe('runConsolidateToTerminal', () => {
  it('dispatches consolidate, reads runId, and polls that runId to a terminal state', async () => {
    const dispatchCalls: Array<[string, string]> = [];
    const pollCalls: Array<[string, string]> = [];
    // running, running, then cleared — proves it polls until terminal, not once.
    const states = ['running', 'running', 'cleared'] as const;
    let i = 0;

    const outcome = await runConsolidateToTerminal('kb-1', {
      sleep: noSleep,
      dispatch: async (id, op) => {
        dispatchCalls.push([id, op]);
        return { ok: true, data: { runId: 'run-xyz' } };
      },
      poll: async (id, runId) => {
        pollCalls.push([id, runId]);
        const state = states[Math.min(i, states.length - 1)];
        i++;
        return { ok: true, state, cleared: state === 'cleared' };
      },
    });

    // Dispatched exactly once, as a consolidate op, for the right KB.
    expect(dispatchCalls).toEqual([['kb-1', 'consolidate']]);
    // Polled the SAME runId the dispatch returned, more than once (to terminal).
    expect(pollCalls.length).toBe(3);
    for (const [id, runId] of pollCalls) {
      expect(id).toBe('kb-1');
      expect(runId).toBe('run-xyz');
    }
    // Honest terminal outcome carried back for the UI to render.
    expect(outcome).toEqual({ ok: true, runId: 'run-xyz', state: 'cleared', cleared: true });
  });

  it('carries a not-cleared terminal through honestly (some findings remain)', async () => {
    const outcome = await runConsolidateToTerminal('kb-2', {
      sleep: noSleep,
      dispatch: async () => ({ ok: true, data: { runId: 'r2' } }),
      poll: async () => ({ ok: true, state: 'not-cleared', cleared: false }),
    });
    expect(outcome).toEqual({ ok: true, runId: 'r2', state: 'not-cleared', cleared: false });
  });

  it('surfaces a failed-run terminal (the repair phase threw) as state:failed', async () => {
    const outcome = await runConsolidateToTerminal('kb-3', {
      sleep: noSleep,
      dispatch: async () => ({ ok: true, data: { runId: 'r3' } }),
      poll: async () => ({ ok: true, state: 'failed', cleared: false }),
    });
    expect(outcome).toEqual({ ok: true, runId: 'r3', state: 'failed', cleared: false });
  });

  it('returns an error outcome (never polls) when the dispatch fails', async () => {
    let polled = false;
    const outcome = await runConsolidateToTerminal('kb-4', {
      sleep: noSleep,
      dispatch: async () => ({ ok: false, error: 'no bridge configured' }),
      poll: async () => {
        polled = true;
        return { ok: true, state: 'cleared', cleared: true };
      },
    });
    expect(polled).toBe(false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe('no bridge configured');
  });

  it('returns an error outcome when the dispatch omits a runId', async () => {
    const outcome = await runConsolidateToTerminal('kb-5', {
      sleep: noSleep,
      dispatch: async () => ({ ok: true, data: {} }),
      poll: async () => ({ ok: true, state: 'cleared', cleared: true }),
    });
    expect(outcome.ok).toBe(false);
  });

  it('stops at the bounded budget and reports the still-running state honestly', async () => {
    let polls = 0;
    const outcome = await runConsolidateToTerminal('kb-6', {
      sleep: noSleep,
      maxAttempts: 3,
      dispatch: async () => ({ ok: true, data: { runId: 'r6' } }),
      poll: async () => {
        polls++;
        return { ok: true, state: 'running', cleared: false };
      },
    });
    expect(polls).toBe(3);
    expect(outcome).toEqual({ ok: true, runId: 'r6', state: 'running', cleared: false });
  });
});
