/**
 * Dispatch-hijack proof: `resolveBandGuard` reads ONLY `composition.guards`.
 *
 * A library hook whose id COLLIDES with a band id must never reach band
 * dispatch. `composition.hooks` is operator-authored, third-party-installable
 * data; `composition.guards` selects platform machinery. If the former could
 * influence the latter, installing a community hook called `wi-contract`
 * would silently re-route an agent's pipeline.
 *
 * MOVED HERE from `packages/library/studio/hook-library.test.ts` in
 * M4-library PR 2. It always asserted about `resolveBandGuard`, which is
 * agents' function, from a library test file — that is a `library → agents`
 * import and library (rank 2) may not reach agents (rank 3). The subject was
 * always agents'; only the file was in the wrong package. Nothing about the
 * assertions changed: the three cases, the fixture shape and the
 * `as unknown as AgentDefinition` widening are verbatim.
 *
 * The widening is deliberate and documented: `AgentComposition` does not
 * carry `hooks` on the type, so a typed fixture cannot express the hijack
 * this test exists to refute. `as unknown as` is the minimal way to pin the
 * contract — never `any`, never `@ts-expect-error`.
 *
 * The complementary half — that `lintHookComposition` REFUSES a band id
 * placed in `composition.hooks` in the first place — stays in
 * `hook-library.test.ts`, where the linter lives. Two packages, two halves,
 * neither sufficient alone.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

import { resolveBandGuard } from '../../agent-bands.ts';

function makeAgentDef(slug: string, guards: string[]): AgentDefinition {
  return {
    slug,
    name: slug,
    description: `Agent ${slug}.`,
    purpose: 'Test purpose.',
    composition: { skills: [], tools: [], mcps: [], hooks: [], guards },
    runtime: { sdk: 'claude', strategy: 'fixed' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Body.',
    path: `/fake/${slug}/SKILL.md`,
  } as AgentDefinition;
}

describe('dispatch-hijack proof: resolveBandGuard reads ONLY composition.guards', () => {
  it('a colliding id ("wi-contract") sitting in composition.hooks does not resolve a band', () => {
    const base = makeAgentDef('innocent-agent', []); // no band declared in guards
    const hijacked = {
      ...base,
      composition: { ...base.composition, hooks: ['wi-contract'] },
    } as unknown as AgentDefinition;
    assert.equal(resolveBandGuard(hijacked), undefined, 'composition.hooks must never influence band dispatch');
  });

  it('the SAME agent WITH the id correctly placed in composition.guards DOES resolve the band', () => {
    const legit = makeAgentDef('project-manager', ['wi-contract']);
    assert.equal(resolveBandGuard(legit), 'wi-contract');
  });

  it('composition.hooks containing every band id simultaneously still resolves nothing', () => {
    const base = makeAgentDef('another-innocent-agent', []);
    const hijacked = {
      ...base,
      composition: { ...base.composition, hooks: ['wi-contract', 'reflection-close', 'demo-band', 'review-band'] },
    } as unknown as AgentDefinition;
    assert.equal(resolveBandGuard(hijacked), undefined);
  });

  // Folded in from the retired `agent-bands-guards-migration.test.ts` (M4
  // cull). That file's own header declared it "must be RED until the rename
  // lands"; the `resolveBandHook` → `resolveBandGuard` rename HAS landed, so
  // both its cases were permanently-green tripwires for a finished migration.
  // Its D1 was input- and assertion-identical to the `legit` case above. Its
  // D2 is this — the pure empty-guards input, with no `hooks` key at all, so
  // it is not merely the negative half of a hijack case.
  it('an empty composition.guards resolves no band (no hooks key present at all)', () => {
    const def = makeAgentDef('guards-only-fixture', []);
    assert.equal(
      resolveBandGuard(def),
      undefined,
      'expected resolveBandGuard to handle an empty-guards def cleanly (no band declared)',
    );
  });
});
