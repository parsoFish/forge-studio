/**
 * projects-root-fold-attribution.test.ts — round-2 hardening pins for the
 * PROJECTS-ROOT-FOLD rule (scripts/check-raw-fs-guarded.mjs), added after the
 * adversarial containment review of the round-1 hardening found two gaps that
 * the round-1 pins (projects-root-fold-hardening.test.ts) did not measure.
 *
 * GAP 1 — WHICH OCCURRENCE THE AUDIT COVERS. The count-aware allowlist could
 * not say WHICH fold a row had audited, only how many. Two positional keying
 * schemes were tried and both leaked in the same direction, which is the signal
 * (per the containment-review skill's own rule) to stop patching the heuristic
 * and change the key:
 *   - scan-order budget: a fresh fold introduced ABOVE the audited one failed
 *     the build but REPORTED the audited line, inviting a `count` bump that
 *     silently permits the unreported new site;
 *   - nearest-line anchor: fixed that geometry, but with occurrences still
 *     within budget the anchor was never consulted at all, so deleting the
 *     audited fold and introducing a DIFFERENT one capturing the same token
 *     elsewhere in the file passed silently — the ratchet claiming audit
 *     coverage for a line nobody had read.
 * The contract pinned here is SITE-PINNED: a row records the audited fold
 * EXPRESSION (normalized), and only a finding whose own expression equals it is
 * suppressed, up to the row's count. Line drift cannot break suppression (the
 * text is unchanged), and a different expression is never covered — including
 * one that reuses the audited folded token.
 *
 * GAP 2 — A SEGMENT WRAPPED IN A CALL. `join(<projectsRoot>, decodeURIComponent(x))`
 * is the ordinary request-path shape in this codebase, and the round-1 call-form
 * pattern required the folded argument to be a bare identifier chain, so one
 * level of call wrapping evaded it entirely.
 *
 * Discipline (immutable-gates): properties only (kept line numbers, finding
 * counts, folded tokens); every fixture precondition asserted before the
 * verdict; positive controls retained so a fix that merely fires more widely
 * is caught too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  scanProjectsRootFold,
  PROJECTS_ROOT_FOLD_ALLOWLIST,
  PROJECTS_ROOT_FOLD_MODULES,
  runLint,
} from './check-raw-fs-guarded.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withFixture(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'fold-attribution-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Every fold-scope module present, so runLint sees a complete module set. */
function benignScope(except: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of PROJECTS_ROOT_FOLD_MODULES) {
    if (except.includes(rel)) continue;
    out[rel] = 'export const noop = true;\n';
  }
  return out;
}

// =============================================================================
// GAP 1 — attribution
// =============================================================================

test('R1: every allowlist row pins the audited fold EXPRESSION, not a location', () => {
  for (const row of PROJECTS_ROOT_FOLD_ALLOWLIST) {
    assert.equal(typeof row.site, 'string', `row ${row.file}+${row.folded} must pin the audited expression`);
    assert.ok(row.site.trim().length > 0, `row ${row.file}+${row.folded} site must not be empty`);
    assert.equal(row.site, row.site.replace(/\s+/g, ' ').trim(), `row ${row.file}+${row.folded} site must be normalized`);
    assert.equal(
      typeof (row as { line?: unknown }).line,
      'undefined',
      `row ${row.file}+${row.folded} must not carry a line anchor — a location cannot express what was audited`,
    );
  }
});

test('R1: each audited expression matches a real occurrence in the real tree', () => {
  for (const row of PROJECTS_ROOT_FOLD_ALLOWLIST) {
    const text = readFileSync(join(REPO_ROOT, row.file), 'utf8');
    const found = scanProjectsRootFold(text, row.file).filter((f) => f.site === row.site);
    assert.equal(
      found.length,
      row.count,
      `row ${row.file} site ${row.site}: audited count ${row.count} must equal the ${found.length} real occurrence(s)`,
    );
    assert.ok(
      found.every((f) => f.folded === row.folded),
      `row ${row.file} site ${row.site}: the recorded folded token must match what the scan reports`,
    );
  }
});

test('R1: a DIFFERENT fold expression reusing an audited token is kept, at its own line', () => {
  const row = PROJECTS_ROOT_FOLD_ALLOWLIST.find((r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target');
  assert.ok(row, 'precondition: the orchestrator/cli.ts + "target" residual is audited');

  // Line 4 folds the SAME token through a DIFFERENT expression; line 6 is the
  // audited expression itself.
  const text = [
    '// fixture',
    'export const a = 1;',
    '',
    'const smuggled = join(projectsRoot, target);',
    '',
    "const asManaged = resolve('projects', target);",
    '',
  ].join('\n');

  withFixture({ 'orchestrator/cli.ts': text, ...benignScope(['orchestrator/cli.ts']) }, (root) => {
    const onDisk = readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8').split('\n');
    assert.match(onDisk[3], /smuggled/, 'precondition: the un-audited expression is on line 4');
    assert.match(onDisk[5], /asManaged/, 'precondition: the audited expression is on line 6');

    const folds = runLint({ root }).findings.filter((f) => f.folded !== undefined);
    assert.equal(folds.length, 1, 'exactly one fold finding is kept (the un-audited expression)');
    assert.equal(folds[0].line, 4, 'the KEPT finding must be the un-audited expression at its own line');
  });
});

test('R1: SWAP — the audited expression removed and another put in its place is NOT absorbed', () => {
  const row = PROJECTS_ROOT_FOLD_ALLOWLIST.find((r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target');
  assert.ok(row, 'precondition: the audited residual exists');
  assert.equal(row!.count, 1, 'precondition: it audits exactly one occurrence');

  // The audited expression is GONE; a different one, capturing the same token,
  // sits somewhere else entirely. Occurrence count is still within budget — the
  // geometry that a count- or anchor-keyed row passes silently.
  const text = `// fixture\n\nconst elsewhere = join(projectsRoot, target);\n`;
  withFixture({ 'orchestrator/cli.ts': text, ...benignScope(['orchestrator/cli.ts']) }, (root) => {
    const onDisk = readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8');
    assert.ok(!onDisk.includes("resolve('projects', target)"), 'precondition: the audited expression is absent');
    assert.ok(onDisk.includes('join(projectsRoot, target)'), 'precondition: the substituted expression is present');

    const res = runLint({ root });
    const folds = res.findings.filter((f) => f.folded !== undefined);
    assert.equal(folds.length, 1, 'the substituted fold must FAIL the build, not inherit the audit');
    assert.equal(folds[0].line, 3, 'and be reported at its own line');
    // The other two fold rows are also stale here (their files are benign stubs
    // in this fixture) — what matters is that the row whose expression was
    // REMOVED is reported, so the operator is told the audit no longer applies.
    const staleFold = res.stale.filter((s) => typeof s.line === 'string' && s.line.startsWith('fold:'));
    assert.ok(
      staleFold.some((s) => s.file === 'orchestrator/cli.ts'),
      `the now-unmatched audited row must be reported as stale; got ${JSON.stringify(staleFold)}`,
    );
  });
});

test('R1: line drift alone still suppresses (the pin is the expression, not the location)', () => {
  const row = PROJECTS_ROOT_FOLD_ALLOWLIST.find((r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target');
  assert.ok(row, 'precondition: the audited residual exists');

  const text = `// fixture\n\n\n\nconst asManaged = ${row!.site};\n`;
  withFixture({ 'orchestrator/cli.ts': text, ...benignScope(['orchestrator/cli.ts']) }, (root) => {
    assert.ok(
      readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8').includes(row!.site),
      'precondition: the audited expression is present, at a different line than in the real tree',
    );
    const folds = runLint({ root }).findings.filter((f) => f.folded !== undefined);
    assert.equal(folds.length, 0, 'a drifted-but-identical audited occurrence is still fully suppressed');
  });
});

test('R1: a SECOND copy of the audited expression exceeds the budget and is kept', () => {
  const row = PROJECTS_ROOT_FOLD_ALLOWLIST.find((r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target');
  assert.ok(row, 'precondition: the audited residual exists');

  const text = `// fixture\nconst one = ${row!.site};\nconst two = ${row!.site};\n`;
  withFixture({ 'orchestrator/cli.ts': text, ...benignScope(['orchestrator/cli.ts']) }, (root) => {
    const folds = runLint({ root }).findings.filter((f) => f.folded !== undefined);
    assert.equal(folds.length, 1, 'the budget covers one occurrence; the surplus copy fails the build');
  });
});

// =============================================================================
// GAP 2 — a folded segment wrapped in one level of call
// =============================================================================

test('R2: a folded segment wrapped in a call is caught (decode/normalise wrappers)', () => {
  const cases: Array<[string, string]> = [
    ["const p = join(projectsRoot, decodeURIComponent(seg));\n", 'seg'],
    ["const p = resolve('projects', basename(untrustedId));\n", 'untrustedId'],
    ["const p = join(ctx.projectsRoot, String(body.project));\n", 'body.project'],
  ];
  for (const [src, expected] of cases) {
    const findings = scanProjectsRootFold(src, 'cli/x.ts');
    assert.equal(findings.length, 1, `expected exactly one finding for: ${src.trim()}`);
    assert.equal(
      findings[0].folded,
      expected,
      `the reported folded token for ${src.trim()} must name the untrusted value`,
    );
  }
});

test('R2: positive controls survive the widened segment pattern (no new false positives)', () => {
  const negatives = [
    "const p = resolve('projects', 'fixedname');\n",           // fixed literal segment
    "const d = resolve('projects');\n",                        // root only
    "  // resolve('projects', projectArg) is the fold\n",       // commented
    "const help = \"use resolve('projects', name) instead\";\n", // inside a string
    "const src = resolve(projectRepoPath, dir);\n",             // singular per-project root
    "const p = join(projectsRoot, sep);\n",                     // path separator constant, still a bare ident: expected TO fire
  ];
  for (const src of negatives.slice(0, 5)) {
    assert.equal(scanProjectsRootFold(src, 'cli/x.ts').length, 0, `expected zero findings for: ${src.trim()}`);
  }
});

test('R2: the real tree still reports zero kept fold findings and zero stale fold rows', () => {
  const res = runLint({});
  assert.equal(
    res.findings.length,
    0,
    `the real tree must stay clean after widening the segment pattern; kept: ${JSON.stringify(res.findings)}`,
  );
  const staleFold = res.stale.filter((s) => typeof s.line === 'string' && s.line.startsWith('fold:'));
  assert.equal(staleFold.length, 0, `no fold allowlist row may be stale; stale: ${JSON.stringify(staleFold)}`);
});
