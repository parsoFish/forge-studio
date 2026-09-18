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
 * and the CLI's unconditional `truthfulness:` summary lines.
 *
 * TEST-WRITER NOTE (immutable-gates): `packages/knowledge/brain-lint-checks-truth.ts`
 * does NOT exist yet. Every test below is RED right now because the import
 * itself fails to resolve — that is the correct RED reason at this stage;
 * see `.superpowers/d14-tests-report.md` for the exact failure recorded per
 * test. `writeTruthTheme`/`writeCheckoutFile` are LOCAL to this file
 * (deliberately not added to `./test-fixtures/brain-lint.ts`): they write
 * `status:`/`evidence:` frontmatter the shared `ThemeSpec` type does not
 * support, and per that file's own header comment a fixture used by only one
 * output file belongs to that file, not the shared one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { CHECK_NAMES, classifyFinding } from '../../brain-lint.ts';
import {
  extractThemeReferences,
  themeTruth,
  brainTruthRates,
  checkThemeTruth,
} from '../../brain-lint-checks-truth.ts';

import { buildBrainFixture, cleanup } from './test-fixtures/brain-lint.ts';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';

// ---------- local fixture writers (see file header: not shared) ----------

const BT = '`';

/** Write one project-brain theme with `status:` frontmatter the shared
 *  `ThemeSpec` type does not model, at
 *  `<root>/brain/projects/<project>/themes/<slug>.md`. (The `evidence:`
 *  override is pinned separately, directly against `extractThemeReferences`,
 *  which takes an already-parsed frontmatter object — no YAML round-trip
 *  needed there.) */
function writeTruthTheme(
  root: string,
  project: string,
  slug: string,
  opts: { status?: 'current' | 'historical'; body?: string } = {},
): string {
  const dir = join(root, 'brain', 'projects', project, 'themes');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const lines = [
    '---',
    `title: ${slug}`,
    'description: description text.',
    'category: pattern',
    'created_at: 2026-01-01T00:00:00Z',
    'updated_at: 2026-01-01T00:00:00Z',
  ];
  if (opts.status) lines.push(`status: ${opts.status}`);
  lines.push('---', '', opts.body ?? '# theme body\n');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

/** Create one file inside a managed project's ground clone,
 *  `<root>/projects/<project>/<relPath>` — a sibling of `<root>/brain/`. */
function writeCheckoutFile(root: string, project: string, relPath: string): void {
  const file = join(root, 'projects', project, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'placeholder\n');
}

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

test('themeTruth: a current theme citing one existing and one absent path -> missing is exactly the absent one', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-a', 'theme-one', {
      body: `Cites ${BT}src/exists.go${BT} and ${BT}src/missing.go${BT}.\n`,
    });
    writeCheckoutFile(root, 'proj-a', 'src/exists.go');

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

test('brainTruthRates: 1 historical + 1 current-no-refs + 1 current-all-present + 2 current-with-missing -> { themes:5, historical:1, unverifiable:1, verifiable:3, stale:2, rate:2/3, checkout:"present" }', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-b', 'hist-1', { status: 'historical', body: `Cites ${BT}nope/nope.go${BT}.\n` });
    writeTruthTheme(root, 'proj-b', 'no-refs', { body: 'No citations here, just prose.\n' });
    writeTruthTheme(root, 'proj-b', 'all-present', { body: `Cites ${BT}ok/here.go${BT}.\n` });
    writeTruthTheme(root, 'proj-b', 'missing-1', { body: `Cites ${BT}gone/one.go${BT}.\n` });
    writeTruthTheme(root, 'proj-b', 'missing-2', { body: `Cites ${BT}ok/here2.go${BT} and ${BT}gone/two.go${BT}.\n` });

    writeCheckoutFile(root, 'proj-b', 'ok/here.go');
    writeCheckoutFile(root, 'proj-b', 'ok/here2.go');
    // gone/one.go, gone/two.go, nope/nope.go deliberately absent.

    const rates = brainTruthRates(root);
    const row = rates.find((r) => r.project === 'proj-b');
    assert.ok(row, `expected a brainTruthRates row for proj-b, got ${JSON.stringify(rates)}`);
    assert.deepEqual(row, {
      project: 'proj-b',
      checkout: 'present',
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

test('checkThemeTruth: exactly one flag per stale CURRENT theme naming every missing path; a historical theme with a missing reference yields no finding', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-d', 'stale-one', { body: `Cites ${BT}gone/a.go${BT} and ${BT}gone/b.go${BT}.\n` });
    writeTruthTheme(root, 'proj-d', 'stale-two', { body: `Cites ${BT}gone/c.go${BT}.\n` });
    writeTruthTheme(root, 'proj-d', 'hist-missing', { status: 'historical', body: `Cites ${BT}gone/d.go${BT}.\n` });
    writeTruthTheme(root, 'proj-d', 'clean', { body: `Cites ${BT}ok/e.go${BT}.\n` });
    writeCheckoutFile(root, 'proj-d', 'ok/e.go');
    // gone/a.go, gone/b.go, gone/c.go, gone/d.go deliberately absent.

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

function runBrainLintCli(fixtureRoot: string): { code: number | null; out: string } {
  // The standalone `packages/knowledge/brain-lint.ts` CLI entry (its own
  // `parseArgs`/`isCli` block) is driven directly rather than
  // `apps/forge/cli.ts brain lint`: `cmdBrainLint`
  // (apps/forge/cli-brain-lint.ts) hardcodes FORGE_ROOT with no `--cwd`/root
  // override, so it cannot be pointed at a fixture. This entry point can
  // (`--cwd <root>`), matching the brief's "ONLY if the CLI accepts a root"
  // clause.
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'packages/knowledge/brain-lint.ts', '--cwd', fixtureRoot],
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
