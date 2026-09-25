/**
 * The materials vocabulary has ONE definition, and this test proves it
 * structurally (forge-ni3).
 *
 * HISTORY. `apps/studio/lib/studio-client.ts` used to hand-keep its own
 * literal `MATERIAL_KINDS = ['images', 'documents', 'audio', 'data-files']`,
 * documented as "Mirrors `packages/agents/studio/materials.ts`'s
 * `MATERIAL_KINDS` verbatim ... keep it in lockstep with the server list if
 * it ever changes" — the same hand-kept-mirror shape forge-zyc proved drifts
 * silently for `SHIPPED_TRIGGER_KINDS`. `@forge/contracts` removes the
 * constraint that forced the mirror (studio may import only
 * `@forge/contracts`): both `packages/agents/studio/materials.ts` and
 * `apps/studio/lib/studio-client.ts` now import and re-export the SAME
 * binding, so the two cannot drift. Mirrors
 * `bridge-port-parity.test.ts`'s own precedent (`DEFAULT_BRIDGE_PORT`).
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/contract/material-kinds-parity.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MATERIAL_KINDS as CONTRACT_KINDS } from '@forge/contracts';
import { MATERIAL_KINDS as STUDIO_KINDS } from '../../lib/studio-client.ts';

const STUDIO_CLIENT_PATH = resolve(__dirname, '..', '..', 'lib', 'studio-client.ts');
const AGENTS_MATERIALS_PATH = resolve(__dirname, '../../../../packages/agents/studio/materials.ts');

test('studio-client.ts serves the contracts constant itself, not a copy of its value', () => {
  expect(STUDIO_KINDS).toBe(CONTRACT_KINDS);
  expect(CONTRACT_KINDS).toEqual(['images', 'documents', 'audio', 'data-files']);
});

test('apps/studio/lib/studio-client.ts holds no local MATERIAL_KINDS literal — it re-exports the contract', () => {
  const source = readFileSync(STUDIO_CLIENT_PATH, 'utf8');
  expect(
    /const\s+MATERIAL_KINDS\s*=/.test(source),
    'studio-client.ts re-declared MATERIAL_KINDS locally — the two can drift again; import it from @forge/contracts',
  ).toBe(false);
  expect(
    /MATERIAL_KINDS[^}]*}\s*from\s*'@forge\/contracts'/.test(source),
    'studio-client.ts must reach the vocabulary through @forge/contracts',
  ).toBe(true);
});

test('packages/agents/studio/materials.ts holds no local MATERIAL_KINDS literal either', () => {
  const source = readFileSync(AGENTS_MATERIALS_PATH, 'utf8');
  expect(
    /const\s+MATERIAL_KINDS\s*=/.test(source),
    'materials.ts re-declared MATERIAL_KINDS locally — re-export it from @forge/contracts instead',
  ).toBe(false);
});
