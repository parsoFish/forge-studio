/**
 * forge-nk1y.5 — every interactive session start stamps a spend ceiling on the
 * session's FIRST status write, or is refused by name before ANY session dir or
 * status is written.
 *
 * Capstone A (2026-10-09): the instructions and project-brain sessions started
 * with `budgets: {}` and no ceiling field, so with FORGE_COST_CEILING_USD unset
 * nothing bounded them. `turnBudgetUsd` already caps every turn at
 * `status.costCeilingUsd` minus the session's spend, so stamping the status IS
 * the enforcement; these tests pin the stamp per start route (all seven session
 * kinds) and the refusal.
 *
 * The bridge runs DRY (FORGE_DRY_BRIDGE + FORGE_ARCHITECT_NO_SPAWN) on a tmp
 * forge root, so nothing spawns even if a refusal were broken (M7 §6.16).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadAgentDefinition, skillPath } from '@forge/agents';
import { sessionDirSegments } from '@forge/kernel';
import { startBridge } from '../../ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const ENV = 'FORGE_COST_CEILING_USD';
const PROJECT = 'demoproj';
const KB = 'ceiling-kb';

type StartRoute = {
  readonly kind: string;
  readonly slug: string;
  readonly kindDir: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
};

const ROUTES: readonly StartRoute[] = [
  { kind: 'architect', slug: 'architect', kindDir: '_architect', path: '/api/architect/start', body: { project: PROJECT, idea: 'an idea' } },
  { kind: 'instructions', slug: 'instructions-creator', kindDir: '_instructions', path: '/api/instructions/start', body: { project: PROJECT, mode: 'init' } },
  { kind: 'project-brain', slug: 'project-brain-builder', kindDir: '_project-brain', path: '/api/project-brain/start', body: { project: PROJECT } },
  { kind: 'demo', slug: 'demo-builder', kindDir: '_demo', path: '/api/demo-builder/start', body: { project: PROJECT, mode: 'create' } },
  { kind: 'onboarding', slug: 'onboarding-agent', kindDir: '_onboarding', path: '/api/studio/onboarding/start', body: { project: PROJECT } },
  { kind: 'authoring', slug: 'creation-agent', kindDir: '_authoring', path: '/api/studio/authoring/start', body: { project: PROJECT, prompt: 'a skill that does x' } },
  { kind: 'kb-cleanup', slug: 'brain-maintenance', kindDir: '_kb-cleanup', path: `/api/studio/kbs/${KB}/cleanup/start`, body: {} },
];

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
const priorEnv: Record<string, string | undefined> = {};

before(async () => {
  for (const k of [ENV, 'FORGE_DRY_BRIDGE', 'FORGE_ARCHITECT_NO_SPAWN']) priorEnv[k] = process.env[k];
  delete process.env[ENV];
  process.env.FORGE_DRY_BRIDGE = '1';
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-start-ceiling-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', PROJECT), { recursive: true });
  const kbDir = join(forgeRoot, 'brain', KB);
  mkdirSync(join(kbDir, 'themes'), { recursive: true });
  mkdirSync(join(kbDir, '_raw'), { recursive: true });
  writeFileSync(join(kbDir, 'kb.yaml'), `id: ${KB}\nname: Ceiling KB\nbinding: { kind: project, ref: ${PROJECT} }\ndesc: fixture\n`, 'utf8');
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  for (const [k, v] of Object.entries(priorEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function start(base: string, r: StartRoute, body: Record<string, unknown> = r.body): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${r.path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function readStatus(r: StartRoute, sessionId: string): Record<string, unknown> {
  const file = join(forgeRoot, '_logs', ...sessionDirSegments(PROJECT, r.kindDir, sessionId), 'status.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

async function withEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prior = process.env[ENV];
  if (value === undefined) delete process.env[ENV];
  else process.env[ENV] = value;
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env[ENV];
    else process.env[ENV] = prior;
  }
}

function skillBudgetUsd(slug: string): number {
  const usd = loadAgentDefinition(skillPath(slug)).budgets.maxBudgetUsd;
  assert.equal(typeof usd, 'number', `${slug} SKILL.md must declare budgets.maxBudgetUsd`);
  return usd as number;
}

for (const r of ROUTES) {
  test(`${r.kind}: ${ENV} unset -> status carries the agent's SKILL.md budget, source agent-budget`, async () => {
    const out = await withEnv(undefined, () => start(url, r));
    assert.equal(out.status, 200, JSON.stringify(out.json));
    const status = readStatus(r, out.json.sessionId as string);
    assert.equal(status.costCeilingUsd, skillBudgetUsd(r.slug));
    assert.equal(status.costCeilingSource, 'agent-budget');
  });

  test(`${r.kind}: ${ENV}=55 -> status carries 55, source env`, async () => {
    const out = await withEnv('55', () => start(url, r));
    assert.equal(out.status, 200, JSON.stringify(out.json));
    const status = readStatus(r, out.json.sessionId as string);
    assert.equal(status.costCeilingUsd, 55);
    assert.equal(status.costCeilingSource, 'env');
  });
}

test('architect: an operator body.costCeilingUsd 5 beats env 55 -> 5, source operator', async () => {
  const r = ROUTES[0];
  const out = await withEnv('55', () => start(url, r, { ...r.body, costCeilingUsd: 5 }));
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const status = readStatus(r, out.json.sessionId as string);
  assert.equal(status.costCeilingUsd, 5);
  assert.equal(status.costCeilingSource, 'operator');
});

test('refusal: an agent with no budget and no env ceiling -> 409 by name, nothing written, on every start route', async () => {
  const refusalRoot = mkdtempSync(join(tmpdir(), 'bridge-start-ceiling-refuse-'));
  try {
    for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(refusalRoot, '_queue', state), { recursive: true });
    }
    mkdirSync(join(refusalRoot, '_logs'), { recursive: true });
    mkdirSync(join(refusalRoot, 'projects', PROJECT), { recursive: true });
    cpKb(refusalRoot);
    // Test seam: every agent reads as having no declared budget.
    const bridge = await startBridge({ forgeRoot: refusalRoot, port: 0, agentBudgetUsd: () => undefined });
    try {
      for (const r of ROUTES) {
        const out = await withEnv(undefined, () => start(bridge.url, r));
        assert.equal(out.status, 409, `${r.kind}: ${JSON.stringify(out.json)}`);
        assert.equal(out.json.error, `no spend ceiling: set FORGE_COST_CEILING_USD or budgets.maxBudgetUsd on agent "${r.slug}"`);
        assert.ok(!existsSync(join(refusalRoot, '_logs', '_sessions')), `${r.kind}: a refused start must create no session dir`);
      }
    } finally {
      await bridge.close();
    }
  } finally {
    rmSync(refusalRoot, { recursive: true, force: true });
  }
});

function cpKb(root: string): void {
  const kbDir = join(root, 'brain', KB);
  mkdirSync(join(kbDir, 'themes'), { recursive: true });
  mkdirSync(join(kbDir, '_raw'), { recursive: true });
  writeFileSync(join(kbDir, 'kb.yaml'), `id: ${KB}\nname: Ceiling KB\nbinding: { kind: project, ref: ${PROJECT} }\ndesc: fixture\n`, 'utf8');
}
