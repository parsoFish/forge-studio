/**
 * W6-B2 review fix (MEDIUM 1) — `ensureSessionTail(kind, sessionId)`
 * (cli/ui-bridge.ts) derives the WS tail's cycle-id/log-dir as
 * `_${kind}-${sessionId}`, where `kind` is a session-kind id (`studio/
 * session-kinds.yaml`'s `descriptor.id`). For the six kinds that spawn a
 * real agent turn through `spawnAgentTurn`, that log dir is ACTUALLY named
 * by `SPAWN_AGENT_SPECS[agentId].logPrefix` — a SEPARATE table, keyed by a
 * different (mostly, but not always, identical) string. Today
 * `descriptor.id === SPAWN_AGENT_SPECS[...].logPrefix` holds for every
 * spawnable kind, but that is a COINCIDENCE, not an enforced invariant — the
 * kb-cleanup/authoring collocation ratchet
 * (cli/agent-run-log-dir-colocation.test.ts) only pins this for ONE kind
 * ('authoring'). A future rename of either side (a session-kind id in the
 * yaml, or a SPAWN_AGENT_SPECS key/logPrefix) would silently break
 * ensureSessionTail for that kind: `ensureTailFor`'s `existsSync` guard
 * makes the miss a quiet no-op, not an error anywhere — the WS tail simply
 * never starts, and nothing in this repo's test suite would go red. This
 * file is the general parity sweep closing that gap for EVERY session kind
 * with a SPAWN_AGENT_SPECS entry, not just authoring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { loadSessionKinds } from './studio/session-kinds.ts';
import { SPAWN_AGENT_SPECS, type SpawnableAgentId } from '../../cli/ui-bridge.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/**
 * Explicit correspondence between a session-kind YAML id and the
 * SPAWN_AGENT_SPECS key that spawns turns for it. Every kind maps to
 * itself EXCEPT 'demo': its session-kind id is 'demo' (R4-16 — the bridge
 * derives the on-disk session dir as `<project>/_demo/<sid>`, and
 * apps/studio/ensureSessionTail both key the WS cycle-id on that same 'demo'
 * string) while the SPAWN_AGENT_SPECS row that spawns its turns is keyed
 * 'demo-builder' (the CLI verb `demo-builder run`, preserved byte-for-byte
 * from before the R2-01-F3b spawn-helper collapse). This map makes that ONE
 * divergence an explicit, named fact instead of an implicit assumption the
 * loop below would otherwise have to special-case silently.
 */
const SESSION_KIND_ID_TO_SPAWN_AGENT_ID: Readonly<Partial<Record<string, SpawnableAgentId>>> = {
  demo: 'demo-builder',
};

/**
 * Session-kind ids with NO SPAWN_AGENT_SPECS entry at all — dispatched
 * through a different mechanism (`spawnAgentDispatch`, not `spawnAgentTurn`)
 * that does not write to the `_<logPrefix>-<sid>` naming convention
 * ensureSessionTail assumes. Listed EXPLICITLY (not silently skipped) so a
 * FUTURE session kind that's missing its spec entry by ACCIDENT — rather
 * than by this documented design choice — fails this test loudly instead of
 * being swept under the same "expected gap" umbrella.
 */
const EXPECTED_NO_SPAWN_SPEC_KIND_IDS: ReadonlySet<string> = new Set(['onboarding']);

test(
  'W6-B2 RATCHET: for every real studio/session-kinds.yaml descriptor with a corresponding SPAWN_AGENT_SPECS entry, ' +
    'SPAWN_AGENT_SPECS[...].logPrefix === the session-kind id (demo/demo-builder mapping explicit) — a future ' +
    'rename/new-kind divergence must fail this test, not silently no-op ensureSessionTail\'s WS tail',
  () => {
    const descriptors = loadSessionKinds(REPO_ROOT);
    assert.ok(
      descriptors.length > 0,
      'NON-VACUOUS CHECK FAILED: loadSessionKinds(REPO_ROOT) returned zero descriptors — the real studio/session-kinds.yaml must parse to at least one row for this sweep to check anything at all.',
    );

    let checkedCount = 0;
    const uncoveredKindIds: string[] = [];

    for (const descriptor of descriptors) {
      const specKey = SESSION_KIND_ID_TO_SPAWN_AGENT_ID[descriptor.id] ?? (descriptor.id as SpawnableAgentId);
      const spec = Object.prototype.hasOwnProperty.call(SPAWN_AGENT_SPECS, specKey) ? SPAWN_AGENT_SPECS[specKey] : undefined;

      if (spec === undefined) {
        uncoveredKindIds.push(descriptor.id);
        continue;
      }

      checkedCount++;
      assert.equal(
        spec.logPrefix,
        descriptor.id,
        `PARITY BROKEN: SPAWN_AGENT_SPECS['${specKey}'].logPrefix is ${JSON.stringify(spec.logPrefix)}, but the session-kind id ` +
          `it corresponds to is ${JSON.stringify(descriptor.id)}. ensureSessionTail(kind, sessionId) ` +
          '(cli/ui-bridge.ts) derives the WS tail\'s log dir as `_${kind}-${sessionId}` using the session-kind id — ' +
          'if SPAWN_AGENT_SPECS actually writes its stderr/event log under a DIFFERENT prefix, the session-detail ' +
          'GET route (cli/bridge-studio-sessions.ts) and the four legacy list routes (cli/ui-bridge.ts) tail the ' +
          'WRONG (non-existent) directory and ensureTailFor\'s existsSync guard silently no-ops — no error anywhere, ' +
          'the WS tail for this kind just never starts. Fix: either rename the drifted side back into agreement, or ' +
          'add this kind to SESSION_KIND_ID_TO_SPAWN_AGENT_ID above if the divergence is intentional (mirroring the ' +
          '"demo" -> "demo-builder" precedent).',
      );
    }

    // Non-vacuous floor: today exactly 6 real session kinds carry a
    // SPAWN_AGENT_SPECS entry (architect/instructions/demo/project-brain/
    // authoring/kb-cleanup) — asserted as a FLOOR (>=), not an exact count,
    // so a future NEW spawnable kind doesn't need this test edited, but a
    // regression that silently drops coverage to zero (e.g. every kind
    // ending up in EXPECTED_NO_SPAWN_SPEC_KIND_IDS by mistake) still fails
    // loudly here rather than passing vacuously.
    assert.ok(
      checkedCount >= 6,
      `NON-VACUOUS CHECK FAILED: only ${checkedCount} session kind(s) were actually checked against a real ` +
        `SPAWN_AGENT_SPECS entry (expected at least 6) — uncovered kind ids: ${JSON.stringify(uncoveredKindIds)}. ` +
        'A parity sweep that checks nothing passes trivially no matter what either table says.',
    );

    // Every uncovered kind id must be one this file explicitly expects to
    // have no SPAWN_AGENT_SPECS entry — a silent, undocumented gap (a real
    // kind added to session-kinds.yaml with no matching spec row, and no
    // explanation here) fails loudly instead of being swallowed by the
    // `spec === undefined` continue above.
    for (const kindId of uncoveredKindIds) {
      assert.ok(
        EXPECTED_NO_SPAWN_SPEC_KIND_IDS.has(kindId),
        `session-kind "${kindId}" has NO SPAWN_AGENT_SPECS entry (directly, nor via SESSION_KIND_ID_TO_SPAWN_AGENT_ID) ` +
          'and is not listed in EXPECTED_NO_SPAWN_SPEC_KIND_IDS — either this kind is missing its spec row (a real ' +
          'gap: ensureSessionTail will never activate its WS tail through the legacy spawn convention), or this is ' +
          'an intentional divergence (like "onboarding", which dispatches via spawnAgentDispatch instead) that ' +
          'should be added to EXPECTED_NO_SPAWN_SPEC_KIND_IDS with a reason.',
      );
    }
  },
);
