/**
 * projects-root-fold-attribution.test.ts — round-2 hardening pins for the
 * PROJECTS-ROOT-FOLD rule (scripts/check-raw-fs-guarded.mjs), added after the
 * adversarial containment review of the round-1 hardening found two gaps that
 * the round-1 pins (projects-root-fold-hardening.test.ts) did not measure.
 *
 * GAP 1 — OCCURRENCE ATTRIBUTION. The count-aware allowlist consumed its
 * audited budget in pure SCAN ORDER, so when a fresh, un-audited fold is
 * introduced ABOVE the audited one, the build still fails (no bypass) but the
 * finding it REPORTS is the old, already-reviewed site. That is worse than a
 * plain miss for the author reading CI: the flagged line looks legitimate
 * because it was audited, and the fastest way to make the failure go away is
 * to raise the row's `count` — which permits the un-reported new site
 * silently. The round-1 pin only asserted "exactly one kept finding" and never
 * asserted WHICH occurrence, so the gap was invisible to it.
 * The contract pinned here: an allowlist row records the LINE it audited, and
 * the occurrences the audit covers are the ones NEAREST that anchor. Line
 * drift therefore still cannot break suppression (the anchor is a hint, never
 * a key), while an INSERTED occurrence is attributed to the new site.
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

test('R1: an allowlist row records the LINE it audited (an attribution anchor, not a key)', () => {
  for (const row of PROJECTS_ROOT_FOLD_ALLOWLIST) {
    assert.equal(
      typeof row.line,
      'number',
      `row ${row.file}+${row.folded} must record the audited line as an attribution anchor`,
    );
    assert.ok(row.line > 0, `row ${row.file}+${row.folded} anchor must be a positive line number`);
  }
});

test('R1: the audited anchors match where the folds actually are in the real tree', () => {
  for (const row of PROJECTS_ROOT_FOLD_ALLOWLIST) {
    const text = readFileSync(join(REPO_ROOT, row.file), 'utf8');
    const found = scanProjectsRootFold(text, row.file).filter((f) => f.folded === row.folded);
    assert.equal(
      found.length,
      row.count,
      `row ${row.file}+${row.folded}: audited count ${row.count} must equal the ${found.length} occurrence(s) actually present`,
    );
    assert.ok(
      found.some((f) => f.line === row.line),
      `row ${row.file}+${row.folded}: the anchor line ${row.line} must be one of the real occurrence lines (${found.map((f) => f.line).join(', ')})`,
    );
  }
});

test('R1: a fold INSERTED ABOVE an audited one is the occurrence reported, not the audited site', () => {
  const anchorRow = PROJECTS_ROOT_FOLD_ALLOWLIST.find((r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target');
  assert.ok(anchorRow, 'precondition: the orchestrator/cli.ts + "target" residual is audited');
  assert.equal(anchorRow!.count, 1, 'precondition: that row audits exactly one occurrence');
  const anchor = anchorRow!.line as number;

  // The audited occurrence sits AT its anchor line; a fresh, un-audited one is
  // inserted well above it (line 4). Padding puts the audited site exactly on
  // the anchor so the fixture mirrors the real file's geometry.
  const NEW_FOLD_LINE = 4;
  const lines: string[] = [];
  lines.push('// fixture');
  lines.push('export const a = 1;');
  lines.push('');
  lines.push("const smuggled = resolve('projects', target);"); // line 4 — the NEW site
  while (lines.length < anchor - 1) lines.push('');
  lines.push("const asManaged = resolve('projects', target);"); // line === anchor
  const text = `${lines.join('\n')}\n`;

  withFixture({ 'orchestrator/cli.ts': text, ...benignScope(['orchestrator/cli.ts']) }, (root) => {
    const onDisk = readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8').split('\n');
    assert.match(onDisk[NEW_FOLD_LINE - 1], /smuggled/, 'precondition: the new fold is on the expected line');
    assert.match(onDisk[anchor - 1], /asManaged/, 'precondition: the audited fold sits on its anchor line');

    const res = runLint({ root });
    const folds = res.findings.filter((f) => f.folded !== undefined);
    assert.equal(folds.length, 1, 'exactly one fold finding is kept (the surplus), not zero and not both');
    assert.equal(
      folds[0].line,
      NEW_FOLD_LINE,
      `the KEPT finding must be the newly inserted site (line ${NEW_FOLD_LINE}), not the audited site (line ${anchor})`,
    );
  });
});

test('R1: line drift alone still suppresses (the anchor is a hint, never a key)', () => {
  const anchorRow = PROJECTS_ROOT_FOLD_ALLOWLIST.find((r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target');
  assert.ok(anchorRow, 'precondition: the audited residual exists');

  // The single audited occurrence, moved far from its recorded anchor.
  const text = `// fixture\n\nconst asManaged = resolve('projects', target);\n`;
  withFixture({ 'orchestrator/cli.ts': text, ...benignScope(['orchestrator/cli.ts']) }, (root) => {
    assert.match(
      readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8'),
      /resolve\('projects', target\)/,
      'precondition: the drifted audited fold is present',
    );
    const res = runLint({ root });
    assert.equal(
      res.findings.filter((f) => f.folded !== undefined).length,
      0,
      'a drifted-but-single audited occurrence is still fully suppressed',
    );
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
