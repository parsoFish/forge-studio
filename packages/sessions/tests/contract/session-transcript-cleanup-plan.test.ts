import { fixtureFinding, kbCleanupDescriptor, writeCleanupPlanFile } from './test-fixtures/cleanup-plan-fixtures.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deriveSessionArtifact } from '../../studio/session-transcript.ts';
import type { CleanupPlanAction } from '../../studio/session-transcript.ts';

import { REAL_CLEANUP_PLAN_MD, REAL_DANGLING_TARGET_RELATIVE, REAL_FINDING_DANGLING, REAL_STATUS, type RealFinding, makeTmpDir, parseManifest } from './test-fixtures/transcript-test-helpers.ts';

// ===========================================================================
// R4-19-F2 — deriveSessionArtifact — cleanup-plan (brain-maintenance's
// KB-cleanup session). RED at branch base: 'cleanup-plan' is not yet a member
// of SESSION_ARTIFACT_KINDS at all, so every test below currently throws
// inside deriveSessionArtifact's own `state === undefined` gate before ever
// reaching a 'cleanup-plan' case — mirrors this file's own precedent for
// every prior not-yet-shipped kind (see e.g. the contract-buildout block's
// header note above).
//
// DERIVE-DON'T-STORE (the binding contract, per the task brief): the session
// dir's plan/cleanup-plan.md supplies the agent's PROPOSED ACTIONS only. The
// CURRENT findings are ALWAYS supplied by the CALLER (a live, KB-scoped
// brain-lint run) — mirrors contract-buildout's D4 pattern exactly, just
// with a different caller-supplied field name. DESIGN CALL (stated
// explicitly, mirroring this file's own precedent for undeclared names,
// e.g. the R4-22/interactive-runner suite's "MY CALL" convention): the
// caller-supplied parameter is named `cleanupFindings` on
// deriveSessionArtifact's input object — this name is NOT dictated anywhere
// in ADR-043 or the task brief; if the implementer picks a different name,
// update the calls below to match (the BEHAVIOUR these tests pin — a
// caller-supplied findings list, DERIVED joins, a throw when absent — is the
// load-bearing contract, not this exact identifier).
// ===========================================================================




// The exact byte form skills/brain-maintenance/SKILL.md's output-contract
// section mandates verbatim: `- [<kind>] <theme-file-path> — <one-sentence
// proposal>` (an em dash, "—", not a hyphen).
const PLAN_TWO_ACTIONS = [
  '# Cleanup plan',
  '',
  'Two proposed actions from the drafting turn.',
  '',
  '- [edge.dangling] brain/forge-dev/themes/foo.md — repoint the related_themes entry at `2026-05-17-foo`.',
  '- [theme.duplicate] brain/cycles/themes/bar.md — merge into baz.md, the richer survivor.',
  '',
].join('\n');

describe('deriveSessionArtifact — cleanup-plan (R4-19-F2, brain-maintenance KB-cleanup session)', () => {
  // Kills: a renderer that ignores the plan file entirely and returns
  // actions:[]; a renderer that mis-splits the `[<kind>] <target> — <proposal>`
  // line shape (e.g. swaps kind/target, or includes the leading "- " marker
  // in `target`); a renderer that marks every action "open" unconditionally
  // regardless of whether its finding is actually present in the
  // caller-supplied list.
  it('R4-19-F2 AT-1: parses the plan\'s action lines into actions[] with kind/target/proposal, each marked "open" when its matching finding IS present in the caller-supplied list', () => {
    const sessionDir = makeTmpDir('cleanupplan-parse-');
    writeCleanupPlanFile(sessionDir, PLAN_TWO_ACTIONS);
    const findings = [
      fixtureFinding('edge.dangling', 'brain/forge-dev/themes/foo.md'),
      fixtureFinding('theme.duplicate', 'brain/cycles/themes/bar.md'),
    ];

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: findings,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: typeof findings }) as {
      kind: string;
      label: string;
      plan: string | null;
      actions: Array<{ kind: string; target: string; proposal: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.kind, 'cleanup-plan');
    assert.equal(artifact.actions.length, 2, `expected 2 parsed actions, got: ${JSON.stringify(artifact.actions)}`);
    const byTarget = new Map(artifact.actions.map((a) => [a.target, a]));
    const foo = byTarget.get('brain/forge-dev/themes/foo.md');
    assert.ok(foo, `expected an action targeting brain/forge-dev/themes/foo.md, got: ${JSON.stringify(artifact.actions)}`);
    assert.equal(foo!.kind, 'edge.dangling');
    assert.equal(foo!.proposal, 'repoint the related_themes entry at `2026-05-17-foo`.');
    assert.equal(foo!.state, 'open');
    const bar = byTarget.get('brain/cycles/themes/bar.md');
    assert.ok(bar, `expected an action targeting brain/cycles/themes/bar.md, got: ${JSON.stringify(artifact.actions)}`);
    assert.equal(bar!.kind, 'theme.duplicate');
    assert.equal(bar!.proposal, 'merge into baz.md, the richer survivor.');
    assert.equal(bar!.state, 'open');
    assert.equal(artifact.openFindingCount, 2);
  });

  // Kills: a renderer that defaults to an empty actions:[]/openFindingCount:0
  // artifact when the caller supplies nothing — the exact "declared-data-
  // fails-open" antipattern the contract-buildout precedent (D4) exists to
  // rule out; mirrors that block's own AT-2 exactly, one screen up.
  it('R4-19-F2 AT-2: cleanupFindings ABSENT -> THROWS a named error naming the missing input, never returns a silent empty/defaulted artifact', () => {
    const sessionDir = makeTmpDir('cleanupplan-missing-findings-');
    writeCleanupPlanFile(sessionDir, PLAN_TWO_ACTIONS);
    assert.throws(
      () => deriveSessionArtifact({ parseManifest, descriptor: kbCleanupDescriptor(), sessionDir }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /finding/i, `error must name the missing caller-supplied input, got: ${err.message}`);
        return true;
      },
      'an implementation that defaults to actions:[]/openFindingCount:0 instead of throwing is exactly the defect this pins',
    );
  });

  // DERIVE-DON'T-STORE — the repo's #1 defect class, per the task brief.
  // Kills: any implementation that stores a per-action status field
  // (in the plan file, in status.json, or anywhere else) instead of
  // deriving `state` fresh from the caller-supplied findings on EVERY call.
  // Proven by calling deriveSessionArtifact TWICE against the SAME
  // byte-unchanged plan file with two DIFFERENT findings lists — a
  // stored-status implementation would report 'open' both times (whatever
  // was written once); a correctly-derived implementation must flip.
  //
  // AMENDED (R4-19-F2-fix, ORCHESTRATOR RULING): the NOW-ABSENT finding's
  // action flips to 'unknown', NOT 'cleared'. This is a CORRECTION, not a
  // weakening of what this test proves: it still requires `state` to flip
  // between two genuinely DIFFERENT values across the two calls (proving
  // fresh derivation, never a stored field) — it just lands on the value the
  // ruling actually mandates. 'cleared' is a POSITIVE claim that the target
  // was scanned and found clean; `fixtureFinding`'s minimal shape and
  // `deriveCleanupPlan`'s own inputs (sessionDir, label, cleanupFindings)
  // carry no scanned-domain evidence for `brain/cycles/themes/bar.md`, so
  // 'cleared' here would be exactly the fail-open defect this whole file
  // exists to close out (see the fail-safe block below for the full
  // contract). The ORIGINAL 'cleared' expectation was itself an instance of
  // "a fixture whose two sides happen to agree is what let the P1 ship."
  it('R4-19-F2 AT-3 (DERIVE-DON\'T-STORE, amended): with the plan file BYTE-UNCHANGED across two calls, removing one action\'s finding from the caller-supplied list flips ONLY that action\'s state to "unknown" (never silently "cleared") and lowers openFindingCount — state is derived at read time, never stored', () => {
    const sessionDir = makeTmpDir('cleanupplan-derive-');
    writeCleanupPlanFile(sessionDir, PLAN_TWO_ACTIONS);
    const planPath = join(sessionDir, 'plan', 'cleanup-plan.md');
    const planBytesBefore = readFileSync(planPath, 'utf8');

    const bothFindings = [
      fixtureFinding('edge.dangling', 'brain/forge-dev/themes/foo.md'),
      fixtureFinding('theme.duplicate', 'brain/cycles/themes/bar.md'),
    ];
    type Artifact = { actions: Array<{ target: string; state: string }>; openFindingCount: number };
    const before = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: bothFindings,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: typeof bothFindings }) as Artifact;
    assert.equal(before.actions.find((a) => a.target === 'brain/forge-dev/themes/foo.md')?.state, 'open', 'arrange: both actions start open');
    assert.equal(before.actions.find((a) => a.target === 'brain/cycles/themes/bar.md')?.state, 'open', 'arrange: both actions start open');
    assert.equal(before.openFindingCount, 2, 'arrange: both findings open');

    // The SECOND finding is now resolved elsewhere (e.g. auto-fixed by a
    // later lint pass) — the CALLER supplies a shorter list. The plan file
    // on disk is never touched between these two calls.
    const oneFindingLeft = [fixtureFinding('edge.dangling', 'brain/forge-dev/themes/foo.md')];
    const after = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: oneFindingLeft,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: typeof oneFindingLeft }) as Artifact;

    assert.equal(
      readFileSync(planPath, 'utf8'),
      planBytesBefore,
      'the plan file on disk must be BYTE-UNCHANGED between the two calls — the state flip must come purely from the different findings list, never a write to the plan',
    );
    assert.equal(after.actions.find((a) => a.target === 'brain/forge-dev/themes/foo.md')?.state, 'open', 'the still-present finding\'s action must stay open');
    assert.equal(
      after.actions.find((a) => a.target === 'brain/cycles/themes/bar.md')?.state,
      'unknown',
      'the NOW-ABSENT finding\'s action must flip to "unknown", proving state is derived at read time from the findings list, never a stored per-action status field anywhere — it must NOT flip to "cleared": deriveCleanupPlan\'s inputs (sessionDir, label, cleanupFindings) carry no scanned-domain evidence that would justify the positive claim "cleared" makes',
    );
    assert.equal(after.openFindingCount, 1, 'openFindingCount must drop from 2 to 1 as the resolved finding leaves the caller-supplied list — and must NOT count the now-"unknown" action, proving openFindingCount counts state===\'open\' specifically, not merely state!==\'cleared\'');
  });

  // Kills: a renderer that treats "the plan has no matching action lines" the
  // SAME as "there is no plan at all" — e.g. returning plan:null whenever
  // actions[] is empty, which would silently hide a drafted-but-malformed
  // plan from the operator (the exact "no actions and no plan" failure mode
  // the task brief calls out by name).
  it('R4-19-F2 AT-4: a plan file present but with ZERO parseable action lines yields actions:[] AND a non-null plan carrying the raw text — never silently "no actions and no plan"', () => {
    const sessionDir = makeTmpDir('cleanupplan-unparseable-');
    const RAW_PROSE = '# Cleanup plan\n\nI looked at the findings but none of them warrant a structured action yet — more investigation needed before I can propose anything concrete.\n';
    writeCleanupPlanFile(sessionDir, RAW_PROSE);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: unknown[] }) as { plan: string | null; actions: unknown[] };

    assert.deepEqual(artifact.actions, [], 'zero lines match the mandated action-line format, so actions must be empty');
    assert.equal(
      artifact.plan,
      RAW_PROSE,
      'the raw plan text must still surface verbatim even with zero parseable action lines — a renderer returning plan:null here is indistinguishable from "no plan file at all" (AT-5 below), the exact ambiguity this pins',
    );
  });

  // Kills: a renderer that throws, or fabricates a plan string, when the
  // session simply hasn't reached a drafted turn yet (e.g. read before the
  // first agent turn ran).
  it('R4-19-F2 AT-5: no plan file at all yields plan:null and actions:[] without throwing', () => {
    const sessionDir = makeTmpDir('cleanupplan-noplan-');
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: unknown[] }) as { plan: string | null; actions: unknown[] };
    assert.equal(artifact.plan, null);
    assert.deepEqual(artifact.actions, []);
  });

  // Kills: a renderer that reads plan/cleanup-plan.md via a raw
  // join()+readFileSync (or any path that skips the module's shared
  // realpath-containment choke point) — mirrors deriveFilePackage's own
  // RED-2b/RED-2e symlink-escape guard exactly, one screen up in this file,
  // just at the single-file granularity cleanup-plan uses instead of a
  // recursive walk.
  it('R4-19-F2 AT-6 (containment): a plan/ directory that is a symlink escaping the session dir contributes NO file — mirrors deriveFilePackage/walkPackageFiles\'s existing containment guarantee (RED-2b/RED-2e\'s idiom)', () => {
    const outsideDir = makeTmpDir('cleanupplan-escape-outside-');
    const SECRET_MARKER = 'TOP-SECRET-CLEANUP-PLAN-MARKER-5541';
    writeFileSync(join(outsideDir, 'cleanup-plan.md'), `- [edge.dangling] brain/x/themes/y.md — ${SECRET_MARKER}\n`, 'utf8');

    const sessionDir = makeTmpDir('cleanupplan-escape-session-');
    symlinkSync(outsideDir, join(sessionDir, 'plan'));
    assert.ok(existsSync(join(sessionDir, 'plan')), 'arrange: the symlinked plan/ must resolve to something');

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: unknown[] }) as { plan: string | null; actions: unknown[] };

    const serialized = JSON.stringify(artifact);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the escaped file\'s content must never appear anywhere in the derived cleanup-plan artifact');
    assert.equal(artifact.plan, null, 'a plan/ that escapes the session dir must contribute NO file — collapsed to the same "no plan file at all" outcome as AT-5');
    assert.deepEqual(artifact.actions, []);
  });
});

// ===========================================================================
// R4-19-F2-fix — the P1 fix: `deriveCleanupPlan` joined a caller-supplied
// ABSOLUTE `Finding.file` against a parsed REPO-RELATIVE plan `target` with
// no normalization, so no real action ever matched and every one silently
// read "cleared" (declared-data-fails-open in its most dangerous direction —
// see this file's own module-header precedent for that phrase, and the task
// brief's incident writeup). This block pins the ORCHESTRATOR RULING that
// closes it: `state` widens from 'open' | 'cleared' to 'open' | 'cleared' |
// 'unknown', where 'cleared' is a POSITIVE claim requiring scanned-domain
// evidence, and 'unknown' is the honest default when that evidence isn't
// establishable.
//
// TESTABILITY NOTE (read before touching this block): `deriveCleanupPlan`
// only ever receives (sessionDir, label, cleanupFindings) — see
// deriveSessionArtifact's 'cleanup-plan' case and cli/bridge-studio-
// sessions.ts's call site, neither of which threads a forgeRoot/kbBrainDir
// or any other scanned-domain signal through. Under THIS signature there is
// NO way to ever positively establish "this target's absence from
// cleanupFindings means it was scanned and found clean" — so every test
// below that exercises a genuinely unmatched target pins 'unknown', not
// 'cleared', and no test in this file ever asserts 'cleared' is reachable at
// all under the current 3-argument call shape. See this file's own T3-style
// report for the explicit statement that the 'cleared' vs 'unknown' split is
// NOT testable from these inputs alone, and what the implementer needs to
// add to ever make 'cleared' reachable.
// ===========================================================================

describe('deriveSessionArtifact — cleanup-plan state (R4-19-F2-fix: path normalization + fail-safe cleared/unknown split)', () => {
  // Type-level pin (BUILD-time, via `tsc`/`npm run build` — node's own
  // `--experimental-strip-types` test run strips type annotations without
  // checking them, so this assignment produces no runtime signal under the
  // scoped `node --test` command; it is a real compile error today because
  // CleanupPlanAction['state'] is currently the narrower 'open' | 'cleared'
  // union, and becomes valid once the implementer widens it per the
  // ORCHESTRATOR RULING). Kills: an implementation that satisfies every
  // runtime assertion below by returning the STRING 'unknown' while leaving
  // the exported TYPE at 'open' | 'cleared' (e.g. via an `as any`/unchecked
  // cast at the return site) — that would pass every `assert.equal` in this
  // file yet leave every real caller of `CleanupPlanAction` (e.g. forge-ui's
  // eventual renderer) type-unsound.
  it('R4-19-F2-fix TYPE-1: CleanupPlanAction[\'state\'] is widened to include \'unknown\' (compile-time pin — see TESTABILITY NOTE above)', () => {
    const widenedStateMustBeAssignable: CleanupPlanAction['state'] = 'unknown' as 'open' | 'cleared' | 'unknown';
    assert.equal(widenedStateMustBeAssignable, 'unknown', 'the widened-union value must round-trip at runtime too, not just type-check');
  });

  // THE REGRESSION LOCK (task brief item 4) — the ONE test that would have
  // caught the live P1: the REAL captured plan text (scripts/journeys/
  // fixtures/r4-19-f2-live-capture/cleanup-plan.md) driven against the REAL
  // captured findings (.../status.json's findings[], absolute `.file` per
  // packages/knowledge/brain-lint.ts's contract). The live bug reported openFindingCount:0
  // with BOTH actions 'cleared'; both findings were genuinely still live.
  // Kills: the exact defect — comparing an absolute Finding.file directly
  // against a repo-relative parsed target with no normalization.
  it('R4-19-F2-fix REGRESSION-LOCK: the REAL captured plan against the REAL captured findings yields BOTH actions "open" and openFindingCount === 2 (the live run wrongly reported both "cleared" and openFindingCount: 0)', () => {
    const sessionDir = makeTmpDir('cleanupplan-live-capture-');
    writeCleanupPlanFile(sessionDir, REAL_CLEANUP_PLAN_MD);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: REAL_STATUS.findings,
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as {
      plan: string | null;
      actions: Array<{ kind: string; target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.plan, REAL_CLEANUP_PLAN_MD, 'the real plan text must surface verbatim');
    assert.equal(artifact.actions.length, 2, `expected exactly 2 parsed actions from the real plan, got: ${JSON.stringify(artifact.actions)}`);
    for (const action of artifact.actions) {
      assert.equal(
        action.state,
        'open',
        `action targeting "${action.target}" (kind "${action.kind}") must be "open" — its finding IS present in the real captured findings; ` +
          `the live P1 reported this as "cleared" because it compared the repo-relative target literally against the absolute Finding.file with no normalization`,
      );
    }
    assert.equal(artifact.openFindingCount, 2, 'openFindingCount must be 2 for the real capture — the live bug reported 0');
  });

  // Path normalization, direction 1 (relative target -> absolute finding,
  // isolated to ONE real pair) — pins the exact real (kind, target, file)
  // triple from the capture, independent of the full-plan parse the
  // regression-lock test above also exercises.
  it('R4-19-F2-fix NORM-1: a repo-relative parsed target matches a live finding whose `.file` is the ABSOLUTE path to that same file (the real captured edge.dangling pair)', () => {
    const sessionDir = makeTmpDir('cleanupplan-norm-relative-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ${REAL_DANGLING_TARGET_RELATIVE} — drop the dangling entry.\n`);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'open',
      `a repo-relative target ("${REAL_DANGLING_TARGET_RELATIVE}") must match the real absolute finding.file ("${REAL_FINDING_DANGLING!.file}") — a literal string-equality join (the P1 defect) would never match these two forms`,
    );
  });

  // Path normalization, direction 2 (reverse: an ALREADY-ABSOLUTE parsed
  // target matches the same absolute finding). Kills: an implementation that
  // unconditionally does `join(someRoot, target)` to normalize — Node's
  // `path.join` does NOT discard the first argument when the second is
  // already absolute (`join('/a/b', '/c/d')` -> `/a/b/c/d`, not `/c/d`), so a
  // normalizer that fails to check `isAbsolute(target)` first would mangle
  // an already-absolute target and miss this match.
  it('R4-19-F2-fix NORM-2: an ALREADY-ABSOLUTE parsed target matches a live finding with that exact `.file`', () => {
    const sessionDir = makeTmpDir('cleanupplan-norm-absolute-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ${REAL_FINDING_DANGLING!.file} — drop the dangling entry.\n`);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(artifact.actions[0]!.target, REAL_FINDING_DANGLING!.file, 'arrange: the parsed target must be the literal absolute path');
    assert.equal(artifact.actions[0]!.state, 'open', 'an already-absolute target equal to the finding\'s own absolute `.file` must match');
  });

  // Path normalization, direction 3 (a `./`-prefixed relative target).
  // Kills: a normalizer that suffix-matches the absolute finding.file against
  // the RAW target without first stripping a leading `./` — `absPath.endsWith
  // ('/' + './brain/...')` is false even though `./brain/...` and `brain/...`
  // name the same file, so an implementation that skips this stripping step
  // would report 'unknown' (or, pre-fix, 'cleared') here instead of 'open'.
  it('R4-19-F2-fix NORM-3: a "./"-prefixed repo-relative target matches the same live finding as its un-prefixed form', () => {
    const sessionDir = makeTmpDir('cleanupplan-norm-dotslash-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ./${REAL_DANGLING_TARGET_RELATIVE} — drop the dangling entry.\n`);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'open',
      `a "./"-prefixed target ("./${REAL_DANGLING_TARGET_RELATIVE}") must match the same finding as its un-prefixed form — a normalizer that only strips a KNOWN prefix (never a leading "./") would miss this`,
    );
  });

  // THE HEART OF IT (task brief item 2 + item 3) — fail SAFE, not open. An
  // action with NO matching live finding must default to 'unknown', never
  // silently 'cleared' — and openFindingCount must count ONLY 'open' actions,
  // not merely "not cleared" (which would wrongly include 'unknown'). Two
  // actions in one plan (one matched, one not) so this also proves the two
  // are computed INDEPENDENTLY, per-action — not a single plan-wide verdict.
  // Kills: (a) the original P1 shape (unmatched -> 'cleared'); (b) an
  // over-permissive fix that defaults unmatched to 'open' instead of
  // 'unknown'; (c) an openFindingCount computed as `actions.length -
  // clearedCount` or `state !== 'cleared'`, which would wrongly count the
  // 'unknown' action as open (2, not 1).
  it('R4-19-F2-fix FAIL-SAFE-1: an action with NO matching live finding reports "unknown" (never "cleared") even while a SIBLING action in the same plan IS matched — and openFindingCount counts ONLY the matched one', () => {
    const sessionDir = makeTmpDir('cleanupplan-failsafe-sibling-');
    const NO_MATCH_TARGET = 'brain/forge-dev/themes/no-such-finding-exists-for-this-target.md';
    writeCleanupPlanFile(
      sessionDir,
      [
        `- [edge.dangling] ${REAL_DANGLING_TARGET_RELATIVE} — drop the dangling entry.`,
        `- [length.soft-cap] ${NO_MATCH_TARGET} — condense this theme.`,
        '',
      ].join('\n'),
    );

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [REAL_FINDING_DANGLING!], // only the FIRST action's finding is live
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: readonly RealFinding[] }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 2);
    const matched = artifact.actions.find((a) => a.target === REAL_DANGLING_TARGET_RELATIVE);
    const unmatched = artifact.actions.find((a) => a.target === NO_MATCH_TARGET);
    assert.equal(matched?.state, 'open', 'the sibling WITH a live finding must be open');
    assert.equal(
      unmatched?.state,
      'unknown',
      'the action with NO matching live finding must be "unknown" — deriveCleanupPlan has no scanned-domain evidence for this target, so "cleared" (a positive claim of verified absence) would be exactly the fail-open defect this pins',
    );
    assert.equal(
      artifact.openFindingCount,
      1,
      'openFindingCount must be 1, not 2 — it must count actions whose state IS "open", never actions that are merely "not cleared" (which would wrongly include the "unknown" one)',
    );
  });

  // Same fail-safe contract, but from the "genuinely clean scan" angle: an
  // EMPTY cleanupFindings list looks, superficially, like "the KB was
  // scanned and nothing is wrong" — but deriveCleanupPlan cannot structurally
  // tell that apart from "the caller passed [] for some other reason" (the
  // exact ambiguity the live P1 exploited: the caller-supplied list was
  // non-empty in production, yet the join still silently produced the same
  // "everything looks resolved" outcome). Reuses the REAL plan text again so
  // this stays grounded in the real capture, not an invented shape.
  it('R4-19-F2-fix FAIL-SAFE-2: an EMPTY caller-supplied findings list against the REAL plan yields "unknown" for every action (never "cleared") and openFindingCount === 0', () => {
    const sessionDir = makeTmpDir('cleanupplan-failsafe-empty-');
    writeCleanupPlanFile(sessionDir, REAL_CLEANUP_PLAN_MD);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupFindings: RealFinding[] }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 2);
    for (const action of artifact.actions) {
      assert.equal(
        action.state,
        'unknown',
        `action targeting "${action.target}" must be "unknown" with an empty caller-supplied findings list — deriveCleanupPlan cannot tell "genuinely scanned and clean" apart from "no domain evidence supplied" from its current inputs alone, so it must never claim "cleared"`,
      );
    }
    assert.equal(artifact.openFindingCount, 0);
  });
});

