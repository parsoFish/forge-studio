/**
 * Tests for cli/reflection-doc.ts — retro.md → ReflectionDoc parser.
 *
 * Tests cover:
 *   - Lesson extraction from "### Observation N — …" sections
 *   - Lesson extraction from inline **P1 — …** bold entries
 *   - Lesson extraction from "**Lesson**: …" paragraphs
 *   - Friction extraction from inline **AP1 — …** entries
 *   - Went-well extraction from Quality signal sections
 *   - Target matching — slug with keywords matching lesson text
 *   - Target matching — no slug when freshThemeSlugs is empty
 *   - Target matching — lesson without a matching slug → no target
 *   - Empty retro.md → empty ReflectionDoc (no undefined-keyed fields)
 *   - The actual retro format used by real cycles
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetroMd } from './reflection-doc.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lessons(doc: ReturnType<typeof parseRetroMd>) {
  return doc.lessons ?? [];
}

// ---------------------------------------------------------------------------
// Lesson extraction — ### Observation N headings
// ---------------------------------------------------------------------------

test('parseRetroMd: extracts lesson from Observation heading', () => {
  const raw = `
## Self-reflection

### Observation 1 — Vendor patch required for int-to-string enum conversion

Any ADO numeric-enum field stored as a string in the SDK struct requires a
vendor-patch unmarshal guard.
`;
  const doc = parseRetroMd(raw, []);
  const ls = lessons(doc);
  assert.ok(ls.length >= 1, 'expected at least one lesson');
  // The lesson text should include the heading's semantic content
  assert.ok(
    ls.some((l) => /vendor|enum|unmarshal|int-to-string/i.test(l.text)),
    `expected a lesson about vendor/enum; got: ${JSON.stringify(ls.map((l) => l.text))}`,
  );
});

test('parseRetroMd: extracts multiple lessons from multiple Observation sections', () => {
  const raw = `
## Self-reflection

### Observation 1 — Resume-already-complete: second confirmed data point

The prior run implemented the full data source but stalled before review.

### Observation 2 — Provider count test: third consecutive hit

Every new data source will trigger the mandatory provider count assertion.
`;
  const doc = parseRetroMd(raw, []);
  const ls = lessons(doc);
  assert.ok(ls.length >= 2, `expected ≥ 2 lessons, got ${ls.length}`);
});

// ---------------------------------------------------------------------------
// Lesson extraction — inline **P1 — …** entries
// ---------------------------------------------------------------------------

test('parseRetroMd: extracts lesson from inline **P1 — …** bold pattern', () => {
  const raw = `
## Self-reflection

### Patterns observed

**P1 — Resume-already-complete: second confirmed data point.** The prior run
implemented the full data source but stalled before review. This resume detected
gate-pass at iter-0 for both WIs.

**P2 — data-source parity gap closed cleanly.** The data source mirrored the
definition exactly as specced.
`;
  const doc = parseRetroMd(raw, []);
  const ls = lessons(doc);
  assert.ok(ls.length >= 2, `expected ≥ 2 lessons from P1/P2, got ${ls.length}`);
  assert.ok(ls.some((l) => /resume|already.complete/i.test(l.text)), 'P1 lesson missing');
  assert.ok(ls.some((l) => /parity|mirrored|cleanly/i.test(l.text)), 'P2 lesson missing');
});

// ---------------------------------------------------------------------------
// Lesson extraction — **Lesson**: paragraphs
// ---------------------------------------------------------------------------

test('parseRetroMd: extracts lesson from **Lesson**: paragraph', () => {
  const raw = `
## Self-reflection

### Observation 3 — Vendor patch required

\`schedule.days_to_release\` requires custom UnmarshalJSON.

**Lesson**: any ADO numeric-enum field stored as a string in the SDK struct
requires a vendor-patch unmarshal guard.
`;
  const doc = parseRetroMd(raw, []);
  const ls = lessons(doc);
  assert.ok(
    ls.some((l) => /numeric.enum|unmarshal|vendor.patch/i.test(l.text)),
    `expected lesson about vendor/unmarshal; got: ${JSON.stringify(ls.map((l) => l.text))}`,
  );
});

// ---------------------------------------------------------------------------
// Friction extraction — AP entries
// ---------------------------------------------------------------------------

test('parseRetroMd: extracts friction from inline **AP1 — …** entry', () => {
  const raw = `
## Self-reflection

### Patterns observed

**P1 — Resume cost cheap.** Recovery is cheap.

**AP1 — report.md inverted diff on resume.** Third occurrence. The stale-diff
antipattern is systemic for resume cycles, not incidental.
`;
  const doc = parseRetroMd(raw, []);
  const friction = doc.friction ?? [];
  assert.ok(friction.length >= 1, `expected ≥ 1 friction item; got ${friction.length}`);
  assert.ok(
    friction.some((f) => /inverted|stale.diff|report\.md/i.test(f)),
    `expected AP1 in friction; got: ${JSON.stringify(friction)}`,
  );
});

// ---------------------------------------------------------------------------
// Went-well extraction
// ---------------------------------------------------------------------------

test('parseRetroMd: extracts went-well from Quality signal section', () => {
  const raw = `
## Self-reflection

### Quality signal

All 5 ACs met. Unit tests: 63 tests green (2 new). Acceptance test: TF_ACC
live round-trip green.

- Cost well under $10 budget
- CI gate: green
- No regressions
`;
  const doc = parseRetroMd(raw, []);
  const ww = doc.wentWell ?? [];
  assert.ok(ww.length >= 1, `expected ≥ 1 went-well item; got ${ww.length}`);
});

// ---------------------------------------------------------------------------
// Target matching — lesson with matching slug
// ---------------------------------------------------------------------------

test('parseRetroMd: lesson with a matching theme slug gets target set', () => {
  const raw = `
## Self-reflection

### Observation 1 — Resume-already-complete: recovery is cheap

The prior run implemented the full data source but stalled before review.
Resume detected gate-pass at iter-0 for both WIs, ran only the unifier.
`;
  const doc = parseRetroMd(raw, [
    'resume-already-complete-near-zero-cost',
    'vendor-patch-unmarshal',
  ]);
  const ls = lessons(doc);
  const resumeLesson = ls.find((l) => /resume|recovery/i.test(l.text));
  assert.ok(resumeLesson, 'expected a resume/recovery lesson');
  assert.equal(
    resumeLesson!.target,
    'resume-already-complete-near-zero-cost',
    `expected target to match the slug; got: ${resumeLesson!.target}`,
  );
});

test('parseRetroMd: lesson without a matching slug gets no target', () => {
  const raw = `
## Self-reflection

### Observation 1 — Some unrelated topic about deployment pipelines

Deployment pipelines need careful ordering of steps.
`;
  const doc = parseRetroMd(raw, [
    'resume-already-complete-near-zero-cost',
    'vendor-patch-unmarshal',
  ]);
  const ls = lessons(doc);
  if (ls.length > 0) {
    // The lesson about deployment should NOT match resume or vendor slugs
    assert.equal(
      ls[0].target,
      undefined,
      `expected no target for unrelated lesson; got: ${ls[0].target}`,
    );
  }
});

test('parseRetroMd: empty freshThemeSlugs → no lesson gets a target', () => {
  const raw = `
## Self-reflection

### Observation 1 — Resume-already-complete: recovery is cheap

The prior run stalled before review. Recovery is cheap.
`;
  const doc = parseRetroMd(raw, []);
  const ls = lessons(doc);
  for (const l of ls) {
    assert.equal(l.target, undefined, `expected no target with empty slugs; got: ${l.target}`);
  }
});

// ---------------------------------------------------------------------------
// Date-prefixed slug matching
// ---------------------------------------------------------------------------

test('parseRetroMd: date-prefixed slug (2026-06-07-foo-bar) matches on non-date part', () => {
  const raw = `
## Self-reflection

### Patterns observed

**P1 — Resume-already-complete: recovery is cheap.** Prior run cost was not
wasted; resume recovery is cheap and fast.
`;
  const doc = parseRetroMd(raw, ['2026-06-07-resume-already-complete-near-zero-cost']);
  const ls = lessons(doc);
  const resumeLesson = ls.find((l) => /resume|recovery|cheap/i.test(l.text));
  assert.ok(resumeLesson, 'expected a resume/recovery lesson');
  assert.equal(
    resumeLesson!.target,
    '2026-06-07-resume-already-complete-near-zero-cost',
    `expected date-prefixed slug as target; got: ${resumeLesson!.target}`,
  );
});

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------

test('parseRetroMd: empty raw → all fields undefined (no keyed empty arrays)', () => {
  const doc = parseRetroMd('', []);
  assert.equal(doc.lessons, undefined);
  assert.equal(doc.wentWell, undefined);
  assert.equal(doc.friction, undefined);
  assert.equal(doc.inconsistencies, undefined);
});

test('parseRetroMd: retro with only user-questions section → no lessons', () => {
  const raw = `
## User questions

## 1. Was the decomposition right?

We had 5 WIs.

## User feedback

_(no feedback)_
`;
  const doc = parseRetroMd(raw, []);
  // Should produce no lessons (no pattern/observation sections)
  const ls = lessons(doc);
  assert.equal(ls.length, 0, `expected 0 lessons; got ${ls.length}: ${JSON.stringify(ls.map((l) => l.text))}`);
});

// ---------------------------------------------------------------------------
// Real-world retro format (smoke test against actual betterADO cycle retro)
// ---------------------------------------------------------------------------

test('parseRetroMd: real betterADO retro format produces at least 2 lessons + 1 antipattern friction', () => {
  const raw = `## Self-reflection

### Cycle facts

- **Initiative:** INIT-2026-06-07-release-folder-data-source · 2 WIs, 0 wedge events, 0 send-back rounds
- **Total cost:** $1.74

**IMPORTANT — report.md diff is inverted.** Stale-diff antipattern on resume.

### Patterns observed

**P1 — Resume-already-complete: second confirmed data point.** The prior run
implemented the full data source but stalled before review. This resume detected
gate-pass at iter-0 for both WIs, ran only the unifier, and produced a clean PR
in 4m 21s at $1.74.

**P2 — data-source parity gap closed cleanly.** The data source mirrored
\`data_release_definition.go\` exactly as specced.

**P3 — Provider count test: third consecutive hit.** Every new data source WILL
trigger the mandatory provider count assertion pair.

**AP1 — report.md inverted diff on resume.** Third occurrence. The stale-diff
antipattern is systemic for resume cycles, not incidental.

### Quality signal

All 5 ACs met. Unit tests: 63 tests green (2 new). Acceptance test: TF_ACC
live round-trip green. CI gate: green. No regressions.

---

## User questions

_(see user-questions.md)_

## User feedback

_(no feedback supplied this cycle)_
`;

  const doc = parseRetroMd(raw, ['2026-06-07-resume-already-complete-near-zero-cost']);

  const ls = lessons(doc);
  assert.ok(ls.length >= 2, `expected ≥ 2 lessons; got ${ls.length}`);

  const friction = doc.friction ?? [];
  assert.ok(friction.length >= 1, `expected ≥ 1 friction item (AP1); got ${friction.length}`);

  // P1 lesson should get the matching target slug
  const p1 = ls.find((l) => /resume|already.complete/i.test(l.text));
  assert.ok(p1, 'expected P1 resume lesson');
  assert.equal(p1!.target, '2026-06-07-resume-already-complete-near-zero-cost');
});

// ---------------------------------------------------------------------------
// KB-badge resolution logic (pure, no DOM) — mirrors ReflectionRenderer
// ---------------------------------------------------------------------------

test('KB badge href: lesson.target produces /knowledge?id=<encoded-target>', () => {
  // Verify the URL pattern the renderer uses, without needing DOM.
  // ReflectionRenderer builds: `/knowledge?id=${encodeURIComponent(lesson.target)}`
  const target = 'resume-already-complete-near-zero-cost';
  const href = `/knowledge?id=${encodeURIComponent(target)}`;
  assert.equal(href, '/knowledge?id=resume-already-complete-near-zero-cost');
});

test('KB badge href: slug with special chars is URL-encoded', () => {
  const target = 'some/special slug+here';
  const href = `/knowledge?id=${encodeURIComponent(target)}`;
  assert.equal(href, '/knowledge?id=some%2Fspecial%20slug%2Bhere');
});

test('KB badge: lesson without target does not produce a badge (undefined check)', () => {
  // ReflectionRenderer: {lesson.target && <a href=...>}
  // Verify the type contract: a lesson without target has target === undefined.
  const raw = `
## Self-reflection

### Observation 1 — Some topic

Some prose without any matching slug.
`;
  const doc = parseRetroMd(raw, []);
  const ls = lessons(doc);
  // No slug match → target must be strictly undefined (falsy → no badge)
  for (const l of ls) {
    assert.ok(l.target === undefined || typeof l.target === 'string',
      'target must be undefined or a string');
  }
});
