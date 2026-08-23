/**
 * forge-6gv.19 (W8-B4) — the CROSS-CHECK for the tool-fence "required names"
 * rule (`Task`, `Agent` — the two names a SKILL.md's `disallowed-tools:`
 * must list before `cli/studio-lint-tool-fence.ts`'s
 * `skill-tool-fence/task-agent-not-disallowed` check stops firing).
 *
 * This value is hand-copied on BOTH sides of the cli/orchestrator <->
 * forge-ui boundary (forge-ui never imports cli/ at runtime — see
 * forge-ui/lib/session-lifecycle-client.ts's and forge-ui/lib/session-
 * client.ts's own headers for the stated "no-cross-boundary-import"
 * convention). The defect this file exists to prevent from recurring:
 * `forge-ui/app/agents/[id]/page.tsx`'s `BLANK_STATE` shipped
 * `disallowedTools: []` with NOTHING tying it to the lint's own required
 * names — a hand-copy with no cross-check, the exact shape of bug
 * `cli/authoring-package-shape-parity.test.ts` (W8-B4 FIX-1) already exists
 * to prevent for the authoring-package-shape rule. This test is that SAME
 * pattern applied to the tool-fence required-names rule.
 *
 * A plain, framework-free TS module under forge-ui/lib/ (no JSX, no
 * 'use client', no Next-only API) IS importable directly by a `node
 * --experimental-strip-types --test` file under cli/ — see
 * cli/id-rule.test.ts's and cli/authoring-package-shape-parity.test.ts's own
 * precedent. This test imports the REAL lint-side array
 * (cli/studio-lint-tool-fence.ts's exported `TOOL_FENCE_REQUIRED_NAMES`)
 * alongside the REAL client-side array
 * (forge-ui/lib/tool-fence-required-names.ts) and asserts they are
 * IDENTICAL — so a name added/removed on one side and forgotten on the
 * other is a RED test, not a silent gap.
 *
 * RUN: node --experimental-strip-types --test cli/tool-fence-required-names-parity.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_FENCE_REQUIRED_NAMES as LINT_NAMES } from './studio-lint-tool-fence.ts';
import { TOOL_FENCE_REQUIRED_NAMES as CLIENT_NAMES } from '../forge-ui/lib/tool-fence-required-names.ts';

test('the lint-side and client-side TOOL_FENCE_REQUIRED_NAMES arrays are byte-for-byte identical', () => {
  assert.deepEqual(
    CLIENT_NAMES,
    LINT_NAMES,
    `forge-ui/lib/tool-fence-required-names.ts's TOOL_FENCE_REQUIRED_NAMES has drifted from ` +
      `cli/studio-lint-tool-fence.ts's own copy — a name was added/changed on one side and not ` +
      `the other:\n  lint:   ${JSON.stringify(LINT_NAMES)}\n  client: ${JSON.stringify(CLIENT_NAMES)}`,
  );
});

test('both required names (Task, Agent) are present, in order, on both sides', () => {
  assert.deepEqual([...LINT_NAMES], ['Task', 'Agent']);
  assert.deepEqual([...CLIENT_NAMES], ['Task', 'Agent']);
});

// The enumeration/drift pin itself: a hypothetical 3rd name added to the
// LINT array but never propagated to the CLIENT array must fail the
// identity check above — proven here by literally constructing that
// drifted state and asserting the SAME comparison the first test performs
// would catch it, without mutating the real modules.
test('enumeration pin: a name present on one side only is NOT deep-equal (proves the cross-check above cannot pass through silent drift)', () => {
  const driftedLint = [...LINT_NAMES, 'Bash'];
  assert.throws(() => assert.deepEqual(CLIENT_NAMES, driftedLint));
});
