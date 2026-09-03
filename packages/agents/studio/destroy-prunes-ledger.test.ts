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
 * ============================================================================
 * W8-B4 FIX-2 (2026-08-23) — the classifier itself had a blind spot a LIVE
 * path walked through: this file's own PROVEN EXCEPTION list below claimed
 * "cli/bridge-studio-writes.ts's agent-delete (:1342) ... reference[s]
 * NEITHER `hooksDir(...)` nor `skillsDir(...)`/`skillDir(...)` anywhere as
 * real code." That claim was FALSE — bridge-studio-writes.ts imports
 * `skillsDir` under an alias (`import { skillsDir as toSkillsDir, ... }`)
 * and calls `resolveGuardedPath(toSkillsDir(ctx.forgeRoot), [slug,
 * 'SKILL.md'])` at its agent-DELETE route, exactly the shape this test
 * exists to catch — the old regex just never learned the file's own local
 * spelling for the function. An adversarial reviewer (S2) reproduced the
 * live consequence: install a skill (real ledger row) -> hand-edit its
 * SKILL.md to drop `provenance` and add a `runtime:` block (making
 * `isStudioAgent()` true) -> DELETE it through the agent-DELETE route ->
 * the ledger row survives -> a later, unrelated hand-authored skill
 * reusing the id inherits it and reads back `needs-review` /
 * `provenance-tampered` — library-35's exact bug through a fourth path.
 *
 * The fix has three parts, all below:
 *
 *   (a) PRODUCTION FIX — cli/bridge-studio-writes.ts's agent-DELETE route
 *       now calls `removeInstallLedgerEntry` before its `rmSync`, mirroring
 *       cli/bridge-studio-skills.ts's DELETE route. See
 *       cli/bridge-studio-writes-ledger-prune.test.ts for the live-bridge
 *       reproduction pins (pin 2: the reviewer's repro, asserting the
 *       ARTIFACT — the ledger file's content and the recreated skill's
 *       trust — not a status code; pin 3: a no-ledger-row delete control).
 *
 *   (b) CLASSIFIER FIX — `hasGuardUsage` below resolves each file's own
 *       import aliases (`resolveImportAliases`) before matching, so
 *       `toSkillsDir(` is recognized as `skillsDir` the same as the
 *       unaliased spelling — for ANY alias name, not just this one (see the
 *       "alias-blindness" pins). It is ALSO now whitespace-tolerant across
 *       the WHOLE file rather than line-scoped, which for free closes the
 *       "guard call wrapped across multiple lines" shape, and recognizes
 *       ONE-HOP intermediate variables (`const dir = hooksDir(root); ...;
 *       resolveGuardedPath(dir, ...)`) — see the "intermediate-variable /
 *       multi-line" pins. What is deliberately NOT attempted, and why, is
 *       documented on `hasGuardUsage` itself.
 *
 *   (c) THIS COMMENT — the false hand-audit claim above (superseded; the
 *       corrected claim is in MECHANISM point 1 below) is why a wrong claim
 *       left in a test is inherited by whoever reads it next. Never again
 *       described as "verified by hand" without the verification actually
 *       having covered every real spelling a file can use.
 * ============================================================================
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
 *      or `guardedFile(hooksDir(...), ...)`, under WHATEVER LOCAL NAME the
 *      file imports `hooksDir` as (see `hasGuardUsage`). Likewise for
 *      skills, rooted at `skillsDir(`/`skillDir(` (or an alias of either).
 *      PER-FILE, not per-line/windowed: the two known sites resolve their
 *      guard through a shared helper function (`locateHook` in
 *      bridge-studio-hooks.ts) many lines above the destructive call, so a
 *      bounded same-function backscan cannot see it without a real
 *      dataflow engine — the file-level co-occurrence is the simplest check
 *      that still correctly excludes every OTHER destroy call in the tree,
 *      WITH ONE PROVEN EXCEPTION this test itself caught (not the
 *      accompanying hand-audit — see HOOK_CENSUS_ALLOWLIST below):
 *      cli/bridge-studio-authoring.ts combines an unrelated staging-cleanup
 *      rmSync with a hooksDir(...)-rooted guard used by a different,
 *      create-only code path. Verified by hand (2026-08-23 W8-B4, RE-verified
 *      W8-B4 FIX-2 against the alias-aware classifier) for every OTHER
 *      destroy-verb site in the tree — in particular
 *      cli/bridge-studio-writes.ts's FLOW-delete route (:2193 area) resolves
 *      its guard root from `flowsBase = resolve(ctx.forgeRoot, 'studio',
 *      'flows')`, never `hooksDir`/`skillsDir`/`skillDir` under any import
 *      or alias, so it correctly does not match; ITS agent-DELETE route DOES
 *      match now (see the FIX-2 header above — this is no longer excluded,
 *      it is the second known production site, listed in the CENSUS below
 *      alongside its required prune call). orchestrator/project-create.ts's
 *      `skillsDir(forgeRoot)` reference is a bare `join(skillsDir(forgeRoot),
 *      ...)`, never wrapped in `resolveGuardedPath`/`guardedFile` (directly
 *      or via a traced one-hop variable), so it still does not match.
 *
 *   2. The classified file-SET must equal EXACTLY the known, audited
 *      production call path for each kind — `cli/bridge-studio-hooks.ts`
 *      (the DELETE route, library-34) / `cli/bridge-studio-skills.ts` +
 *      `cli/bridge-studio-writes.ts` (the skills DELETE route and the
 *      agents DELETE route respectively, library-35) — plus any AUDITED
 *      false positive named in HOOK_CENSUS_ALLOWLIST below, each with a
 *      mandatory reason (mirrors scripts/check-raw-fs-guarded.mjs's own
 *      ALLOWLIST idiom). A file appearing that is neither a known site nor
 *      allowlisted fails the test BY NAME, forcing a look — the list must
 *      grow consciously, never silently.
 *
 *   3. PAIRING (the load-bearing assertion — RED before the fix, GREEN
 *      after): each classified file must ALSO contain, in real code
 *      (through whatever local alias it imports under), the matching
 *      ledger-prune call — `revokeHookApprovalIfPresent(`
 *      (orchestrator/studio/hook-scan.ts) for a hook file,
 *      `removeInstallLedgerEntry(` (orchestrator/studio/skill-install-ledger.ts)
 *      for a skill file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Destroy-verb detection is intentionally left NAME-LITERAL, not alias-
// resolved: every real destroy-verb call site in the tree today imports
// rmSync/unlinkSync/rmdirSync/renameSync UNALIASED, bare, from 'node:fs' —
// grepping the literal spelling has zero observed false-negative risk. A
// `import { rmSync as nuke } from 'node:fs'` alias would evade this (a
// documented limit, same register as check-request-path-sinks.mjs's own
// "ALIASED / DYNAMICALLY-DISPATCHED SINKS ARE INVISIBLE" caveat) — closing
// it is a matter of reusing `resolveImportAliases` below for the verb names
// too, deferred because it defends against a shape that has never occurred
// here, unlike the guard-function alias this fix closes (which was live).
const DESTROY_VERB_RE = /\b(rmSync|unlinkSync|rmdirSync|renameSync)\s*\(/;

/**
 * Files that trip the FILE-scoped census without destroying a skill package,
 * mapped to the witness pattern for what they DO destroy. Each is re-derived
 * every run by the loop in the enumeration test below — an entry here buys a
 * file nothing if one of its destroy verbs ever names a skill path.
 */
const DESTROY_VERBS_NOT_SKILL_SCOPED = new Map<string, RegExp>([
  // M4-agents routes carve: its agent-DELETE route moved to
  // `packages/agents/bridge-agents-studio.ts` (registered in the census below,
  // with its prune). What remains is the FLOW delete.
  ['cli/bridge-studio-writes.ts', /rmSync\(dirname\(flowYamlPath\)/],
]);

const GUARD_CALL_NAMES = ['resolveGuardedPath', 'guardedFile'];

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * W8-B4 FIX-2 — parse every `import { X, Y as Z, type W } from '...'`
 * statement in `code` (single- OR multi-line — this codebase's own style
 * almost always wraps a long named-import list across lines, e.g.
 * bridge-studio-hooks.ts's own `hooksDir` import) and return a
 * local-binding-name -> original-exported-name map. An unaliased import
 * (`{ Z }`) maps to itself, so a lookup by ORIGINAL name finds both the
 * aliased and unaliased local spelling uniformly — the fix for the exact
 * blind spot library-35's fourth path exploited: the old classifier grepped
 * for the literal call-site spelling `skillsDir(`, which
 * cli/bridge-studio-writes.ts's `import { skillsDir as toSkillsDir, ... }`
 * never produces (the file calls `toSkillsDir(`, a spelling the old regex
 * had never heard of), so the whole file silently fell out of BOTH the
 * census and the pairing assertion.
 */
function resolveImportAliases(code: string): Map<string, string> {
  const aliasMap = new Map<string, string>();
  const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(code))) {
    for (const rawItem of m[1].split(',')) {
      const item = rawItem.trim().replace(/^type\s+/, '').trim();
      if (!item) continue;
      const asMatch = item.match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) {
        aliasMap.set(asMatch[2], asMatch[1]); // local -> original
      } else {
        aliasMap.set(item, item); // unaliased: local === original
      }
    }
  }
  return aliasMap;
}

/** Every LOCAL name (aliased or not) this file imports under any of `originals`. */
function localNamesFor(aliasMap: Map<string, string>, originals: string[]): string[] {
  const out: string[] = [];
  for (const [local, original] of aliasMap) {
    if (originals.includes(original)) out.push(local);
  }
  return out;
}

/**
 * Does `code` (comment-stripped, WHOLE file, newlines intact — not a
 * per-line scan) contain a call to resolveGuardedPath(...)/guardedFile(...)
 * rooted at one of `localNames` — the file's own local spelling(s) of a
 * canonical guard-producing function, already resolved through
 * `resolveImportAliases`?
 *
 * TWO shapes are recognized (W8-B4 FIX-2), closing two of the three gaps
 * this test itself found (2026-08-23):
 *
 *   1. DIRECT, possibly MULTI-LINE:
 *        resolveGuardedPath(
 *          hooksDir(forgeRoot),
 *          [id, 'hook.yaml'],
 *        )
 *      is still one call expression whose only separator between the outer
 *      and inner call is whitespace, and regex `\s` already matches `\n` —
 *      so matching against the WHOLE file's text (not a per-line scan)
 *      closes this shape for free, no extra tracking needed.
 *
 *   2. ONE-HOP INTERMEDIATE VARIABLE:
 *        const dir = hooksDir(forgeRoot);
 *        ...
 *        resolveGuardedPath(dir, [id, 'hook.yaml']);
 *      — the exact synthetic shape the adversarial reviewer (S2) built to
 *      defeat the line-scoped original ("an entirely ordinary style").
 *      Any `const/let/var IDENT = <localName>(...)` assignment is a
 *      candidate; IDENT counts as a guard root if it later appears as the
 *      FIRST argument of resolveGuardedPath/guardedFile anywhere in the
 *      file.
 *
 * CHOSEN APPROACH, AND WHY NOT A BLANKET "FAIL LOUD ON ANYTHING I CANNOT
 * PROVE CLEAN": a true dataflow engine is out of scope for a regex-class
 * checker (documented, same register as check-raw-fs-guarded.mjs). The
 * residual gap beyond the two shapes above — a SECOND hop
 * (`const a = hooksDir(root); const b = a; resolveGuardedPath(b, ...)`), a
 * reassignment, or the guard root threaded through a helper function call —
 * is real and NOT claimed to be closed. A blanket rule ("any file that
 * assigns a hooksDir/skillsDir/skillDir call to a variable AND has a
 * destroy verb, but doesn't provably route that variable into a guard, must
 * fail the test") was considered and REJECTED after checking it against the
 * live tree: it fires on real, audited-safe code in THIS SAME FILE
 * (cli/bridge-studio-writes.ts assigns `toSkillsDir(ctx.forgeRoot)` to a
 * read-only local consumed only by `listAgentDefinitions(...)` — never a
 * guard call — at its flow-PUT route, nothing to do with any delete path).
 * A rule that fires on genuinely unrelated code trains the next author to
 * `--write`/allowlist past it without reading, which is the exact failure
 * mode a ratchet exists to prevent — noise destroys a gate's authority.
 * The two shapes handled above are the two the reviewer actually
 * demonstrated; anything deeper is a documented limit, not a silent one.
 */
function hasGuardUsage(code: string, localNames: string[]): boolean {
  if (localNames.length === 0) return false;
  const alt = localNames.map(escapeRegExp).join('|');
  const directRe = new RegExp(`\\b(?:${GUARD_CALL_NAMES.join('|')})\\s*\\(\\s*(?:${alt})\\s*\\(`);
  if (directRe.test(code)) return true;

  const assignRe = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${alt})\\s*\\(`, 'g');
  const candidates = new Set<string>();
  let am: RegExpExecArray | null;
  while ((am = assignRe.exec(code))) candidates.add(am[1]);
  for (const v of candidates) {
    const useRe = new RegExp(`\\b(?:${GUARD_CALL_NAMES.join('|')})\\s*\\(\\s*${escapeRegExp(v)}\\s*[,)]`);
    if (useRe.test(code)) return true;
  }
  return false;
}

/** Alias-resolved "is `nameOriginal` (however locally aliased) called anywhere in `code`?" */
function hasCallTo(code: string, localNames: string[]): boolean {
  if (localNames.length === 0) return false;
  const alt = localNames.map(escapeRegExp).join('|');
  return new RegExp(`\\b(?:${alt})\\s*\\(`).test(code);
}

interface FileScan {
  file: string; // repo-relative, POSIX separators
  hasDestroyVerb: boolean;
  hasHookGuard: boolean;
  hasSkillGuard: boolean;
  hasHookPrune: boolean;
  hasSkillPrune: boolean;
}

/** Pure, source-string entry point — lets the alias/multi-line/intermediate-
 *  variable pins exercise the real classifier against a synthetic fixture
 *  without writing a file into the scanned tree (which would pollute the
 *  CENSUS assertions below). `scanFile` is a thin disk-reading wrapper
 *  around this. */
function scanSource(rawSource: string, rel: string): FileScan {
  const code = rawSource
    .split('\n')
    .filter((l) => !isCommentLine(l))
    .join('\n');
  const aliasMap = resolveImportAliases(code);
  const hookGuardNames = localNamesFor(aliasMap, ['hooksDir']);
  const skillGuardNames = localNamesFor(aliasMap, ['skillsDir', 'skillDir']);
  const hookPruneNames = localNamesFor(aliasMap, ['revokeHookApprovalIfPresent']);
  const skillPruneNames = localNamesFor(aliasMap, ['removeInstallLedgerEntry']);
  return {
    file: rel,
    hasDestroyVerb: code.split('\n').some((l) => DESTROY_VERB_RE.test(l)),
    hasHookGuard: hasGuardUsage(code, hookGuardNames),
    hasSkillGuard: hasGuardUsage(code, skillGuardNames),
    hasHookPrune: hasCallTo(code, hookPruneNames),
    hasSkillPrune: hasCallTo(code, skillPruneNames),
  };
}

function scanFile(absPath: string): FileScan {
  const rawSource = readFileSync(absPath, 'utf8');
  const rel = relative(REPO_ROOT, absPath).split('\\').join('/');
  return scanSource(rawSource, rel);
}

function scanTree(): FileScan[] {
  const files = [...listTsFiles(join(REPO_ROOT, 'cli')), ...listTsFiles(join(REPO_ROOT, 'orchestrator')), ...listTsFiles(join(REPO_ROOT, 'packages')), ...listTsFiles(join(REPO_ROOT, 'apps', 'forge'))];
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
 * The one historical entry is GONE, and its absence is the point. M4-library
 * PR 4b split `bridge-studio-authoring.ts`: the staging-cleanup `rmSync` stayed
 * in the retained route file (which now contains no `hooksDir` at all) and
 * `finalizeHookFromLanded`'s `hooksDir` usage moved to
 * `bridge-studio-authoring-hook.ts` (which contains no destroy verb at all).
 * The whole-file co-occurrence that produced the false positive no longer
 * occurs, so the suppression is not merely stale — the split removed the cause.
 * Verified: no file among the five carries both a destroy verb and a hooksDir
 * reference. An empty allowlist is the honest state; a row that suppresses
 * nothing is a row that hides the next real one.
 */
const HOOK_CENSUS_ALLOWLIST: Record<string, string> = {};

test('ENUMERATION (library-34 class): every hook-package-destroying module is the known DELETE route (plus audited false positives), and calls revokeHookApprovalIfPresent', () => {
  const scans = scanTree();
  const hookDestroyFiles = scans.filter((s) => s.hasDestroyVerb && s.hasHookGuard);
  const files = hookDestroyFiles.map((s) => s.file).sort();
  const expected = ['packages/library/bridge-studio-hooks.ts', ...Object.keys(HOOK_CENSUS_ALLOWLIST)].sort();
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

test('ENUMERATION (library-35 class): every skill-package-destroying module is a known DELETE route, and calls removeInstallLedgerEntry', () => {
  const scans = scanTree();
  const skillDestroyFiles = scans.filter((s) => s.hasDestroyVerb && s.hasSkillGuard);
  const files = skillDestroyFiles.map((s) => s.file).sort();
  // W8-B4 FIX-2: cli/bridge-studio-writes.ts's agent-DELETE route joins the
  // census — it was ALWAYS a real skill-destroying site (skillsDir imported
  // as toSkillsDir); the old literal-spelling regex just never saw it.
  // M4-agents routes carve: the agent DELETE route MOVED out of
  // `cli/bridge-studio-writes.ts` into `packages/agents/bridge-agents-studio.ts`,
  // which is a real skill-destroying site and calls the prune. Registered here
  // deliberately, as this guard's own message instructs.
  const expected = [
    'packages/library/bridge-studio-skills.ts',
    'cli/bridge-studio-writes.ts',
    'packages/agents/bridge-agents-studio.ts',
  ].sort();
  assert.deepEqual(
    files,
    expected,
    `a module combining a destructive fs call with the skillsDir(...)/skillDir(...) containment idiom ` +
      `appeared where not expected (or a known one vanished) — found in: [${files.join(', ')}], expected: ` +
      `[${expected.join(', ')}]. A NEW delete-adjacent route touching skills/<id> MUST call ` +
      `removeInstallLedgerEntry(...) (orchestrator/studio/skill-install-ledger.ts) before removing the ` +
      `package directory, or a fresh hand-authored skill later reusing that id inherits a stranger's ` +
      `provenance row and is wrongly needs-review (library-35). If this file is a legitimate new ` +
      `skill-destroying site, add it here deliberately alongside its prune call.`,
  );
  for (const s of skillDestroyFiles) {
    const notSkillScoped = DESTROY_VERBS_NOT_SKILL_SCOPED.get(s.file);
    if (notSkillScoped !== undefined) {
      // A FALSIFIABLE exemption, never a blanket one. The census is
      // deliberately FILE-scoped — coarse is the safe direction for a guard
      // about deletion — so a file can pair a destroy verb with an unrelated
      // skills-dir idiom. That is now true of `cli/bridge-studio-writes.ts`:
      // the M4-agents carve took its agent-DELETE route away, and every
      // destroy verb it still has targets a FLOW directory, while its
      // remaining `skillsDir(...)` uses are starter WRITES and a roster read.
      // Rather than trust that, re-derive it on every run: the exemption holds
      // only while no destroy verb in the file names a skill path, so the
      // moment someone adds a real skill delete here it evaporates and the
      // prune requirement comes back.
      const src = readFileSync(join(REPO_ROOT, s.file), 'utf8');
      const destroys = [...src.matchAll(/\b(?:rmSync|unlinkSync|rmdirSync|renameSync)\s*\(([^;\n]*)/g)]
        .map((m) => m[1] ?? '');
      assert.ok(destroys.length > 0, `${s.file}: exemption is stale — it no longer destroys anything at all`);
      for (const arg of destroys) {
        assert.ok(
          !/skill/i.test(arg),
          `${s.file} is exempted from the prune requirement because its destroy verbs were all ` +
            `flow-scoped, but one now names a skill path: ${JSON.stringify(arg.trim())}. Either route ` +
            `it through removeInstallLedgerEntry(...) or remove this file from ` +
            `DESTROY_VERBS_NOT_SKILL_SCOPED — never both.`,
        );
      }
      assert.ok(notSkillScoped.test(src), `${s.file}: the exemption's own witness pattern no longer matches`);
      continue;
    }
    assert.ok(
      s.hasSkillPrune,
      `${s.file} destroys a skill package (rmSync/unlinkSync/rmdirSync/renameSync) but never calls ` +
        `removeInstallLedgerEntry(...) anywhere in the file (library-35).`,
    );
  }
});

// ---------------------------------------------------------------------------
// W8-B4 FIX-2 — classifier pins. These exercise `scanSource` directly against
// small synthetic fixtures (never written into cli/ or orchestrator/, so they
// cannot perturb the CENSUS assertions above) to pin the two blind spots the
// adversarial reviewer (S2) found in the ORIGINAL line-scoped, literal-
// spelling classifier.
// ---------------------------------------------------------------------------

test('W8-B4 FIX-2 pin: an import alias for skillsDir — under a NAME OTHER THAN "toSkillsDir" — is still classified as a skill guard', () => {
  // Deliberately a DIFFERENT alias spelling than the real production file
  // (`toSkillsDir`) uses — proves the mechanism resolves ANY alias via the
  // import statement itself, not a second hardcoded spelling standing in
  // for the first (which would just be pinning one more literal string).
  const fixture = [
    `import { skillsDir as bananaDir } from '../skill-path.ts';`,
    `import { rmSync } from 'node:fs';`,
    `import { resolveGuardedPath } from './studio-path-guard.ts';`,
    ``,
    `export function deleteSkillById(forgeRoot: string, id: string): void {`,
    `  const pathGuard = resolveGuardedPath(bananaDir(forgeRoot), [id, 'SKILL.md']);`,
    `  rmSync(pathGuard.realPath, { recursive: true, force: true });`,
    `}`,
    ``,
  ].join('\n');
  const scan = scanSource(fixture, 'fixtures/alias-skill.ts');
  assert.equal(scan.hasDestroyVerb, true, 'fixture sanity: the rmSync must be seen');
  assert.equal(
    scan.hasSkillGuard,
    true,
    'a skillsDir import aliased to an arbitrary local name must still be recognized as the skill guard idiom',
  );
});

test('W8-B4 FIX-2 pin: an import alias for hooksDir — under yet another distinct name — is still classified as a hook guard', () => {
  const fixture = [
    `import { hooksDir as whateverHooksAreCalledHere } from '../orchestrator/studio/hook-library.ts';`,
    `import { unlinkSync } from 'node:fs';`,
    `import { guardedFile } from './studio-path-guard.ts';`,
    ``,
    `export function deleteHookFile(forgeRoot: string, id: string): void {`,
    `  const f = guardedFile(whateverHooksAreCalledHere(forgeRoot), [id, 'hook.yaml'], 'write');`,
    `  unlinkSync(f as string);`,
    `}`,
    ``,
  ].join('\n');
  const scan = scanSource(fixture, 'fixtures/alias-hook.ts');
  assert.equal(scan.hasDestroyVerb, true, 'fixture sanity: the unlinkSync must be seen');
  assert.equal(
    scan.hasHookGuard,
    true,
    'a hooksDir import aliased to an arbitrary local name must still be recognized as the hook guard idiom',
  );
});

test('W8-B4 FIX-2 pin: a guard call WRAPPED ACROSS MULTIPLE LINES (an ordinary formatting choice, not an evasion) is still classified', () => {
  const fixture = [
    `import { hooksDir } from '../orchestrator/studio/hook-library.ts';`,
    `import { rmSync } from 'node:fs';`,
    `import { resolveGuardedPath } from './studio-path-guard.ts';`,
    ``,
    `export function deleteHookDir(forgeRoot: string, id: string): void {`,
    `  const pathGuard = resolveGuardedPath(`,
    `    hooksDir(forgeRoot),`,
    `    [id, 'hook.yaml'],`,
    `  );`,
    `  rmSync(pathGuard.realPath, { recursive: true, force: true });`,
    `}`,
    ``,
  ].join('\n');
  const scan = scanSource(fixture, 'fixtures/multiline-call.ts');
  assert.equal(scan.hasDestroyVerb, true, 'fixture sanity: the rmSync must be seen');
  assert.equal(
    scan.hasHookGuard,
    true,
    'resolveGuardedPath(...) whose arguments are wrapped onto their own lines must still be classified — a ' +
      'reformat must never silently exit the census',
  );
});

test('W8-B4 FIX-2 pin: an INTERMEDIATE VARIABLE — hooksDir(...) assigned before the guard call, the adversarial reviewer\'s exact synthetic shape — is still classified', () => {
  // This is the literal construction from the S2 finding: "the reviewer
  // constructed a synthetic file that assigns hooksDir(forgeRoot) to an
  // intermediate variable before calling resolveGuardedPath(...) — an
  // entirely ordinary style — and the regex reported hasHookGuard: false."
  const fixture = [
    `import { hooksDir } from '../orchestrator/studio/hook-library.ts';`,
    `import { rmdirSync } from 'node:fs';`,
    `import { resolveGuardedPath } from './studio-path-guard.ts';`,
    ``,
    `export function deleteHookDir(forgeRoot: string, id: string): void {`,
    `  const dir = hooksDir(forgeRoot);`,
    `  // ... unrelated lines the ORIGINAL same-line regex could never bridge ...`,
    `  const pathGuard = resolveGuardedPath(dir, [id, 'hook.yaml']);`,
    `  rmdirSync(pathGuard.realPath, { recursive: true });`,
    `}`,
    ``,
  ].join('\n');
  const scan = scanSource(fixture, 'fixtures/intermediate-variable.ts');
  assert.equal(scan.hasDestroyVerb, true, 'fixture sanity: the rmdirSync must be seen');
  assert.equal(
    scan.hasHookGuard,
    true,
    'a hooksDir(...) value threaded through one intermediate variable before reaching resolveGuardedPath ' +
      'must still be classified as a hook guard, not silently excluded',
  );
});

test('W8-B4 FIX-2 pin (negative control): a variable holding an UNRELATED root is never mistaken for a hook/skill guard', () => {
  // Proves the one-hop heuristic is not so loose it flags every guarded
  // delete in the tree — only variables actually assigned FROM
  // hooksDir(...)/skillsDir(...)/skillDir(...) count.
  const fixture = [
    `import { rmSync } from 'node:fs';`,
    `import { resolveGuardedPath } from './studio-path-guard.ts';`,
    ``,
    `export function deleteProjectDir(projectsRoot: string, id: string): void {`,
    `  const dir = projectsRoot;`,
    `  const pathGuard = resolveGuardedPath(dir, [id]);`,
    `  rmSync(pathGuard.realPath, { recursive: true, force: true });`,
    `}`,
    ``,
  ].join('\n');
  const scan = scanSource(fixture, 'fixtures/unrelated-root.ts');
  assert.equal(scan.hasDestroyVerb, true);
  assert.equal(scan.hasHookGuard, false, 'a plain project-root delete must never be misclassified as a hook guard');
  assert.equal(scan.hasSkillGuard, false, 'a plain project-root delete must never be misclassified as a skill guard');
});
