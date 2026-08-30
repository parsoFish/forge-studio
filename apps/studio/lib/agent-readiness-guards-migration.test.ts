/**
 * MIGRATION ACCEPTANCE TEST (must be RED on today's code) — F1 of the
 * ADR-027-amendment-#2 `composition.hooks` → `composition.guards` rename:
 * `forge-ui/lib/agent-readiness.ts`'s check key/label must be the guard one
 * (`key: 'guard'`), not the hook one (`key: 'hook'`).
 *
 * Mirrors `agent-readiness.test.ts`'s existing conventions (vitest
 * `test`/`expect`, the same `FULL_CONTENT`/`READY_CAPABILITY` fixture shape)
 * rather than inventing a new one — this is a SEPARATE new file, not an edit
 * to that existing, currently-green suite.
 *
 * `ReadinessInput` requires a `hooks: string[]` field today (no `guards`
 * field exists on the type at all). The fixture below supplies `hooks: []`
 * as a TEST-HARNESS PLACEHOLDER ONLY (documented, never a claim about the
 * real future field name) alongside the real `guards: [...]` content, cast
 * via `as unknown as ReadinessInput` — purely so `computeReadinessChecks`
 * runs to completion and this test can isolate the SPECIFIC gap (the check
 * key/label/derivation is blind to `guards`) with a clean assertion mismatch,
 * rather than a `state.hooks.length` crash on a genuinely hooks-less input.
 *
 * ## Coverage limit
 *
 * This file pins the `lib/agent-readiness.ts` view-state logic only. The
 * three agent-builder components that also read `catalog.hooks`
 * (`CatalogPalette.tsx`, `DropZone.tsx`, `YamlPreview.tsx`) are NOT
 * unit-tested here — descoped by peer review (2026-08-04): adding a
 * component-rendering harness (jsdom + `@testing-library/react`) is a new
 * test-infra dependency, an ask-first item, not something this migration's
 * test-writing pass is authorized to add. Their migration to
 * `catalog.guards` is enforced instead by two OTHER mechanisms, not left
 * silent:
 *  (a) `npm run build` — once `Catalog.hooks` ceases to exist as a type
 *      field (the migration's registry/types change), every one of these
 *      components' `catalog.hooks` reads becomes a `tsc` compile error, so a
 *      missed call site fails the build, not silently ships; and
 *  (b) the live `ui:journey` agent-builder beats (`scripts/journeys/`) drive
 *      these components through real drag/drop + save flows against the
 *      real catalog — a component still reading the deleted `catalog.hooks`
 *      key would render an empty/broken palette there, which the journey
 *      gate would catch.
 * No unit-level regression gate exists for these three files; the two
 * mechanisms above are what this migration relies on instead.
 */

import { test, expect } from 'vitest';

import { computeReadinessChecks } from './agent-readiness';
import type { AgentCapabilityDescriptor } from './studio-client';
import type { ReadinessInput } from './agent-readiness';

const READY_CAPABILITY: AgentCapabilityDescriptor = { interactive: false, runtimeSdks: ['claude'], fanoutCapable: false };

function makeGuardsInput(guards: string[]): ReadinessInput {
  return {
    purpose: 'Decompose initiatives.',
    skills: ['brain-query'],
    hooks: [], // placeholder only — see header
    guards,
    process: '# Project Manager\n...',
    interactivity: 'Fully autonomous; never blocks on the operator.',
    capability: READY_CAPABILITY,
  } as unknown as ReadinessInput;
}

test('F1: computeReadinessChecks has a "guard" check key/label, not "hook" (RED until migrated)', () => {
  const checks = computeReadinessChecks(makeGuardsInput(['event-log']));
  const guardCheck = checks.find((c) => c.key === 'guard');
  expect(guardCheck, `expected a "guard"-keyed check — got keys: ${JSON.stringify(checks.map((c) => c.key))}`).toBeDefined();
});

test('F1: the guard check reflects composition.guards content (ok when non-empty, not ok when empty) (RED until migrated)', () => {
  const withGuards = computeReadinessChecks(makeGuardsInput(['event-log']));
  const withoutGuards = computeReadinessChecks(makeGuardsInput([]));
  expect(withGuards.find((c) => c.key === 'guard')?.ok, 'expected ok:true when guards is non-empty').toBe(true);
  expect(withoutGuards.find((c) => c.key === 'guard')?.ok, 'expected ok:false when guards is empty').toBe(false);
});

test('F1: no stale "hook"-keyed check remains once migrated (RED — today it still exists)', () => {
  const checks = computeReadinessChecks(makeGuardsInput(['event-log']));
  expect(
    checks.some((c) => c.key === 'hook'),
    `expected NO "hook"-keyed check to remain — got keys: ${JSON.stringify(checks.map((c) => c.key))}`,
  ).toBe(false);
});
