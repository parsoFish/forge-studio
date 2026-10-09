/**
 * forge-nk1y.4 — the plan card shows the RUN CEILING the scheduler enforces,
 * labelled as a ceiling, with the estimate shown separately.
 *
 * Stranger attempt 2 (Q3/Q5): the card read "cap $5"; that was the architect's
 * `cost_budget_usd` (an estimate), the run's ceiling was 1.5× it, and planning
 * spend counted against it — the run "Stopped on budget — $4.76 of $3.75" with
 * nothing on the card saying so. The chip now renders the one derivation the
 * run and its stop read (`resolveRunCeiling`, @forge/kernel).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPlanHtml } from '../../kinds/architect-plan-html.ts';
import type { ArchitectSession, ProposedInitiative } from '../../kinds/architect-plan.ts';

function init(over: Partial<ProposedInitiative> = {}): ProposedInitiative {
  return {
    initiative_id: 'INIT-2026-10-09-min-commits-filter',
    project: 'gitpulse',
    project_repo_path: '/tmp/projects/gitpulse',
    title: 'min-commits filter',
    iteration_budget: 5,
    cost_budget_usd: 2.5,
    class: 'code',
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    body: '# min-commits filter\n',
    ...over,
  };
}

function session(i: ProposedInitiative): ArchitectSession {
  return {
    session_id: '2026-10-09T09-44-00',
    project: 'gitpulse',
    project_repo_path: '/tmp/projects/gitpulse',
    vision: 'Filter authors below a commit count.',
    brain_context: [],
    council: { flags: [], escalations: [], perCritic: [], totalCostUsd: 0 },
    initiatives: [i],
  } as unknown as ArchitectSession;
}

function chips(html: string): string {
  const m = html.match(/<div class="init-chips">([\s\S]*?)<\/div>/);
  assert.ok(m, 'the initiative card renders its chips');
  return m[1].replace(/\s+/g, ' ').trim();
}

test('derived: the stranger\'s $2.50 estimate shows a $3.75 CEILING chip and a separate estimate chip — never "cap"', () => {
  const html = renderPlanHtml(session(init()), {});
  const c = chips(html);
  assert.match(c, /data-run-ceiling-usd="3\.75" data-run-ceiling-source="derived"/);
  assert.match(c, />ceiling <strong>\$3\.75<\/strong>/);
  assert.match(c, /data-cost-estimate-usd="2\.5">estimate <strong>\$2\.5<\/strong>/);
  assert.doesNotMatch(c, /\bcap\b/, 'the estimate is never labelled as the cap');
});

test('env: FORGE_COST_CEILING_USD on this Studio is the ceiling the chip shows (it wins at the run too)', () => {
  const c = chips(renderPlanHtml(session(init()), { FORGE_COST_CEILING_USD: '30' }));
  assert.match(c, /data-run-ceiling-usd="30" data-run-ceiling-source="env"/);
  assert.match(c, /estimate <strong>\$2\.5<\/strong>/);
});

test('the footer says planning spend counts against the ceiling, and names the env tier', () => {
  const html = renderPlanHtml(session(init()), {});
  assert.match(html, /Planning spend counts against it/);
  assert.match(html, /<code>FORGE_COST_CEILING_USD<\/code> when set/);
  assert.match(html, /<code>cost_budget_usd<\/code> plus 50%/);
});
