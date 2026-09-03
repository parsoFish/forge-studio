/**
 * forge-6gv.19 (W8-B4) — the ENUMERATION pin for `serializeAgentDefinition`
 * (`projectAgentFrontmatter`, this module's `:62-63`): `allowed-tools` and
 * `disallowed-tools` must be written TOGETHER on a full re-serialize, never
 * one without the other.
 *
 * WHY THIS MATTERS. `cli/studio-lint-tool-fence.ts`'s scope test is
 * presence-only (`'allowed-tools' in data || 'disallowed-tools' in data`),
 * deliberately (see that file's own header — option (b), judging content
 * instead of presence, is rejected for this lane). The ORIGINAL forge-6gv.19
 * bead named only `disallowed-tools` as the unconditional write to fix; the
 * ruling (see `apps/studio/lib/agent-authoring-view.ts`'s `BLANK_STATE`
 * comment) corrected that — `allowed-tools` at `:62` is EQUALLY
 * unconditional and equally trips the presence test on its own. This pin
 * exists so a future edit that starts conditionally omitting just ONE of
 * the two keys (the disqualified "stop writing the key when empty" shape,
 * option (a) in the ruling) fails HERE, at the producer, rather than only
 * being caught indirectly by a downstream lint fixture.
 *
 * This pin is GREEN ON ARRIVAL — `projectAgentFrontmatter` already writes
 * both keys unconditionally and W8-B4 does not change that function (the
 * fix lives at the BLANK_STATE seed, one layer up). Load-bearingness is
 * proven by temporarily mutating one of the two unconditional writes to be
 * conditional (option (a)'s exact shape) and watching this test fail — see
 * the W8-B4 session report for the quoted red output; the mutation is not
 * committed.
 *
 * RUN: node --experimental-strip-types --test orchestrator/studio/skill-md-fidelity.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import matter from 'gray-matter';

import { serializeAgentDefinition } from '../../studio/skill-md-fidelity.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

function minimalDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'probe-agent',
    name: 'Probe Agent',
    description: 'A minimal agent for the skill-md-fidelity enumeration pin.',
    purpose: 'Prove allowed-tools/disallowed-tools are emitted together.',
    composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed' },
    brainAccess: 'none',
    interactivity: 'none',
    allowedTools: [],
    disallowedTools: [],
    budgets: {},
    body: '## Process\n\nDo the thing.\n',
    ...overrides,
  } as AgentDefinition;
}

test('enumeration pin: a full re-serialize (no originalRaw) writes allowed-tools and disallowed-tools TOGETHER', () => {
  const out = serializeAgentDefinition(minimalDef());
  const { data } = matter(out);
  const hasAllowed = 'allowed-tools' in data;
  const hasDisallowed = 'disallowed-tools' in data;
  assert.strictEqual(
    hasAllowed,
    hasDisallowed,
    `projectAgentFrontmatter must write both tool-fence keys together — got ` +
      `allowed-tools=${hasAllowed} disallowed-tools=${hasDisallowed}`,
  );
  // Today both are ALWAYS present on a full re-serialize (unconditional
  // writes) — pin the actual current behaviour, not just the symmetry.
  assert.strictEqual(hasAllowed, true, 'expected allowed-tools to be present on a full re-serialize');
  assert.strictEqual(hasDisallowed, true, 'expected disallowed-tools to be present on a full re-serialize');
});

test('enumeration pin holds when the two arrays are asymmetric (one fenced, one not)', () => {
  const out = serializeAgentDefinition(minimalDef({ disallowedTools: ['Task', 'Agent'], allowedTools: [] }));
  const { data } = matter(out);
  assert.strictEqual('allowed-tools' in data, 'disallowed-tools' in data);
  assert.deepEqual(data['disallowed-tools'], ['Task', 'Agent']);
  assert.deepEqual(data['allowed-tools'], []);
});

test('enumeration pin holds on the byte-preserving fast path too (originalRaw supplied, frontmatter unchanged)', () => {
  const def = minimalDef({ disallowedTools: ['Task', 'Agent'] });
  const first = serializeAgentDefinition(def);
  // Re-serialize with the first output as originalRaw and an IDENTICAL def —
  // nothing semantically changed, so the D5 fast path applies (original
  // frontmatter block kept verbatim). Both keys must still be present,
  // because they were present in `first`.
  const second = serializeAgentDefinition(def, first);
  const { data } = matter(second);
  assert.strictEqual('allowed-tools' in data, 'disallowed-tools' in data);
});
