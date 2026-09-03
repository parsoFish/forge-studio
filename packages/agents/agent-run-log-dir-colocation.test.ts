/**
 * R4-22 F4 (T3, acceptance test) — pins the CO-LOCATION invariant between
 * the generic interactive spine's event-log directory
 * (`packages/sessions/interactive-runner.ts`'s `cycleId`, L290) and the
 * bridge's per-turn stderr sink (`cli/ui-bridge.ts`'s `spawnAgentTurn`,
 * driven by its `SPAWN_AGENT_SPECS` table) — the two writers that MUST agree
 * on ONE directory per turn, or a turn's events and its stderr split across
 * two directories and the live UI panel (`apps/studio/app/sessions/[kind]/
 * [sessionId]/page.tsx:158`, `cycleId = \`_${kind}-${sessionId}\``) ends up
 * subscribed to neither.
 *
 * THE DEFECT IS FIXED; THIS RATCHET IS WHAT KEEPS IT FIXED (M4-agents cull,
 * 2026-09-03 — the paragraph below previously described the defect in the
 * present tense long after it had been closed, which made the file read as
 * a standing red). What it used to be:
 *   - `interactive-runner.ts` built `_interactive-${descriptor.id}-${sid}`;
 *   - `spawnAgentTurn` wrote stderr.log into `_logs/_${logPrefix}-${sid}/`,
 *     where `SPAWN_AGENT_SPECS.authoring.logPrefix === 'authoring'`;
 *   - so for the real "authoring" kind those were TWO directories,
 *     `_interactive-authoring-<sid>` vs `_authoring-<sid>`.
 * Today `packages/sessions/interactive-runner.ts:290` builds
 * `cycleId = \`_${descriptor.id}-${ctx.sessionId}\`` and the two agree.
 *
 * WHY STILL A SOURCE-TEXT RATCHET. The original reason was that
 * `SPAWN_AGENT_SPECS` was a module-private `const`. **That is no longer
 * true** — `cli/ui-bridge.ts:3430` now reads `export const
 * SPAWN_AGENT_SPECS`, so this file's own retirement clause (a) is satisfied
 * on its face. It is deliberately NOT retired here: importing that symbol
 * from `packages/agents` would mint a `package-to-legacy` boundary
 * violation on a host helper that the sessions lane owns under M4 ruling 67
 * (inject at assembly, never import across). Retiring a source-text ratchet
 * by trading it for a new boundary violation on another lane's symbol is not
 * a cull. Revisit at the routes carve, when the host-helper question is
 * settled by assembly — clause (b), one shared exported helper both writers
 * call, remains the better ending.
 *
 * Precedent for the technique lives in
 * `packages/sessions/interactive-finalizers.test.ts`'s "RATCHET: every
 * staging-dirname literal ... is the IDENTICAL string" test (search
 * "R4-21 phase 2, pin round 4"): it reads BOTH production files' real source
 * text with anchored regexes rather than demanding a shared export, for the
 * identical class of defect — two hardcoded literals that must agree,
 * drifting apart with both modules' own suites green throughout because
 * neither suite reads the OTHER module's literal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INTERACTIVE_RUNNER_PATH = join(REPO_ROOT, 'packages', 'sessions', 'interactive-runner.ts');
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
