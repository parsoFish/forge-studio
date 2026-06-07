/**
 * Tests for orchestrator/architect-plan.ts — the PLAN.md operator artefact
 * renderer + feedback-comment parser. Stage S2A.
 *
 * Conventions:
 *  - Every test that touches disk uses a fresh `mkdtempSync` dir; nothing
 *    bleeds into the real `_queue/pending/` (per the destructive-instruction
 *    preserve-intent rule).
 *  - C19 (informational-only aggregate footprint) is pinned by an explicit
 *    no-language-from-this-set assertion.
 *  - ARCH-4: C27 type discriminator + exploration fields removed (dead paths);
 *    tests assert the dead paths no longer appear in output.
 *  - C12 path layout: writePlanDoc emits exactly the path documented in
 *    contracts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  renderPlanDoc,
  renderPlanHtml,
  writePlanDoc,
  type ArchitectSession,
  type ProposedInitiative,
  type CouncilTranscript,
} from './architect-plan.ts';
// Note: ExplorationFields, ProjectMetrics, InitiativeType removed (ARCH-4).
// Note: ProposedFeature + features[] removed (no-feature model, 2026-06-04).

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function fxTempdir(label: string): string {
  return mkdtempSync(join(tmpdir(), `forge-arch-plan-${label}-`));
}

function fxInitiative(overrides: Partial<ProposedInitiative> = {}): ProposedInitiative {
  return {
    initiative_id: 'INIT-2026-05-23-sample-init',
    project: 'sample',
    project_repo_path: '/tmp/projects/sample',
    title: 'Sample initiative',
    iteration_budget: 5,
    cost_budget_usd: 1.0,
    estimated_cost_usd: 0.25,
    body: '# Sample initiative\n\nThis is the manifest body.\n\n## Acceptance criteria\n\n- given: "X exists"\n  when:  "Y happens"\n  then:  "Z is observable"\n',
    ...overrides,
  };
}

function fxCouncilTranscript(overrides: Partial<CouncilTranscript> = {}): CouncilTranscript {
  return {
    flags: [],
    escalations: [],
    perCritic: [],
    totalCostUsd: 0,
    ...overrides,
  };
}

function fxSession(overrides: Partial<ArchitectSession> = {}): ArchitectSession {
  return {
    session_id: '2026-05-23T10-15-00',
    project: 'sample',
    project_repo_path: '/tmp/projects/sample',
    vision: 'Add a sample feature for testing.',
    brain_context: [
      { path: 'brain/projects/sample/profile.md', summary: 'Project profile with taste signals.' },
    ],
    council: fxCouncilTranscript(),
    initiatives: [fxInitiative()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. renderPlanDoc — basic shape
// ---------------------------------------------------------------------------

test('renderPlanDoc: produces a markdown document with all required sections', () => {
  const session = fxSession();
  const doc = renderPlanDoc(session);
  assert.match(doc, /^# Architect plan — 2026-05-23T10-15-00/m);
  // Cwc Amendment 1: brief + interview section
  assert.match(doc, /## Operator brief \+ interview/);
  assert.match(doc, /## Brain context/);
  assert.match(doc, /## Proposed initiatives/);
  assert.match(doc, /## Aggregate footprint/);
  // Council transcript and open escalations sections removed (MVP per MVUS).
  assert.ok(!/## Council transcript/.test(doc), 'Council transcript must not appear in rendered PLAN.md');
  assert.ok(!/## Open escalations/.test(doc), 'Open escalations must not appear in rendered PLAN.md');
  // ARCH-4: verdict placeholder removed (verdict via UI bridge, not PLAN.md annotation)
  assert.ok(!/<!-- verdict:/.test(doc), 'VERDICT_PLACEHOLDER must not appear in rendered PLAN.md');
});

// ---------------------------------------------------------------------------
// 2. renderPlanDoc — embeds the manifest body verbatim
// ---------------------------------------------------------------------------

test('renderPlanDoc: embeds each proposed initiative manifest body verbatim', () => {
  const init = fxInitiative({
    initiative_id: 'INIT-2026-05-23-sample-x',
    body: '# Custom body marker\n\nSomething unique 9d7a-b3e2.\n',
  });
  const doc = renderPlanDoc(fxSession({ initiatives: [init] }));
  assert.match(doc, /Something unique 9d7a-b3e2/);
  assert.match(doc, /INIT-2026-05-23-sample-x/);
});

// ---------------------------------------------------------------------------
// 3. renderPlanDoc — C19 informational-only aggregate footprint
// ---------------------------------------------------------------------------

test('renderPlanDoc: aggregate footprint is informational only (C19 — no gate language)', () => {
  // Synthesise 20 initiatives to mimic the betterado drop.
  const initiatives: ProposedInitiative[] = [];
  for (let i = 1; i <= 20; i++) {
    initiatives.push(fxInitiative({
      initiative_id: `INIT-2026-05-23-bett-${String(i).padStart(2, '0')}`,
      title: `Initiative ${i}`,
      iteration_budget: 10,
      estimated_cost_usd: 26.7, // ≈$534 across 20
    }));
  }
  const doc = renderPlanDoc(fxSession({ project: 'betterado', initiatives }));
  // The footprint line must be present
  assert.match(doc, /## Aggregate footprint/);
  assert.match(doc, /informational/i, 'aggregate footprint frames itself as informational');
  // Total iteration budget surfaces
  assert.match(doc, /200/, 'rendered aggregate iteration budget (20 × 10)');
  // Total estimated cost surfaces (any of $534 / 534 / 533/534)
  assert.match(doc, /\$5\d\d/, 'rendered aggregate estimated cost (≈$534)');

  // The forbidden vocabulary (C19) must NOT appear in the footprint section.
  // Slice the doc to just the footprint section so we don't false-positive
  // on the proposed-initiatives table (which legitimately may use other terms).
  const footprintStart = doc.indexOf('## Aggregate footprint');
  const nextSection = doc.indexOf('\n## ', footprintStart + 1);
  const footprintBlock = doc.slice(footprintStart, nextSection >= 0 ? nextSection : undefined);
  assert.ok(!/\bgate\b/i.test(footprintBlock), `footprint block must not say "gate":\n${footprintBlock}`);
  assert.ok(!/\bthreshold\b/i.test(footprintBlock), `footprint block must not say "threshold":\n${footprintBlock}`);
  assert.ok(!/auto-?escalat/i.test(footprintBlock), `footprint block must not propose auto-escalation:\n${footprintBlock}`);
  assert.ok(!/aggregate_budget_declared/.test(footprintBlock), `footprint block must not reference the removed bench criterion:\n${footprintBlock}`);
});

// ---------------------------------------------------------------------------
// 4. ARCH-4: C27 exploration discriminator removed — renderPlanDoc no longer
// accepts type/exploration fields. Validate the dead paths are truly gone.
// ---------------------------------------------------------------------------

test('renderPlanDoc: no exploration/C27 fields in rendered output (ARCH-4 — dead paths removed)', () => {
  const doc = renderPlanDoc(fxSession());
  assert.ok(!/parameter_space/.test(doc), 'exploration parameter_space must not appear');
  assert.ok(!/hypothesis/.test(doc), 'exploration hypothesis must not appear');
  assert.ok(!/metric_command/.test(doc), 'exploration metric_command must not appear');
  assert.ok(!/locked_baselines/.test(doc), 'exploration locked_baselines must not appear');
  assert.ok(!/## Project metrics/.test(doc), 'C26 project_metrics must not appear (ARCH-4)');
});

// ---------------------------------------------------------------------------
// 7. writePlanDoc — C12 location
// ---------------------------------------------------------------------------

test('writePlanDoc: writes to <projectRoot>/_architect/<session-id>/PLAN.md per C12', () => {
  const dir = fxTempdir('w1');
  const projectRoot = join(dir, 'project-x');
  mkdirSync(projectRoot, { recursive: true });
  const session = fxSession({ session_id: '2026-05-23T11-22-33', project: 'project-x' });
  const path = writePlanDoc(session, projectRoot);
  assert.equal(path, resolve(projectRoot, '_architect', '2026-05-23T11-22-33', 'PLAN.md'));
  assert.ok(existsSync(path), 'PLAN.md was written');
  const body = readFileSync(path, 'utf8');
  assert.match(body, /# Architect plan — 2026-05-23T11-22-33/);
});

// ---------------------------------------------------------------------------
// 11. renderPlanDoc — brain context appears with greppable paths
// ---------------------------------------------------------------------------

test('renderPlanDoc: brain-context section lists every brain path + summary', () => {
  const session = fxSession({
    brain_context: [
      { path: 'brain/projects/sample/profile.md', summary: 'Project profile.' },
      { path: 'brain/cycles/themes/pr-as-sole-review-window.md', summary: 'PR is the review window.' },
    ],
  });
  const doc = renderPlanDoc(session);
  assert.match(doc, /brain\/projects\/sample\/profile\.md/);
  assert.match(doc, /Project profile/);
  assert.match(doc, /brain\/cycles\/themes\/pr-as-sole-review-window\.md/);
  assert.match(doc, /PR is the review window/);
});

// ---------------------------------------------------------------------------
// 12. writePlanDoc → re-read preserves the manifest body verbatim
// ---------------------------------------------------------------------------

test('writePlanDoc: the written PLAN.md preserves the manifest body verbatim', () => {
  const dir = fxTempdir('rt2');
  const projectRoot = join(dir, 'proj');
  mkdirSync(projectRoot, { recursive: true });
  const session = fxSession({ session_id: '2026-05-23T20-00-00' });
  const planPath = writePlanDoc(session, projectRoot);
  const written = readFileSync(planPath, 'utf8');
  assert.match(written, /This is the manifest body\./);
});

// ---------------------------------------------------------------------------
// 13. renderPlanDoc — multi-initiative table with depends-on edges
// ---------------------------------------------------------------------------

test('renderPlanDoc: proposed-initiatives table lists each initiative and dependency edges', () => {
  const session = fxSession({
    initiatives: [
      fxInitiative({ initiative_id: 'INIT-2026-05-23-a-foo', title: 'Foo' }),
      fxInitiative({
        initiative_id: 'INIT-2026-05-23-a-bar',
        title: 'Bar',
        depends_on_initiatives: ['INIT-2026-05-23-a-foo'],
      }),
    ],
  });
  const doc = renderPlanDoc(session);
  assert.match(doc, /INIT-2026-05-23-a-foo/);
  assert.match(doc, /INIT-2026-05-23-a-bar/);
  // Dependency edge surfaces in the table
  assert.match(doc, /INIT-2026-05-23-a-bar.*INIT-2026-05-23-a-foo/);
});

// ---------------------------------------------------------------------------
// 14. Cwc Amendment 1 — Operator brief + interview section
// ---------------------------------------------------------------------------

test('renderPlanDoc: empty interview rounds renders an "operator drafted directly" notice', () => {
  const doc = renderPlanDoc(fxSession({ interview: [] }));
  assert.match(doc, /## Operator brief \+ interview/);
  assert.match(doc, /### Interview/);
  assert.match(doc, /No interview rounds — operator drafted directly/);
});

test('renderPlanDoc: omitted interview field renders the same notice (defaults to no rounds)', () => {
  // Fixture has no `interview` field by default
  const doc = renderPlanDoc(fxSession());
  assert.match(doc, /No interview rounds — operator drafted directly/);
});

test('renderPlanDoc: interview rounds render as a Q&A table with operator answers', () => {
  const session = fxSession({
    interview: [
      { question: 'What is the scope edge?', answer: 'INIT-01 only; defer the rest.' },
      { question: 'What signals success?', answer: 'release_definition tests pass on first cycle.' },
      { question: 'Any prior attempts?', answer: '[operator skipped]' },
    ],
  });
  const doc = renderPlanDoc(session);
  // Table header present
  assert.match(doc, /\| # \| Question \| Operator answer \|/);
  // Each round surfaces both Q and A
  assert.match(doc, /What is the scope edge\?/);
  assert.match(doc, /INIT-01 only; defer the rest\./);
  assert.match(doc, /What signals success\?/);
  assert.match(doc, /release_definition tests pass on first cycle\./);
  assert.match(doc, /Any prior attempts\?/);
  assert.match(doc, /\[operator skipped\]/);
});

test('renderPlanDoc: interview answers containing | are escaped so the markdown table stays valid', () => {
  const session = fxSession({
    interview: [
      { question: 'Pick one: A | B | C?', answer: 'option | B' },
    ],
  });
  const doc = renderPlanDoc(session);
  // Pipes inside cells are escaped with backslash so the table parses
  assert.match(doc, /Pick one: A \\\| B \\\| C\?/);
  assert.match(doc, /option \\\| B/);
});

// ---------------------------------------------------------------------------
// 15. Cwc Amendment 2 — renderPlanHtml smoke + structural
// ---------------------------------------------------------------------------

test('renderPlanHtml: produces a self-contained HTML document with no external links', () => {
  const html = renderPlanHtml(fxSession());
  // Well-formed doctype + html
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<\/html>\s*$/);
  // Inline styles present, no external stylesheet
  assert.match(html, /<style>/);
  assert.ok(!/rel="stylesheet"/.test(html), 'no external stylesheet link');
  assert.ok(!/<script[^>]+src=/.test(html), 'no external script src');
  // Title carries session id + project
  assert.match(html, /<title>PLAN — 2026-05-23T10-15-00 — sample<\/title>/);
});

test('renderPlanHtml: renders initiative AC list instead of feature dep graph (no-feature model, 2026-06-04)', () => {
  const html = renderPlanHtml(fxSession({
    initiatives: [
      fxInitiative({
        initiative_id: 'INIT-2026-05-24-multi-ac',
        body: '## Substrate\n\n- given: "CI is red"\n  when:  "fmt is fixed"\n  then:  "checks pass"\n- given: "CI is green"\n  when:  "deployment gate is added"\n  then:  "pre-deploy checks run"\n',
      }),
    ],
  }));
  // Cycle diagram and old dep-graph MUST NOT be present
  assert.ok(!/class="cycle"/.test(html), 'cycle diagram must not be present');
  assert.ok(!/class="dep-graph"/.test(html), 'SVG dep-graph must not be present');
  assert.ok(!/Feature dependency graph/.test(html), 'feature dep graph title must not be present');
  // AC list IS rendered
  assert.match(html, /Acceptance criteria/);
  assert.match(html, /class="ac-list-wrap"/);
  assert.match(html, /class="ac-table"/);
  // GWT blocks surface in the table
  assert.match(html, /CI is red/);
  assert.match(html, /fmt is fixed/);
  assert.match(html, /checks pass/);
});

test('renderPlanHtml: single-AC initiative renders AC list with one row', () => {
  const html = renderPlanHtml(fxSession({
    initiatives: [
      fxInitiative({
        initiative_id: 'INIT-2026-05-24-single-ac',
        body: '## Single\n\n- given: "system is ready"\n  when:  "request arrives"\n  then:  "response is 200"\n',
      }),
    ],
  }));
  assert.ok(!/class="dep-graph"/.test(html), 'SVG dep-graph must not be present');
  assert.match(html, /class="ac-table"/);
  assert.match(html, /system is ready/);
  assert.match(html, /request arrives/);
  assert.match(html, /response is 200/);
});

test('renderPlanHtml: multi-initiative session renders one AC list per initiative with initiative-id chrome', () => {
  const html = renderPlanHtml(fxSession({
    initiatives: [
      fxInitiative({
        initiative_id: 'INIT-A',
        title: 'First initiative',
        body: '## A\n\n- given: "A condition"\n  when:  "A action"\n  then:  "A outcome"\n',
      }),
      fxInitiative({
        initiative_id: 'INIT-B',
        title: 'Second initiative',
        body: '## B\n\n- given: "B condition"\n  when:  "B action"\n  then:  "B outcome"\n',
      }),
    ],
  }));
  // No SVG dep-graphs
  assert.ok(!/class="dep-graph"/.test(html), 'no SVG dep-graphs in multi-initiative output');
  // Two AC list wrappers (one per initiative)
  const acListCount = (html.match(/class="ac-list-wrap"/g) ?? []).length;
  assert.equal(acListCount, 2, 'expected one ac-list-wrap per initiative');
  // Each initiative-id appears (title chrome)
  assert.match(html, /INIT-A/);
  assert.match(html, /INIT-B/);
  // AC content surfaces
  assert.match(html, /A condition/);
  assert.match(html, /B condition/);
});

test('renderPlanHtml: surfaces vision + interview rounds as a table', () => {
  const html = renderPlanHtml(fxSession({
    vision: 'A bill-splitting app for friends.',
    interview: [
      { question: 'Login required?', answer: 'No — link-based only.' },
      { question: 'Settle up flow?', answer: 'Single tap, no currencies.' },
    ],
  }));
  assert.match(html, /A bill-splitting app for friends\./);
  assert.match(html, /<th>Question<\/th>/);
  assert.match(html, /Login required\?/);
  assert.match(html, /link-based only/);
  assert.match(html, /Settle up flow\?/);
  assert.match(html, /Single tap, no currencies\./);
});

test('renderPlanHtml: empty interview renders the "operator drafted directly" notice', () => {
  const html = renderPlanHtml(fxSession({ interview: [] }));
  assert.match(html, /No interview rounds — operator drafted directly\./);
  // The Q&A table should NOT be present in the interview section
  // (the council escalations section may still have <tr> elements, so we
  // can't assert globally — but the interview heading + empty-class notice is enough)
  assert.match(html, /<p class="empty">No interview rounds/);
});

test('renderPlanHtml: aggregate footprint renders a stacked bar with one segment per initiative', () => {
  const initiatives: ProposedInitiative[] = [];
  for (let i = 1; i <= 4; i++) {
    initiatives.push(fxInitiative({
      initiative_id: `INIT-2026-05-23-aggr-${i}`,
      iteration_budget: i,
    }));
  }
  const html = renderPlanHtml(fxSession({ initiatives }));
  // Section header carries the informational badge per C19
  assert.match(html, /Aggregate footprint <span class="badge">informational<\/span>/);
  // One <div class="seg"> per initiative (4 initiatives → 4 segments)
  const segs = html.match(/<div class="seg"/g) ?? [];
  assert.equal(segs.length, 4, `expected 4 stacked-bar segments, got ${segs.length}`);
  // Informational framing visible in the body (uses C19-safe vocabulary per
  // S2A-DECISIONS §11: avoids the words "gate", "threshold",
  // "auto-escalate/auto-escalation", and "aggregate_budget_declared" — even
  // in plain prose).
  assert.match(html, /Informational only\./);
  assert.match(html, /Forge does not enforce a budget or block at any number/);
  assert.match(html, /the operator decides/);
});

test('renderPlanHtml: C19 — aggregate footprint section uses none of the forbidden vocabulary', () => {
  const html = renderPlanHtml(fxSession({
    initiatives: [
      fxInitiative({ initiative_id: 'INIT-X-1', estimated_cost_usd: 100 }),
      fxInitiative({ initiative_id: 'INIT-X-2', estimated_cost_usd: 200 }),
    ],
  }));
  // Slice the footprint block from <h2>Aggregate footprint to the next <h2>
  const footprintStart = html.indexOf('Aggregate footprint');
  const nextH2 = html.indexOf('<h2', footprintStart + 1);
  const block = html.slice(footprintStart, nextH2 >= 0 ? nextH2 : html.length);
  assert.ok(!/\bthreshold\b/i.test(block), `footprint block must not say "threshold":\n${block}`);
  assert.ok(!/auto-?escalat/i.test(block), `footprint block must not propose auto-escalation:\n${block}`);
  assert.ok(!/aggregate_budget_declared/.test(block), `footprint block must not reference removed bench criterion:\n${block}`);
});

test('renderPlanHtml: no exploration/C27 fields in output (ARCH-4 — dead paths removed)', () => {
  // Verifies the dead render paths for type/exploration are truly gone.
  const html = renderPlanHtml(fxSession());
  assert.ok(!/exploration/.test(html), 'exploration render path must not appear');
  assert.ok(!/parameter_space/.test(html), 'parameter_space must not appear');
  assert.ok(!/locked_baselines/.test(html), 'locked_baselines must not appear');
  assert.ok(!/Project metrics/.test(html), 'project_metrics C26 block must not appear');
  assert.ok(!/Initiative type/.test(html), 'Initiative type meta line must not appear');
});


test('renderPlanHtml: HTML-escapes operator content so manifest body cannot break the page', () => {
  const html = renderPlanHtml(fxSession({
    vision: 'Build <thing> with "quotes" & ampersands.',
    initiatives: [fxInitiative({
      body: '# Title <h1> attack\n\n<script>alert("xss")</script>\nNormal content.\n',
    })],
  }));
  // Vision is escaped
  assert.match(html, /Build &lt;thing&gt; with &quot;quotes&quot; &amp; ampersands\./);
  // Manifest body is escaped — the literal "<script>" must NOT appear as raw HTML
  assert.ok(!/<script>alert\("xss"\)<\/script>/.test(html), 'XSS-style content must be escaped');
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
});

// ---------------------------------------------------------------------------
// 16. writePlanDoc — emits PLAN.html sibling next to PLAN.md (Amendment 2)
// ---------------------------------------------------------------------------

test('writePlanDoc: writes PLAN.html sibling alongside PLAN.md', () => {
  const dir = fxTempdir('w2');
  const projectRoot = join(dir, 'project-y');
  mkdirSync(projectRoot, { recursive: true });
  const session = fxSession({ session_id: '2026-05-24T00-00-00', project: 'project-y' });
  const planPath = writePlanDoc(session, projectRoot);

  const sessionDir = resolve(projectRoot, '_architect', '2026-05-24T00-00-00');
  assert.ok(existsSync(planPath), 'PLAN.md exists');
  assert.ok(existsSync(join(sessionDir, 'PLAN.html')), 'PLAN.html sibling exists');

  const html = readFileSync(join(sessionDir, 'PLAN.html'), 'utf8');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>PLAN — 2026-05-24T00-00-00 — project-y<\/title>/);
});

