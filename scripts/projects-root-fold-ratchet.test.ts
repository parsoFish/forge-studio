/**
 * projects-root-fold-ratchet.test.ts — immutable acceptance gate for the NEW
 * projects-root-fold rule in scripts/check-raw-fs-guarded.mjs.
 *
 * THE CLASS THIS CLOSES. The def-use lint (its sibling test check-raw-fs-guarded
 * .test.ts) is structurally blind to one containment-bypass shape: an untrusted
 * value folded INTO a projects root instead of passed as a guarded SEGMENT — e.g.
 * `resolve('projects', projectArg)`. Folding an untrusted id into the guard's ROOT
 * makes any downstream containment check tautological (the root already absorbed
 * the untrusted value), so a later `resolveGuardedPath(root, segs)` vets nothing.
 * The new rule (scanProjectsRootFold + PROJECTS_ROOT_FOLD_ALLOWLIST, wired into
 * runLint) flags a re-introduced fold and fails the build.
 *
 * Discipline (immutable-gates):
 *   - RED-AT-BASE: against the CURRENT ratchet there is no `scanProjectsRootFold`
 *     export, so the named import below fails at link time and the whole file
 *     errors — the file is RED for the rule until the export lands. It is NOT
 *     stubbed to pass.
 *   - The MUTATION case (case 7) is the durable class-closer: it injects a fresh
 *     fold into the REAL source tree and proves the scanner catches it. The
 *     precondition (the mutation is present in the text) is asserted BEFORE the
 *     verdict is read.
 *   - The integration case proves the rule fails an UN-allowlisted fold through
 *     the real runLint pipeline while the audited residual is suppressed.
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
// it, and always clean up. Mirrors the runLint({ root }) contract (runLint reads
// modules relative to `root`), which is what lets a synthetic tree stand in for
// the repo without touching real sources.
// ---------------------------------------------------------------------------
function withFixture(files: Record<string, string>, fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'projects-root-fold-'));
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
// UNIT — the scanner mechanism on synthetic text (independent of real sources)
// =============================================================================

test('1: flags an untrusted identifier folded into a string projects root', () => {
  const findings = scanProjectsRootFold("const p = resolve('projects', projectArg);\n", 'cli/x.ts');
  assert.equal(findings.length, 1, 'exactly one fold finding');
  assert.equal(findings[0].folded, 'projectArg');
});

test('2: flags a member-expression folded into a string projects root', () => {
  const findings = scanProjectsRootFold("const p = resolve('projects', m.project);\n", 'packages/flows/scheduler.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].folded, 'm.project');
});

test('3: a string-literal segment is safe (a fixed name is not an untrusted value)', () => {
  const findings = scanProjectsRootFold("const p = resolve('projects', 'fixedname');\n", 'cli/x.ts');
  assert.equal(findings.length, 0);
});

test('4: a single-arg root resolution is safe (no folded segment)', () => {
  const findings = scanProjectsRootFold("const d = resolve('projects');\n", 'cli/x.ts');
  assert.equal(findings.length, 0);
});

test('5: a commented-out fold is skipped (not code)', () => {
  const findings = scanProjectsRootFold("  // resolve('projects', projectArg) is the fold\n", 'cli/x.ts');
  assert.equal(findings.length, 0);
});

test('6: flags a fold onto an identifier projects-root (projectsRoot form)', () => {
  const findings = scanProjectsRootFold("const p = join(projectsRoot, projectArg);\n", 'cli/x.ts');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].folded, 'projectArg');
});

// =============================================================================
// MUTATION on the REAL tree — the class-closer proof
// =============================================================================

test('7 (MUTATION): a re-introduced fold in the real source tree is caught', () => {
  const realPath = join(REPO_ROOT, 'packages/agents/find-session-project.ts');
  const realText = readFileSync(realPath, 'utf8');

  // Baseline scan of the real source. NOTE (informational, not asserted): before
  // the branch removes the current fold this is >= 1; after, the cmdAgentDispatch
  // fold is routed through the guard. We deliberately do NOT gate on this count —
  // the scanner may still surface unrelated syntactic folds in the file (see the
  // implementer note in the report), so the durable proof is the mutation below.
  const realFindings = scanProjectsRootFold(realText, 'packages/agents/find-session-project.ts');
  assert.ok(Array.isArray(realFindings), 'the scanner returns a findings array on real source');

  // Inject a fresh fold and PROVE the mutation applied before reading any verdict.
  const MUT_LINE = "const repoPath = resolve('projects', projectArg);";
  const mutatedText = `${realText}\n${MUT_LINE}\n`;
  assert.ok(mutatedText.includes(MUT_LINE), 'precondition: the fold mutation is present in the text');

  const mutatedFindings = scanProjectsRootFold(mutatedText, 'packages/agents/find-session-project.ts');
  assert.ok(
    mutatedFindings.length > realFindings.length,
    'the injected fold adds a finding the scanner did not have before',
  );
  assert.ok(
    mutatedFindings.some((f) => f.folded === 'projectArg'),
    'the re-introduced fold is caught with folded === "projectArg"',
  );
});

// =============================================================================
// STRUCTURE — the audited-residual allowlist is well-formed
// =============================================================================

test('8: the fold allowlist carries the audited residual rows, folded-token-keyed', () => {
  assert.ok(Array.isArray(PROJECTS_ROOT_FOLD_ALLOWLIST) && PROJECTS_ROOT_FOLD_ALLOWLIST.length > 0);
  for (const row of PROJECTS_ROOT_FOLD_ALLOWLIST) {
    assert.equal(typeof row.file, 'string');
    assert.equal(typeof row.folded, 'string', 'rows are folded-token-keyed (survives line drift), not line-keyed');
    assert.ok(row.reason && row.reason.trim().length > 0, `row ${row.file}+${row.folded} needs a reason`);
  }
  const has = (file: string, folded: string) =>
    PROJECTS_ROOT_FOLD_ALLOWLIST.some((r) => r.file === file && r.folded === folded);
  assert.ok(has('apps/forge/cli.ts', 'target'), 'the dual-mode name-or-path residual is audited');
  assert.ok(has('packages/flows/scheduler.ts', 'm.project'), 'the guarded-downstream residual is audited');
});

// =============================================================================
// INTEGRATION — runLint fails an un-allowlisted fold, suppresses the residual
// =============================================================================

test('9: runLint FAILS an un-allowlisted fold, suppresses the audited residual', () => {
  withFixture(
    {
      // The audited-trusted dual-mode residual (allowlisted by file+folded).
      'apps/forge/cli.ts': "const asManaged = resolve('projects', target);\n",
      // A fresh, un-audited fold — must fail the build. The fixture subject is
      // `find-session-project.ts` because that is what `PROJECTS_ROOT_FOLD_MODULES`
      // now scopes: M4-agents s3 split `agent-run.ts`, and the real
      // `join(projectsDir, name)` fold left with `findSessionProject`. A fixture
      // planted in a module the scan no longer covers proves nothing.
      'packages/agents/find-session-project.ts': "const p = resolve('projects', evilArg);\n",
      // Remaining fold-scope modules present but benign, so the scan sees a
      // complete module set rather than skipping absent files.
      'packages/agents/agent-dispatch.ts': "export const noop = true;\n",
      'packages/flows/scheduler.ts': "export const noop = true;\n",
    },
    (root) => {
      // Fixture precondition: assert the two folds are on disk before the verdict.
      assert.ok(
        readFileSync(join(root, 'packages/agents/find-session-project.ts'), 'utf8').includes("resolve('projects', evilArg)"),
        'precondition: the un-allowlisted fold is present in the fixture',
      );
      assert.ok(
        readFileSync(join(root, 'apps/forge/cli.ts'), 'utf8').includes("resolve('projects', target)"),
        'precondition: the audited residual fold is present in the fixture',
      );

      const res = runLint({ root });
      // `findings` is the kept array that fails the build (runLint returns
      // { findings: kept, ... }; main() exits 1 on findings.length).
      assert.ok(res.findings.length >= 1, 'the un-allowlisted fold makes the build fail (non-empty kept findings)');
      assert.ok(
        res.findings.some((f) => f.file === 'packages/agents/find-session-project.ts' && f.folded === 'evilArg'),
        'the failing finding is the packages/agents/find-session-project.ts evilArg fold',
      );
      assert.ok(
        !res.findings.some((f) => f.folded === 'target'),
        'the allowlisted apps/forge/cli.ts+target fold is suppressed, not among the build failures',
      );
    },
  );
});

test('10: runLint PASSES when the only fold is an audited residual', () => {
  withFixture(
    {
      'apps/forge/cli.ts': "const asManaged = resolve('projects', target);\n",
      'packages/agents/find-session-project.ts': "export const noop = true;\n",
      'packages/agents/agent-dispatch.ts': "export const noop = true;\n",
      'packages/flows/scheduler.ts': "export const noop = true;\n",
    },
    (root) => {
      assert.ok(
        readFileSync(join(root, 'apps/forge/cli.ts'), 'utf8').includes("resolve('projects', target)"),
        'precondition: the audited residual fold is present in the fixture',
      );
      const res = runLint({ root });
      assert.equal(res.findings.length, 0, 'a tree whose only fold is an audited residual passes clean');
    },
  );
});
