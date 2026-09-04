/**
 * ACCEPTANCE TEST (must be RED until fixed) — bd `forge-b2k` (P1):
 * `flowProjectOf` in cli/bridge-studio-writes.ts (~L1010) is an unguarded
 * file-existence ORACLE, driven through the REAL PUT /api/studio/flows/:id
 * route (mirrors the fixture idiom of cli/bridge-studio-flows.test.ts).
 *
 * Root cause: the PUT route's own `id` (the URL path segment) IS SLUG_RE-
 * gated and containment-guarded (resolveGuardedPath) — that is not the bug.
 * The bug is a SECOND, independent path construction inside the SAME
 * handler: the closure passed as `opts.flowProjectOf` —
 *
 *   const flowProjectOf = (id: string): string | null | undefined => {
 *     if (id === merged.id) return merged.project;
 *     try {
 *       return loadFlowDefinition(join(ctx.forgeRoot, 'studio', 'flows', id, 'flow.yaml')).project;
 *     } catch { return undefined; }
 *   };
 *
 * — called from `checkTargetProject` (orchestrator/studio/validate-triggers.ts)
 * with `id = trigger.target.ref`, taken VERBATIM from the request BODY's
 * `triggers[].target.ref` field. That `ref` is NEVER SLUG_RE-gated or
 * containment-guarded anywhere on this path (checkFlowTriggers only checks
 * `opts.flowIds.has(ref)` for a REGISTRY-MEMBERSHIP finding — it does not
 * gate the shape of `ref` before `flowProjectOf` uses it in a raw `join()` +
 * `readFileSync`-backed load). A `..`-traversing `ref` is joined straight
 * into a real filesystem read of an ARBITRARY, attacker-chosen path.
 *
 * It is a READ (existence + shape oracle), not a write: the file's CONTENTS
 * are never returned to the client. But whether `loadFlowDefinition` throws
 * (path absent, unreadable, or fails to parse as a FlowDefinition with a
 * project field) vs. succeeds with a non-empty `project` is OBSERVABLE in
 * the PUT response's `findings` array (`checkTargetProject`'s "no project
 * binding" trigger-cron finding is present in one case, absent in the
 * other) — a classic existence oracle: an attacker can binary-search the
 * filesystem outside the forge root, one PUT request confirming/refuting
 * "does a FlowDefinition-shaped YAML file exist at this exact path" without
 * ever seeing its content.
 *
 * The correct fix closes the oracle: the SAME request, sent when the
 * traversal target is absent vs. present-and-parseable, must produce an
 * INDISTINGUISHABLE outcome (identical status code AND identical findings).
 * This test sends the literal SAME PUT body (byte-identical target.ref)
 * TWICE — once before the outside file exists, once after — so the only
 * variable between the two calls is the outside filesystem state, never a
 * different ref string (which would trivially make the two responses
 * differ by the ref text baked into finding messages, an irrelevant
 * confound, not the oracle itself).
 *
 * Self-check: if the oracle were closed, both calls would produce IDENTICAL
 * findings arrays regardless of whether the outside file exists — that is
 * exactly what this test asserts and what fails today.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors cli/bridge-studio-flows.test.ts)
// ---------------------------------------------------------------------------

function makeAgentSkillMd(): string {
  return [
    '---',
    'name: Test Agent',
    'description: Minimal agent for the oracle test.',
    'phase: architect',
    'purpose: Run tests.',
    'brainAccess: none',
    'interactivity: none',
    'composition:',
    '  skills: [tdd-workflow]',
    '  tools: []',
    '  mcps: []',
    '  guards: [event-log]',
    'runtime:',
    '  sdk: claude-code',
    '  strategy: fixed',
    '  model: claude-sonnet-4-5',
    'allowed-tools: []',
    'disallowed-tools: []',
    'budgets: {}',
    '---',
    '',
    'Test agent process body.',
  ].join('\n');
}

/** A real, load-able FlowDefinition — the "outside" traversal target. */
function makeOutsideFlowYaml(project: string): string {
  return [
    'id: outside-secret-flow',
    'name: Outside Secret Flow',
    'version: 1',
    'goal: An outside flow the oracle probes for.',
    'project: ' + project,
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'nodes:',
    '  - id: architect',
    '    agent: test-agent',
    '  - id: review',
    '    gate: human',
    'edges:',
    '  - from: architect',
    '    to: review',
    '    artifact: PLAN.md',
    'triggers: []',
  ].join('\n');
}

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
let outsideDir: string;
let ref: string;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-flow-oracle-'));
  outsideDir = mkdtempSync(join(tmpdir(), 'bridge-flow-oracle-outside-'));

  mkdirSync(join(forgeRoot, 'skills', 'test-agent'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-agent', 'SKILL.md'), makeAgentSkillMd());
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });

  for (const state of ['pending', 'done', 'ready-for-review', 'failed', 'in-flight']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // The traversal ref: a relative path from <forgeRoot>/studio/flows/ to the
  // OUTSIDE tmp directory — computed at runtime so this test is not tied to
  // any particular tmp-dir depth on a given machine.
  ref = relative(join(forgeRoot, 'studio', 'flows'), outsideDir);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (outsideDir) rmSync(outsideDir, { recursive: true, force: true });
});

async function putJson(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}/api/studio/flows/oracle-flow`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function oracleBody(): Record<string, unknown> {
  return {
    goal: 'Oracle probe.',
    nodes: [
      { id: 'architect', agent: 'test-agent' },
      { id: 'review', gate: 'human' },
    ],
    edges: [{ from: 'architect', to: 'review', artifact: 'PLAN.md' }],
    triggers: [
      {
        on: 'cron',
        schedule: '0 0 * * *',
        target: { kind: 'flow', ref },
      },
    ],
  };
}

test('FIXED (verified against the amended build; not touched this round — the assertion was already property-based): flowProjectOf must not be a file-existence oracle — the SAME PUT body must produce IDENTICAL findings regardless of outside filesystem state', async () => {
  // Call 1: the traversal target does not exist yet at all.
  const before1 = await putJson(oracleBody());
  assert.equal(before1.status, 400, `expected 400 (the unregistered-flow-target finding always fires), got ${before1.status}: ${JSON.stringify(before1.json)}`);

  // Plant a REAL, load-able FlowDefinition at the traversal target, with a
  // non-empty project binding.
  writeFileSync(join(outsideDir, 'flow.yaml'), makeOutsideFlowYaml('some-outside-project'));

  // Call 2: the LITERAL SAME body (same ref string) — only the outside
  // filesystem state changed.
  const after1 = await putJson(oracleBody());
  assert.equal(after1.status, 400, `expected 400 again (still an unregistered-flow-target), got ${after1.status}: ${JSON.stringify(after1.json)}`);

  assert.deepEqual(
    after1.json,
    before1.json,
    `the SAME request must produce an INDISTINGUISHABLE response regardless of whether a FlowDefinition-shaped file exists at the traversal target — got DIFFERENT findings:\n` +
      `  before (target absent):  ${JSON.stringify(before1.json)}\n` +
      `  after  (target present): ${JSON.stringify(after1.json)}\n` +
      `Today: flowProjectOf(ref) reads straight through the unguarded join(forgeRoot,'studio','flows',ref,'flow.yaml') — when the outside file is absent it throws (caught, returns undefined), producing an EXTRA "trigger-cron ... has no project binding" finding that disappears once a project-bound flow.yaml exists at that exact path. This is the oracle: an attacker can binary-search the filesystem outside the forge root one PUT at a time, learning "does a FlowDefinition-shaped YAML file exist here, and does it carry a non-empty project" without ever seeing the file's content.`,
  );
});

test('sanity: the outside traversal target is never written to, and studio/flows/oracle-flow is never created (every call above 400s before the write step)', () => {
  assert.ok(!existsSync(join(forgeRoot, 'studio', 'flows', 'oracle-flow', 'flow.yaml')), 'the flow being edited must never have been written — the oracle is a read, not a write');
});
