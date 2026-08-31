/**
 * forge-6gv.19 (W8-B4) — REAL end-to-end pins for the from-blank Agent
 * Builder compose, driven through the ACTUAL bridge PUT route (not a
 * hand-rolled call to `serializeAgentDefinition`/`toolFenceFinding` in
 * isolation — see `cli/studio-lint-tool-fence.test.ts`'s own header for why
 * this repo insists on the real entry point).
 *
 * The full chain exercised:
 *
 *   apps/studio/lib/agent-authoring-view.ts's REAL `BLANK_STATE` (imported, not
 *   hand-copied)
 *     -> REAL `buildAgentPutBody`
 *     -> PUT /api/studio/agents/:slug (cli/bridge-studio-writes.ts)
 *     -> REAL `serializeAgentDefinition` (orchestrator/studio/skill-md-
 *        fidelity.ts)
 *     -> an on-disk SKILL.md
 *     -> REAL `lintSkillToolFence` (cli/studio-lint-tool-fence.ts) — the
 *        exported entry point `toolFenceFinding` is reached through.
 *
 * Pin 1 — a from-blank compose (BLANK_STATE + the name a human must type
 *         before handleSave's own client guard allows the click through)
 *         passes the fence. Proven red at branch base by BLANK_STATE's
 *         pre-fix `disallowedTools: []` (see the W8-B4 session report for
 *         the quoted failing output; also reproduced here by the
 *         restore-and-reprove dance on `apps/studio/lib/agent-authoring-
 *         view.ts` — not committed).
 *
 * Pin 2 — the fence still catches a REAL violation: an agent that declares
 *         tool frontmatter (both keys present — exactly what a from-blank
 *         compose always writes, per skill-md-fidelity.ts's unconditional
 *         both-keys write) and omits Task/Agent from disallowed-tools STILL
 *         reports the finding. This is the pin that stops a future
 *         "stop writing the key when empty" (option (a), disqualified by
 *         the ruling) regression: that shape would move the agent OUT of
 *         `declaresToolFrontmatter`'s scope, and this pin would go red.
 *
 * RUN: node --experimental-strip-types --test cli/bridge-studio-write-tool-fence.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';
import { lintSkillToolFence } from '@forge/library/studio-lint-tool-fence.ts';
import { BLANK_STATE, buildAgentPutBody, type AgentBuilderState } from '../apps/studio/lib/agent-authoring-view.ts';

const CHECK = 'skill-tool-fence/task-agent-not-disallowed';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-tool-fence-'));
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'done'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

/** The REAL "pick Blank, type the required fields, Save" flow: BLANK_STATE
 *  plus only what a human must type before (a) handleSave's own client
 *  guard allows the click through (`name`) and (b) validateAgent's
 *  error-level checks require server-side (`purpose`, the process/body
 *  text) — `interactivity`/`guards`/`runtime` are already non-blank on
 *  BLANK_STATE itself and are left untouched. */
function fromBlankFilledIn(overrides: Partial<AgentBuilderState> = {}): AgentBuilderState {
  return {
    ...BLANK_STATE,
    name: 'Blank Compose Test',
    purpose: 'Prove a from-blank compose passes the tool fence.',
    process: '## Process\n\nDo the thing.\n',
    ...overrides,
  };
}

test('pin 1: a from-blank Agent Builder compose, saved via the REAL bridge PUT route, passes skill-tool-fence/task-agent-not-disallowed', async () => {
  const slug = 'blank-compose-test';
  const res = await putJson(`${bridgeUrl}/api/studio/agents/${slug}`, buildAgentPutBody(fromBlankFilledIn(), { create: true }));
  assert.equal(res.status, 200, `PUT failed: ${await res.text()}`);

  const findings = lintSkillToolFence(forgeRoot);
  const hits = findings.filter((f) => f.object === `skill:${slug}`);
  assert.deepEqual(hits, [], `a from-blank compose must pass the tool fence — got: ${JSON.stringify(hits)}`);
});

test('pin 2: an agent whose disallowed-tools omits Task/Agent STILL reports the finding (the in-scope set has not shrunk)', async () => {
  // Simulates the pre-fix regression shape directly against the real bridge
  // + real lint, independent of whatever BLANK_STATE currently ships —
  // proves the LINT side of the fence still enforces, not just that
  // BLANK_STATE happens to be correct today.
  const slug = 'blank-compose-unfenced-regression';
  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${slug}`,
    buildAgentPutBody(fromBlankFilledIn({ disallowedTools: [] }), { create: true }),
  );
  assert.equal(res.status, 200, `PUT failed: ${await res.text()}`);

  const findings = lintSkillToolFence(forgeRoot);
  const hits = findings.filter((f) => f.object === `skill:${slug}` && f.check === CHECK && f.level === 'error');
  assert.equal(
    hits.length,
    1,
    `an agent declaring tool frontmatter with an empty disallowed-tools must still fail the fence — got: ${JSON.stringify(hits)}`,
  );
  assert.match(hits[0]!.message, /Task/);
  assert.match(hits[0]!.message, /Agent/);
});

test('pin 2b: the same agent, correctly fenced, passes — proves pin 2 is a real content check, not a permanently-red assertion', async () => {
  const slug = 'blank-compose-fenced-control';
  const res = await putJson(
    `${bridgeUrl}/api/studio/agents/${slug}`,
    buildAgentPutBody(fromBlankFilledIn({ disallowedTools: ['Task', 'Agent'] }), { create: true }),
  );
  assert.equal(res.status, 200, `PUT failed: ${await res.text()}`);

  const findings = lintSkillToolFence(forgeRoot);
  const hits = findings.filter((f) => f.object === `skill:${slug}`);
  assert.deepEqual(hits, [], `a correctly-fenced agent must pass — got: ${JSON.stringify(hits)}`);
});
