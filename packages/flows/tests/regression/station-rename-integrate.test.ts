/**
 * forge-8vfn.6.10.18 (operator item 85) — execute the demo→integrate STATION
 * rename: the flow node id, the band guard, the manifest `resume_from` value,
 * the requeue API field and the CLI flag all move from `demo` to `integrate`.
 * The demo ARTIFACT (demo.json, DEMO.md, the demo-agent skill's slug) is
 * unaffected — this file pins the STATION identity only.
 *
 * RED at base (039ea08d and every commit before this bead's fix lands):
 *   - `resume_from` is typed `'demo' | 'develop'` (packages/contracts/manifest-types.ts),
 *     so `parseManifest`/`serializeManifest` accept `'demo'` and there is no
 *     `'integrate'` member to accept in the first place — the round-trip
 *     assertion below fails on a manifest that still says `demo`.
 *   - `studio/flows/forge-develop/flow.yaml` declares the node id `demo`, not
 *     `integrate` — the node-lookup assertion below finds nothing.
 *   - `runRequeue`'s option is `resumeFromDemo`, not `resumeFromIntegrate` —
 *     TypeScript itself refuses the call below with the new field name.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel';
import { parseManifest, serializeManifest, type InitiativeManifest } from '../../manifest.ts';
import { loadFlowDefinition } from '../../studio/flow-registry.ts';
import { flowPathForId } from '../../flow-runner.ts';
import { runRequeue } from '../../forge-requeue.ts';

function fixture(): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-09-19-station-rename',
    class: 'code',
    acceptance_criteria: [],
    project: 'fixture-project',
    project_repo_path: '/tmp/fixture-project',
    created_at: '2026-09-19T00:00:00Z',
    iteration_budget: 5,
    cost_budget_usd: 1,
    phase: 'pending',
    origin: 'architect',
    body: '# fixture',
  };
}

test('manifest resume_from: the NEW identity "integrate" round-trips through parse/serialize', () => {
  const serialized = serializeManifest({ ...fixture(), resume_from: 'integrate' });
  assert.match(serialized, /^resume_from:\s*integrate\s*$/m, 'serializeManifest must write resume_from: integrate');
  assert.equal(
    parseManifest(serialized).resume_from,
    'integrate',
    'parseManifest must accept and round-trip resume_from: integrate',
  );
});

test('manifest resume_from: the RETIRED identity "demo" is refused by the parser (dropped, not carried over)', () => {
  // Hand-built frontmatter carrying the pre-rename value directly — this is
  // NOT round-tripped through serializeManifest (which would never emit the
  // retired value), it simulates a manifest a stale writer left on disk.
  const staleFrontmatter = [
    '---',
    'initiative_id: INIT-2026-09-19-station-rename',
    'project: fixture-project',
    'project_repo_path: /tmp/fixture-project',
    "created_at: '2026-09-19T00:00:00Z'",
    'iteration_budget: 5',
    'cost_budget_usd: 1',
    'class: code',
    'phase: pending',
    'origin: architect',
    'resume_from: demo',
    '---',
    '# fixture',
    '',
  ].join('\n');
  assert.equal(
    parseManifest(staleFrontmatter).resume_from,
    undefined,
    'a manifest carrying the retired resume_from: demo value must parse to resume_from: undefined — ' +
      '"demo" is no longer a member of the resume_from union and must not silently pass through',
  );
});

test('the example develop flow declares the STATION node id "integrate", not "demo"', () => {
  const flow = loadFlowDefinition(flowPathForId('forge-develop'));
  const integrateNode = flow.nodes.find((n) => n.id === 'integrate');
  assert.ok(
    integrateNode,
    `studio/flows/forge-develop/flow.yaml must declare a node with id "integrate" — got node ids: ${flow.nodes.map((n) => n.id).join(', ')}`,
  );
  assert.equal(integrateNode!.agent, 'demo-agent', 'the integrate node keeps the demo-agent skill as its declared dispatch');
  assert.equal(integrateNode!.resumable, true, 'the integrate node is still the resume target (ADR-019/R4-10-F6)');
  assert.ok(
    !flow.nodes.some((n) => n.id === 'demo'),
    'no node may be named "demo" any more — the STATION identity moved to "integrate"',
  );
});

test('runRequeue: the requeue API accepts resumeFromIntegrate and stamps resume_from: integrate (not resumeFromDemo)', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-station-rename-requeue-'));
  try {
    for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(root, '_queue', d), { recursive: true });
    }
    mkdirSync(join(root, '_worktrees'), { recursive: true });
    mkdirSync(join(root, 'projects'), { recursive: true });

    const id = 'INIT-2026-09-19-station-rename';
    const file = `${id}.md`;
    const wt = join(root, '_worktrees', id);
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, 'wi-work.txt'), 'salvageable per-WI commits live here');
    writeFileSync(
      join(root, '_queue', 'failed', file),
      // SEC-02: project_repo_path must be genuinely contained under
      // <forgeRoot>/projects/ and worktree_path identity-bound to
      // <forgeRoot>/_worktrees/<initiative_id> (packages/flows/tests/regression/
      // forge-requeue.test.ts's own MANIFEST() fixture states the same rule).
      serializeManifest({
        ...fixture(),
        initiative_id: id,
        project_repo_path: join(root, 'projects', 'fixture-project'),
        worktree_path: wt,
      }),
    );

    const result = runRequeue(id, { forgeRoot: root, resumeFromIntegrate: true });

    assert.equal(result.worktreeRemoved, false, 'the resumeFromIntegrate path preserves the salvaged worktree');
    const moved = readFileSync(join(root, '_queue', 'pending', file), 'utf8');
    assert.match(moved, /^resume_from:\s*integrate\s*$/m, 'runRequeue must stamp resume_from: integrate, never resume_from: demo');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the demo-agent skill declares the integrate-band guard, not demo-band (studio-owned declaration carrier)', () => {
  const skillMd = readFileSync(join(FORGE_ROOT, 'skills', 'demo-agent', 'SKILL.md'), 'utf8');
  assert.match(skillMd, /guards:\s*\[event-log,\s*integrate-band\]/, 'skills/demo-agent/SKILL.md must declare the integrate-band guard');
  assert.doesNotMatch(skillMd, /demo-band/, 'skills/demo-agent/SKILL.md must not reference the retired demo-band guard id');
});
