/**
 * R1-06 WI-2 review pins — two MAJOR correctness bugs in the KB create
 * hand-off + descriptor-derived seeding path.
 *
 * MAJOR 1 — split-descriptor silent data loss (project-bound KB via hand-off).
 *   POST /api/studio/kbs scaffolds every new KB at brain/<id> UNCONDITIONALLY,
 *   but the seeding runner (runCommitStep) re-derives brain/projects/<id> from
 *   binding.kind === 'project'. Result for a project-bound KB created via the
 *   hand-off: TWO kb.yaml with the same id (brain/<id> empty from create,
 *   brain/projects/<id> carrying the seeded themes), loadKbDescriptors lists a
 *   duplicate, and resolveKbBrainDir returns the FIRST (empty) one — total
 *   silent loss of the seeding. The runner must commit into the SAME dir create
 *   scaffolded (brain/<id>) whenever it handles a create hand-off (kb_id set),
 *   reserving brain/projects/<project> for the ORDINARY project-brain flow.
 *
 * MAJOR 2 — phantom-project pollution (flow/unique-bound KB).
 *   The hand-off anchors the seeding session under projects/<sessionProject>/,
 *   with sessionProject = the KB id for a NON-project binding. discoverProjects
 *   then lists projects/<kbId>/ as a phantom project in GET /api/studio/projects
 *   and the /knowledge/new dropdown. A non-project KB seeding session must be
 *   anchored under a dot-prefixed name so discoverProjects (which already skips
 *   dot-dirs) never surfaces it — while the runner still finds its status under
 *   the same anchor.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { loadKbDescriptors } from '@forge/knowledge/bridge-studio-kbs.ts';
import { resolveKbBrainDir } from '@forge/knowledge/brain-paths.ts';
import { runProjectBrainTurn, type ProjectBrainStatus } from '../../packages/sessions/kinds/project-brain.ts';

// ---------------------------------------------------------------------------
// Fixture (mirrors cli/bridge-studio-kb-create.test.ts's minimal forge root)
// ---------------------------------------------------------------------------

const CYCLES_KB_YAML = `id: cycles\nname: Cycles Brain\nbinding: { kind: flow, ref: forge-develop }\ndesc: Cross-cycle patterns.\n`;
const FORGE_DEV_KB_YAML = `id: forge-dev\nname: Forge Dev Brain\nbinding: { kind: unique }\ndesc: Forge engineering decisions.\n`;

function bandSkillMd(slug: string, band: string): string {
  return `---
name: ${slug}
description: A test ${band} agent.
library: true
purpose: Does ${band} things.
brainAccess: none
interactivity: none
composition:
  skills: []
  tools: []
  mcps: []
  guards: [${band}]
runtime:
  sdk: claude-agent-sdk
  strategy: fixed
  model: claude-sonnet-4-6
budgets: {}
allowed-tools: []
disallowed-tools: []
---
## Process

This agent does ${band} things.
`;
}

const FORGE_DEVELOP_FLOW_YAML = `id: forge-develop
name: Forge Develop
version: 1
goal: Test develop flow.
project: null
kb: null
costCeilingUsd: 10
origin: seed
disposable: true
nodes:
  - { id: demo, agent: demo-agent }
  - { id: adversarial-review, agent: adversarial-review }
edges: []
triggers: []
`;

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-kb-seeding-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'cycles', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', 'themes'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'forge-dev', '_raw'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'forge-dev', 'kb.yaml'), FORGE_DEV_KB_YAML);

  const developFlowDir = join(forgeRoot, 'studio', 'flows', 'forge-develop');
  mkdirSync(developFlowDir, { recursive: true });
  writeFileSync(join(developFlowDir, 'flow.yaml'), FORGE_DEVELOP_FLOW_YAML);
  for (const [slug, band] of [['demo-agent', 'demo-band'], ['adversarial-review', 'review-band']] as const) {
    const skillDir = join(forgeRoot, 'skills', slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), bandSkillMd(slug, band));
  }
  mkdirSync(join(forgeRoot, 'projects', 'demo-project'), { recursive: true });

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeServer = result.close;
});

after(async () => {
  await closeServer?.();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function post(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Flip a hand-off session's status.json to `committing` (preserving the
 *  descriptor-derived kb_id/kb_binding create wrote) and stage a theme +
 *  profile.md, so runProjectBrainTurn drives runCommitStep. */
function stageForCommit(sessionDir: string): void {
  const statusPath = join(sessionDir, 'status.json');
  const status = JSON.parse(readFileSync(statusPath, 'utf8')) as ProjectBrainStatus;
  writeFileSync(statusPath, JSON.stringify({ ...status, phase: 'committing' }));
  const staging = join(sessionDir, 'themes');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
  writeFileSync(join(staging, 'profile.md'), '# seeded profile\n');
}

// ---------------------------------------------------------------------------
// MAJOR 1 — project-bound KB: create + seed → a SINGLE brain/<id>, no split.
// ---------------------------------------------------------------------------

test('PIN MAJOR-1: project-bound KB create+seed commits to a single brain/<id> — no split descriptor, no orphaned seeding', async () => {
  const kbId = 'proj-bound-kb';
  const { status, json } = await post('/api/studio/kbs', {
    id: kbId,
    name: 'Proj Bound KB',
    binding: { kind: 'project', ref: 'demo-project' },
    desc: 'A project-bound KB created via the hand-off.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  const sessionId = json['sessionId'] as string;
  assert.equal(typeof sessionId, 'string', 'create must hand off a seeding sessionId');

  // Create scaffolds brain/<id> unconditionally.
  assert.ok(existsSync(join(forgeRoot, 'brain', kbId, 'kb.yaml')), 'create scaffolded brain/<id>/kb.yaml');

  // Drive the hand-off session (project binding → anchored under the real project) to commit.
  const sessionDir = join(forgeRoot, 'projects', 'demo-project', '_project-brain', sessionId);
  assert.ok(existsSync(join(sessionDir, 'status.json')), 'hand-off session exists under the bound project');
  stageForCommit(sessionDir);

  const r = await runProjectBrainTurn({
    sessionId,
    projectRoot: join(forgeRoot, 'projects', 'demo-project'),
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
  });
  assert.equal(r.phase, 'committed');

  // (a) The seeding must land in the SAME dir create scaffolded — brain/<id>.
  assert.ok(existsSync(join(forgeRoot, 'brain', kbId, 'themes', 'structure.md')), 'seeded theme committed to brain/<id>/themes');
  assert.ok(existsSync(join(forgeRoot, 'brain', kbId, 'profile.md')), 'seeded profile committed to brain/<id>');

  // (b) There must be NO second kb.yaml re-derived from binding.kind at brain/projects/<id>.
  assert.equal(
    existsSync(join(forgeRoot, 'brain', 'projects', kbId, 'kb.yaml')),
    false,
    'split descriptor: a project-bound hand-off must NOT write a second kb.yaml at brain/projects/<id>',
  );

  // (c) loadKbDescriptors must list the id EXACTLY once (no duplicate).
  const descriptors = loadKbDescriptors(forgeRoot);
  const matches = descriptors.filter((d) => d.id === kbId);
  assert.equal(matches.length, 1, `exactly one descriptor for "${kbId}" — a split descriptor lists it twice (got ${matches.length})`);

  // (d) The KB the operator opens (resolveKbBrainDir) is brain/<id> and is NOT empty.
  const opened = resolveKbBrainDir(forgeRoot, kbId);
  assert.ok(opened, 'resolveKbBrainDir resolves the created KB');
  assert.equal(realpathSync(opened!), realpathSync(join(forgeRoot, 'brain', kbId)), 'operator opens brain/<id>, not brain/projects/<id>');
  assert.ok(matches[0].counts.themes >= 1, 'the opened KB carries the seeded themes (not empty)');
});

// ---------------------------------------------------------------------------
// MAJOR 2 — flow-bound KB: create must NOT create a phantom project, while the
// seeding session stays reachable/commitable by the runner.
// ---------------------------------------------------------------------------

test('PIN MAJOR-2: flow-bound KB create leaves NO phantom project, and the runner still finds its seeding status', async () => {
  const kbId = 'flow-bound-kb';
  const { status, json } = await post('/api/studio/kbs', {
    id: kbId,
    name: 'Flow Bound KB',
    binding: { kind: 'flow', ref: 'forge-develop' },
    desc: 'A flow-bound KB created via the hand-off.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  const sessionId = json['sessionId'] as string;
  assert.equal(typeof sessionId, 'string', 'create must hand off a seeding sessionId');

  // (a) No top-level projects/<kbId> phantom dir.
  assert.equal(
    existsSync(join(forgeRoot, 'projects', kbId)),
    false,
    'a flow-bound KB seeding session must NOT create a discoverable projects/<kbId> dir',
  );

  // (b) GET /api/studio/projects must NOT list the KB id.
  const projRes = await fetch(`${bridgeUrl}/api/studio/projects`);
  const projJson = (await projRes.json()) as { projects: { id: string }[] };
  const ids = projJson.projects.map((p) => p.id);
  assert.ok(!ids.includes(kbId), `KB id "${kbId}" must not surface as a phantom project (got: ${ids.join(', ')})`);

  // (c) The seeding session is still reachable: its status.json exists under the
  // dot-prefixed anchor, and the runner finds it + commits.
  const anchor = `.kb-${kbId}`;
  const statusPath = join(forgeRoot, 'projects', anchor, '_project-brain', sessionId, 'status.json');
  assert.ok(existsSync(statusPath), `seeding session status.json must exist under the dot-anchor projects/${anchor}/`);
  stageForCommit(dirname(statusPath));

  const r = await runProjectBrainTurn({
    sessionId,
    projectRoot: join(forgeRoot, 'projects', anchor),
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
  });
  assert.equal(r.phase, 'committed', 'the runner finds the status under the anchor and commits');
  // Commit lands in the create-scaffolded brain/<id> (the flow-bound KB's own dir).
  assert.ok(existsSync(join(forgeRoot, 'brain', kbId, 'profile.md')), 'seeded profile committed to brain/<id>');
});
