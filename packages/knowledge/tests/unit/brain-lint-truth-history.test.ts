/**
 * D14 fix round 2 (`.superpowers/d14-fix2-tests-brief.md`) — the brain-lint
 * truthfulness axis's HISTORY-BACKED staleness ruling, split out of
 * `brain-lint-truth.test.ts` at the 800-line cap (same split rationale as
 * `brain-lint.test.ts` -> `brain-lint-{graph,filing,integrity,
 * orchestration}.test.ts`; shared fixtures — including the git-checkout
 * helpers this file needs — live in `./test-fixtures/brain-lint-truth.ts`).
 *
 * T2 ruling (fix round 2): a hostile hand-check of round 1's 9 betterado
 * "stale" verdicts found only 3 genuine; the 6 false positives all cited
 * something that was NEVER a file in the project (an ADO token format, a Go
 * idiom, a module version pin, a generated `.forge/live-evidence/…`
 * artifact, an absence claim in a `reference`-category theme). "Stale" now
 * means "cited a file the project once had, and no longer has": a reference
 * is `missing` only when it is absent from the checkout's working tree AND
 * `git -C <checkout> log --all -- <ref>` finds it on some ref (tracked at
 * some point, on some branch). A reference absent now and never tracked is
 * dropped from `references` outright — never evidence of staleness. A
 * checkout that is not its own git repository (and not inside one) reports
 * `checkout:'present'` (the dir DOES exist) with `history:'absent'`,
 * `rate:null`, and yields no findings — the same "never guessed" rule an
 * absent checkout already got.
 *
 * `brain-lint-truth.test.ts` covers extraction + round-1 + fix-round-1 (the
 * provenance/prefix/traversal/antipattern/--project rulings), and rewrote
 * its own pre-existing stale-producing fixtures to be history-backed there;
 * this file adds ONLY the fix-round-2-specific cases the brief calls out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { themeTruth, brainTruthRates, checkThemeTruth } from '../../brain-lint-checks-truth.ts';

import { buildBrainFixture, cleanup } from './test-fixtures/brain-lint.ts';
import {
  BT,
  writeTruthTheme,
  writeCheckoutFile,
  gitCheckout,
  gitCommitOnSideBranchOnly,
} from './test-fixtures/brain-lint-truth.ts';

// ---------- never-tracked absent: dropped, not stale ----------

test('themeTruth: a reference absent now AND never tracked in git history is DROPPED from references entirely — not evidence of staleness', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-j', 'never-tracked', { body: `Cites ${BT}src/never-was.go${BT}.\n` });
    // A real git checkout, but src/never-was.go was NEVER committed to it.
    gitCheckout(root, 'proj-j', { 'src/unrelated.go': 'x\n' });

    const [t] = themeTruth(root, 'proj-j');
    assert.deepEqual(t.references, [], `a never-tracked, currently-absent reference must be DROPPED entirely, got ${JSON.stringify(t.references)}`);
    assert.deepEqual(t.missing, []);

    const row = brainTruthRates(root).find((r) => r.project === 'proj-j');
    assert.ok(row, `expected a brainTruthRates row for proj-j, got nothing`);
    assert.equal(row!.unverifiable, 1, `the theme's only ref was dropped, leaving it unverifiable (0 refs), got ${JSON.stringify(row)}`);
    assert.equal(row!.verifiable, 0);
    assert.equal(row!.stale, 0);
  } finally {
    cleanup(root);
  }
});

// ---------- present only on an unmerged side branch: still stale ----------

test('themeTruth: a reference present ONLY on an unmerged side branch is "once tracked" (git log --all scans every ref) — missing/stale on main', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-k', 'unmerged-cite', { body: `Cites ${BT}scaffold/unmerged.go${BT}.\n` });
    const checkoutRoot = gitCheckout(root, 'proj-k', { 'README.md': 'placeholder\n' });
    gitCommitOnSideBranchOnly(checkoutRoot, 'scaffold/unmerged.go', 'package scaffold\n');

    const [t] = themeTruth(root, 'proj-k');
    assert.deepEqual(t.references, ['scaffold/unmerged.go'], `a side-branch-only reference is still kept, got ${JSON.stringify(t.references)}`);
    assert.deepEqual(
      t.missing,
      ['scaffold/unmerged.go'],
      `absent from main's working tree, but "git log --all" finds it on the side branch — once tracked, now gone from THIS branch, so it IS stale, got ${JSON.stringify(t.missing)}`,
    );
  } finally {
    cleanup(root);
  }
});

// ---------- the two hostile-review false-positive shapes: never tracked ----------

test('themeTruth: a Go module version pin (pkg@vX.Y.Z-shaped) and a generated .forge/live-evidence/ artifact, both never tracked, are dropped — not stale (the two false-positive shapes the hostile re-review found)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-l', 'module-pin-and-evidence', {
      body: [
        `Pins ${BT}terraform-plugin-sdk/v2@v2.38.1${BT}.`,
        `Live evidence captured to ${BT}.forge/live-evidence/acceptance-x.json${BT}.`,
        '',
      ].join('\n'),
    });
    // A real git checkout, but NEITHER cited path was ever a tracked file.
    gitCheckout(root, 'proj-l', { 'go.mod': 'module example\n' });

    const [t] = themeTruth(root, 'proj-l');
    assert.deepEqual(t.references, [], `neither the module pin nor the generated evidence path was ever tracked — both dropped, got ${JSON.stringify(t.references)}`);
    assert.deepEqual(t.missing, []);
  } finally {
    cleanup(root);
  }
});

// ---------- history: 'absent' vs 'present' ----------

test('brainTruthRates: a checkout dir that exists but is NOT a git repository (and not inside one) -> checkout:"present", history:"absent", rate:null, and checkThemeTruth yields no finding (never guessed, same rule as an absent checkout)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-m', 'plain-dir-theme', { body: `Cites ${BT}src/whatever.go${BT}.\n` });
    writeCheckoutFile(root, 'proj-m', 'src/placeholder.go'); // plain dir, no `git init`

    const row = brainTruthRates(root).find((r) => r.project === 'proj-m');
    assert.ok(row, `expected a brainTruthRates row for proj-m, got nothing`);
    assert.equal(row!.checkout, 'present', `the dir DOES exist — checkout must still read 'present', got ${JSON.stringify(row)}`);
    assert.equal(row!.history, 'absent', `no git history available — must report history:'absent', got ${JSON.stringify(row)}`);
    assert.equal(row!.rate, null, `no history -> never guessed at -> rate:null, got ${JSON.stringify(row)}`);

    const findings = checkThemeTruth(root).filter((f) => f.file.includes(join('projects', 'proj-m')));
    assert.deepEqual(findings, [], `a history-absent brain must yield NO findings, same rule as a checkout-absent one, got ${JSON.stringify(findings)}`);
  } finally {
    cleanup(root);
  }
});

test('brainTruthRates: a checkout that IS its own git repository -> history:"present"', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-n', 'n-theme', { body: `Cites ${BT}ok/n.go${BT}.\n` });
    gitCheckout(root, 'proj-n', { 'ok/n.go': 'x\n' });

    const row = brainTruthRates(root).find((r) => r.project === 'proj-n');
    assert.ok(row, `expected a brainTruthRates row for proj-n, got nothing`);
    assert.equal(row!.history, 'present', `a real git checkout must report history:'present', got ${JSON.stringify(row)}`);
  } finally {
    cleanup(root);
  }
});

// ---------- D14 security review: git pathspec magic must never apply ----------

test('themeTruth: an evidence: ref carrying git pathspec magic (`src/*.ts`) is judged LITERALLY — it must not read as "once tracked" just because it happens to glob-match an unrelated real tracked file (git log lacked --literal-pathspecs)', () => {
  const root = buildBrainFixture({ themes: [] });
  try {
    writeTruthTheme(root, 'proj-glob', 'glob-theme', { evidence: ['src/*.ts'] });
    // A REAL, unrelated tracked file the glob `src/*.ts` would match — proves
    // the fix is about pathspec MAGIC, not just an absent target.
    gitCheckout(root, 'proj-glob', { 'src/a.ts': 'export const a = 1;\n' });

    const [t] = themeTruth(root, 'proj-glob');
    assert.deepEqual(
      t.references,
      [],
      `"src/*.ts" was never a literally-tracked path — must be dropped, not glob-matched against src/a.ts, got ${JSON.stringify(t.references)}`,
    );
    assert.deepEqual(
      t.missing,
      [],
      `a literal "src/*.ts" must never read as "once tracked" via pathspec magic, got ${JSON.stringify(t.missing)}`,
    );
  } finally {
    cleanup(root);
  }
});
