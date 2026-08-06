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
import { projectBrainDir } from '../orchestrator/brain-paths.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const STAGE_ORDER = ['contract', 'instructions', 'secrets', 'demo', 'roadmap'] as const;

/**
 * D11 allow-list (AT-23 replacement, pin 2 — round-1 adversarial review). Every
 * detail string `deriveContractStages` emits today, traced to its exact
 * producing line in `cli/contract-stages.ts`. A NEW pattern must be added
 * here deliberately, with review, the moment a genuinely new detail shape is
 * introduced — that deliberate-addition friction IS the D11 gate; the old
 * five-banned-word substring check (`pass|fail|clause|green|red|compliant`)
 * had none, and a wholly new verdict sentence sailed straight through it.
 */
const ALLOWED_DETAIL_PATTERNS: RegExp[] = [
  /^gate command: .+$/, // deriveContractRow — testProcess.local.cmd tokens (contract-stages.ts:124)
  /^a compliance report file exists at \.forge\/contract-compliance-report\.json$/, // deriveContractRow (contract-stages.ts:126)
  /^source file: (AGENTS\.md|CLAUDE\.md)$/, // deriveInstructionsRow (contract-stages.ts:144)
  /^[A-Za-z_][A-Za-z0-9_]*$/, // deriveSecretsRow — a bare declared requiresEnv NAME, verbatim (contract-stages.ts:158; D3 names-only, no template)
  /^step: (capture|verify|present)$/, // deriveDemoRow — a declared demoProcess step kind (contract-stages.ts:168)
  /^built demo skill: .+$/, // deriveDemoRow — demo.lock.json's demo_skill (contract-stages.ts:179)
];

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
  // AT-23 was REPLACED (pin 2, round-1 adversarial review — T2 ruling:
  // ACCEPTED, the reviewer falsified the original test by mutation). The
  // original lowercased every detail string and checked
  // `!text.includes(w)` for `['pass','fail','clause','green','red',
  // 'compliant']`. The reviewer appended a genuine D11 violation to
  // `deriveContractRow`:
  //
  //   detail.push('C1 requirement met — this contract stage satisfies the
  //   onboarding gate');
  //
  // — and all 29 ATs, including the old AT-23, still passed (that sentence
  // contains none of the five banned words). The old check had also forced a
  // workaround into PRODUCTION prose: contract-stages.ts:113-114/172-173 had
  // to avoid the ordinary English word "declared" because it contains the
  // substring "red" ("decla-RED"), which the old AT-23 greped for literally.
  // A test that makes production code dodge a normal word while missing an
  // actual verdict sentence is worse than no test — replaced with an
  // ALLOW-LIST template check (T2-ruled option (a)): every detail string
  // this module emits today has one of the small number of static shapes in
  // `ALLOWED_DETAIL_PATTERNS` above. A NEW, unenumerated detail string fails
  // this test and forces a deliberate, reviewed addition to the allow-list —
  // that friction IS the D11 gate.
  //
  // Verified (T3, this pin): applying the reviewer's exact mutation to
  // `deriveContractRow` and re-running this file scoped turns THIS test RED
  // (`stage "contract" produced a detail string matching NO enumerated
  // allow-list pattern: "C1 requirement met — this contract stage satisfies
  // the onboarding gate"`), while the OLD substring-ban version stayed
  // green under the identical mutation — see the T3 report for the raw
  // before/after run output.
  it('AT-23 (REPLACED — allow-list template check): every detail line, across all five stages, for a project whose every stage is present, matches one of the explicitly enumerated ALLOWED_DETAIL_PATTERNS shapes', () => {
    const projectsRoot = makeProjectsRoot();
    const dir = makeProjectDir(projectsRoot, 'allgreenproj');
    writeFileSync(join(dir, 'AGENTS.md'), '# instructions\n', 'utf8');
    writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n', 'utf8');
    writeProjectJson(dir, {
      testProcess: { local: { cmd: ['npm', 'test'] }, acceptance: { match: 'acceptance', required: true, requiresEnv: ['X'] } },
      demoProcess: [{ kind: 'capture', text: 'x' }],
    });
    // Also exercise the two CONDITIONAL detail lines (compliance report,
    // built demo skill) so the allow-list is checked against every shape
    // this module can currently produce, not just the unconditional ones.
    writeFileSync(join(dir, '.forge', 'contract-compliance-report.json'), JSON.stringify({ finalHardGreen: true }), 'utf8');
    mkdirSync(join(dir, '.forge', 'demo'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'demo', 'demo.lock.json'), JSON.stringify({ demo_skill: '.forge/skills/demo-design-x/SKILL.md' }), 'utf8');

    const rows = okRows(deriveContractStages({ forgeRoot: REPO_ROOT, projectsRoot, projectId: 'allgreenproj' }));
    let detailLinesChecked = 0;
    for (const row of rows) {
      assert.ok(row.status === 'present' || row.status === 'absent', `status must be exactly "present" or "absent", got: ${JSON.stringify(row.status)}`);
      for (const detail of row.detail) {
        detailLinesChecked++;
        assert.ok(
          ALLOWED_DETAIL_PATTERNS.some((p) => p.test(detail)),
          `stage "${row.stage}" produced a detail string matching NO enumerated allow-list pattern: ${JSON.stringify(detail)} — a new/changed detail shape must be a deliberate, reviewed addition to ALLOWED_DETAIL_PATTERNS, never silently accepted`,
        );
      }
    }
    assert.ok(detailLinesChecked >= 6, `expected the fixture to actually exercise every allow-listed shape at least once, only checked ${detailLinesChecked} detail lines`);
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

// ===========================================================================
// AT-30..32: item 3 — the roadmap row's C4 divergence, made VISIBLE
// (T2 ruling, binding, pin 2). `cli/preflight.ts`'s checkC4 (HARD) fails
// closed unless BOTH roadmap.md AND brain/projects/<id>/profile.md (Brain 3,
// ADR 035, central in the forge repo) exist — but `deriveRoadmapRow` today
// only ever looks at roadmap.md, so a project can read `roadmap: present`
// here while `forge preflight` fails it outright over the missing brain
// profile, with nothing in this row hinting why.
//
// T2's binding ruling has three parts:
//   - the row's `status` STAYS presence-of-roadmap.md only — folding the
//     brain profile in would be a clause verdict (D11 forbids it; only
//     `forge preflight`'s exit code is entitled to make that call);
//   - folding the profile into the `roadmap` STAGE is refused on R2-10's own
//     D3 grounds (`brain` is its own SESSION_STAGES entry precisely because
//     Brain-3 seeding is not the roadmap — mapping one onto the other is the
//     fabricated-mapping shape D3 already rejected once);
//   - but the missing profile must be VISIBLE: a `detail` line reports the
//     real presence/absence of brain/projects/<id>/profile.md (a fact,
//     phrased as a fact, no verdict), and `source` names both files.
//
// RED now, deliberately: `deriveRoadmapRow(projectDir)` (contract-stages.ts)
// takes no `forgeRoot`/`projectId` at all today and never looks at the brain
// profile — WI-3 (not yet built) must thread both through. These three tests
// pin the intended shape ahead of that implementation.
//
// Kills two wrong "fixes":
//   (1) folding the profile check into `status` (a C4 verdict on this row)
//       — AT-31 pins `status` staying 'present' even when the profile is
//       absent;
//   (2) dropping the profile fact so the divergence goes invisible again —
//       AT-30/AT-31 both require a profile.md-naming detail line, in BOTH
//       the present and the absent case.
// ===========================================================================

describe('deriveContractStages — roadmap C4 divergence visibility (item 3, T2 ruling, AT-30..32)', () => {
  it('AT-30: roadmap.md present + brain/projects/<id>/profile.md present → both facts appear in detail, source names both files', () => {
    const projectsRoot = makeProjectsRoot();
    const fakeForgeRoot = makeProjectsRoot('contract-stages-brainroot-');
    const dir = makeProjectDir(projectsRoot, 'bothpresentproj');
    writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n', 'utf8');
    const brainDir = projectBrainDir(fakeForgeRoot, 'bothpresentproj');
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, 'profile.md'), '# profile\n', 'utf8');

    const rows = okRows(deriveContractStages({ forgeRoot: fakeForgeRoot, projectsRoot, projectId: 'bothpresentproj' }));
    const roadmap = byStage(rows, 'roadmap');
    assert.equal(roadmap.status, 'present');
    assert.ok(
      roadmap.detail.some((d) => /profile\.md/.test(d) && /present/i.test(d)),
      `expected a detail line reporting the brain profile as present, got: ${JSON.stringify(roadmap.detail)}`,
    );
    assert.ok(roadmap.source.includes('roadmap.md'), `source must still name roadmap.md, got: ${JSON.stringify(roadmap.source)}`);
    assert.ok(roadmap.source.includes('profile.md'), `source must ALSO name the brain profile file (T2 ruling: "the row's source will name both files"), got: ${JSON.stringify(roadmap.source)}`);
  });

  it('AT-31 (the divergence itself — checkC4 in cli/preflight.ts fails HARD for this identical fixture): roadmap.md present + profile.md ABSENT → status STAYS present (never folded into a C4 verdict), AND a detail line names the absent profile so the divergence is visible', () => {
    const projectsRoot = makeProjectsRoot();
    const fakeForgeRoot = makeProjectsRoot('contract-stages-brainroot-');
    const dir = makeProjectDir(projectsRoot, 'noprofileproj');
    writeFileSync(join(dir, 'roadmap.md'), '# roadmap\n', 'utf8');
    // Deliberately no brain/projects/noprofileproj/profile.md anywhere.

    const rows = okRows(deriveContractStages({ forgeRoot: fakeForgeRoot, projectsRoot, projectId: 'noprofileproj' }));
    const roadmap = byStage(rows, 'roadmap');
    assert.equal(
      roadmap.status, 'present',
      'kills wrong-fix (1): the row must stay presence-of-roadmap.md only — folding the brain profile into THIS stage\'s status would be a clause verdict, which D11 forbids and which only forge preflight\'s exit code is entitled to make',
    );
    assert.ok(
      roadmap.detail.some((d) => /profile\.md/.test(d) && /absent/i.test(d)),
      `kills wrong-fix (2): a detail line must name the absent profile so the divergence is VISIBLE, got: ${JSON.stringify(roadmap.detail)}`,
    );
  });

  it('AT-32: roadmap.md ABSENT → status stays "absent" regardless of the brain profile\'s presence (checked both ways)', () => {
    for (const profilePresent of [true, false]) {
      const projectsRoot = makeProjectsRoot();
      const fakeForgeRoot = makeProjectsRoot('contract-stages-brainroot-');
      const id = `noroadmap-${profilePresent ? 'withprofile' : 'noprofile'}`;
      makeProjectDir(projectsRoot, id); // dir exists but no roadmap.md
      if (profilePresent) {
        const brainDir = projectBrainDir(fakeForgeRoot, id);
        mkdirSync(brainDir, { recursive: true });
        writeFileSync(join(brainDir, 'profile.md'), '# profile\n', 'utf8');
      }
      const rows = okRows(deriveContractStages({ forgeRoot: fakeForgeRoot, projectsRoot, projectId: id }));
      assert.equal(
        byStage(rows, 'roadmap').status, 'absent',
        `roadmap.md absent must read as absent regardless of the brain profile's presence (profilePresent=${profilePresent})`,
      );
    }
  });
});
