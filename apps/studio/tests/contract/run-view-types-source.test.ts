/**
 * forge-8vfn.5.17 — RunStatus/RunPhaseStatus/RunPhaseMeta/Run used to be
 * hand-declared in apps/studio/lib/studio-client.ts, a second copy of
 * packages/flows/run-view-types.ts (now packages/contracts/run-view-types.ts)
 * with no parity test comparing the two (bead forge-cv9,
 * studio-client.test.ts:791).
 *
 * This is a SOURCE-TEXT check, not a runtime type check: TypeScript's
 * structural typing makes two identically-shaped declarations
 * interchangeable at the type level, so no runtime assertion can tell "one
 * shared declaration" apart from "two declarations that happen to match
 * today" — the exact way this pair drifted unnoticed on `costUsd`,
 * `workItems[].costUsd` and `trigger.kind` (packages/contracts/design.md,
 * "Run view types — three fields resolved toward the wire, not the
 * server"). The only test that can kill a REINTRODUCED local mirror is one
 * that looks at where the declaration comes from.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';

const STUDIO_CLIENT_PATH = join(__dirname, '../../lib/studio-client.ts');
const RUN_TYPES = ['RunStatus', 'RunPhaseStatus', 'RunPhaseMeta', 'Run'] as const;

function studioClientSource(): string {
  return readFileSync(STUDIO_CLIENT_PATH, 'utf8');
}

test('studio-client.ts imports RunStatus/RunPhaseStatus/RunPhaseMeta/Run from @forge/contracts', () => {
  // KILLS: the type import silently dropped, or narrowed to fewer than all
  // four names, while the re-export list keeps up appearances.
  const source = studioClientSource();
  const importLine = source
    .split('\n')
    .find((line) => line.includes('import type') && line.includes("from '@forge/contracts'"));
  expect(importLine, "no `import type { ... } from '@forge/contracts'` line found in studio-client.ts").toBeDefined();
  for (const name of RUN_TYPES) {
    expect(importLine, `${name} is not imported from @forge/contracts in studio-client.ts`).toContain(name);
  }
});

test('studio-client.ts does not re-declare RunStatus/RunPhaseStatus/RunPhaseMeta/Run locally', () => {
  // KILLS: any of the four types re-declared with `export type <Name> = ...`
  // in studio-client.ts — a second, driftable copy of @forge/contracts's
  // declaration, even one that is byte-identical today. This is the exact
  // shape the pre-forge-8vfn.5.17 file had (`export type Run = { ... }`,
  // `export type RunPhaseMeta = { ... }`) and the exact shape a regression
  // would reintroduce.
  const source = studioClientSource();
  for (const name of RUN_TYPES) {
    const localDeclaration = new RegExp(`export type ${name}\\s*=[^;]`);
    expect(
      localDeclaration.test(source),
      `${name} is declared locally in studio-client.ts ("export type ${name} = ...") instead of imported from @forge/contracts`,
    ).toBe(false);
  }
});
