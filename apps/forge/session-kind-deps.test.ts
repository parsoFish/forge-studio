/**
 * CONFORMANCE — the real flows symbols satisfy the ports sessions declares.
 *
 * WHY THIS FILE EXISTS AND WHERE IT LIVES. `packages/sessions` may not import
 * `packages/flows` (rank 4 cannot name rank 5, and `check-boundaries` counts
 * type-only imports as well as value ones), so sessions declares PORT types for
 * the four manifest functions it needs. Nothing inside sessions can check those
 * declarations against the real thing — by construction, it cannot see it.
 * `apps/forge` is the one place that may import both, so this is the only spot
 * where the two halves can be compared at all.
 *
 * WHAT IT PROVES, AND WHAT MAKES IT MORE THAN DECORATION. `session-kind-deps.ts`
 * assigns the real `parseManifest`/`serializeManifest`/
 * `mintAndPersistManifestCycleId`/`promoteManifests` into
 * `ArchitectManifestPorts`. That assignment is itself the check: if a port
 * signature drifts from the function it stands for, the repo-wide `tsc` fails
 * HERE, at the seam, rather than compiling into a runtime shape mismatch inside
 * sessions. This file pins that the assignment is REAL — that the object is
 * populated, its members are the flows functions themselves and not wrappers
 * that could paper over a difference, and that the ports are actually reachable
 * from the assembly rather than declared and dropped.
 *
 * MUTATION-PROVED, reporting only what was actually run and where each landed
 * — I twice guessed the location and was twice wrong, so no taxonomy is
 * offered here beyond the two measurements:
 *
 *   1. `promoteManifests`' declared `opts` widened to `{ queueRoot; project }`
 *      (it really takes `{ queueRoot }` alone) → repo-wide build RED at
 *      `kinds/architect.ts`'s call site, NOT at this file's assignment.
 *   2. `parseManifest` given an extra required parameter → RED at BOTH this
 *      file (line 95, "Expected 2 arguments, but got 1") and architect's call
 *      site.
 *
 * What both establish is the load-bearing claim: a port that drifts from the
 * function it stands for cannot reach a green build. WHERE it surfaces varies
 * with the direction of the drift, and a reader chasing one should check both
 * the binding here and the call sites in sessions.
 *
 * The manifest SHAPE needs no port and no check: ruling 81 lifted
 * `InitiativeManifest` into `@forge/contracts`, which both sides import
 * directly. One definition, so there is nothing to keep in step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseManifest,
  serializeManifest,
  mintAndPersistManifestCycleId,
} from '@forge/flows/manifest.ts';
import { promoteManifests } from '@forge/flows/promote-manifests.ts';

import { architectManifestPorts, parseManifestPort } from './session-kind-deps.ts';

test('every architect manifest port is bound to the real flows function', () => {
  // Identity, not just callability: a wrapper could silently adapt a signature
  // that has drifted, which is exactly what this seam must not allow.
  assert.equal(architectManifestPorts.parseManifest, parseManifest, 'parseManifest must be the flows function itself');
  assert.equal(architectManifestPorts.serializeManifest, serializeManifest, 'serializeManifest must be the flows function itself');
  assert.equal(
    architectManifestPorts.mintAndPersistManifestCycleId, mintAndPersistManifestCycleId,
    'mintAndPersistManifestCycleId must be the flows function itself',
  );
  assert.equal(architectManifestPorts.promoteManifests, promoteManifests, 'promoteManifests must be the flows function itself');
});

test('the port object is fully populated — no member declared and left undefined', () => {
  const keys = Object.keys(architectManifestPorts).sort();
  assert.deepEqual(
    keys,
    ['mintAndPersistManifestCycleId', 'parseManifest', 'promoteManifests', 'serializeManifest'],
    'a port silently missing from the bound object would make the kind refuse at run time for a reason no test named',
  );
  for (const k of keys) {
    assert.equal(
      typeof (architectManifestPorts as unknown as Record<string, unknown>)[k], 'function',
      `${k} must be callable`,
    );
  }
});

test('the roadmap-draft renderer port is bound to the same parseManifest', () => {
  assert.equal(parseManifestPort, parseManifest);
});

test('the ports round-trip a manifest through the contract type', () => {
  // End-to-end through the seam: serialize then parse, using ONLY the shape
  // both packages now name from @forge/contracts. If the lifted type and the
  // flows functions ever disagreed, this is where it would show.
  const manifest = {
    initiative_id: 'INIT-2026-09-03-conformance',
    project: 'testproj',
    project_repo_path: '/tmp/testproj',
    created_at: new Date(0).toISOString(),
    iteration_budget: 3,
    cost_budget_usd: 5,
    phase: 'pending' as const,
    origin: 'architect' as const,
    body: '# Conformance\n',
  };
  const round = architectManifestPorts.parseManifest(architectManifestPorts.serializeManifest(manifest));
  assert.equal(round.initiative_id, manifest.initiative_id);
  assert.equal(round.project, manifest.project);
  assert.equal(round.phase, manifest.phase);
  assert.equal(round.origin, manifest.origin);
  assert.match(round.body, /# Conformance/);
});
