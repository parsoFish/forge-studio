/**
 * W8-B4 (library-34 / library-35) — the ENUMERATION pin the task brief
 * demanded, mirroring cli/bridge-community-registry-crud.test.ts's CRUD-12b
 * idiom ("a pin that fails if the [...] list is ever narrowed/widened
 * again") applied to a DIFFERENT invariant: every fs call that destroys a
 * hook or skill package BY ID must be paired with the matching ledger-prune
 * call, so a hook/skill deleted then recreated byte-identical never
 * silently inherits a stranger's ledger row (approval, in the hook case;
 * install provenance, in the skill case).
 *
 * THE CLASS THIS DEFENDS AGAINST (the campaign's own repeated failure
 * shape): "you gated one of three call paths." A future delete-adjacent
 * route (a new bridge route, a CLI command, an authoring/finalize cleanup,
 * a staging-dir teardown) that reaches for `rmSync`/`unlinkSync`/
 * `rmdirSync`/`renameSync` on a `studio/hooks/<id>` or `skills/<id>`
 * directory must be caught here — not discovered later as a live
 * trust-ledger defect.
 *
 * MECHANISM — two static, PER-FILE checks over cli/ + orchestrator/
 * (deliberately a crude text scan, not a type-checked dataflow engine —
 * same documented-limits register as scripts/check-raw-fs-guarded.mjs):
 *
 *   1. CLASSIFY. A file is a "hook destroy file" when it contains, in real
 *      (non-comment) code, BOTH (a) a destructive call
 *      (rmSync/unlinkSync/rmdirSync/renameSync) AND (b) the hooks
 *      containment idiom this codebase uses everywhere to resolve an id
 *      into `studio/hooks/<id>` — `resolveGuardedPath(hooksDir(...), ...)`
 *      or `guardedFile(hooksDir(...), ...)`. Likewise for skills, rooted at
 *      `skillsDir(`/`skillDir(`. PER-FILE, not per-line/windowed: the two
 *      known sites resolve their guard through a shared helper function
 *      (`locateHook` in bridge-studio-hooks.ts) many lines above the
 *      destructive call, so a bounded same-function backscan cannot see it
 *      without a real dataflow engine — the file-level co-occurrence is the
 *      simplest check that still correctly excludes every OTHER destroy
 *      call in the tree, WITH ONE PROVEN EXCEPTION this test itself caught
 *      (not the accompanying hand-audit — see HOOK_CENSUS_ALLOWLIST below):
 *      cli/bridge-studio-authoring.ts combines an unrelated staging-cleanup
 *      rmSync with a hooksDir(...)-rooted guard used by a different,
 *      create-only code path. Verified by hand (2026-08-23 W8-B4) for every
 *      OTHER destroy-verb site in the tree — in particular
 *      cli/bridge-studio-writes.ts's agent-delete (:1342) and flow-delete
 *      (:2193) routes reference NEITHER `hooksDir(` nor `skillsDir(`/
 *      `skillDir(` anywhere as real code, and orchestrator/project-create.ts's
 *      `skillsDir(forgeRoot)` reference is a bare `join()`, never wrapped in
 *      a guard producer, so neither matches.
 *
 *   2. The classified file-SET must equal EXACTLY the known, audited
 *      production call path for each kind — `cli/bridge-studio-hooks.ts`
 *      (the DELETE route, library-34) / `cli/bridge-studio-skills.ts` (the
 *      DELETE route, library-35) — plus any AUDITED false positive named in
 *      HOOK_CENSUS_ALLOWLIST below, each with a mandatory reason (mirrors
 *      scripts/check-raw-fs-guarded.mjs's own ALLOWLIST idiom). A file
 *      appearing that is neither the known site nor allowlisted fails the
 *      test BY NAME, forcing a look — the list must grow consciously, never
 *      silently.
 *
 *   3. PAIRING (the load-bearing assertion — RED before the fix, GREEN
 *      after): each classified file must ALSO contain, in real code, the
 *      matching ledger-prune call — `revokeHookApprovalIfPresent(`
 *      (orchestrator/studio/hook-scan.ts) for a hook file,
 *      `removeInstallLedgerEntry(` (orchestrator/studio/skill-install-ledger.ts)
 *      for a skill file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DESTROY_VERB_RE = /\b(rmSync|unlinkSync|rmdirSync|renameSync)\s*\(/;
const HOOK_GUARD_RE = /\b(resolveGuardedPath|guardedFile)\s*\(\s*hooksDir\s*\(/;
const SKILL_GUARD_RE = /\b(resolveGuardedPath|guardedFile)\s*\(\s*(skillsDir|skillDir)\s*\(/;
const HOOK_PRUNE_RE = /\brevokeHookApprovalIfPresent\s*\(/;
const SKILL_PRUNE_RE = /\bremoveInstallLedgerEntry\s*\(/;

/** Same crude, DOCUMENTED comment filter check-raw-fs-guarded.mjs's own
 *  header states it uses — a token inside a `/** ... *​/`-style or `//`
 *  comment must not count as a real reference. */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

function listTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      listTsFiles(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

interface FileScan {
  file: string; // repo-relative, POSIX separators
  hasDestroyVerb: boolean;
  hasHookGuard: boolean;
  hasSkillGuard: boolean;
  hasHookPrune: boolean;
  hasSkillPrune: boolean;
}

function scanFile(absPath: string): FileScan {
  const lines = readFileSync(absPath, 'utf8').split('\n').filter((l) => !isCommentLine(l));
  const rel = relative(REPO_ROOT, absPath).split('\\').join('/');
  return {
    file: rel,
    hasDestroyVerb: lines.some((l) => DESTROY_VERB_RE.test(l)),
    hasHookGuard: lines.some((l) => HOOK_GUARD_RE.test(l)),
    hasSkillGuard: lines.some((l) => SKILL_GUARD_RE.test(l)),
    hasHookPrune: lines.some((l) => HOOK_PRUNE_RE.test(l)),
    hasSkillPrune: lines.some((l) => SKILL_PRUNE_RE.test(l)),
  };
}

function scanTree(): FileScan[] {
  const files = [...listTsFiles(join(REPO_ROOT, 'cli')), ...listTsFiles(join(REPO_ROOT, 'orchestrator'))];
  return files.map(scanFile);
}

/**
 * AUDITED FALSE POSITIVES on the whole-file (not line-adjacent) heuristic —
 * mirrors scripts/check-raw-fs-guarded.mjs's own ALLOWLIST idiom: file +
 * mandatory reason, never a silent skip. A file here is exempted from the
 * "must call the prune function" PAIRING assertion, but stays in the
 * expected classified-file list the CENSUS assertion checks — so a REAL new
 * hook-destroying site later added to this same file is still visible to a
 * reviewer reading the expected-files list, even though its pairing is not
 * mechanically enforced.
 *
 * cli/bridge-studio-authoring.ts — the interactive-authoring FINALIZE route's
 * `finally` block (rmSync at :673, discovered by THIS test 2026-08-23 W8-B4 —
 * missed by the accompanying hand-audit) removes
 * `_interactive-library/<id>/`, the STAGING/landed-draft scratch area a
 * finalize turn writes to BEFORE `finalizeHookFromLanded` copies it into
 * `studio/hooks/<id>` — never the installed hook package itself, and the
 * cleanup fires regardless of outcome (success or failure), after the real
 * install step has already run (or been reverted). `hooksDir(...)` is used
 * elsewhere in this file by `finalizeHookFromLanded` — a CREATE-only writer
 * with a 409-on-exists guard, never a delete — which is what the whole-file
 * co-occurrence heuristic actually saw; it cannot see that these are two
 * unrelated call sites. Verified by hand.
 */
const HOOK_CENSUS_ALLOWLIST: Record<string, string> = {
  'cli/bridge-studio-authoring.ts':
    'FINALIZE route cleanup of `_interactive-library/<id>/` staging (rmSync at :673) — not the installed ' +
    'studio/hooks/<id> package. hooksDir(...) is used elsewhere in this file only by the CREATE-only ' +
    'finalizeHookFromLanded (409-on-exists, never deletes).',
};

test('ENUMERATION (library-34 class): every hook-package-destroying module is the known DELETE route (plus audited false positives), and calls revokeHookApprovalIfPresent', () => {
  const scans = scanTree();
  const hookDestroyFiles = scans.filter((s) => s.hasDestroyVerb && s.hasHookGuard);
  const files = hookDestroyFiles.map((s) => s.file).sort();
  const expected = ['cli/bridge-studio-hooks.ts', ...Object.keys(HOOK_CENSUS_ALLOWLIST)].sort();
  assert.deepEqual(
    files,
    expected,
    `a module combining a destructive fs call with the hooksDir(...) containment idiom appeared where ` +
      `not expected (or a known one vanished) — found in: [${files.join(', ')}], expected: [${expected.join(', ')}]. ` +
      `A NEW delete-adjacent route touching studio/hooks/<id> MUST call revokeHookApprovalIfPresent(...) ` +
      `(orchestrator/studio/hook-scan.ts) before removing the package directory, or a hook deleted then ` +
      `recreated byte-identical silently inherits the old ledger row's approval (library-34). If this file ` +
      `is a legitimate new hook-destroying site, add it here deliberately alongside its prune call; if it is ` +
      `another audited false positive (like bridge-studio-authoring.ts's staging cleanup), add a REASONED ` +
      `entry to HOOK_CENSUS_ALLOWLIST above — never a silent skip.`,
  );
  for (const s of hookDestroyFiles) {
    if (s.file in HOOK_CENSUS_ALLOWLIST) continue; // audited false positive, reasoned above
    assert.ok(
      s.hasHookPrune,
      `${s.file} destroys a hook package (rmSync/unlinkSync/rmdirSync/renameSync) but never calls ` +
        `revokeHookApprovalIfPresent(...) anywhere in the file (library-34).`,
    );
  }
});

test('ENUMERATION (library-35 class): every skill-package-destroying module is the known DELETE route, and calls removeInstallLedgerEntry', () => {
  const scans = scanTree();
  const skillDestroyFiles = scans.filter((s) => s.hasDestroyVerb && s.hasSkillGuard);
  const files = skillDestroyFiles.map((s) => s.file);
  assert.deepEqual(
    files,
    ['cli/bridge-studio-skills.ts'],
    `a module combining a destructive fs call with the skillsDir(...)/skillDir(...) containment idiom ` +
      `appeared where not expected (or the known one vanished) — found in: [${files.join(', ')}]. A NEW ` +
      `delete-adjacent route touching skills/<id> MUST call removeInstallLedgerEntry(...) ` +
      `(orchestrator/studio/skill-install-ledger.ts) before removing the package directory, or a fresh ` +
      `hand-authored skill later reusing that id inherits a stranger's provenance row and is wrongly ` +
      `needs-review (library-35). If this file is a legitimate new skill-destroying site, add it here ` +
      `deliberately alongside its prune call.`,
  );
  for (const s of skillDestroyFiles) {
    assert.ok(
      s.hasSkillPrune,
      `${s.file} destroys a skill package (rmSync/unlinkSync/rmdirSync/renameSync) but never calls ` +
        `removeInstallLedgerEntry(...) anywhere in the file (library-35).`,
    );
  }
});
