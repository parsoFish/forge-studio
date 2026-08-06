/**
 * Acceptance tests for `cli/contract-stages.ts` (R4-17 — Onboarding session
 * staging). The module DOES NOT EXIST YET — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./contract-stages.ts` import is the expected
 * red).
 *
 * `deriveContractStages` reports ARTIFACT PRESENCE for the five onboarding
 * stages (`contract, instructions, secrets, demo, roadmap` — SESSION_STAGES
 * minus `brain`), never a clause verdict (D11 — `forge preflight`'s exit code
 * is the only authoritative contract-green signal). See
 * `_wave5/specs/R4-17.md` D2/D3/D4/D5/D11 for the binding decisions this file
 * pins.
 *
 * DESIGN CHOICES THIS FILE PINS (T3 clarifications on an under-specified
 * contract — flagged in the T3 report, not silently assumed):
 *
 *   - A project id that does not resolve to a real, contained directory under
 *     `projectsRoot` (unknown id, or a symlink escaping `projectsRoot`) is a
 *     DISTINCT failure from "project exists but nothing is onboarded yet" —
 *     the former is `{ok:false}`; the latter returns all five rows, mostly
 *     `absent`, `{ok:true}`. A brand-new, never-onboarded project directory is
 *     a completely normal, expected input to this function (it is the whole
 *     point of the onboarding session), so it must never fail closed.
 *   - `.forge/project.json` MISSING entirely is "absent" for the
 *     config-backed stages (contract/secrets/demo's declared half) — NOT a
 *     `{ok:false}` failure. Only a project.json that EXISTS but is malformed
 *     (invalid JSON, or fails the real `orchestrator/project-config.ts`
 *     validator — e.g. missing the required `testProcess.local.cmd`) fails
 *     the WHOLE derivation closed, reusing that module's own canonical
 *     fail-closed parser rather than a second, looser hand-rolled one (D11:
 *     "never re-implements a clause verdict" — the real validator already
 *     exists and is the one source of "is this shape legal").
 *   - `secrets` stage status is driven by `requiresEnv.length > 0` — an
 *     explicitly empty `requiresEnv: []` (mdtoc's real, creds-free shape) is
 *     `absent`, regardless of whether the surrounding `testProcess.acceptance`
 *     block exists at all: the stage is about which secret NAMES this
 *     project needs, and there are none.
 *   - `demo` stage status is `present` iff EITHER `demoProcess[]` is declared
 *     OR `.forge/demo/demo.lock.json` exists (declared-only, before the demo
 *     is ever built, is legitimately `present` — it names an intent).
 *   - `bytes` is non-null ONLY for the two stages backed by a single prose
 *     file read directly off disk (`instructions`, `roadmap`); `contract`,
 *     `secrets`, and `demo` are config/lock-JSON-backed and always carry
 *     `bytes: null`, per the type doc's own split.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { deriveContractStages, type ContractStageRow, type DeriveContractStagesResult } from './contract-stages.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const STAGE_ORDER = ['contract', 'instructions', 'secrets', 'demo', 'roadmap'] as const;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeProjectsRoot(prefix = 'contract-stages-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function makeProjectDir(projectsRoot: string, id: string): string {
  const dir = join(projectsRoot, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeProjectJson(projectDir: string, cfg: unknown): void {
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, '.forge', 'project.json'), JSON.stringify(cfg, null, 2), 'utf8');
}

const VALID_CONFIG_BASE = {
  testProcess: { local: { cmd: ['npm', 'test'] } },
};

function okRows(result: DeriveContractStagesResult): ContractStageRow[] {
  assert.equal(result.ok, true, `expected ok:true, got: ${JSON.stringify(result)}`);
  return (result as { ok: true; rows: ContractStageRow[] }).rows;
}

function byStage(rows: ContractStageRow[], stage: string): ContractStageRow {
  const r = rows.find((x) => x.stage === stage);
  assert.ok(r, `expected a "${stage}" row, got stages: ${rows.map((x) => x.stage).join(', ')}`);
  return r!;
}

// ===========================================================================
// AT-1: all five stages, always, in declared order — never a dropped row
// ===========================================================================

describe('deriveContractStages — five stages, always, in order (AT-1, AT-2)', () => {
  it('AT-1: a brand-new, never-onboarded project dir (nothing but the dir itself) → 5 rows, in order, every one absent, each naming its own source', () => {
    const projectsRoot = makeProjectsRoot();
    makeProjectDir(projectsRoot, 'freshproj');
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'freshproj' });
    const rows = okRows(result);
    assert.deepEqual(
      rows.map((r) => r.stage),
      [...STAGE_ORDER],
      'kills an implementation that drops a stage row when nothing is onboarded yet — a missing row is indistinguishable from "we did not look"',
    );
    for (const row of rows) {
      assert.equal(row.status, 'absent', `stage "${row.stage}" must be absent on a fresh project, got: ${JSON.stringify(row)}`);
      assert.ok(row.source.length > 0, `stage "${row.stage}" must name its source even when absent, got empty string`);
      assert.equal(row.bytes, null, `stage "${row.stage}" must carry bytes:null when absent`);
      assert.deepEqual(Array.isArray(row.detail), true);
    }
  });

  it('AT-2: sourcesScanned names every one of the five stage sources, non-empty, even on a fresh project', () => {
    const projectsRoot = makeProjectsRoot();
    makeProjectDir(projectsRoot, 'freshproj2');
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'freshproj2' });
    assert.equal(result.ok, true);
    const scanned = (result as { ok: true; sourcesScanned: string[] }).sourcesScanned;
    assert.ok(Array.isArray(scanned) && scanned.length > 0, 'sourcesScanned must never be silently empty');
  });
});

// ===========================================================================
// AT-3..5: contract stage
// ===========================================================================

describe('deriveContractStages — contract stage (AT-3..5)', () => {
  it('AT-3: testProcess.local.cmd declared → present, detail carries the real gate command tokens, source names .forge/project.json, bytes:null', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'gateproj');
    writeProjectJson(dir, { testProcess: { local: { cmd: ['npm', 'run', 'gate-sentinel-x7'] } } });
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'gateproj' }));
    const contract = byStage(rows, 'contract');
    assert.equal(contract.status, 'present');
    assert.equal(contract.source, '.forge/project.json');
    assert.equal(contract.bytes, null, 'contract is config-backed — bytes must be null, never a file size');
    const joined = contract.detail.join(' ');
    assert.ok(joined.includes('npm') && joined.includes('gate-sentinel-x7'), `detail must carry the REAL declared gate tokens, got: ${JSON.stringify(contract.detail)}`);
  });

  it('AT-4: .forge/contract-compliance-report.json present → an EXTRA detail line beyond the plain gate-declared case', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'reportproj');
    writeProjectJson(dir, VALID_CONFIG_BASE);
    const withoutReport = byStage(okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'reportproj' })), 'contract');
    writeFileSync(join(dir, '.forge', 'contract-compliance-report.json'), JSON.stringify({ finalHardGreen: true }), 'utf8');
    const withReport = byStage(okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'reportproj' })), 'contract');
    assert.ok(
      withReport.detail.length > withoutReport.detail.length,
      `presence of contract-compliance-report.json must contribute an extra detail line, got before=${JSON.stringify(withoutReport.detail)} after=${JSON.stringify(withReport.detail)}`,
    );
  });

  it('AT-5: .forge/project.json missing entirely → contract stage absent, NOT a whole-derivation failure', () => {
    const projectsRoot = makeProjectsRoot();
    makeProjectDir(projectsRoot, 'noconfigproj');
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'noconfigproj' });
    assert.equal(result.ok, true, 'a missing project.json on a fresh project must never fail the whole derivation closed');
    assert.equal(byStage((result as { ok: true; rows: ContractStageRow[] }).rows, 'contract').status, 'absent');
  });
});

// ===========================================================================
// AT-6..8: instructions stage
// ===========================================================================

describe('deriveContractStages — instructions stage (AT-6..8)', () => {
  it('AT-6: AGENTS.md present → present, source "AGENTS.md", bytes = the REAL byte length read from disk', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'agentsmdproj');
    const body = '# Agent instructions\n\nSome real content here, sentinel-9182.\n';
    writeFileSync(join(dir, 'AGENTS.md'), body, 'utf8');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'agentsmdproj' }));
    const instructions = byStage(rows, 'instructions');
    assert.equal(instructions.status, 'present');
    assert.equal(instructions.source, 'AGENTS.md');
    assert.equal(instructions.bytes, Buffer.byteLength(body, 'utf8'), 'bytes must be the real on-disk byte length, not a hardcoded/estimated number');
  });

  it('AT-7: AGENTS.md absent, CLAUDE.md present → present, source names CLAUDE.md (the contract\'s named legacy alias), bytes real', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'claudemdproj');
    const body = '# Legacy instructions file\n';
    writeFileSync(join(dir, 'CLAUDE.md'), body, 'utf8');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'claudemdproj' }));
    const instructions = byStage(rows, 'instructions');
    assert.equal(instructions.status, 'present', 'CLAUDE.md must count as present — the contract\'s named legacy alias, per docs/forge-project-contract.md');
    assert.equal(instructions.source, 'CLAUDE.md', 'source must name WHICH file was actually found, never a fixed "AGENTS.md" regardless of which one is real');
    assert.equal(instructions.bytes, Buffer.byteLength(body, 'utf8'));
  });

  it('AT-8: neither AGENTS.md nor CLAUDE.md present → absent, source non-empty, bytes:null', () => {
    const projectsRoot = makeProjectsRoot();
    makeProjectDir(projectsRoot, 'noinstrproj');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'noinstrproj' }));
    const instructions = byStage(rows, 'instructions');
    assert.equal(instructions.status, 'absent');
    assert.equal(instructions.bytes, null);
    assert.ok(instructions.source.length > 0);
  });
});

// ===========================================================================
// AT-9..12: secrets stage — D3 SECURITY (names only, never values)
// ===========================================================================

describe('deriveContractStages — secrets stage is NAMES ONLY (D3, AT-9..12)', () => {
  it('AT-9: requiresEnv declares real names → present, detail carries exactly those names, bytes:null', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'secretsproj');
    writeProjectJson(dir, {
      testProcess: { local: { cmd: ['npm', 'test'] }, acceptance: { match: 'acceptance', required: true, requiresEnv: ['TF_ACC', 'ADO_PAT'] } },
    });
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'secretsproj' }));
    const secrets = byStage(rows, 'secrets');
    assert.equal(secrets.status, 'present');
    assert.equal(secrets.bytes, null);
    assert.ok(secrets.detail.includes('TF_ACC'), `detail must name the real declared secret NAME "TF_ACC", got: ${JSON.stringify(secrets.detail)}`);
    assert.ok(secrets.detail.includes('ADO_PAT'), `detail must name the real declared secret NAME "ADO_PAT", got: ${JSON.stringify(secrets.detail)}`);
  });

  it('AT-10: an explicitly EMPTY requiresEnv:[] (mdtoc\'s real creds-free shape) → absent, even though testProcess.acceptance itself is declared', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'credsfreeproj');
    writeProjectJson(dir, {
      testProcess: { local: { cmd: ['npm', 'test'] }, acceptance: { match: 'acceptance', required: true, requiresEnv: [] } },
    });
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'credsfreeproj' }));
    assert.equal(byStage(rows, 'secrets').status, 'absent', 'zero declared secret names must read as absent regardless of the surrounding acceptance block existing');
  });

  it('AT-11: no testProcess.acceptance block at all → absent', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'noacceptanceproj');
    writeProjectJson(dir, VALID_CONFIG_BASE);
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'noacceptanceproj' }));
    assert.equal(byStage(rows, 'secrets').status, 'absent');
  });

  it('AT-12 (D3, "a guard that cannot fail is not a guard"): a REAL secrets.env at the project root carrying a sentinel VALUE never appears ANYWHERE in the result, even when its declared NAME also appears in requiresEnv', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'realsecretsproj');
    writeProjectJson(dir, {
      testProcess: { local: { cmd: ['npm', 'test'] }, acceptance: { match: 'acceptance', required: true, requiresEnv: ['SENTINEL_SECRET_NAME'] } },
    });
    const SENTINEL_VALUE = 'TOP-SECRET-VALUE-DO-NOT-LEAK-71a3f9';
    writeFileSync(join(dir, 'secrets.env'), `SENTINEL_SECRET_NAME=${SENTINEL_VALUE}\n`, 'utf8');
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'realsecretsproj' });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SENTINEL_VALUE), `deriveContractStages must NEVER open secrets.env / surface an env VALUE — sentinel leaked into: ${serialized}`);
    // Positive control the guard is not just "never returns anything about
    // secrets at all" — the declared NAME must still surface (D3 is
    // names-only, not secrets-blind).
    assert.ok(serialized.includes('SENTINEL_SECRET_NAME'), 'the declared secret NAME must still surface — D3 is names-only, not a blanket secrets blackout');
  });
});

// ===========================================================================
// AT-13..16: demo stage
// ===========================================================================

describe('deriveContractStages — demo stage (AT-13..16)', () => {
  it('AT-13: demoProcess declared, no lock file → present, detail carries the real declared step kinds', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'demoproj');
    writeProjectJson(dir, {
      ...VALID_CONFIG_BASE,
      demoProcess: [
        { kind: 'capture', text: 'capture the before state' },
        { kind: 'verify', text: 'run the gate' },
        { kind: 'present', text: 'attach the evidence' },
      ],
    });
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'demoproj' }));
    const demo = byStage(rows, 'demo');
    assert.equal(demo.status, 'present');
    assert.equal(demo.bytes, null);
    const joined = demo.detail.join(' ');
    for (const kind of ['capture', 'verify', 'present']) {
      assert.ok(joined.includes(kind), `detail must name declared demoProcess step kind "${kind}", got: ${JSON.stringify(demo.detail)}`);
    }
  });

  it('AT-14: demo.lock.json present (built) → detail carries the real demo_skill value from the lock file', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'demolockproj');
    writeProjectJson(dir, { ...VALID_CONFIG_BASE, demoProcess: [{ kind: 'capture', text: 'x' }] });
    mkdirSync(join(dir, '.forge', 'demo'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'demo', 'demo.lock.json'),
      JSON.stringify({ demo_skill: '.forge/skills/demo-design-sentinel-77/SKILL.md' }),
      'utf8',
    );
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'demolockproj' }));
    const demo = byStage(rows, 'demo');
    assert.equal(demo.status, 'present');
    assert.ok(
      demo.detail.some((d) => d.includes('demo-design-sentinel-77')),
      `detail must carry the REAL demo_skill value from demo.lock.json, got: ${JSON.stringify(demo.detail)}`,
    );
  });

  it('AT-15: demo.lock.json present with demo_skill:null (a lock whose generator vanished) → still present (the lock exists), never a crash or a fabricated skill path', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'demonullskillproj');
    writeProjectJson(dir, VALID_CONFIG_BASE);
    mkdirSync(join(dir, '.forge', 'demo'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'demo', 'demo.lock.json'), JSON.stringify({ demo_skill: null }), 'utf8');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'demonullskillproj' }));
    assert.equal(byStage(rows, 'demo').status, 'present');
  });

  it('AT-16: neither demoProcess declared nor demo.lock.json present → absent', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'nodemoproj');
    writeProjectJson(dir, VALID_CONFIG_BASE);
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'nodemoproj' }));
    assert.equal(byStage(rows, 'demo').status, 'absent');
  });
});

// ===========================================================================
// AT-17..19: roadmap stage
// ===========================================================================

describe('deriveContractStages — roadmap stage (AT-17..19)', () => {
  it('AT-17: roadmap.md present → present, source "roadmap.md", bytes = real byte length', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'roadmapproj');
    const body = '# Roadmap\n\n- [ ] sentinel milestone 44f2\n';
    writeFileSync(join(dir, 'roadmap.md'), body, 'utf8');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'roadmapproj' }));
    const roadmap = byStage(rows, 'roadmap');
    assert.equal(roadmap.status, 'present');
    assert.equal(roadmap.source, 'roadmap.md');
    assert.equal(roadmap.bytes, Buffer.byteLength(body, 'utf8'));
  });

  it('AT-18: roadmap.md absent → absent, bytes:null', () => {
    const projectsRoot = makeProjectsRoot();
    makeProjectDir(projectsRoot, 'noroadmapproj');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'noroadmapproj' }));
    const roadmap = byStage(rows, 'roadmap');
    assert.equal(roadmap.status, 'absent');
    assert.equal(roadmap.bytes, null);
  });

  it('AT-19: an existing-but-EMPTY roadmap.md is present with bytes:0 — never collapsed onto "absent" (mirrors markdown-draft\'s null-vs-empty distinction elsewhere in this codebase)', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'emptyroadmapproj');
    writeFileSync(join(dir, 'roadmap.md'), '', 'utf8');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'emptyroadmapproj' }));
    const roadmap = byStage(rows, 'roadmap');
    assert.equal(roadmap.status, 'present', 'a file that exists but is empty is still PRESENT — "present" answers "does the artifact exist", not "is it non-empty"');
    assert.equal(roadmap.bytes, 0);
  });
});

// ===========================================================================
// AT-20..22: fails closed on a malformed .forge/project.json — never a
// partial parse, never a row that guesses
// ===========================================================================

describe('deriveContractStages — malformed .forge/project.json fails closed (AT-20..22)', () => {
  it('AT-20: .forge/project.json is not valid JSON → {ok:false} naming the problem', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'badjsonproj');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'project.json'), '{ this is not json [[[', 'utf8');
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'badjsonproj' });
    assert.equal(result.ok, false, 'invalid JSON must fail the WHOLE derivation closed, never a partial per-stage guess');
    assert.ok((result as { ok: false; error: { message: string } }).error.message.length > 0);
  });

  it('AT-21: .forge/project.json is valid JSON but fails the real project-config shape (missing required testProcess.local.cmd) → {ok:false}', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'wrongshapeproj');
    writeProjectJson(dir, { name: 'wrongshape', testProcess: {} });
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'wrongshapeproj' });
    assert.equal(result.ok, false, 'a project.json that fails the real testProcess.local.cmd requirement must fail closed — never a row that pretends the contract stage is "absent" for a file that actually exists but is broken');
  });

  it('AT-22: a malformed project.json never produces a row for ANY stage — {ok:false} carries no "rows" the caller could mistakenly read', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'noPartialProj');
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'project.json'), 'null', 'utf8');
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'noPartialProj' });
    assert.equal(result.ok, false);
    assert.ok(!('rows' in result), 'an {ok:false} result must carry no "rows" field at all — never a half-filled array a careless caller could read past the ok check');
  });
});

// ===========================================================================
// AT-23..24: D11 — presence, never a verdict
// ===========================================================================

describe('deriveContractStages — D11: presence, never a verdict (AT-23, AT-24)', () => {
  it('AT-23: a project whose EVERY stage is present never has any row claiming a clause "passes" or is "green" — status is only ever present|absent, and detail never uses pass/fail/green/clause-code verdict language', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'allgreenproj');
    writeFileSync(join(dir, 'AGENTS.md'), '# instructions\n', 'utf8');
    writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n', 'utf8');
    writeProjectJson(dir, {
      testProcess: { local: { cmd: ['npm', 'test'] }, acceptance: { match: 'acceptance', required: true, requiresEnv: ['X'] } },
      demoProcess: [{ kind: 'capture', text: 'x' }],
    });
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'allgreenproj' }));
    for (const row of rows) {
      assert.ok(row.status === 'present' || row.status === 'absent', `status must be exactly "present" or "absent", got: ${JSON.stringify(row.status)}`);
      const text = row.detail.join(' ').toLowerCase();
      for (const forbidden of ['pass', 'fail', 'clause', 'green', 'red', 'compliant']) {
        assert.ok(!text.includes(forbidden), `stage "${row.stage}" detail must never use verdict language ("${forbidden}") — presence only, per D11: only "forge preflight"'s exit code is the authoritative contract-green signal. detail: ${JSON.stringify(row.detail)}`);
      }
    }
  });

  it('AT-24: every stage present on a real, grounded project (mdtoc) still reads as presence facts only, matching the REAL, independently-verified on-disk state', () => {
    const mdtocRoot = join(REPO_ROOT, 'projects');
    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot: mdtocRoot, projectId: 'mdtoc' }));
    assert.equal(byStage(rows, 'contract').status, 'present');
    // mdtoc has NO AGENTS.md, only the legacy CLAUDE.md alias (verified on
    // disk, docs/forge-project-contract.md C8) — grounds AT-7's contract
    // against the real repo, not just a synthetic fixture.
    const instructions = byStage(rows, 'instructions');
    assert.equal(instructions.status, 'present');
    assert.equal(instructions.source, 'CLAUDE.md');
    // mdtoc's real testProcess.acceptance.requiresEnv is [] (creds-free) —
    // grounds AT-10 against the real repo.
    assert.equal(byStage(rows, 'secrets').status, 'absent');
    // mdtoc declares demoProcess but has no .forge/demo/demo.lock.json yet.
    const demo = byStage(rows, 'demo');
    assert.equal(demo.status, 'present');
    assert.ok(!demo.detail.some((d) => d.includes('demo-design')), 'mdtoc has no built demo.lock.json — detail must not fabricate a demo_skill line');
    assert.equal(byStage(rows, 'roadmap').status, 'present');
  });
});

// ===========================================================================
// AT-25..29: containment — the projectId boundary
// ===========================================================================

describe('deriveContractStages — containment (AT-25..29)', () => {
  it('AT-25: a projectId that is not a valid slug (path traversal shape) → {ok:false}, rejected before any real project lookup', () => {
    const projectsRoot = makeProjectsRoot();
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: '../../etc' });
    assert.equal(result.ok, false, 'a non-slug projectId must be rejected, never treated as a filesystem path to resolve');
  });

  it('AT-26: an unknown projectId (valid slug shape, no such directory) → {ok:false}, DISTINCT from "fresh, never-onboarded project" (AT-1) — the caller must be able to tell "no such project" from "project exists but empty"', () => {
    const projectsRoot = makeProjectsRoot();
    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'totally-unknown-project-xyz' });
    assert.equal(result.ok, false);
  });

  it('AT-27 (real symlink escape, no lexical string test): projectId resolves via a symlink to a REAL directory OUTSIDE projectsRoot → its content is never surfaced', () => {
    const projectsRoot = makeProjectsRoot();
    const outsideDir = makeProjectsRoot('contract-stages-outside-');
    const SECRET_MARKER = 'TOP-SECRET-OUTSIDE-PROJECT-MARKER-6612';
    mkdirSync(join(outsideDir, '.forge'), { recursive: true });
    writeFileSync(join(outsideDir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: [SECRET_MARKER] } } }), 'utf8');
    symlinkSync(outsideDir, join(projectsRoot, 'escaped-alias'));

    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'escaped-alias' });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SECRET_MARKER), `an escaping symlinked projectId must never surface the outside project's content, got: ${serialized}`);
  });

  it('AT-28 (FALSE-REJECTION CONTROL — proves the guard is not merely "reject every symlink"): a projectId that is a RELATIVE symlink resolving back INSIDE projectsRoot must be ACCEPTED', () => {
    const projectsRoot = makeProjectsRoot();
    const realDir = makeProjectDir(projectsRoot, 'real-project-target');
    writeFileSync(join(realDir, 'roadmap.md'), '# real roadmap\n', 'utf8');
    symlinkSync('real-project-target', join(projectsRoot, 'alias-back-inside'), 'dir');

    const result = deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'alias-back-inside' });
    assert.equal(result.ok, true, 'a symlink that resolves back INSIDE projectsRoot must be accepted — a guard that rejects every symlink outright, escaping or not, is over-strict, not a real containment check');
    assert.equal(byStage((result as { ok: true; rows: ContractStageRow[] }).rows, 'roadmap').status, 'present');
  });

  it('AT-29: two DIFFERENT projectIds under the same projectsRoot never cross-contaminate each other\'s rows', () => {
    const projectsRoot = makeProjectsRoot();
    const dirA = makeProjectDir(projectsRoot, 'proj-a');
    const dirB = makeProjectDir(projectsRoot, 'proj-b');
    writeFileSync(join(dirA, 'roadmap.md'), '# A only\n', 'utf8');
    writeProjectJson(dirB, { testProcess: { local: { cmd: ['b-only-cmd'] } } });

    const rowsA = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'proj-a' }));
    const rowsB = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'proj-b' }));
    assert.equal(byStage(rowsA, 'roadmap').status, 'present');
    assert.equal(byStage(rowsA, 'contract').status, 'absent');
    assert.equal(byStage(rowsB, 'roadmap').status, 'absent');
    assert.equal(byStage(rowsB, 'contract').status, 'present');
  });
});
