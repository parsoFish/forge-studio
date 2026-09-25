/**
 * Unit tests for `brain-lint-checks-truth.ts` — the brain-lint truthfulness
 * axis (bead forge-mfv5.3.4): does a CURRENT project (Brain 3) theme's cited
 * code still exist in its ground clone (`<forgeRoot>/projects/<name>/`)?
 *
 * `forge brain lint` verifies STRUCTURE only today (frontmatter, index sync,
 * links, orphans, category routing). Measured 2026-09-12 on
 * `brain/projects/terraform-provider-betterado` (144 themes): structurally
 * near-perfect while a 10-theme hand sample was ~50% stale — themes
 * asserting code and layers the provider no longer has. Planners read Brain
 * 3 as a mandatory input (CLAUDE.md "The brain is the first source of
 * knowledge"), so a stale theme misdirects the next roadmap. This module
 * measures that staleness instead of only structural well-formedness.
 *
 * `extractThemeReferences` · `themeTruth` · `brainTruthRates` ·
 * `checkThemeTruth` — plus the registry wiring (CHECK_NAMES/classifyFinding)
 * and the CLI's unconditional `truthfulness:` summary lines. This file holds
 * extraction + round-1 + fix-round-1 (T2 review rulings) coverage; the
 * fix-round-2 (history-backed staleness) tests split into the sibling
 * `brain-lint-truth-history.test.ts` at the 800-line cap — same split
 * rationale as `brain-lint.test.ts` -> `brain-lint-{graph,filing,integrity,
 * orchestration}.test.ts`. Shared fixtures (including the git-checkout
 * helpers both files need) live in `./test-fixtures/brain-lint-truth.ts`.
 *
 * TEST-WRITER NOTE (immutable-gates): the module started out not existing at
 * all (round 1: `.superpowers/d14-tests-report.md`); fix round 1
 * (`.superpowers/d14-fix1-tests-report.md`) pinned the T2 review rulings
 * (provenance roots, prefix normalisation, `../` guard, antipattern
 * evidence-only, `--project` scoping) below the "D14 FIX ROUND 1" marker;
 * fix round 2 (`.superpowers/d14-fix2-tests-report.md`) rewrote the
 * stale-producing cases in THIS file to be history-backed (git commit then
 * delete, instead of a plain filesystem gap) and added its own new tests in
 * the sibling file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

import { CHECK_NAMES, classifyFinding } from '../../brain-lint.ts';
import {
  extractThemeReferences,
  themeTruth,
  brainTruthRates,
  checkThemeTruth,
  FORGE_PROVENANCE_ROOTS,
} from '../../brain-lint-checks-truth.ts';

import { buildBrainFixture, cleanup } from './test-fixtures/brain-lint.ts';
import { BT, writeTruthTheme, writeCheckoutFile, gitCheckout } from './test-fixtures/brain-lint-truth.ts';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';

// ---------- 1. extraction: IS / IS-NOT examples ----------

const IS_REFERENCE_CASES: ReadonlyArray<readonly [raw: string, expected: string]> = [
  ['azuredevops/internal/service/release/resource_release.go', 'azuredevops/internal/service/release/resource_release.go'],
  ['docs/data-sources/', 'docs/data-sources/'],
  ['./GNUmakefile/x.go', 'GNUmakefile/x.go'],
];

const NOT_REFERENCE_CASES: readonly string[] = [
  'go test ./...',
  'https://x.y/z.go',
  'docs/**/*.md',
  '<id>/x.md',
  'quality_gate_cmd',
  'WI-4',
  '/abs/path.go',
];

test('extractThemeReferences: each IS-reference example extracts (one assertion per example; kills an implementation that only recognises a subset of the repo-relative-path shape)', () => {
  for (const [raw, expected] of IS_REFERENCE_CASES) {
    const body = `See ${BT}${raw}${BT} for details.\n`;
    const refs = extractThemeReferences(body, {});
    assert.ok(refs.includes(expected), `expected "${raw}" to extract as "${expected}", got ${JSON.stringify(refs)}`);
  }
});

test('extractThemeReferences: each IS-NOT example extracts nothing (one assertion per example; kills an over-eager extractor that treats a command, a URL, a glob, a placeholder or an absolute path as an assertion)', () => {
  for (const raw of NOT_REFERENCE_CASES) {
    const body = `See ${BT}${raw}${BT} for details.\n`;
    const refs = extractThemeReferences(body, {});
    assert.equal(refs.length, 0, `expected "${raw}" to extract nothing, got ${JSON.stringify(refs)}`);
  }
});

// ---------- 2. extraction: evidence frontmatter overrides the body ----------

test('extractThemeReferences: a non-empty evidence[] frontmatter list is the COMPLETE reference set — the body is ignored entirely', () => {
  const frontmatter = { evidence: ['a/b.go', 'c/d/'] };
  const body = `Body mentions ${BT}x/y.go${BT} and ${BT}z/w.go${BT} but evidence wins.\n`;
  const refs = extractThemeReferences(body, frontmatter);
  assert.deepEqual(refs, ['a/b.go', 'c/d/'], `evidence frontmatter must be the complete (and only) reference set, got ${JSON.stringify(refs)}`);
});

test('extractThemeReferences: an EMPTY evidence[] list does not count as "present" — falls back to body extraction (kills a naive `"evidence" in frontmatter` presence check)', () => {
  const frontmatter = { evidence: [] as string[] };
  const body = `Body cites ${BT}x/y.go${BT} here.\n`;
  const refs = extractThemeReferences(body, frontmatter);
  assert.deepEqual(refs, ['x/y.go'], `empty evidence[] must fall back to body extraction, got ${JSON.stringify(refs)}`);
});

// ---------- 3. extraction: fenced blocks are commands, not assertions ----------

test('extractThemeReferences: a path inside a fenced code block is ignored; the SAME-SHAPED single-backtick span in the fence is a false-positive trap for a fence-unaware regex, and an inline span outside the fence is kept', () => {
  // The fenced content is itself single-backtick-wrapped (`fenced/only.go`) —
  // deliberately, so a naive /`([^`\n]+)`/g extractor that never strips fenced
  // regions first WOULD match it (the backticks are still there to match); a
  // correct implementation must recognise the ``` fence and skip its content
  // wholesale. A fence with no backticks inside it would pass either way and
  // prove nothing.
  const body = [
    '```',
    `Run ${BT}fenced/only.go${BT} from here.`,
    '```',
    '',
    `Inline reference: ${BT}inline/kept.go${BT}`,
    '',
  ].join('\n');
  const refs = extractThemeReferences(body, {});
  assert.ok(refs.includes('inline/kept.go'), `inline span outside the fence must be extracted, got ${JSON.stringify(refs)}`);
  assert.ok(!refs.includes('fenced/only.go'), `fenced-block content must NOT be extracted even though it is itself backtick-wrapped (commands, not assertions), got ${JSON.stringify(refs)}`);
});

// ---------- 4. themeTruth ----------

test('themeTruth: a current theme citing one existing and one absent-but-ONCE-TRACKED path -> missing is exactly the absent one (T2 fix-round-2: history-backed, not a plain filesystem gap)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-a', 'theme-one', {
      body: `Cites ${BT}src/exists.go${BT} and ${BT}src/missing.go${BT}.\n`,
    });
    gitCheckout(
      root,
      'proj-a',
      { 'src/exists.go': 'package a\n', 'src/missing.go': 'package a\n' },
      { deleteAfterCommit: ['src/missing.go'] },
    );

    const results = themeTruth(root, 'proj-a');
    assert.equal(results.length, 1, `expected exactly one theme, got ${JSON.stringify(results)}`);
    const [t] = results;
    assert.equal(t.status, 'current');
    assert.deepEqual(t.references, ['src/exists.go', 'src/missing.go']);
    assert.deepEqual(t.missing, ['src/missing.go']);
    assert.ok(
      t.file.endsWith(join('proj-a', 'themes', 'theme-one.md')),
      `file must point at the theme file, got ${t.file}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- 5. brainTruthRates: the pinned aggregate example ----------

test('brainTruthRates: 1 historical + 1 current-no-refs + 1 current-all-present + 2 current-with-missing -> { themes:5, historical:1, unverifiable:1, verifiable:3, stale:2, rate:2/3, checkout:"present", history:"present" } (T2 fix-round-2: missing paths are COMMITTED then deleted, same expected numbers)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-b', 'hist-1', { status: 'historical', body: `Cites ${BT}nope/nope.go${BT}.\n` });
    writeTruthTheme(root, 'proj-b', 'no-refs', { body: 'No citations here, just prose.\n' });
    writeTruthTheme(root, 'proj-b', 'all-present', { body: `Cites ${BT}ok/here.go${BT}.\n` });
    writeTruthTheme(root, 'proj-b', 'missing-1', { body: `Cites ${BT}gone/one.go${BT}.\n` });
    writeTruthTheme(root, 'proj-b', 'missing-2', { body: `Cites ${BT}ok/here2.go${BT} and ${BT}gone/two.go${BT}.\n` });

    // ok/here.go, ok/here2.go are committed and KEPT; gone/one.go,
    // gone/two.go are committed then deleted (once-tracked, now gone — the
    // history-backed "missing" shape). nope/nope.go (cited only by the
    // historical theme, which is excluded from every count) is never tracked
    // at all — irrelevant either way since historical themes never count.
    gitCheckout(
      root,
      'proj-b',
      { 'ok/here.go': 'x\n', 'ok/here2.go': 'x\n', 'gone/one.go': 'x\n', 'gone/two.go': 'x\n' },
      { deleteAfterCommit: ['gone/one.go', 'gone/two.go'] },
    );

    const rates = brainTruthRates(root);
    const row = rates.find((r) => r.project === 'proj-b');
    assert.ok(row, `expected a brainTruthRates row for proj-b, got ${JSON.stringify(rates)}`);
    assert.deepEqual(row, {
      project: 'proj-b',
      checkout: 'present',
      history: 'present',
      themes: 5,
      historical: 1,
      verifiable: 3,
      unverifiable: 1,
      stale: 2,
      rate: 2 / 3,
    });
  } finally {
    cleanup(root);
  }
});

test('brainTruthRates: rows are sorted by project', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'zzz-project', 'z-theme', { body: 'no refs' });
    writeTruthTheme(root, 'aaa-project', 'a-theme', { body: 'no refs' });
    const rates = brainTruthRates(root);
    const names = rates.map((r) => r.project);
    assert.deepEqual(names, [...names].sort(), `brainTruthRates rows must be sorted by project, got ${JSON.stringify(names)}`);
    assert.ok(names.includes('aaa-project') && names.includes('zzz-project'));
  } finally {
    cleanup(root);
  }
});

// ---------- 6. brainTruthRates: checkout absent ----------

test('brainTruthRates: checkout absent -> checkout:"absent", rate:null, and checkThemeTruth never guesses at it (no finding)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-c', 'orphan-theme', { body: `Cites ${BT}gone/nowhere.go${BT}.\n` });
    // Deliberately no `<root>/projects/proj-c` — the ground clone is absent.

    const rates = brainTruthRates(root);
    const row = rates.find((r) => r.project === 'proj-c');
    assert.ok(row, `expected a brainTruthRates row for proj-c, got ${JSON.stringify(rates)}`);
    assert.equal(row.checkout, 'absent', `expected checkout:'absent', got ${JSON.stringify(row)}`);
    assert.equal(row.rate, null, `expected rate:null when checkout is absent, got ${JSON.stringify(row)}`);

    const findings = checkThemeTruth(root).filter((f) => f.file.includes(join('projects', 'proj-c')));
    assert.deepEqual(
      findings,
      [],
      `a checkout-absent brain must yield NO findings — it is reported by the rate row as checkout:'absent', never guessed at. Got ${JSON.stringify(findings)}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- 7. checkThemeTruth ----------

test('checkThemeTruth: exactly one flag per stale CURRENT theme naming every missing path; a historical theme with a missing reference yields no finding (T2 fix-round-2: missing paths are COMMITTED then deleted, same expected numbers)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-d', 'stale-one', { body: `Cites ${BT}gone/a.go${BT} and ${BT}gone/b.go${BT}.\n` });
    writeTruthTheme(root, 'proj-d', 'stale-two', { body: `Cites ${BT}gone/c.go${BT}.\n` });
    writeTruthTheme(root, 'proj-d', 'hist-missing', { status: 'historical', body: `Cites ${BT}gone/d.go${BT}.\n` });
    writeTruthTheme(root, 'proj-d', 'clean', { body: `Cites ${BT}ok/e.go${BT}.\n` });
    // gone/a.go, gone/b.go, gone/c.go are committed then deleted (once
    // tracked, now gone). ok/e.go is committed and KEPT. gone/d.go (cited
    // only by the historical theme, always excluded) is never tracked.
    gitCheckout(
      root,
      'proj-d',
      { 'gone/a.go': 'x\n', 'gone/b.go': 'x\n', 'gone/c.go': 'x\n', 'ok/e.go': 'x\n' },
      { deleteAfterCommit: ['gone/a.go', 'gone/b.go', 'gone/c.go'] },
    );

    const findings = checkThemeTruth(root).filter((f) => f.file.includes(join('projects', 'proj-d')));
    assert.equal(findings.length, 2, `expected exactly 2 findings (stale-one, stale-two — one per stale theme, not one per missing path), got ${JSON.stringify(findings)}`);

    for (const f of findings) {
      assert.equal(f.category, 'flag', `checkThemeTruth findings must be category:'flag' (agent-resolvable, never a hard error), got ${JSON.stringify(f)}`);
      assert.equal(f.check, 'checkThemeTruth');
    }

    const staleOne = findings.find((f) => f.file.endsWith('stale-one.md'));
    assert.ok(staleOne, `expected a finding for stale-one.md, got ${JSON.stringify(findings)}`);
    assert.match(staleOne.message, /gone\/a\.go/, `message must name gone/a.go, got: ${staleOne.message}`);
    assert.match(staleOne.message, /gone\/b\.go/, `message must name gone/b.go too (both missing paths named), got: ${staleOne.message}`);

    const staleTwo = findings.find((f) => f.file.endsWith('stale-two.md'));
    assert.ok(staleTwo, `expected a finding for stale-two.md, got ${JSON.stringify(findings)}`);
    assert.match(staleTwo.message, /gone\/c\.go/, `message must name gone/c.go, got: ${staleTwo.message}`);

    assert.ok(
      !findings.some((f) => f.file.endsWith('hist-missing.md')),
      `a historical theme must never be flagged, even with a missing reference (kills "historical is ignored only in the rate")`,
    );
    assert.ok(
      !findings.some((f) => f.file.endsWith('clean.md')),
      `a theme with every reference present must not be flagged`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- 8. registry: CHECK_NAMES + classifyFinding ----------

test('registry: CHECK_NAMES includes checkThemeTruth, and classifyFinding stamps kind:"truth.stale" resolution:"agent" for its findings (an LLM can re-verify the citation or mark the theme historical)', () => {
  assert.ok(CHECK_NAMES.includes('checkThemeTruth'), `CHECK_NAMES must include checkThemeTruth, got ${JSON.stringify(CHECK_NAMES)}`);

  const classified = classifyFinding({
    category: 'flag',
    file: '/x/brain/projects/proj-d/themes/stale-one.md',
    check: 'checkThemeTruth',
    message: 'cites missing path(s): gone/a.go, gone/b.go — the theme may describe code that no longer exists',
  });
  assert.equal(classified.kind, 'truth.stale');
  assert.equal(classified.resolution, 'agent');
  assert.ok(classified.fixHint && classified.fixHint.length > 0, 'checkThemeTruth must carry a non-empty fixHint (agent-tier findings always do, per classifyFinding house style)');
});

// ---------- 9. CLI: unconditional truthfulness: summary lines ----------

function runBrainLintCli(fixtureRoot: string, extraArgs: string[] = []): { code: number | null; out: string } {
  // The standalone `packages/knowledge/brain-lint.ts` CLI entry (its own
  // `parseArgs`/`isCli` block) is driven directly rather than
  // `apps/forge/cli.ts brain lint`: `cmdBrainLint`
  // (apps/forge/cli-brain-lint.ts) hardcodes FORGE_ROOT with no `--cwd`/root
  // override, so it cannot be pointed at a fixture. This entry point can
  // (`--cwd <root>`), matching the brief's "ONLY if the CLI accepts a root"
  // clause. (I3, D14 review: the REAL operator CLI — `apps/forge/cli.ts brain
  // lint`, which has no fixture door — gets its own regression-lock test in
  // `apps/forge/tests/integration/brain-lint-truthfulness-cli.test.ts`.)
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'packages/knowledge/brain-lint.ts', '--cwd', fixtureRoot, ...extraArgs],
    { cwd: FORGE_ROOT, encoding: 'utf8' },
  );
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('CLI (`packages/knowledge/brain-lint.ts --cwd <root>`): prints one "truthfulness:" line per brain/projects/<p>, unconditionally — a clean brain still gets its 0/1 stale (0%) line, and an absent checkout gets its own line rather than being silently skipped', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    // A clean brain: one current theme, one reference, present in the clone.
    writeTruthTheme(root, 'proj-clean', 'only-theme', { body: `Cites ${BT}ok/here.go${BT}.\n` });
    writeCheckoutFile(root, 'proj-clean', 'ok/here.go');

    // A brain whose ground clone was never checked out.
    writeTruthTheme(root, 'proj-nocheckout', 'orphan', { body: `Cites ${BT}gone/x.go${BT}.\n` });

    const { out } = runBrainLintCli(root);

    assert.match(
      out,
      /truthfulness: proj-clean — 0\/1 stale \(0%\) · 0 unverifiable · 0 historical/,
      `expected the clean-brain truthfulness line, got:\n${out}`,
    );
    assert.match(
      out,
      /truthfulness: proj-nocheckout — checkout absent, not judged/,
      `expected the checkout-absent truthfulness line, got:\n${out}`,
    );
  } finally {
    cleanup(root);
  }
});

// =====================================================================
// D14 FIX ROUND 1 (.superpowers/d14-fix1-tests-brief.md) — pins T2's review
// rulings that replace the original extraction model. Root cause (review C1):
// the original model checked EVERY inline-code reference against the
// managed project's ground clone, including forge-provenance citations
// (`_logs/...`, `brain/cycles/_raw/...` in a theme's own `## Sources`
// footer) that describe how FORGE learned the lesson, not a claim about the
// PROJECT's code — driving betterado's measured stale rate to 99% against a
// ~50% hand-sampled baseline. C1/C2/M1/M3 below correct the extraction/
// verification model; M2 scopes the CLI's summary lines; the closing test
// pins the corrected rate on a realistic corpus-shaped body.
// =====================================================================

// ---------- C1: forge-namespace references are provenance, not claims ----------

test('FORGE_PROVENANCE_ROOTS: exports exactly the 4 roots, verbatim (C1)', () => {
  assert.deepEqual(
    [...FORGE_PROVENANCE_ROOTS],
    ['_logs', '_queue', '_worktrees', 'brain'],
    `FORGE_PROVENANCE_ROOTS must be exactly ['_logs','_queue','_worktrees','brain'], got ${JSON.stringify(FORGE_PROVENANCE_ROOTS)}`,
  );
});

test('extractThemeReferences: a candidate whose FIRST path segment is a forge-provenance root is dropped for EVERY root in FORGE_PROVENANCE_ROOTS — it describes how forge learned the lesson, not the project (C1)', () => {
  const provenanceCases = [
    '_logs/2026-06-06T04-41-44_INIT-x/events.jsonl',
    '_queue/done/INIT-x.md',
    '_worktrees/m7-d/notes.md',
    'brain/cycles/_raw/2026-06-06-x.md',
  ];
  for (const raw of provenanceCases) {
    const refs = extractThemeReferences(`Cites ${BT}${raw}${BT}.\n`, {});
    assert.equal(refs.length, 0, `expected "${raw}" (forge-provenance root) to be dropped, got ${JSON.stringify(refs)}`);
  }
});

test('extractThemeReferences: a project-code path with no forge-provenance prefix is still kept (C1 control case)', () => {
  const refs = extractThemeReferences(`Cites ${BT}azuredevops/x.go${BT}.\n`, {});
  assert.deepEqual(refs, ['azuredevops/x.go'], `a non-provenance reference must be unaffected, got ${JSON.stringify(refs)}`);
});

test('extractThemeReferences: a provenance root name is only excluded as the FIRST path segment — an embedded occurrence elsewhere in the path is kept (kills a substring-match implementation)', () => {
  const refs = extractThemeReferences(`Cites ${BT}orchestrator/brain/x.go${BT}.\n`, {});
  assert.deepEqual(
    refs,
    ['orchestrator/brain/x.go'],
    `"brain" must only be excluded as the FIRST segment, not anywhere in the path, got ${JSON.stringify(refs)}`,
  );
});

// ---------- C2: a forge-root-relative project path is normalised ----------

test('themeTruth: a projects/<project>/-prefixed self-citation is normalised — not missing, and references reports the STRIPPED form (C2)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-e', 'prefixed-cite', {
      body: `Cites ${BT}projects/proj-e/src/a.ts${BT}.\n`,
    });
    writeCheckoutFile(root, 'proj-e', 'src/a.ts');

    const [t] = themeTruth(root, 'proj-e');
    assert.deepEqual(
      t.references,
      ['src/a.ts'],
      `references must report the NORMALISED (projects/proj-e/-stripped) form, got ${JSON.stringify(t.references)}`,
    );
    assert.deepEqual(
      t.missing,
      [],
      `the prefixed citation resolves to an existing file once normalised against <cwd>/projects/proj-e/ — must not be missing, got ${JSON.stringify(t.missing)}`,
    );
  } finally {
    cleanup(root);
  }
});

test('themeTruth: a projects/<OTHER-project>/-prefixed citation is NOT stripped — only the theme\'s OWN project prefix normalises (C2, kills over-eager stripping; T2 fix-round-2: the resulting miss is history-backed, not a plain filesystem gap)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-e2', 'cross-project-cite', {
      body: `Cites ${BT}projects/some-other-project/src/a.ts${BT}.\n`,
    });
    // Even though the referenced file exists somewhere, it is NOT under
    // <cwd>/projects/proj-e2/ (this theme's own checkout root) once left
    // unstripped, so it must resolve as missing rather than silently
    // matching a foreign project's tree. The real file lives under its OWN
    // project's checkout — irrelevant here, since proj-e2's own resolution
    // never reaches it.
    writeCheckoutFile(root, 'some-other-project', 'src/a.ts');
    // proj-e2's OWN checkout: the literal (unstripped) path was, at some
    // point, committed there too — then deleted — so the "missing" verdict
    // below is history-backed (once tracked under this exact literal path),
    // not just a plain, never-real filesystem gap.
    gitCheckout(
      root,
      'proj-e2',
      { 'projects/some-other-project/src/a.ts': 'x\n' },
      { deleteAfterCommit: ['projects/some-other-project/src/a.ts'] },
    );

    const [t] = themeTruth(root, 'proj-e2');
    assert.deepEqual(
      t.references,
      ['projects/some-other-project/src/a.ts'],
      `a foreign-project prefix must be left AS-IS (only the theme's own project name strips), got ${JSON.stringify(t.references)}`,
    );
    assert.deepEqual(
      t.missing,
      ['projects/some-other-project/src/a.ts'],
      `unstripped, this resolves under proj-e2's OWN checkout root, where it does not exist, got ${JSON.stringify(t.missing)}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- M1: `../` never escapes ----------

test('extractThemeReferences: a `../`-leading or `/../`-containing candidate never escapes the checkout root — dropped (M1)', () => {
  const startsWithDotDot = extractThemeReferences(`Cites ${BT}../../secrets/x.go${BT}.\n`, {});
  assert.equal(startsWithDotDot.length, 0, `a "../"-leading candidate must be dropped, got ${JSON.stringify(startsWithDotDot)}`);

  const containsDotDot = extractThemeReferences(`Cites ${BT}foo/../bar/baz.go${BT}.\n`, {});
  assert.equal(containsDotDot.length, 0, `a candidate containing "/../" (not just leading) must be dropped, got ${JSON.stringify(containsDotDot)}`);
});

test('extractThemeReferences: an ordinary nested path with no ".." segment is still kept (M1 control case, kills an overly-broad traversal filter)', () => {
  const refs = extractThemeReferences(`Cites ${BT}foo/bar/baz.go${BT}.\n`, {});
  assert.deepEqual(refs, ['foo/bar/baz.go'], `a path with no ".." must be unaffected, got ${JSON.stringify(refs)}`);
});

// ---------- M3: antipattern themes are judged only on declared evidence ----------

test('themeTruth/brainTruthRates: an antipattern-category theme contributes body references to NOTHING — a body citation to an absent path is unverifiable (not stale); evidence: overrides normally, verifiable and judged (M3)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-f', 'anti-no-evidence', {
      category: 'antipattern',
      body: `Documents that ${BT}absent/path.ts${BT} does not exist.\n`,
    });
    writeTruthTheme(root, 'proj-f', 'anti-with-evidence', {
      category: 'antipattern',
      evidence: ['present/file.ts'],
      body: `Also mentions ${BT}absent/path.ts${BT} in prose (must be ignored — evidence: is the complete set).\n`,
    });
    writeCheckoutFile(root, 'proj-f', 'present/file.ts');
    // absent/path.ts deliberately absent — must never even be extracted.

    const themes = themeTruth(root, 'proj-f');
    const noEv = themes.find((t) => t.file.endsWith('anti-no-evidence.md'));
    const withEv = themes.find((t) => t.file.endsWith('anti-with-evidence.md'));
    assert.ok(noEv, `expected a ThemeTruth for anti-no-evidence.md, got ${JSON.stringify(themes)}`);
    assert.ok(withEv, `expected a ThemeTruth for anti-with-evidence.md, got ${JSON.stringify(themes)}`);

    assert.deepEqual(
      noEv!.references,
      [],
      `an antipattern theme with no evidence: must contribute ZERO body references, got ${JSON.stringify(noEv!.references)}`,
    );
    assert.deepEqual(noEv!.missing, []);

    assert.deepEqual(
      withEv!.references,
      ['present/file.ts'],
      `evidence: still overrides for an antipattern theme, got ${JSON.stringify(withEv!.references)}`,
    );
    assert.deepEqual(withEv!.missing, []);

    const row = brainTruthRates(root).find((r) => r.project === 'proj-f');
    assert.ok(row, `expected a brainTruthRates row for proj-f, got nothing`);
    assert.equal(row!.unverifiable, 1, `anti-no-evidence (0 refs) must count as unverifiable, got ${JSON.stringify(row)}`);
    assert.equal(row!.verifiable, 1, `anti-with-evidence (evidence:, present) must count as verifiable, got ${JSON.stringify(row)}`);
    assert.equal(row!.stale, 0, `neither theme is stale, got ${JSON.stringify(row)}`);
  } finally {
    cleanup(root);
  }
});

// ---------- M2: --project scopes the truthfulness lines ----------

test('CLI: --project <p> scopes the truthfulness: lines to that project only (M2)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-g', 'g-theme', { body: `Cites ${BT}ok/g.go${BT}.\n` });
    writeCheckoutFile(root, 'proj-g', 'ok/g.go');
    writeTruthTheme(root, 'proj-h', 'h-theme', { body: `Cites ${BT}ok/h.go${BT}.\n` });
    writeCheckoutFile(root, 'proj-h', 'ok/h.go');

    const { out } = runBrainLintCli(root, ['--project', 'proj-g']);
    assert.match(out, /truthfulness: proj-g — /, `expected a truthfulness line for the named project, got:\n${out}`);
    assert.ok(
      !/truthfulness: proj-h — /.test(out),
      `--project proj-g must NOT print proj-h's truthfulness line, got:\n${out}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- item 8: the rate on a realistic body ----------

test('themeTruth/brainTruthRates: a realistic corpus-shaped body (## Sources footer citing forge-provenance paths + one present and one absent project path) -> exactly one missing (the absent project path), stale 1/1 (T2 fix-round-2, item 4: the absent path was once committed)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-i', 'realistic', {
      body: [
        `Uses ${BT}src/present.go${BT} but not ${BT}src/absent.go${BT} anymore.`,
        '',
        '## Sources',
        `- ${BT}_logs/2026-06-06T04-41-44_INIT-x/events.jsonl${BT} (WI-5 gate events)`,
        `- ${BT}brain/cycles/_raw/2026-06-06-x.md${BT} (cycle archive)`,
        '',
      ].join('\n'),
    });
    // src/present.go is committed and KEPT; src/absent.go is committed then
    // deleted (once tracked, now gone — the history-backed "missing" shape
    // this whole fix round requires). The two Sources citations are
    // forge-provenance (C1) and never even reach `references`.
    gitCheckout(
      root,
      'proj-i',
      { 'src/present.go': 'x\n', 'src/absent.go': 'x\n' },
      { deleteAfterCommit: ['src/absent.go'] },
    );

    const [t] = themeTruth(root, 'proj-i');
    assert.deepEqual(
      t.references,
      ['src/present.go', 'src/absent.go'],
      `provenance citations must never appear in references at all — only the two genuine project-code paths, got ${JSON.stringify(t.references)}`,
    );
    assert.deepEqual(
      t.missing,
      ['src/absent.go'],
      `exactly the absent project path should be missing — the provenance citations are excluded upstream, not just non-missing, got ${JSON.stringify(t.missing)}`,
    );

    const row = brainTruthRates(root).find((r) => r.project === 'proj-i');
    assert.ok(row, `expected a brainTruthRates row for proj-i, got nothing`);
    assert.equal(row!.history, 'present', `proj-i is a real git checkout, got ${JSON.stringify(row)}`);
    assert.equal(row!.verifiable, 1, `1 current theme with references, got ${JSON.stringify(row)}`);
    assert.equal(row!.stale, 1, `the one genuine, once-tracked code-path miss, got ${JSON.stringify(row)}`);
    assert.equal(
      row!.rate,
      1,
      `stale 1 / verifiable 1 = rate 1 (100%) on THIS fixture — the point is it is no longer inflated by the 2 provenance citations that would have made it look like 3 missing out of 1 theme, got ${JSON.stringify(row)}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- containment: evidence: refs never reach an unguarded fs/git probe ----------

test('themeTruth: an evidence: ref that escapes the checkout (`../outside.md`) or is absolute (`/etc/passwd`) is DROPPED by the containment guard before any existsSync/git probe — never counted present or stale (SEC: evidence: is returned verbatim by extractThemeReferences, bypassing normalizeCandidate\'s own M1 traversal filter, which only runs on body-derived candidates)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    // A real file OUTSIDE proj-guard's own checkout, sitting where
    // join(checkoutRoot, '../outside.md') would land if the traversal were
    // not contained — proves the guard, not just an absent target, is what
    // stops it.
    mkdirSync(join(root, 'projects'), { recursive: true });
    writeFileSync(join(root, 'projects', 'outside.md'), 'not part of proj-guard\n');
    writeTruthTheme(root, 'proj-guard', 'guard-theme', {
      evidence: ['../outside.md', '/etc/passwd'],
    });

    const [t] = themeTruth(root, 'proj-guard');
    assert.deepEqual(t.references, [], `an escaping ref must never be counted present, got ${JSON.stringify(t.references)}`);
    assert.deepEqual(t.missing, [], `an escaping ref is DROPPED, not judged stale, got ${JSON.stringify(t.missing)}`);

    const row = brainTruthRates(root).find((r) => r.project === 'proj-guard');
    assert.ok(row, `expected a brainTruthRates row for proj-guard, got nothing`);
    assert.equal(row!.verifiable, 0, `no reference survives the guard, so nothing is verifiable, got ${JSON.stringify(row)}`);
    assert.equal(row!.rate, null, `0 verifiable -> rate is null, never a false 0%, got ${JSON.stringify(row)}`);
  } finally {
    cleanup(root);
  }
});
