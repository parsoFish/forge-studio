/**
 * ONE state, ONE word — the community install state a hook reports, driven at
 * the two ROUTES an operator actually walks (ruling 402, T1 M6; ruling 326:
 * a capability closes on a door-driving test, not on a helper's unit case).
 *
 * WHAT WAS MEASURED. Story S8 beat 14 installs a vendored hook by id, follows
 * it to the page that owns the trust decision, and found the two surfaces
 * disagreeing about the same hook:
 *
 *     data-install-state: expected "needs-review", got "draft-pending-approval"
 *
 * `communityInstallState`'s hook branch consulted `hookRunState(...).runnable`
 * alone and discarded `.needsReview` — already true for a freshly installed
 * hook with no ledger entry (`studio/hook-approval-ledger.ts`, the `!ledgerEntry`
 * arm). So a hook waiting on the operator's trust decision was reported in a
 * word only the community layer uses, while the install route that had just
 * created it answered `hook-needs-approval` and `/hooks/<id>` rendered
 * `data-hook-trust="needs-review"` for that same hook.
 *
 * WHICH WORD IS REAL IS NOT A MATTER OF TASTE, and this is the part worth
 * keeping: `needs-review` appears in 37 non-test places across
 * `packages/library` and `apps/studio`, including the load-bearing
 * `computeTrust` (`bridge-studio-hooks.ts`) and the live DOM attribute.
 * `draft-pending-approval` appeared in exactly three files, ALL inside the
 * community layer itself — a private name for a decision another subsystem
 * owns. A surface that invents its own vocabulary for a shared state makes
 * the operator learn two words for one thing, and a story walking both doors
 * is what noticed.
 *
 * `draft-pending-approval` is NOT retired: it stays reachable for the residual
 * `!needsReview && !runnable` case (an approved, hash-matching hook whose scan
 * verdict is currently blocked without an override), so nothing is lost.
 *
 * WHY THIS FILE EXISTS RATHER THAN A TEST IN `bridge-studio-community.test.ts`:
 * that file is a BASELINED oversize file (908 lines against the 800-line cap),
 * and `check-file-size`'s rule is that an exemption is a ceiling, not a
 * licence — it may only shrink. A new file is the honest home for new
 * coverage, and it also keeps this measurement findable by its own name.
 *
 * WHY IT DISPATCHES THE ROUTES DIRECTLY INSTEAD OF BOOTING A BRIDGE. Ten
 * sibling suites in this package import `startBridge` from
 * `apps/forge/ui-bridge.ts` and boot a real server. Every one of them is
 * BASELINED: `check-boundaries` calls that edge `package-to-assembly` — a
 * package reaching up into the assembly inverts the direction the assembly
 * exists to provide — and a NEW file taking it is a new violation off the
 * baseline, which `npm test` caught here before this ever reached CI. The
 * baseline only shrinks, so the honest move is not to join it. `dispatchRoute`
 * over `libraryRoutes` is the same door — it IS the route table these URLs
 * resolve through — reached without the assembly. The sibling suites'
 * `bridgeUrl` adds an HTTP hop and a server lifecycle, neither of which this
 * measurement is about.
 *
 * MUTATION PASS (§15.68 — a control that is green either way is not a
 * control). Restoring the old one-liner
 * (`hookRunState(...).runnable ? 'installed' : 'draft-pending-approval'`) reds
 * BOTH this file's test and the unit case in `studio/community-index.test.ts`:
 * measured `# pass 94 / # fail 2` with the two `not ok` lines named. Recorded
 * in the PR body.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import yaml from 'js-yaml';
import { dispatchRoute } from '@forge/kernel';
import { libraryRoutes } from '../../routes.ts';
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts';
import { fixtureFlowSource } from '../test-fixtures/flow-fixture.ts';
import { inertAuthoringSession } from '../test-fixtures/authoring-session-fixture.ts';

let forgeRoot: string;

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'community-install-state-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), yaml.dump({}), 'utf8');
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

/** Drive one library route and read back what it actually sent. The response
 *  is captured off `writeHead`/`end`, which is exactly what `sendJson`
 *  (`packages/kernel/http-envelope.ts:50-58`) calls. */
async function callRoute(
  url: string,
  method: string,
  body: unknown = {},
): Promise<{ status: number; handled: boolean; json: Record<string, unknown> }> {
  let status = 0;
  let payload = '';
  const res = {
    writeHead: (s: number) => { status = s; },
    end: (chunk?: string) => { if (typeof chunk === 'string') payload = chunk; },
  } as unknown as ServerResponse;

  const handled = await dispatchRoute(
    libraryRoutes({
      agentFacts: fixtureAgentFacts(forgeRoot),
      isSdkAvailable: () => false,
      flowSource: fixtureFlowSource,
      authoringSession: inertAuthoringSession,
    }),
    {} as IncomingMessage,
    res,
    { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => body },
    url,
    method,
  );

  assert.equal(handled, true, `the library route table must own ${method} ${url}`);
  return { status, handled, json: payload === '' ? {} : (JSON.parse(payload) as Record<string, unknown>) };
}

/** A vendored community hook package — the only kind forge can install, since
 *  the install copies bytes already committed in this repo and fetches
 *  nothing (`bridge-studio-community.ts`'s hook arm). */
function vendorHookPackage(id: string): void {
  const dir = join(forgeRoot, 'studio', 'community', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id,
      name: id,
      description: `${id} description`,
      on: 'PreToolUse',
      script: 'scripts/run.sh',
      permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
}

test('402: a hook installed by id reads "needs-review" on the detail route — the word the install route and /hooks/<id> already use', async () => {
  vendorHookPackage('route-hook-state-word');

  const installed = await callRoute('/api/studio/community/hook/route-hook-state-word/install', 'POST');
  assert.equal(installed.status, 200);
  assert.equal(
    installed.json.routedTo,
    'hook-needs-approval',
    'the install route names the state one way; the rest of this test is about whether the next route agrees',
  );

  const detail = await callRoute('/api/studio/community/hook/route-hook-state-word', 'GET');
  assert.equal(detail.status, 200);
  const item = detail.json as { id: string; installState?: string };
  // Sanity first: without this the assertion below could pass against a body
  // about some other hook entirely.
  assert.equal(item.id, 'route-hook-state-word', 'the detail route answered about the hook this test installed');
  assert.equal(
    item.installState,
    'needs-review',
    'the detail route must not invent a private name for a decision the hooks subsystem owns',
  );
});

test('402: an uninstalled vendored hook still reads "not-installed" — the fix did not collapse two states into one', async () => {
  vendorHookPackage('route-hook-untouched');
  const detail = await callRoute('/api/studio/community/hook/route-hook-untouched', 'GET');
  assert.equal(detail.status, 200);
  assert.equal((detail.json as { installState?: string }).installState, 'not-installed');
});
