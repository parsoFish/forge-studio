/**
 * R4-22 F4 (T3, acceptance test) — pins the CO-LOCATION invariant between
 * the generic interactive spine's event-log directory
 * (`orchestrator/interactive-runner.ts`'s `cycleId`, L213) and the bridge's
 * per-turn stderr sink (`cli/ui-bridge.ts`'s `spawnAgentTurn`, driven by its
 * private `SPAWN_AGENT_SPECS` table) — the two writers that MUST agree on
 * ONE directory per turn, or a turn's events and its stderr split across two
 * directories and the live UI panel (`apps/studio/app/sessions/[kind]/
 * [sessionId]/page.tsx:158`, `cycleId = \`_${kind}-${sessionId}\``) ends up
 * subscribed to neither.
 *
 * THE DEFECT (reproduced, not hypothetical — see the T3 brief; not
 * re-litigated here). Today:
 *   - `orchestrator/interactive-runner.ts:213` builds
 *     `cycleId = \`_interactive-${descriptor.id}-${ctx.sessionId}\``;
 *   - `cli/ui-bridge.ts`'s `spawnAgentTurn` writes stderr.log into
 *     `_logs/_${logPrefix}-${sessionId}/`, where
 *     `SPAWN_AGENT_SPECS.authoring.logPrefix === 'authoring'`.
 * For the real "authoring" kind these are TWO DIFFERENT directories:
 * `_interactive-authoring-<sid>` vs `_authoring-<sid>`.
 *
 * WHY A SOURCE-TEXT RATCHET (a documented T3 design call — SECOND-BEST):
 * `SPAWN_AGENT_SPECS` is a module-private `const` in `cli/ui-bridge.ts`
 * (verified: no `export` on its declaration) — exporting it would be a
 * PRODUCTION edit, out of scope for a T3 (acceptance-test-only) pass, and
 * this project's ADR-042 surface cap makes a new `cli/`/`orchestrator/`
 * export something a test-writer asks for, not grants itself for its own
 * convenience. Precedent for this exact technique already lives in this
 * repo: `orchestrator/interactive-finalizers.test.ts`'s "RATCHET: every
 * staging-dirname literal ... is the IDENTICAL string" test (search
 * "R4-21 phase 2, pin round 4" in that file) reads BOTH production files'
 * real source text with anchored regexes rather than demanding a shared
 * export, for the identical class of defect (two hardcoded literals that
 * must agree, drifting apart with both modules' own suites green
 * throughout because neither suite reads the OTHER module's literal). This
 * test copies that shape.
 *
 * RETIRE THIS RATCHET when either (a) `SPAWN_AGENT_SPECS` (or an equivalent
 * per-kind log-dir-naming source of truth) is exported from `cli/
 * ui-bridge.ts` and this test can import + read it directly instead of
 * regex-scanning source text, or (b) the log-dir-naming convention itself is
 * extracted into one shared, exported helper that both `interactive-
 * runner.ts` and `ui-bridge.ts` call — at that point this test should import
 * and call the helper instead of re-deriving its output from two
 * independent regexes (mirroring the sibling ratchet's own retirement note).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const INTERACTIVE_RUNNER_PATH = join(REPO_ROOT, 'orchestrator', 'interactive-runner.ts');
const UI_BRIDGE_PATH = join(REPO_ROOT, 'cli', 'ui-bridge.ts');

const AUTHORING_ID = 'authoring';

/** Extracts `orchestrator/interactive-runner.ts`'s `cycleId` template
 *  literal, RAW (unevaluated source text) — e.g. today:
 *  `"_interactive-${descriptor.id}-${ctx.sessionId}"`. Anchored on the exact
 *  `const cycleId = \`...\`;` declaration shape; robust to incidental
 *  whitespace, NOT a loose scan for "cycleId" anywhere (which would also
 *  match this module's own prose comments, several of which reproduce the
 *  variable name). Returns `null` on a failed extraction — callers must
 *  treat that as FAILED, never as "the template is empty". Verified
 *  (`grep -c`) to match exactly once against the real file before this test
 *  was written. */
function extractSpineCycleIdTemplate(source: string): string | null {
  const m = source.match(/const\s+cycleId\s*=\s*`([^`]*)`;/);
  return m ? m[1] : null;
}

/** Extracts `cli/ui-bridge.ts`'s `spawnAgentTurn`'s `logDir` template
 *  literal, RAW — anchored on the `const logDir = join(forgeRoot, '_logs',
 *  \`...\`)` call shape unique to `spawnAgentTurn`. A SECOND, unrelated
 *  `const logDir = join(...)` exists elsewhere in this file (the dispatch-
 *  agent path), but it passes a bare `runId` identifier with no backtick
 *  template at all — this regex requires the backtick form and the literal
 *  `forgeRoot`/`'_logs'` arguments, so it cannot match that declaration.
 *  Verified (`grep -c`) to match exactly once against the real file. */
function extractBridgeLogDirTemplate(source: string): string | null {
  const m = source.match(/const\s+logDir\s*=\s*join\(\s*forgeRoot\s*,\s*'_logs'\s*,\s*`([^`]*)`\s*\)/);
  return m ? m[1] : null;
}

/** Extracts the `logPrefix` value of `SPAWN_AGENT_SPECS`'s `authoring` row,
 *  anchored on its real, current shape (`authoring: { argvPrefix: [...],
 *  logPrefix: '...' }`) — robust to quote style. Verified (`grep -c`) to
 *  match exactly once against the real file. */
function extractAuthoringLogPrefix(source: string): string | null {
  const m = source.match(/authoring:\s*\{\s*argvPrefix:\s*\[[^\]]*\]\s*,\s*logPrefix:\s*(['"])([^'"]*)\1\s*\}/);
  return m ? m[2] : null;
}

test(
  'R4-22 F4 (T3): CO-LOCATION RATCHET — for the real "authoring" kind, the directory ' +
    "orchestrator/interactive-runner.ts's cycleId names is EXACTLY the directory cli/ui-bridge.ts's " +
    'spawnAgentTurn writes stderr.log into',
  () => {
    const runnerSource = readFileSync(INTERACTIVE_RUNNER_PATH, 'utf8');
    const bridgeSource = readFileSync(UI_BRIDGE_PATH, 'utf8');

    const spineTemplate = extractSpineCycleIdTemplate(runnerSource);
    assert.ok(
      spineTemplate !== null,
      'NON-VACUOUS CHECK FAILED (the single most important assertion in this test): could not find ' +
        `"const cycleId = \`...\`;" anywhere in ${INTERACTIVE_RUNNER_PATH}. An extraction that silently matches ` +
        'nothing would make this ratchet vacuously pass no matter what either production file says. If ' +
        "runInteractiveTurn's cycleId construction was renamed or its declaration shape changed, UPDATE THIS " +
        "TEST'S REGEX to match the new shape — do not delete this check.",
    );

    const bridgeTemplate = extractBridgeLogDirTemplate(bridgeSource);
    assert.ok(
      bridgeTemplate !== null,
      'NON-VACUOUS CHECK FAILED: could not find spawnAgentTurn\'s ' +
        `"const logDir = join(forgeRoot, '_logs', \`...\`)" in ${UI_BRIDGE_PATH} — see the sibling check's comment ` +
        'for why a silent non-match is exactly the failure mode this ratchet guards against.',
    );

    const authoringLogPrefix = extractAuthoringLogPrefix(bridgeSource);
    assert.ok(
      authoringLogPrefix !== null,
      `NON-VACUOUS CHECK FAILED: could not find SPAWN_AGENT_SPECS's "authoring" row in ${UI_BRIDGE_PATH} — if the ` +
        'row or its shape changed, UPDATE THIS REGEX.',
    );

    // Sanity, independent of the cycleId bug this ratchet exists to catch:
    // SPAWN_AGENT_SPECS.authoring.logPrefix must equal the descriptor id it
    // names ("authoring"). True today regardless of the co-location defect —
    // asserted so a future rename of either the descriptor id or the
    // logPrefix ALONE (without the other) is caught here too, not just the
    // co-location assertion below.
    assert.equal(
      authoringLogPrefix,
      AUTHORING_ID,
      `SPAWN_AGENT_SPECS.authoring.logPrefix (${JSON.stringify(authoringLogPrefix)}) must equal the descriptor id ` +
        `it names (${JSON.stringify(AUTHORING_ID)}) — a drift here means the bridge's own stderr-sink directory no ` +
        "longer even matches the studio/session-kinds.yaml row it was spawned for.",
    );

    // THE RATCHET. Substitute the REAL "authoring" id / a shared session id
    // into each RAW, unevaluated template — plain string substitution on
    // the extracted source text, deliberately NOT `eval` (these are
    // hostile-adjacent production source snippets read off disk) — and
    // assert the two resulting directory names are IDENTICAL. This is the
    // assertion that goes RED the moment the two directory-naming
    // conventions drift apart: the exact defect this WI closes. RED at HEAD
    // today (spineTemplate carries the extra "_interactive-" prefix
    // bridgeTemplate does not); GREEN once interactive-runner.ts:213's
    // cycleId becomes `_${descriptor.id}-${ctx.sessionId}`.
    const sid = 'colocation-ratchet-sid-9f3c1e';
    const spineDir = (spineTemplate as string).replace('${descriptor.id}', AUTHORING_ID).replace('${ctx.sessionId}', sid);
    const bridgeDir = (bridgeTemplate as string).replace('${logPrefix}', authoringLogPrefix as string).replace('${sessionId}', sid);

    assert.equal(
      spineDir,
      bridgeDir,
      'CO-LOCATION INVARIANT BROKEN:\n' +
        `  orchestrator/interactive-runner.ts's cycleId (spine event-log dir): ${JSON.stringify(spineDir)}\n` +
        `  cli/ui-bridge.ts's spawnAgentTurn logDir (stderr.log dir):          ${JSON.stringify(bridgeDir)}\n` +
        'A single authoring turn writes its events and its stderr into TWO DIFFERENT directories, and the live UI ' +
        'panel (apps/studio/app/sessions/[kind]/[sessionId]/page.tsx, cycleId = `_${kind}-${sessionId}`) subscribes to ' +
        "neither. FIX: orchestrator/interactive-runner.ts:213's cycleId must be `_${descriptor.id}-${ctx.sessionId}` " +
        '(matching the convention every consumer already derives), not ' +
        '`_interactive-${descriptor.id}-${ctx.sessionId}`.',
    );
  },
);
