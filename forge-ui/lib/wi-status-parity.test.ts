/**
 * Acceptance test for a W6-RV-1 review finding — WI-status mirror parity.
 *
 * SSOT: orchestrator/work-item.ts's `WORK_ITEM_STATUSES` (exported for this
 * purpose) — the four `WorkItemStatus` values the scheduler/dev-loop actually
 * write to a work item's frontmatter: pending, in-progress, complete, failed.
 *
 * Mirror: forge-ui/lib/bridge-client.ts's `WI_STATUSES`, a hand-kept runtime
 * array (feeding `RoadmapWorkItem['status']`'s type and, downstream, the
 * roadmap card's WI done/total micro-badge arithmetic in RoadmapDag.tsx —
 * 'complete' counts toward done, 'failed' counts in the total but not done).
 * forge-ui cannot import orchestrator/ TypeScript directly in PRODUCTION
 * code (the same constraint SHIPPED_TRIGGER_KINDS documents for itself in
 * ./studio-client.ts), so the mirror is a hand-copied literal there — this
 * TEST file is allowed to import the real SSOT directly (vitest resolves the
 * explicit-.ts-extension export with zero extra config; the module is inert
 * at load time), so the pin stays true as the SSOT changes rather than
 * needing a synchronized manual update on both sides every time a status is
 * added or retired. Follows forge-ui/lib/trigger-kind-parity.test.ts's exact
 * precedent (SHIPPED_TRIGGER_KIND_IDS vs SHIPPED_TRIGGER_KINDS).
 *
 * RUN: npx vitest run lib/wi-status-parity.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';

// The real, on-disk SSOT — imported directly, not re-typed/re-declared here.
import { WORK_ITEM_STATUSES as SSOT_STATUSES } from '../../orchestrator/work-item.ts';
// The forge-ui hand-kept mirror under test.
import { WI_STATUSES as MIRROR_STATUSES } from './bridge-client.ts';

test('WI-status mirror parity: forge-ui\'s WI_STATUSES is EXACTLY orchestrator/work-item.ts\'s WORK_ITEM_STATUSES, both directions — no status missing from the mirror, no orphan status in the mirror', () => {
  const ssot = [...SSOT_STATUSES].sort();
  const mirror = [...MIRROR_STATUSES].sort();

  const missingFromMirror = ssot.filter((s) => !(mirror as string[]).includes(s));
  const orphansInMirror = mirror.filter((s) => !(ssot as string[]).includes(s));

  expect(
    missingFromMirror,
    `WorkItemStatus values in the SSOT but MISSING from the forge-ui mirror: ${missingFromMirror.join(', ') || '(none)'}`,
  ).toEqual([]);
  expect(
    orphansInMirror,
    `mirror statuses with no matching SSOT value (orphans — retired or never-real): ${orphansInMirror.join(', ') || '(none)'}`,
  ).toEqual([]);

  // Belt-and-braces full-set equality (both prior assertions already prove
  // this, but this is the single assertion that would show up FIRST/loudest
  // in a `vitest run` summary — the two above exist for a readable diagnosis
  // when it fails).
  expect(mirror).toEqual(ssot);
});
