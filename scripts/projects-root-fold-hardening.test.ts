/**
 * projects-root-fold-hardening.test.ts — hardening pins for the PROJECTS-ROOT-FOLD
 * rule in scripts/check-raw-fs-guarded.mjs (SEC-07). Sibling to
 * projects-root-fold-ratchet.test.ts (left untouched — it still pins the base
 * contract and must keep passing).
 *
 * WHY A SECOND FILE. The base rule (scanProjectsRootFold) is a single-line regex
 * tripwire whose own header discloses a set of honest blind spots:
 *   - FOLD-CALLEE: it only matches a bare `join(`/`resolve(` token. A renamed
 *     import binding, a local variable alias, or a namespace/member-form callee
 *     (`ns.join(...)`) can carry the exact same fold shape and go unseen.
 *   - PROJECTS-ROOT: it only recognizes three literal spellings for the root
 *     argument (`'projects'` / `projectsRoot` / `projectsDir`). A root under any
 *     other name — including one whose value traces back to a projects-root call
 *     or a literal `'projects'` path segment through a local binding — is
 *     invisible to it.
 *   - SHAPE: it is single-line only (a call whose arguments span multiple lines
 *     is missed) and it has no template-literal handling at all.
 * On the other side, the SAME crude per-line comment filter and the lack of any
 * string-literal blanking produce FALSE positives: prose inside a block comment
 * whose continuation lines don't start with `*`, or a fold shape merely quoted
 * inside a string literal (e.g. a help/error message), is scanned as if it were
 * live code.
 * Finally, its allowlist is TOKEN-keyed (file + folded) with no occurrence
 * budget — an audited single-occurrence residual silently absorbs ANY number of
 * future, un-audited folds that happen to reuse the same token in the same file.
 *
 * This file pins the HARDENED contract that closes those gaps: callee coverage
 * beyond the bare token, root coverage beyond the three literal spellings
 * (by name pattern AND by binding), template-literal folds, multi-line calls,
 * correct comment/string suppression (no false positives), and a COUNT-AWARE
 * allowlist that only suppresses up to its audited occurrence count.
 *
 * Discipline (immutable-gates): every assertion is on a PROPERTY (finding
 * count, the `folded` token, kept-vs-suppressed sets, allowlist row shape) —
 * never on incidental prose. Every fixture/mutation precondition is asserted
 * BEFORE any verdict is read. Section E is a set of POSITIVE controls so a
 * future "fix" that just fires on every `join`/`resolve` call is caught as a
 * regression too, not only the missed-detection direction.
 *
 * Defensive framing only, per public-repo discipline: this file names lint
 * BLIND SPOTS a hardened scanner must close, not a reproduction of any live
 * exploit against a running system.
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
  runLint,
} from './check-raw-fs-guarded.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Fixture helper — build a throwaway module tree under a tmpdir, run fn against
// it, and always clean up. Mirrors the sibling ratchet's withFixture (and the
// runLint({ root }) contract: runLint reads PROJECTS_ROOT_FOLD_MODULES relative
// to `root`, which is what lets a synthetic tree stand in for the repo).
// ---------------------------------------------------------------------------
function withFixture(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'projects-root-fold-hardening-'));
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

// =============================================================================
// A. FOLD-CALLEE COVERAGE — a fold reached through anything but the bare
// `join(`/`resolve(` token
// =============================================================================

test('A1: a renamed-import callee alias still catches the fold', () => {
  const src = "import { resolve as r } from 'node:path';\nconst p = r('projects', projectArg);\n";
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1, 'exactly one finding through the renamed-import callee');
  assert.equal(findings[0].folded, 'projectArg');
});

test('A2: a local variable alias of resolve/join still catches the fold', () => {
  const src = 'const r = resolve;\nconst p = r(\'projects\', projectArg);\n';
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1, 'exactly one finding through the local-alias callee');
  assert.equal(findings[0].folded, 'projectArg');
});

test('A3: a namespace/member-form callee (path.join) still catches the fold', () => {
  const src = 'const p = path.join(projectsRoot, projectArg);\n';
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1, 'exactly one finding through the namespace-member callee');
  assert.equal(findings[0].folded, 'projectArg');
});

// =============================================================================
// B. PROJECTS-ROOT COVERAGE — a root reached through anything but the three
// literal spellings
// =============================================================================

test('B4: a member-expression root (ctx.projectsRoot) still catches the fold', () => {
  const src = 'const p = join(ctx.projectsRoot, projectArg);\n';
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].folded, 'projectArg');
});

test('B5: differently-NAMED projects-root identifiers (name-pattern family) still catch the fold', () => {
  const src = [
    'const p1 = resolve(projBase, projectArg1);',
    'const p2 = resolve(projectsBase, projectArg2);',
    'const p3 = resolve(PROJECTS_ROOT, projectArg3);',
    '',
  ].join('\n');
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 3, 'all three differently-named projects-root spellings are caught');
  assert.deepEqual(
    findings.map((f) => f.folded).sort(),
    ['projectArg1', 'projectArg2', 'projectArg3'].sort(),
  );
});

test('B6: a root bound BY VALUE to a projects-root call (the name gives no hint) still catches the fold', () => {
  const src = "const anyBase = resolve('projects');\nconst p = join(anyBase, projectArg);\n";
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1, 'the fold onto the value-bound root is caught');
  assert.equal(findings[0].folded, 'projectArg');
});

test('B7: a root bound via a literal "projects" path segment still catches the fold', () => {
  const src = "const anyBase = join(forgeRoot, 'projects');\nconst p = resolve(anyBase, projectArg);\n";
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1, 'the fold onto the literal-segment-bound root is caught');
  assert.equal(findings[0].folded, 'projectArg');
});

// =============================================================================
// C. TEMPLATE-LITERAL FOLDS
// =============================================================================

test('C8: a bare template-literal fold onto the literal "projects" root is caught', () => {
  const src = 'const p = `projects/${projectArg}`;\n';
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].folded, 'projectArg');
});

test('C9: a template-literal fold onto an identifier projects-root is caught', () => {
  const src = 'const p = `${projectsRoot}/${projectArg}`;\n';
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].folded, 'projectArg');
});

// =============================================================================
// D. MULTI-LINE CALL FORM
// =============================================================================

test('D10: a fold call whose arguments span multiple lines is caught', () => {
  const src = "const p = resolve(\n  'projects',\n  projectArg,\n);\n";
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].folded, 'projectArg');
});

// =============================================================================
// E. NO FALSE POSITIVES — positive controls (some already pass at base; kept as
// controls so a future "fires on everything" fix regresses visibly)
// =============================================================================

test('E11: a string-literal second argument (a fixed name) is not a fold', () => {
  const findings = scanProjectsRootFold("resolve('projects', 'fixedname');\n", 'cli/x.ts');
  assert.equal(findings.length, 0);
});

test('E12: a single-arg root resolution has nothing folded', () => {
  const findings = scanProjectsRootFold("resolve('projects');\n", 'cli/x.ts');
  assert.equal(findings.length, 0);
});

test('E13: a line-commented fold is not code', () => {
  const findings = scanProjectsRootFold("  // resolve('projects', projectArg) is the fold\n", 'cli/x.ts');
  assert.equal(findings.length, 0);
});

test('E14: a fold mentioned in block-comment prose (continuation lines without a leading *) is skipped', () => {
  const src = [
    '/*',
    ' * prose describing the shape below',
    "   resolve('projects', projectArg) mentioned here, no leading star",
    ' */',
    '',
  ].join('\n');
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 0, 'block-comment prose must not be scanned as code even without a leading *');
});

test('E15: a fold shape appearing inside a string literal is not code', () => {
  const src = "const help = \"use resolve('projects', name) instead\";\n";
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 0, 'string-literal contents must not be scanned as code');
});

test('E16: a singular per-project root (out of the projects-ROOT class) produces no finding', () => {
  const src = "const src = resolve(projectRepoPath, dir);\nconst a = join(projectDir, '.forge');\n";
  const findings = scanProjectsRootFold(src, 'cli/x.ts');
  assert.equal(findings.length, 0, 'projectRepoPath/projectDir name a SINGLE project dir, not the projects root');
});

// =============================================================================
// F. COUNT-AWARE ALLOWLIST — an audited residual suppresses only its audited
// occurrence count, not every future reuse of the same token
// =============================================================================

test('F17: every fold-allowlist row carries an audited positive-integer occurrence count', () => {
  assert.ok(Array.isArray(PROJECTS_ROOT_FOLD_ALLOWLIST) && PROJECTS_ROOT_FOLD_ALLOWLIST.length > 0);
  for (const row of PROJECTS_ROOT_FOLD_ALLOWLIST) {
    assert.equal(typeof row.file, 'string');
    assert.equal(typeof row.folded, 'string', 'rows stay folded-token-keyed (survives line drift)');
    assert.ok(row.reason && row.reason.trim().length > 0, `row ${row.file}+${row.folded} needs a reason`);
    assert.equal(
      typeof row.count,
      'number',
      `row ${row.file}+${row.folded} must carry an audited occurrence count`,
    );
    assert.ok(
      Number.isInteger(row.count) && row.count > 0,
      `row ${row.file}+${row.folded} count must be a positive integer, got ${row.count}`,
    );
  }
});

test('F18: a surplus occurrence beyond the audited count is kept as ONE build-failing finding', () => {
  withFixture(
    {
      // orchestrator/cli.ts + folded "target" is audited for count 1 in the real
      // allowlist; this fixture holds TWO occurrences of the identical fold.
      'orchestrator/cli.ts': "const a = resolve('projects', target);\nconst b = resolve('projects', target);\n",
      // Remaining fold-scope modules present but benign, so the scan sees a
      // complete module set rather than skipping absent files.
      'cli/agent-run.ts': 'export const noop = true;\n',
      'orchestrator/agent-dispatch.ts': 'export const noop = true;\n',
      'orchestrator/scheduler.ts': 'export const noop = true;\n',
    },
    (root) => {
      const onDisk = readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8');
      assert.equal(
        (onDisk.match(/resolve\('projects', target\)/g) ?? []).length,
        2,
        'precondition: the fixture holds exactly two occurrences of the audited "target" fold',
      );
      const auditedRow = PROJECTS_ROOT_FOLD_ALLOWLIST.find(
        (r) => r.file === 'orchestrator/cli.ts' && r.folded === 'target',
      );
      assert.ok(auditedRow, 'precondition: the real allowlist audits orchestrator/cli.ts + "target"');
      assert.equal(auditedRow.count, 1, 'precondition: the real audit for this token is count 1');

      const res = runLint({ root });
      assert.equal(
        res.findings.length,
        1,
        'exactly one kept finding — the surplus occurrence beyond the audited count (not 0, not 2)',
      );
      assert.equal(res.findings[0].file, 'orchestrator/cli.ts');
      assert.equal(res.findings[0].folded, 'target');
    },
  );
});

test('F19: exactly the audited number of occurrences is fully suppressed (0 kept)', () => {
  withFixture(
    {
      'orchestrator/cli.ts': "const a = resolve('projects', target);\n",
      'cli/agent-run.ts': 'export const noop = true;\n',
      'orchestrator/agent-dispatch.ts': 'export const noop = true;\n',
      'orchestrator/scheduler.ts': 'export const noop = true;\n',
    },
    (root) => {
      assert.ok(
        readFileSync(join(root, 'orchestrator/cli.ts'), 'utf8').includes("resolve('projects', target)"),
        'precondition: the audited-count fold is present in the fixture',
      );
      const res = runLint({ root });
      assert.equal(res.findings.length, 0, 'a tree with exactly the audited occurrence count passes clean');
    },
  );
});

// =============================================================================
// G. NO-FALSE-POSITIVE PIN ON THE REAL TREE — keeps the ratchet honest
// =============================================================================

test('G20: runLint against the real repo root has zero fold findings and no stale fold rows', () => {
  const res = runLint({});
  assert.equal(
    res.findings.length,
    0,
    'the real tree must not trip the fold rule (or any other runLint dimension) after hardening',
  );
  const staleFoldRows = res.stale.filter((s) => typeof s.line === 'string' && s.line.startsWith('fold:'));
  assert.deepEqual(staleFoldRows, [], 'every fold-allowlist row must suppress a real finding — none may go stale');
});

// =============================================================================
// H. MUTATION ON THE REAL TREE — the durable class-closer. Each evasion shape is
// appended to the REAL cli/agent-run.ts text (never written to disk); the
// mutation's presence is asserted BEFORE any verdict is read.
// =============================================================================

test('H21a: a renamed-import/local-alias callee fold, re-introduced into the real tree, is caught', () => {
  const realPath = join(REPO_ROOT, 'cli/agent-run.ts');
  const realText = readFileSync(realPath, 'utf8');
  const realFindings = scanProjectsRootFold(realText, 'cli/agent-run.ts');

  const MUT = "const localResolve = resolve;\nconst mutatedEvasionPath1 = localResolve('projects', evasionTokenAlias);";
  const mutatedText = `${realText}\n${MUT}\n`;
  assert.ok(mutatedText.includes(MUT), 'precondition: the alias-callee mutation is present in the text');

  const mutatedFindings = scanProjectsRootFold(mutatedText, 'cli/agent-run.ts');
  assert.ok(
    mutatedFindings.length > realFindings.length,
    'the alias-callee fold adds a finding beyond the unmutated baseline',
  );
  assert.ok(
    mutatedFindings.some((f) => f.folded === 'evasionTokenAlias'),
    'the re-introduced fold is caught with the injected token',
  );
});

test('H21b: a differently-named-root binding fold, re-introduced into the real tree, is caught', () => {
  const realPath = join(REPO_ROOT, 'cli/agent-run.ts');
  const realText = readFileSync(realPath, 'utf8');
  const realFindings = scanProjectsRootFold(realText, 'cli/agent-run.ts');

  const MUT = "const evasionBase = resolve('projects');\nconst mutatedEvasionPath2 = join(evasionBase, evasionTokenBinding);";
  const mutatedText = `${realText}\n${MUT}\n`;
  assert.ok(mutatedText.includes(MUT), 'precondition: the differently-named-root-binding mutation is present in the text');

  const mutatedFindings = scanProjectsRootFold(mutatedText, 'cli/agent-run.ts');
  assert.ok(
    mutatedFindings.length > realFindings.length,
    'the differently-named-root-binding fold adds a finding beyond the unmutated baseline',
  );
  assert.ok(
    mutatedFindings.some((f) => f.folded === 'evasionTokenBinding'),
    'the re-introduced fold is caught with the injected token',
  );
});

test('H21c: a template-literal fold, re-introduced into the real tree, is caught', () => {
  const realPath = join(REPO_ROOT, 'cli/agent-run.ts');
  const realText = readFileSync(realPath, 'utf8');
  const realFindings = scanProjectsRootFold(realText, 'cli/agent-run.ts');

  const MUT = 'const mutatedEvasionPath3 = `projects/${evasionTokenTemplate}`;';
  const mutatedText = `${realText}\n${MUT}\n`;
  assert.ok(mutatedText.includes(MUT), 'precondition: the template-literal mutation is present in the text');

  const mutatedFindings = scanProjectsRootFold(mutatedText, 'cli/agent-run.ts');
  assert.ok(
    mutatedFindings.length > realFindings.length,
    'the template-literal fold adds a finding beyond the unmutated baseline',
  );
  assert.ok(
    mutatedFindings.some((f) => f.folded === 'evasionTokenTemplate'),
    'the re-introduced fold is caught with the injected token',
  );
});
