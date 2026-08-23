/**
 * W8-B4 FIX-1 — the CROSS-CHECK for the authoring package "shape rule"
 * (which single file at an authoring session's `staging/` root identifies
 * the drafted package's kind: `SKILL.md` -> skill, `hook.yaml` -> hook,
 * `template.md` -> template).
 *
 * This rule is hand-copied on BOTH sides of the cli/orchestrator <->
 * forge-ui boundary (forge-ui never imports cli/ at runtime — see
 * forge-ui/lib/session-lifecycle-client.ts's own header: "a hand-mirrored
 * copy, never an import"; forge-ui/lib/session-client.ts's header names the
 * same "no-cross-boundary-import convention"). The W8-B4/WI-3 defect this
 * file exists to prevent from ever recurring: `kind:'template'` was taught
 * to the server's DEDICATED finalize route
 * (`cli/bridge-studio-authoring.ts`) but never to the GENERIC verdict
 * route's own copy of the rule (`cli/bridge-studio-affordances.ts`'s
 * `deriveAuthoringPackageKind`) — the route the operator's real Approve
 * button actually calls — so drafting a template worked but approving it
 * 409'd forever. A hand-copy with no cross-check is exactly how that
 * happened; this test is the cross-check.
 *
 * A plain, framework-free TS module under forge-ui/lib/ (no JSX, no
 * 'use client', no Next-only API) IS importable directly by a `node
 * --experimental-strip-types --test` file under cli/ — see
 * cli/id-rule.test.ts's own precedent (`import { buildProjectSavePayload }
 * from '../forge-ui/lib/project-save-payload.ts'`). This test uses that
 * SAME precedent to import the REAL client-side array
 * (forge-ui/lib/authoring-package-shape.ts) alongside the REAL server-side
 * array (cli/bridge-studio-affordances.ts's exported
 * `AUTHORING_PACKAGE_SHAPES`) and asserts they are IDENTICAL — so a shape
 * added to one side and forgotten on the other is a RED test, not a silent
 * gap. This is the "one definition on each side, each with a test that
 * fails if the two disagree" fallback (never a single shared module,
 * because forge-ui's OWN production bundle — the browser side — still never
 * imports cli/ at runtime; only this NODE-SIDE TEST crosses the boundary).
 *
 * RUN: node --experimental-strip-types --test cli/authoring-package-shape-parity.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUTHORING_PACKAGE_SHAPES as SERVER_SHAPES } from './bridge-studio-affordances.ts';
import { AUTHORING_PACKAGE_SHAPES as CLIENT_SHAPES } from '../forge-ui/lib/authoring-package-shape.ts';

test('the server-side and client-side authoring-package-shape arrays are byte-for-byte identical', () => {
  assert.deepEqual(
    CLIENT_SHAPES,
    SERVER_SHAPES,
    `forge-ui/lib/authoring-package-shape.ts's AUTHORING_PACKAGE_SHAPES has drifted from ` +
      `cli/bridge-studio-affordances.ts's own copy — a shape was added/changed on one side ` +
      `and not the other:\n  server: ${JSON.stringify(SERVER_SHAPES)}\n  client: ${JSON.stringify(CLIENT_SHAPES)}`,
  );
});

test('every currently-known shape (skill, hook, template) is present on BOTH sides, naming the exact marker filename', () => {
  const byKind = (shapes: readonly { filename: string; kind: string }[]) =>
    Object.fromEntries(shapes.map((s) => [s.kind, s.filename]));
  assert.deepEqual(byKind(SERVER_SHAPES), { skill: 'SKILL.md', hook: 'hook.yaml', template: 'template.md' });
  assert.deepEqual(byKind(CLIENT_SHAPES), { skill: 'SKILL.md', hook: 'hook.yaml', template: 'template.md' });
});

// The enumeration pin itself: a hypothetical 4th shape added to the SERVER
// array but never propagated to the CLIENT array must fail the identity
// check above — proven here by literally constructing that drifted state
// and asserting the SAME comparison this file's first test performs would
// catch it, without mutating the real modules.
test('enumeration pin: a shape present on one side only is NOT deep-equal (proves the cross-check above cannot pass through silent drift)', () => {
  const driftedServer = [...SERVER_SHAPES, { filename: 'agent.md', kind: 'agent-package' }];
  assert.throws(() => assert.deepEqual(CLIENT_SHAPES, driftedServer));
});
