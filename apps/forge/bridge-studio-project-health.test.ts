/**
 * W8-C3 WI-1 — the SERVER half of the projects index's health signal.
 *
 * RED at branch base (`d17b4251`): `loadProjectsWithMeta`
 * (apps/forge/bridge-studio.ts:375) returns a project with NO health field at all,
 * and worse, it derives nothing about the config's validity — it short-circuits
 * on `if (!ref.hasConfig) return result;` (:421) and swallows a malformed
 * config in `catch { /* ignore unreadable project.json *\/ }` (:457). A
 * project with no `.forge/project.json`, an unparseable one, or one still in
 * the R1-03 legacy flat-gate-key shape (gitpulse's live state — the one the
 * `contract-stages` route already 409s on) comes off the wire looking BYTE
 * IDENTICAL to a healthy project. That is `declared-data-fails-open` at the
 * producer, and it is the root cause of forge-j1e / projects-08: "a
 * contract-broken project is visually indistinguishable from a healthy one".
 *
 * The verdict is DERIVED, per request, by running the config through the SAME
 * validator the orchestrator itself runs the project through —
 * `validateProjectConfig` (orchestrator/project-config.ts:364). Nothing is
 * stored: there is no field on disk, in project.json, or anywhere else that a
 * writer could forget to update. If the validator's opinion changes, the
 * health signal changes with it in the same call.
 *
 * RUN: node --test --experimental-strip-types apps/forge/bridge-studio-project-health.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

type WireProject = {
  id: string;
  name: string;
  configHealth?: { state: string; reason?: string };
  /** WI-4 — optional on this LOCAL wire type on purpose: the tests below
   *  assert it becomes present, so declaring it required here would make the
   *  RED state a compile error rather than an assertion failure. */
  localSkills?: string[];
};

function seedProject(id: string, configJson: string | null): string {
  const dir = join(forgeRoot, 'projects', id);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  if (configJson !== null) writeFileSync(join(dir, '.forge', 'project.json'), configJson, 'utf8');
  return dir;
}

async function roster(): Promise<WireProject[]> {
  const res = await fetch(`${url}/api/studio/projects`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { projects: WireProject[] };
  return body.projects;
}

function byId(rows: WireProject[], id: string): WireProject {
  const row = rows.find((r) => r.id === id);
  assert.ok(row, `expected project "${id}" in the roster; got ${rows.map((r) => r.id).join(', ')}`);
  return row;
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-project-health-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // healthy: a real, valid, migrated config
  seedProject('healthyproj', JSON.stringify({ name: 'Healthy', testProcess: { local: { cmd: ['npm', 'test'] } } }));
  // half-onboarded: the directory exists, `.forge/project.json` does not
  seedProject('unconfiguredproj', null);
  // present but not JSON at all
  seedProject('badjsonproj', '{ not valid json [[[');
  // gitpulse's live state: the R1-03 legacy flat gate keys, pre-migration
  seedProject('flatkeysproj', JSON.stringify({ name: 'Flat', quality_gate_cmd: 'npm test' }));
  // the CONFLICT shape: flat keys ALONGSIDE testProcess (migrate refuses this)
  seedProject('conflictproj', JSON.stringify({ quality_gate_cmd: 'npm test', testProcess: { local: { cmd: ['npm', 'test'] } } }));

  // W8-C3 WI-4: project-LOCAL skills (the forge<->project contract's own
  // `.forge/skills/demo-design/SKILL.md` shape), plus a bare directory that
  // carries no SKILL.md and therefore is not a skill.
  const localSkills = seedProject('localskillsproj', JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }));
  for (const slug of ['demo-design', 'zeta-helper']) {
    mkdirSync(join(localSkills, '.forge', 'skills', slug), { recursive: true });
    writeFileSync(join(localSkills, '.forge', 'skills', slug, 'SKILL.md'), `---\nname: ${slug}\n---\n`, 'utf8');
  }
  mkdirSync(join(localSkills, '.forge', 'skills', 'not-a-skill'), { recursive: true });
  // W8-C3 review round 1 (S1): a SIDECAR-ONLY project — no `testProcess` in
  // the JSON at all, the local gate single-sourced from
  // `.forge/quality_gate_cmd`. A supported, documented shape (R1-03-F1) and
  // the shape the live terraform-provider-betterado project is in.
  const sidecar = seedProject('sidecarproj', JSON.stringify({ name: 'Sidecar' }));
  writeFileSync(join(sidecar, '.forge', 'quality_gate_cmd'), 'go test ./...\n', 'utf8');
  // ...and one where the sidecar must NOT rescue a genuinely malformed shape.
  const sidecarBad = seedProject('sidecarmalformedproj', JSON.stringify({ testProcess: 'not-an-object' }));
  writeFileSync(join(sidecarBad, '.forge', 'quality_gate_cmd'), 'go test ./...\n', 'utf8');

  // ...and one on the BROKEN-config project, to prove the two derivations are independent.
  mkdirSync(join(forgeRoot, 'projects', 'flatkeysproj', '.forge', 'skills', 'broken-proj-skill'), { recursive: true });
  writeFileSync(join(forgeRoot, 'projects', 'flatkeysproj', '.forge', 'skills', 'broken-proj-skill', 'SKILL.md'), '---\nname: x\n---\n', 'utf8');

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The four derived states
// ---------------------------------------------------------------------------

test('W8-C3 WI-1: every project on the roster carries a derived configHealth — no project is silently unjudged', async () => {
  const rows = await roster();
  assert.equal(rows.length, 8, 'all eight seeded projects must still be LISTED — a broken config must never make a project disappear');
  for (const row of rows) {
    assert.ok(row.configHealth, `project "${row.id}" came off the wire with NO configHealth — that is the fail-open shape this WI closes`);
    assert.ok(
      ['ok', 'unconfigured', 'invalid'].includes(row.configHealth.state),
      `project "${row.id}" has an unknown configHealth.state ${JSON.stringify(row.configHealth.state)}`,
    );
  }
});

test('W8-C3 WI-1: a valid migrated config derives state "ok", and carries NO reason (a healthy project must not invent one)', async () => {
  const row = byId(await roster(), 'healthyproj');
  assert.deepEqual(row.configHealth, { state: 'ok' });
});

test('W8-C3 WI-1: a project directory with no .forge/project.json derives state "unconfigured" — half-onboarded, not healthy, not broken', async () => {
  const row = byId(await roster(), 'unconfiguredproj');
  assert.equal(row.configHealth?.state, 'unconfigured');
  assert.match(String(row.configHealth?.reason ?? ''), /project\.json/, 'the reason must name the missing file, so the operator knows what to create');
});

test('W8-C3 WI-1: an unparseable .forge/project.json derives state "invalid" and the reason says it is not valid JSON', async () => {
  const row = byId(await roster(), 'badjsonproj');
  assert.equal(row.configHealth?.state, 'invalid');
  assert.match(String(row.configHealth?.reason ?? ''), /not valid JSON/i);
});

test('W8-C3 WI-1 (the gitpulse case): a config still on the R1-03 flat gate keys derives state "invalid", and the reason is the REAL validator message naming the migration', async () => {
  const row = byId(await roster(), 'flatkeysproj');
  assert.equal(row.configHealth?.state, 'invalid');
  // The message must come from validateProjectConfig itself (orchestrator/
  // project-config.ts:388) — not a re-worded copy this file would have to be
  // kept in sync with.
  assert.match(String(row.configHealth?.reason ?? ''), /flat gate keys moved to the typed testProcess object/);
  assert.match(String(row.configHealth?.reason ?? ''), /quality_gate_cmd → testProcess\.local\.cmd/);
});

test('W8-C3 WI-1: the CONFLICT shape (flat keys alongside testProcess) is also "invalid", with the validator\'s conflict message — never smoothed into ok', async () => {
  const row = byId(await roster(), 'conflictproj');
  assert.equal(row.configHealth?.state, 'invalid');
  assert.match(String(row.configHealth?.reason ?? ''), /conflicting flat gate key/);
});

// ---------------------------------------------------------------------------
// The derivation must not cost the roster its existing contract
// ---------------------------------------------------------------------------

test('W8-C3 WI-1: an INVALID config still yields every field the roster could read — the project stays openable and nameable, it is only marked unhealthy', async () => {
  const row = byId(await roster(), 'flatkeysproj');
  assert.equal(row.name, 'Flat', 'the display name is still read from the malformed config — a broken project the operator cannot even identify is worse, not safer');
});

test('W8-C3 WI-1: configHealth is DERIVED, never stored — it agrees with the contract-stages route on the SAME project, because both run the same validator', async () => {
  const row = byId(await roster(), 'flatkeysproj');
  const stages = await fetch(`${url}/api/studio/projects/flatkeysproj/contract-stages`);
  assert.equal(stages.status, 409, 'contract-stages already 409s this shape today (cli/bridge-studio.ts:1131)');
  assert.equal(row.configHealth?.state, 'invalid', 'the roster must agree with the route that already knows — two derivations of one fact must never disagree');
});

// ---------------------------------------------------------------------------
// W8-C3 WI-4 — project-LOCAL skills (projects-06 / projects-43)
//
// RED at branch base: the roster carries no notion of a skill living inside
// the project. The forge↔project contract puts one there by name
// (`.forge/skills/demo-design/SKILL.md`, docs/forge-project-contract.md:445),
// but `GET /api/studio/catalog` only ever lists forge-wide skills, so
// `SkillsBind`'s picker is forge-wide only: a project-local skill that is
// unbound can NEVER be re-bound (projects-06), and a bound id the picker
// cannot resolve renders as a normal healthy chip (projects-43).
//
// Derived per request from disk, like `configHealth`. Nothing stored.
// ---------------------------------------------------------------------------

test('W8-C3 WI-4: a project\'s own .forge/skills/<id>/SKILL.md ids are surfaced as localSkills', async () => {
  const rows = await roster();
  assert.deepEqual(byId(rows, 'localskillsproj').localSkills, ['demo-design', 'zeta-helper']);
});

test('W8-C3 WI-4: localSkills is [] — not absent — for a project with no local skills, so "we looked and found none" is distinguishable', async () => {
  const rows = await roster();
  assert.deepEqual(byId(rows, 'healthyproj').localSkills, []);
});

test('W8-C3 WI-4: a .forge/skills/<id> directory with NO SKILL.md is not a skill — a bare directory must not become a bindable id', async () => {
  const rows = await roster();
  assert.ok(!(byId(rows, 'localskillsproj').localSkills ?? []).includes('not-a-skill'));
});

test('W8-C3 WI-4: localSkills is derived even when the project CONFIG is broken — a project you cannot build is exactly the one whose bindings you need to see', async () => {
  const rows = await roster();
  const row = byId(rows, 'flatkeysproj');
  assert.equal(row.configHealth?.state, 'invalid');
  assert.deepEqual(row.localSkills, ['broken-proj-skill']);
});

// ---------------------------------------------------------------------------
// W8-C3 REVIEW ROUND 1 (S1) — the roster's verdict must match what the
// ORCHESTRATOR actually does, not just what `validateProjectConfig` says about
// the bare JSON.
//
// The hostile review refuted this lane's own repeated claim ("the SAME
// validator the orchestrator runs the project through"). It was FALSE: the
// orchestrator's `loadProjectConfig` reads `.forge/quality_gate_cmd` and calls
// `injectSidecarIntoTestProcess` BEFORE validating, so a project that
// single-sources its local gate from the sidecar — which is a SUPPORTED,
// documented shape, and the shape the live `terraform-provider-betterado`
// project on this host is in — validated fine for the orchestrator and was
// reported `invalid` / "contract broken" by the roster.
//
// That is this lane's own defect class reshipped as a FALSE NEGATIVE: a
// healthy, actively-run project rendered bold red on the index whose entire
// purpose is to tell broken from healthy. The cure is a PARITY pin, not a
// third fixture: for every shape below, the roster's verdict must AGREE with
// `loadProjectConfig`'s own accept/reject, because disagreement in either
// direction is the defect.
// ---------------------------------------------------------------------------

import { loadProjectConfig } from '@forge/projects/project-config.ts';

/** Does the REAL orchestrator loader accept this project? */
function orchestratorAccepts(projectId: string): boolean {
  try {
    return loadProjectConfig(join(forgeRoot, 'projects', projectId)) !== null;
  } catch {
    return false;
  }
}

test('W8-C3 S1: a project whose local gate comes ONLY from the .forge/quality_gate_cmd sidecar is "ok" — the orchestrator runs it, so the roster must not call it broken', async () => {
  const row = byId(await roster(), 'sidecarproj');
  assert.equal(orchestratorAccepts('sidecarproj'), true, 'precondition: the real loader accepts a sidecar-only project');
  assert.equal(row.configHealth?.state, 'ok', `the roster must agree with the loader — got ${JSON.stringify(row.configHealth)}`);
});

test('W8-C3 S1 (PARITY, the pin that would have caught it): for EVERY seeded shape, configHealth.state === "ok" iff the real loadProjectConfig accepts it', async () => {
  const rows = await roster();
  for (const row of rows) {
    const accepted = orchestratorAccepts(row.id);
    const healthy = row.configHealth?.state === 'ok';
    assert.equal(
      healthy,
      accepted,
      `"${row.id}": roster says ${healthy ? 'ok' : row.configHealth?.state}, the orchestrator ${accepted ? 'ACCEPTS' : 'refuses'} it — a disagreement in EITHER direction is the defect`,
    );
  }
});

test('W8-C3 S1: the sidecar does NOT rescue a config the loader still refuses — a malformed testProcess stays invalid, matching injectSidecarIntoTestProcess\'s own deliberate non-rescue', async () => {
  const row = byId(await roster(), 'sidecarmalformedproj');
  assert.equal(orchestratorAccepts('sidecarmalformedproj'), false, 'precondition: the real loader still refuses a malformed testProcess even with a sidecar present');
  assert.equal(row.configHealth?.state, 'invalid');
});
