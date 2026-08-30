/**
 * Acceptance test for item forge-zyc pin 1 — trigger-kind mirror parity.
 *
 * SSOT: orchestrator/flow-trigger.ts:52-67's `TRIGGER_KINDS` registry
 * (rows-as-data). `SHIPPED_TRIGGER_KIND_IDS` (:65-67) is the filtered
 * `status: 'shipped'` subset — 7 ids today: flow-complete, agent-complete,
 * merged, pr-merged, issue-raised, cron, webhook (manual/feed stay
 * `status: 'reserved'`, correctly excluded).
 *
 * Drifted mirror: forge-ui/lib/studio-client.ts:245's hand-kept
 * `SHIPPED_TRIGGER_KINDS` constant. Its own doc comment (:236-244) says
 * "keep it in lockstep with the registry when a new kind ships (or one is
 * retired)" — it wasn't: agent-complete (R2-08-F2), pr-merged and
 * issue-raised (R2-08-F3) all shipped server-side but were never added here.
 *
 * Mechanism: follows forge-ui/lib/flow-artifact-catalog.test.ts's AT-52
 * precedent — read the REAL production source rather than a hand-copied
 * fixture, so this test stays true as the registry changes rather than
 * needing a manual update every time a kind ships/retires. AT-52 walks an
 * on-disk directory (its SSOT is a directory listing); here the real SSOT is
 * a TS module export, so this file imports it directly rather than parsing
 * text — confirmed under this repo's forge-ui vitest runner
 * (`environment: 'node'`, see forge-ui/vitest.config.ts) importing
 * `orchestrator/flow-trigger.ts`'s explicit-`.ts`-extension export resolves
 * with zero extra config and is inert at module-load time (its own import of
 * `stageFlowRunRequest` from `./flow-run-requests.ts` does no
 * filesystem/env work until a function is actually CALLED — this file never
 * calls one, only reads the two exported registry constants).
 *
 * RUN: npx vitest run lib/trigger-kind-parity.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';

// The real, on-disk SSOT — imported directly, not re-typed/re-declared here.
import { SHIPPED_TRIGGER_KIND_IDS as SSOT_SHIPPED_IDS } from '@forge/contracts';
// The forge-ui hand-kept mirror under test.
import { SHIPPED_TRIGGER_KINDS as MIRROR_SHIPPED_IDS } from './studio-client.ts';

test('RED (forge-zyc pin 1): forge-ui\'s SHIPPED_TRIGGER_KINDS mirror is EXACTLY the real orchestrator/flow-trigger.ts SHIPPED_TRIGGER_KIND_IDS set, both directions — no id missing from the mirror, no orphan id in the mirror', () => {
  const ssot = [...SSOT_SHIPPED_IDS].sort();
  const mirror = [...MIRROR_SHIPPED_IDS].sort();

  const missingFromMirror = ssot.filter((id) => !(mirror as string[]).includes(id));
  const orphansInMirror = mirror.filter((id) => !(ssot as string[]).includes(id));

  expect(
    missingFromMirror,
    `shipped trigger kinds in the SSOT but MISSING from the forge-ui mirror: ${missingFromMirror.join(', ') || '(none)'}`,
  ).toEqual([]);
  expect(
    orphansInMirror,
    `mirror ids with no matching SHIPPED SSOT row (orphans — retired or never-real): ${orphansInMirror.join(', ') || '(none)'}`,
  ).toEqual([]);

  // Belt-and-braces full-set equality (both prior assertions already prove
  // this, but this is the single assertion that would show up FIRST/loudest
  // in a `vitest run` summary — the two above exist for a readable diagnosis
  // when it fails).
  expect(mirror).toEqual(ssot);
});
