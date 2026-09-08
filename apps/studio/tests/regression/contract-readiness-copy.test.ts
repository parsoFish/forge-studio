/**
 * `ContractReadiness` — ruling 169's honest readiness sentence (bead
 * `forge-8vfn.6.5`, second half).
 *
 * The create form used to promise a "contract-green" project and the readiness
 * panel said nothing about what creation had NOT done, so a project whose demo
 * skill and demo alignment were still owed read as finished. Ruling 169: a
 * project reads "contract: n unresolved · m agent-generated pending" until the
 * demo agent has run.
 *
 * Render-test convention, as `project-contract-panel-render.test.ts`'s header
 * states it: a `.test.ts` in `lib/`, asserted on `renderToStaticMarkup`. The
 * extension matters — `vitest.config.ts`'s `include` is
 * `['lib/**\/*.test.ts', 'components/**\/*.test.ts']`, so a `.test.tsx`
 * anywhere runs NOWHERE. Elements are therefore built with
 * `React.createElement`, never JSX.
 *
 * `ContractReadiness` is a pure function component — no `useEffect`, no
 * `useState` — so static markup is its whole output.
 *
 * NO NEW `data-*` KEY, deliberately. `ContractResolutionPanel` already carries
 * the machine-readable form (`data-resolution-failing-count`,
 * `-agent-count`); a second copy here would put one fact in two places and
 * oblige a journey update for a sentence.
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContractReadiness } from '@/components/studio/project-builder/ContractReadiness';
import type { PreflightClause, PreflightResult } from '@/lib/studio-client';

/** A contract whose five UI checks all pass, so the counts are the only variable. */
const FILLED = {
  northStar: 'A tool that reports how long each build stage took.',
  instructions: 'Managed by forge.',
  demoSteps: [
    { kind: 'capture' as const, text: 'before' },
    { kind: 'verify' as const, text: 'after' },
  ],
  skills: ['cli-conventions'],
  kb: 'story-s2',
};

function clause(id: string, pass: boolean, resolution?: PreflightClause['resolution']): PreflightClause {
  return { id, title: id, hard: false, pass, detail: '', ...(resolution ? { resolution } : {}) };
}

function render(preflight: PreflightResult | null): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(ContractReadiness as any, { ...FILLED, preflight }));
}

test('ruling 169: the panel names both numbers while clauses are open, and says which an agent owes', () => {
  const html = render({
    ready: false,
    clauses: [clause('C1', true), clause('DEMO-SKILL', false, 'agent'), clause('DEMO-ALIGN', false, 'agent')],
  });
  expect(html).toContain('contract: 2 unresolved · 2 agent-generated pending');
});

test('the agent tier is a SUBSET of unresolved, never a second total', () => {
  const html = render({
    ready: false,
    clauses: [clause('DEMO-SKILL', false, 'agent'), clause('C6', false, 'user'), clause('C2', false, 'auto')],
  });
  expect(html).toContain('contract: 3 unresolved · 1 agent-generated pending');
});

test('a finished contract says nothing — a count of zero is not a sentence worth rendering', () => {
  const html = render({ ready: true, clauses: [clause('C1', true), clause('C6', true)] });
  expect(html).not.toContain('unresolved');
});

test('pending is not zero: while preflight has not answered, the panel makes no claim about what is open', () => {
  const html = render(null);
  expect(html).not.toContain('unresolved');
});
