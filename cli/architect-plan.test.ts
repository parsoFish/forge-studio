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
  extractGwtBlocks,
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

// ---------------------------------------------------------------------------
// 17. W7-B7 (artifact-plan-29) — extractGwtBlocks must parse the GWT shape the
// architect ACTUALLY emits: bold-markdown prose (`**Given** …` on its own line
// or all three clauses inline), not just the YAML-ish `given:` key style. The
// old YAML-only regex returned [] on 100% of real plans, so every PLAN the
// operator was asked to approve read "No GWT blocks parsed".
// ---------------------------------------------------------------------------

test('extractGwtBlocks: multi-line bold-markdown prose (the real architect output — demo-project 2026-08-18)', () => {
  const body = [
    '## Acceptance criteria',
    '',
    '**Given** the forge CLI is invoked as `forge --version` from any working directory,  ',
    '**When** the process runs,  ',
    '**Then** it prints the bare semver string to stdout and exits 0.',
    '',
    '**Given** a test `cli/version.test.ts` is added,  ',
    '**When** the test suite runs,  ',
    '**Then** the test passes.',
  ].join('\n');
  const blocks = extractGwtBlocks(body);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].given, 'the forge CLI is invoked as `forge --version` from any working directory');
  assert.equal(blocks[0].when, 'the process runs');
  assert.equal(blocks[0].then, 'it prints the bare semver string to stdout and exits 0.');
});

test('extractGwtBlocks: single-line inline triple (betterado 2026-07-01 shape)', () => {
  const body = '**Given** the acceptance tests, **When** live evidence captured, **Then** `CaptureLiveEvidence` called; real REST GET in demo.json.';
  const blocks = extractGwtBlocks(body);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    given: 'the acceptance tests',
    when: 'live evidence captured',
    then: '`CaptureLiveEvidence` called; real REST GET in demo.json.',
  });
});

// W7-B7 review r1 hardening: bare (unbolded) keyword matching turned ORDINARY
// prose sentences that happen to start with Given/When/Then into fabricated
// GWT blocks rendered as review evidence at approval time. The architect's
// real shapes are BOLD (`**Given** …`) or YAML keys — bold (or the YAML key)
// is the intent signal, so bare prose must never parse.
test('extractGwtBlocks: bare Given/When/Then prose sentences do NOT fabricate GWT blocks', () => {
  const body = [
    'Given the SDK constraints, we chose approach B.',
    'When running in CI, the flag is ignored.',
    'Then the reviewer sees both paths.',
  ].join('\n');
  assert.deepEqual(extractGwtBlocks(body), [], 'prose that merely starts with the keywords is not an acceptance criterion');
});

test('extractGwtBlocks: a bolded Given followed by bare prose lines stays incomplete (no block)', () => {
  const body = ['**Given** a real criterion opener,', 'When this prose line is unbolded, it is not the WHEN clause.'].join('\n');
  assert.deepEqual(extractGwtBlocks(body), []);
});

test('extractGwtBlocks: YAML key style keeps parsing (no regression), and mixed docs collect both', () => {
  const body = [
    '- given: "X exists"',
    '  when:  "Y happens"',
    '  then:  "Z is observable"',
    '',
    '**Given** prose condition,',
    '**When** prose action,',
    '**Then** prose outcome.',
  ].join('\n');
  const blocks = extractGwtBlocks(body);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].given, 'X exists');
  assert.equal(blocks[1].given, 'prose condition');
});

test('extractGwtBlocks: a body with no GWT of any shape returns []', () => {
  assert.deepEqual(extractGwtBlocks('# Just a title\n\nSome prose about giving and taking.'), []);
});

// ---------------------------------------------------------------------------
// 17b. WI-7a (regate row artifact-plan-29, still open) — the REAL architect
// writes acceptance criteria as PLAIN prose under `### AC-N` headings inside a
// `## Acceptance criteria` section, not bold. The W7-B7 bold-required
// hardening (above) made that real shape parse to []. Context — the
// acceptance-criteria section, not bolding — is now the intent signal that
// admits a plain Given/When/Then clause run.
// ---------------------------------------------------------------------------

test('extractGwtBlocks: plain prose under `## Acceptance criteria` / `### AC-N` headings parses (the REAL architect shape)', () => {
  const body = [
    '## Acceptance criteria',
    '',
    '### AC-1 — make docs exits 0; registry docs use new array syntax',
    '',
    'Given `make docs` (tfplugindocs or equivalent),',
    'When run after the framework resources are registered,',
    'Then `docs/resources/betterado_release_definition.md` are regenerated. `make docs` exits 0.',
    '',
    '### AC-3 — make test + lint green',
    '',
    'Given all doc/example changes,',
    'When `make test` (no `TF_ACC`) + `golangci-lint run ./...` + `make terrafmt-check`,',
    'Then all exit 0.',
  ].join('\n');
  const blocks = extractGwtBlocks(body);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].given, '`make docs` (tfplugindocs or equivalent)');
  assert.equal(blocks[0].when, 'run after the framework resources are registered');
  assert.equal(blocks[0].then, '`docs/resources/betterado_release_definition.md` are regenerated. `make docs` exits 0.');
  assert.equal(blocks[1].given, 'all doc/example changes');
  assert.equal(blocks[1].when, '`make test` (no `TF_ACC`) + `golangci-lint run ./...` + `make terrafmt-check`');
  assert.equal(blocks[1].then, 'all exit 0.');
});

test('extractGwtBlocks: a `### AC-N` block with Given + Then only (no When) parses one block with an empty `when`', () => {
  const body = [
    '## Acceptance criteria',
    '',
    '### AC-2 — examples/ updated to new HCL syntax',
    '',
    'Given files under `examples/resources/betterado_release_definition/` and `examples/resources/betterado_task_group/`,',
    'Then every `.tf` file uses the new array syntax and `make terrafmt-check` exits 0 against them.',
  ].join('\n');
  const blocks = extractGwtBlocks(body);
  assert.equal(blocks.length, 1);
  assert.equal(
    blocks[0].given,
    'files under `examples/resources/betterado_release_definition/` and `examples/resources/betterado_task_group/`',
  );
  assert.equal(blocks[0].when, '', 'When is genuinely absent from the source AC — must not be fabricated');
  assert.equal(
    blocks[0].then,
    'every `.tf` file uses the new array syntax and `make terrafmt-check` exits 0 against them.',
  );
});

test('renderPlanHtml: a Given+Then-only AC (no When) renders an em-dash for the missing clause, not a fabricated or blank cell', () => {
  const body = [
    '## Acceptance criteria',
    '',
    '### AC-2 — examples/ updated to new HCL syntax',
    '',
    'Given files under `examples/resources/betterado_release_definition/`,',
    'Then every `.tf` file uses the new array syntax.',
  ].join('\n');
  const html = renderPlanHtml(fxSession({ initiatives: [fxInitiative({ body })] }));
  assert.match(html, /files under `examples\/resources\/betterado_release_definition\/`/);
  assert.match(html, /every `\.tf` file uses the new array syntax\./);
  // The When cell renders the missing-clause em-dash, never an empty <td></td>
  // and never fabricated text.
  assert.match(html, /<td>—<\/td>/, 'missing When clause renders as an honest em-dash');
});

test('extractGwtBlocks: the SAME plain Given/When/Then lines OUTSIDE any acceptance-criteria context still do NOT parse (the context gate is real)', () => {
  const body = [
    '## Context',
    '',
    'Given `make docs` (tfplugindocs or equivalent),',
    'When run after the framework resources are registered,',
    'Then `docs/resources/betterado_release_definition.md` are regenerated. `make docs` exits 0.',
  ].join('\n');
  assert.deepEqual(
    extractGwtBlocks(body),
    [],
    'plain GWT prose outside an acceptance-criteria section must not fabricate a block, even when the text is identical to a real AC',
  );
});

test('extractGwtBlocks: the acceptance-criteria context CLOSES at the next same-or-higher heading that is not an AC-N heading', () => {
  const body = [
    '## Acceptance criteria',
    '',
    '### AC-1 — a real criterion',
    '',
    'Given a real criterion,',
    'When it runs,',
    'Then it passes.',
    '',
    '## Not in scope',
    '',
    'Given this is just prose in the out-of-scope section,',
    'When someone reads it,',
    'Then it must not be parsed as an AC.',
  ].join('\n');
  const blocks = extractGwtBlocks(body);
  assert.equal(blocks.length, 1, 'only the AC-1 block inside the still-open context parses');
  assert.equal(blocks[0].given, 'a real criterion');
  assert.equal(blocks[0].when, 'it runs');
  assert.equal(blocks[0].then, 'it passes.');
});

// Corpus fixture — copied verbatim from a REAL merged architect manifest
// (`_queue/done/INIT-2026-06-19-framework-docs-examples.md`, terraform-provider-betterado,
// betterado roadmap execution 2026-06-19). `_queue/` and `projects/` are
// gitignored operational state, so the body is copied into the fixture
// rather than read from disk at test time. 4 ACs: AC-1 and AC-3 have the
// full triple, AC-2 and AC-4 are Given+Then only (no When) — the exact shape
// this defect made invisible on the PLAN the operator was asked to approve.
const REAL_MANIFEST_AC_SECTION = [
  '## Context',
  '',
  'The v1.0.0 breaking change requires updated registry documentation and HCL examples. Current `docs/resources/betterado_release_definition.md`, `docs/resources/betterado_task_group.md`, and all files under `examples/` use the old block syntax. Consumers landing on the registry page after 1.0.0 must see the new array syntax. The project `roadmap.md` should record the remaining holistic SDKv2→framework migration as the documented follow-on.',
  '',
  '## Acceptance criteria',
  '',
  '### AC-1 — make docs exits 0; registry docs use new array syntax',
  '',
  'Given `make docs` (tfplugindocs or equivalent),',
  'When run after the framework resources are registered,',
  'Then `docs/resources/betterado_release_definition.md` and `docs/resources/betterado_task_group.md` are regenerated and contain example HCL using `stages = [{…}]` and `task = [{…}]` array syntax (not block syntax). `make docs` exits 0.',
  '',
  '### AC-2 — examples/ updated to new HCL syntax',
  '',
  'Given files under `examples/resources/betterado_release_definition/` and `examples/resources/betterado_task_group/`,',
  'Then every `.tf` file uses the new array syntax and `make terrafmt-check` exits 0 against them.',
  '',
  '### AC-3 — make test + lint green',
  '',
  'Given all doc/example changes,',
  'When `make test` (no `TF_ACC`) + `golangci-lint run ./...` + `make terrafmt-check`,',
  'Then all exit 0.',
  '',
  '### AC-4 — roadmap documents follow-on holistic migration',
  '',
  'Given `roadmap.md` (or `docs/roadmap.md`) in the project repo,',
  'Then it contains a section titled **Future: holistic terraform-plugin-framework migration** listing the remaining SDKv2 resources (`betterado_release_folder`, `betterado_release_definition_permissions`, and upstream-inherited resources) as phase-2 candidates, with a note that the mux scaffold from initiative 1 is the extension point.',
  '',
  '## Not in scope',
  '',
  '- Re-validating live acceptance tests (covered in initiatives 2, 3, 4).',
  '- Publishing the release tag (handled by the existing release process outside forge).',
  '- Migrating any additional resources beyond `release_definition` and `task_group`.',
].join('\n');

test('extractGwtBlocks: corpus fixture (real merged manifest) parses all 4 ACs — 2 full triples, 2 Given+Then-only', () => {
  const blocks = extractGwtBlocks(REAL_MANIFEST_AC_SECTION);
  assert.equal(blocks.length, 4, 'all 4 acceptance criteria parse, not just the full-triple ones');
  assert.equal(blocks[0].given, '`make docs` (tfplugindocs or equivalent)');
  assert.equal(blocks[0].when, 'run after the framework resources are registered');
  assert.ok(blocks[0].then.startsWith('`docs/resources/betterado_release_definition.md`'));
  // AC-2: Given + Then only, no When — must not be dropped, must not fabricate a When.
  assert.equal(
    blocks[1].given,
    'files under `examples/resources/betterado_release_definition/` and `examples/resources/betterado_task_group/`',
  );
  assert.equal(blocks[1].when, '');
  assert.ok(blocks[1].then.startsWith('every `.tf` file uses the new array syntax'));
  assert.equal(blocks[2].given, 'all doc/example changes');
  assert.equal(blocks[2].when, '`make test` (no `TF_ACC`) + `golangci-lint run ./...` + `make terrafmt-check`');
  assert.equal(blocks[2].then, 'all exit 0.');
  // AC-4: Given + Then only, no When.
  assert.equal(blocks[3].given, '`roadmap.md` (or `docs/roadmap.md`) in the project repo');
  assert.equal(blocks[3].when, '');
  assert.ok(blocks[3].then.startsWith('it contains a section titled'));
  // The "Not in scope" prose (also Given/When/Then-shaped-ish text is absent here,
  // but this pins that the context closed and no 5th block leaked in).
  assert.equal(blocks.length, 4);
});

// ---------------------------------------------------------------------------
// 18. W7-B7 (artifact-plan-30) — the PLAN's operator notice must point at the
// surface that exists (/artifact?run=_architect-<sid>&type=plan), not the
// retired /architect/<sid> screen (M7-4 / ADR-031).
// ---------------------------------------------------------------------------

test('renderPlanHtml: the review notice names the /artifact plan surface, never the retired /architect route', () => {
  const html = renderPlanHtml(fxSession({ session_id: '2026-05-24T00-00-00' }));
  assert.ok(html.includes('/artifact?run=_architect-2026-05-24T00-00-00&amp;type=plan'), 'notice points at the live artifact plan surface');
  assert.ok(!/\/architect\/2026-05-24T00-00-00/.test(html), 'no reference to the retired /architect/<sid> route remains');
});

test('renderPlanDoc: the PLAN.md operator note names the /artifact plan surface', () => {
  const md = renderPlanDoc(fxSession({ session_id: '2026-05-24T00-00-00' }));
  assert.ok(md.includes('/artifact?run=_architect-2026-05-24T00-00-00&type=plan'));
  assert.ok(!md.includes('/architect/2026-05-24T00-00-00'));
});

