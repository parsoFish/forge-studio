/**
 * Integration tests for `GET /api/studio/kbs/:id` health itemization.
 *
 * What `health.checks` must report per check — a real pass, an honest `n/a`, and never a vacuous exempt-pass.
 *
 * Split out of `bridge-studio-kbs.test.ts` (1,306 lines) in M4: 7 of its 35
 * cases. Shared support lives in `./test-fixtures/bridge-studio-kbs.ts`.
 */

import { refusingSessionStatusIo } from '../test-fixtures/session-status-io.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { knowledgeRoutes, type KnowledgeRouteContext } from '../../routes.ts';

import { CHECK_NAMES, checkReflectorLoss } from '../../brain-lint.ts';

import {
  CYCLES_KB_YAML,
  HEALTH_KB_ID,
  setupSharedForge,
  makeIsolatedForge,
  postAt,
  seedProjectBrain,
} from './test-fixtures/bridge-studio-kbs.ts';

let forgeRoot: string;

before(async () => {
  const shared = await setupSharedForge();
  forgeRoot = shared.root;
});

after(async () => {
  rmSync(forgeRoot, { recursive: true, force: true });
});

/**
 * `post`/`get`/`getAt` drive the CARVED HANDLERS directly — no bridge
 * (COMMON §5: a package test never boots one). The `{status, json}` shape is
 * preserved so every assertion below is byte-for-byte what it was over HTTP.
 * Not tested here any more, deliberately: origin/CSRF/404-fallthrough — the
 * HOST's policy, tested in `cli/*.test.ts`.
 */
const routes = knowledgeRoutes({
  sessionStatusIo: refusingSessionStatusIo,
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'demo-band'],
  // M4 ruling 86: the real fix turn is injected by the assembly, so route
  // tests declare one. It THROWS: no assertion in this file expects a fix turn
  // to be dispatched, and a stub that returned a plausible result would let a
  // future change dispatch one here unnoticed.
  runFixTurn: async () => {
    throw new Error('unexpected brain-fix dispatch in this test');
  },
});

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

async function drive(root: string, path: string, method: string, body: unknown = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: KnowledgeRouteContext = {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    readBody: async () => body,
  };
  const matched = await dispatchRoute(routes, mockReq(), res, ctx, path, method);
  if (!matched) return { status: 404, json: {} };
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

async function post(path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  return drive(forgeRoot, path, 'POST', body ?? {});
}

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return drive(forgeRoot, path, 'GET');
}

/** GET against an isolated root (mirrors `postAt`'s style/pairing). Used by
 *  the R6-08 WI-1 health-itemization RED pins below, which each need their
 *  OWN forge-root (a fresh 'cycles' with exactly one seeded defect, or the
 *  isolated alpha/alpha-two/throwkb fixtures) rather than the shared file-level
 *  fixture — mutating the SHARED 'cycles'/HEALTH_KB_ID KBs would risk
 *  interfering with the ~30 other tests in this file that read them. */
async function getAt(root: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  return drive(root, path, 'GET');
}

const FULL_SCOPE_CHECK_NAMES = CHECK_NAMES;

type CheckHealthEntry = { check: string; status: string; errorCount: number; flagCount: number };

// ---------------------------------------------------------------------------
// R1-06 WI-3 review MAJOR 1 (mis-scoped health count / declared-data-fails-open):
// buildKbHealth scoped its lint filter with the HARDCODED
// `resolve(forgeRoot,'brain',<id>)` prefix (= brain/<id>), so for a project KB
// living at brain/projects/<id> the filter matched nothing and health reported
// lintFlags=0 — hiding the Lint section for exactly the project KBs WI-3 targets,
// while op=lint/op=consolidate reported the real count. The health filter must
// scope via resolveKbBrainDir (the SAME resolution consolidate/lint use).
//
// RED today: GET health for r1-06-health reports lintFlags=0 (not 3).
// ---------------------------------------------------------------------------
test('R1-06 WI-3 MAJOR 1 red-pin: GET health for a project KB reports the REAL checkProjectBrainIndexes count (not 0) — RED today', async () => {
  // Fixture precondition, asserted BEFORE the verdict: op=lint (which already
  // scopes correctly) sees exactly 3 checkProjectBrainIndexes findings for this
  // project KB, so a health count of 0 is a mis-scope, not an empty corpus.
  const lint = await post(`/api/studio/kbs/${HEALTH_KB_ID}/maintenance`, { op: 'lint' });
  assert.equal(lint.status, 200, JSON.stringify(lint.json));
  const projectFindings = (lint.json['findings'] as Array<{ check?: string; category?: string }>).filter(
    (f) => f.check === 'checkProjectBrainIndexes',
  );
  assert.equal(
    projectFindings.length,
    3,
    `fixture precondition failed: expected 3 checkProjectBrainIndexes findings via op=lint, got ${projectFindings.length}`,
  );

  // Verdict: the health object's lintFlags must reflect those same 3 findings
  // — PLUS 6 more, all from the ONE full-scope scan now that it walks
  // brain/projects/<id>/themes (M1-D, ADR 035). By hand, over this fixture's 3
  // unlisted, near-identically-titled themes:
  //   3  checkProjectBrainIndexes — not listed in the project category index
  //   3  checkOrphans             — not reachable from INDEX.md or any index
  //   3  checkDuplicateThemes     — normalized-title collision across the trio
  // 3 + 3 + 3 = 9. Each is a distinct check's own honest verdict on the same
  // three files, not one check counted three times.
  //
  // It used to be 6: 3 checkProjectBrainIndexes plus 3 from a SECOND lens
  // (lintThemeFiles over the KB's own theme files), whose non-project-aware
  // checkIndexSync rediscovered the "not listed in patterns.md" defect under a
  // different check name. That lens existed only because the shared scan never
  // walked this KB at all; with the scan fixed it is gone, and with it the
  // possibility of Studio counting a flag `forge brain lint` does not report.
  const detail = await get(`/api/studio/kbs/${HEALTH_KB_ID}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  const health = detail.json['health'] as { lintFlags?: number; lintErrors?: number } | undefined;
  assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
  assert.equal(
    health!.lintFlags,
    9,
    `expected health.lintFlags=9 for a project KB with 3 checkProjectBrainIndexes + 3 checkOrphans + 3 checkDuplicateThemes flags, got ${health!.lintFlags} — the health filter is mis-scoped to brain/<id> instead of brain/projects/<id>`,
  );
});

test('R6-08 WI-1 RED-A: GET health.checks itemizes EXACTLY the full-scope checks (set-equality) — RED today (checks absent)', async () => {
  // Mirrors the existing R1-06 health test's harness (~:534-559): the shared
  // `get()` helper against the never-mutated HEALTH_KB_ID fixture.
  const detail = await get(`/api/studio/kbs/${HEALTH_KB_ID}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.json));
  const health = detail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
  assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
  assert.ok(Array.isArray(health!.checks), `health.checks must be an array — got ${JSON.stringify(health)}`);
  const names = health!.checks!.map((c) => c.check).sort();
  const expected = [...FULL_SCOPE_CHECK_NAMES].sort();
  assert.deepEqual(
    names,
    expected,
    `health.checks must itemize exactly the full-scope checks (checkCleanupCandidates excluded — cleanup-dry-run only). Expected ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`,
  );
});

test('R6-08 4on: a lone checkFrontmatter defect (missing description) on the top-level "cycles" KB yields checks[checkFrontmatter]={fail,errorCount:1}; the applicable forge-themes checks pass; the non-applicable checks (checkProjectBrainIndexes/checkReflectorLoss) are honestly n/a, NOT pass; aggregate lintErrors rolls up (RULING 2)', async () => {
  const iso = await makeIsolatedForge();
  try {
    // Fresh, ISOLATED 'cycles' KB (checkFrontmatter/checkIndexSync/checkOrphans
    // are hardcoded to THEME_SUBDIRS=['cycles','forge-dev'] — packages/knowledge/brain-lint.ts:124
    // — so a project-brain fixture can never exercise checkFrontmatter at all;
    // this must be a top-level brain). Isolated rather than the shared 'cycles'
    // fixture, which ~15 other tests in this file read and must stay pristine.
    mkdirSync(join(iso.root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(iso.root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    // Linked once in patterns.md (satisfies checkIndexSync + checkOrphans —
    // both scan brain/cycles/*.md for theme links) so checkFrontmatter's
    // missing-description error is the FIXTURE's ONLY defect.
    writeFileSync(
      join(iso.root, 'brain', 'cycles', 'patterns.md'),
      '# cycles — Patterns\n\n> Category index.\n\n## Theme pages\n- [`rb-frontmatter`](./themes/rb-frontmatter.md) — fixture theme.\n',
    );
    writeFileSync(
      join(iso.root, 'brain', 'cycles', 'themes', 'rb-frontmatter.md'),
      '---\ntitle: "RB Frontmatter Fixture"\ncategory: pattern\ncreated_at: "2026-08-01T00:00:00Z"\nupdated_at: "2026-08-01T00:00:00Z"\n---\n\n' +
      '# RB Frontmatter Fixture\n\nMinimal fixture body with no links (deliberately missing `description` — the ONE defect this fixture carries).\n',
    );

    const detail = await getAt(iso.root, '/api/studio/kbs/cycles');
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    const health = detail.json['health'] as
      | { checks?: CheckHealthEntry[]; lintErrors?: number; lintFlags?: number }
      | undefined;
    assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
    assert.ok(Array.isArray(health!.checks), `health.checks must be an array — got ${JSON.stringify(health)}`);

    const byName = new Map(health!.checks!.map((c) => [c.check, c]));
    const fm = byName.get('checkFrontmatter');
    assert.ok(fm, `checks[] must include a checkFrontmatter entry, got ${JSON.stringify(health!.checks)}`);
    assert.equal(fm!.status, 'fail', `checkFrontmatter must be status:'fail' for the seeded missing-description defect, got ${JSON.stringify(fm)}`);
    assert.equal(fm!.errorCount, 1, `checkFrontmatter errorCount must be 1, got ${JSON.stringify(fm)}`);

    // R6-08 4on (F1/F2 correction): the OLD expectation here — EVERY other
    // check reports 'pass' — encoded the reviewer-proved MISLEADING behavior:
    // checkProjectBrainIndexes (scans brain/projects/*) and checkReflectorLoss
    // (a GLOBAL advisory over _queue/done) never actually inspect a top-level
    // 'cycles' KB at all, so reporting 'pass' for them was a declared-data-
    // fails-open lie (twelve green dots, only ten of which ever ran, as of
    // R4-19-F2's checkDanglingEdges + checkDuplicateThemes). Under the honest
    // design those two report 'n/a'; the remaining 9 forge-themes checks
    // genuinely DID scan this KB (readThemeFiles walks brain/cycles/
    // themes) and correctly report 'pass' on this single-defect fixture.
    const NEVER_APPLICABLE_TO_CYCLES = new Set(['checkProjectBrainIndexes', 'checkReflectorLoss']);
    for (const name of FULL_SCOPE_CHECK_NAMES) {
      if (name === 'checkFrontmatter') continue;
      const entry = byName.get(name);
      assert.ok(entry, `checks[] must ALWAYS include a ${name} entry, even when clean (never absent) — got ${JSON.stringify(health!.checks)}`);
      if (NEVER_APPLICABLE_TO_CYCLES.has(name)) {
        assert.equal(entry!.status, 'n/a', `${name} never scans a top-level 'cycles' KB — it must report 'n/a', NOT 'pass' (declared-data-fails-open), got ${JSON.stringify(entry)}`);
      } else {
        assert.equal(entry!.status, 'pass', `${name} must be status:'pass' on this single-defect fixture, got ${JSON.stringify(entry)}`);
      }
    }

    // RULING 2: the aggregate lintErrors/lintFlags fields are KEPT — derived
    // as a roll-up over checks[], never dropped and never allowed to diverge.
    assert.equal(health!.lintErrors, 1, `aggregate lintErrors must roll up to 1, got ${health!.lintErrors}`);
    const rollupErrors = health!.checks!.reduce((sum, c) => sum + c.errorCount, 0);
    assert.equal(health!.lintErrors, rollupErrors, `aggregate lintErrors (${health!.lintErrors}) must equal the sum of checks[].errorCount (${rollupErrors})`);
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 WI-1 RED-C (risk #5, sibling-leak guard): checks[checkProjectBrainIndexes].flagCount for "alpha" excludes sibling "alpha-two"s findings — RED today (checks absent)', async () => {
  const iso = await makeIsolatedForge();
  try {
    // The SAME alpha/alpha-two sibling fixture shape as the existing MAJOR 2
    // red-pin above (~:572): alpha has 2 unlisted theme findings, alpha-two
    // has 1 — a naive substring scope (`file.includes('alpha')`) would fold
    // alpha-two's finding into alpha's count (3, not 2).
    seedProjectBrain(iso.root, 'alpha', ['a-one', 'a-two']);
    seedProjectBrain(iso.root, 'alpha-two', ['b-one']);

    // Fixture precondition (before any verdict): the pre-existing, already
    // correctly-scoped op=lint read really does see 2 findings for alpha,
    // independent of alpha-two.
    const lintAlpha = await postAt(iso.root, '/api/studio/kbs/alpha/maintenance', { op: 'lint' });
    const alphaFindings = (lintAlpha.json['findings'] as Array<{ check?: string }>).filter(
      (f) => f.check === 'checkProjectBrainIndexes',
    );
    assert.equal(alphaFindings.length, 2, `precondition: alpha must have 2 checkProjectBrainIndexes findings via op=lint, got ${alphaFindings.length}`);

    const detail = await getAt(iso.root, '/api/studio/kbs/alpha');
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    const health = detail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
    assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
    assert.ok(Array.isArray(health!.checks), `health.checks must be an array — got ${JSON.stringify(health)}`);

    const entry = health!.checks!.find((c) => c.check === 'checkProjectBrainIndexes');
    assert.ok(entry, `checks[] must include a checkProjectBrainIndexes entry, got ${JSON.stringify(health!.checks)}`);
    assert.equal(
      entry!.flagCount,
      2,
      `checkProjectBrainIndexes.flagCount for "alpha" must be exactly 2 (its own findings only) — a naive substring scope would fold in sibling "alpha-two"'s 1 finding and report 3. Got ${JSON.stringify(entry)}`,
    );
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 WI-1 addendum (RULING 3, unlettered in the WI spec): a lint-run throw marks every check status:"unknown" plus a top-level healthError — never a silent 0/0 pass — RED today', async () => {
  const iso = await makeIsolatedForge();
  try {
    // The SAME 'throwkb' fixture as the existing MINOR 1 red-pin above
    // (patterns.md is a DIRECTORY → readIndexEntries' readFileSync throws
    // EISDIR, uncaught inside checkProjectBrainIndexes → runBrainLint throws).
    // Confirmed empirically before writing this assertion: GET .../throwkb's
    // graph build does NOT throw (buildKbGraph tolerates the directory), only
    // buildKbHealth's runBrainLint call does — so this reaches a 200 today,
    // just with the current silent-catch bug (lintFlags/lintErrors both 0).
    seedProjectBrain(iso.root, 'throwkb', ['t-one'], { patternsAsDir: true });

    const detail = await getAt(iso.root, '/api/studio/kbs/throwkb');
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    const health = detail.json['health'] as { checks?: CheckHealthEntry[]; healthError?: string } | undefined;
    assert.ok(health, `health object must be present, got ${JSON.stringify(detail.json)}`);
    assert.ok(Array.isArray(health!.checks), `health.checks must be an array even on a lint-run throw — got ${JSON.stringify(health)}`);
    assert.ok(
      health!.checks!.length > 0 && health!.checks!.every((c) => c.status === 'unknown'),
      `every check must be status:'unknown' when the lint run throws — got ${JSON.stringify(health!.checks)}`,
    );
    assert.equal(
      typeof health!.healthError,
      'string',
      `a top-level healthError (string) must be present on a lint-run throw — got ${JSON.stringify(health)}`,
    );
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 4on (F2): checkReflectorLoss is a GLOBAL advisory (_queue/done) — every kb reports it "n/a", never "pass", even when a real reflector-loss condition exists', async () => {
  const iso = await makeIsolatedForge();
  try {
    // Seed a REAL reflector-loss condition: a `_queue/done/` manifest with no
    // matching archive under `brain/cycles/_raw/` — checkReflectorLoss's own
    // trigger (packages/knowledge/brain-lint.ts). Deliberately GLOBAL: nothing ties this
    // manifest to any one KB's brain dir (its `file` is under `_queue/done/`,
    // never under `brain/<kbId>`).
    writeFileSync(join(iso.root, '_queue', 'done', 'lost-init.md'), '# lost initiative\n');

    // Fixture precondition, asserted directly against the real check (there is
    // no per-kb HTTP route for a check that is never kb-scoped): the condition
    // is genuinely real, not a fixture no-op.
    const findings = checkReflectorLoss(iso.root);
    assert.equal(
      findings.length,
      1,
      `precondition: checkReflectorLoss must find the seeded lost-init manifest, got ${JSON.stringify(findings)}`,
    );

    // A top-level forge kb ('cycles') and a project kb — the GLOBAL/never-
    // applicable verdict must hold for EVERY kb kind, not just one.
    mkdirSync(join(iso.root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(iso.root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    seedProjectBrain(iso.root, 'reflector-loss-check', ['r-one']);

    for (const kbId of ['cycles', 'reflector-loss-check']) {
      const detail = await getAt(iso.root, `/api/studio/kbs/${kbId}`);
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      const health = detail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
      assert.ok(health, `health object must be present for "${kbId}", got ${JSON.stringify(detail.json)}`);
      assert.ok(Array.isArray(health!.checks), `health.checks must be an array for "${kbId}" — got ${JSON.stringify(health)}`);
      const entry = health!.checks!.find((c) => c.check === 'checkReflectorLoss');
      assert.ok(entry, `checks[] must include a checkReflectorLoss entry for "${kbId}", got ${JSON.stringify(health!.checks)}`);
      assert.equal(
        entry!.status,
        'n/a',
        `checkReflectorLoss never inspects any single kb's brain dir — "${kbId}" must report 'n/a', NEVER 'pass', even though the seeded condition is genuinely real (declared-data-fails-open). Got ${JSON.stringify(entry)}`,
      );
    }
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('R6-08 4on (F1): a project kb with NO own themes reports the 10 forge-theme checks "n/a" (never "pass"); with an own theme carrying a real defect, the lintThemeFiles-covered check is real (fail)', async () => {
  const iso = await makeIsolatedForge();
  try {
    // Part 1 — a project kb scaffolded with an empty themes/ dir: the shared
    // readThemeFiles-based checks never see it (it isn't brain/cycles or
    // brain/forge-dev) AND lintThemeFiles has nothing of its own to lint
    // (0 own theme files) — every forge-themes-scoped check must be honestly
    // 'n/a', never a silent 'pass' implying "scanned, found nothing".
    const emptyId = 'f1-empty-themes-project';
    const emptyDir = join(iso.root, 'brain', 'projects', emptyId);
    mkdirSync(join(emptyDir, 'themes'), { recursive: true });
    writeFileSync(
      join(emptyDir, 'kb.yaml'),
      `id: ${emptyId}\nname: ${emptyId}\nbinding: { kind: project, ref: ${emptyId} }\ndesc: F1 no-own-themes fixture.\nbackend: filesystem\n`,
    );
    writeFileSync(join(emptyDir, 'patterns.md'), `# ${emptyId} — Patterns\n\n> fixture index.\n\n## Theme pages\n`);

    const emptyDetail = await getAt(iso.root, `/api/studio/kbs/${emptyId}`);
    assert.equal(emptyDetail.status, 200, JSON.stringify(emptyDetail.json));
    const emptyHealth = emptyDetail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
    assert.ok(emptyHealth, `health object must be present, got ${JSON.stringify(emptyDetail.json)}`);
    const emptyByName = new Map(emptyHealth!.checks!.map((c) => [c.check, c]));
    // A project kb with 0 theme files has nothing for any of these to inspect.
    // The scan walks its themes/ dir now (ADR 035) but reads no file out of
    // it, so every one of them must report 'n/a' — a check that opened nothing
    // has not earned a 'pass' over an empty set.
    const FORGE_THEME_CHECKS = [
      'checkFrontmatter', 'checkIndexSync', 'checkSourceLinks', 'checkStaleness',
      'checkOrphans', 'checkLengthSoftCap', 'checkCategoryScope',
      'checkDanglingEdges', 'checkDuplicateThemes',
    ] as const;
    for (const name of FORGE_THEME_CHECKS) {
      const entry = emptyByName.get(name);
      assert.ok(entry, `checks[] must include a ${name} entry, got ${JSON.stringify(emptyHealth!.checks)}`);
      assert.equal(
        entry!.status,
        'n/a',
        `${name} never scans a project kb's brain dir AND this kb has 0 own theme files — must report 'n/a', NEVER 'pass'. Got ${JSON.stringify(entry)}`,
      );
    }

    // Part 2 — a SEPARATE project kb with ONE own theme carrying a real
    // defect (missing `description`), correctly linked in its own patterns.md
    // so checkIndexSync stays clean and checkFrontmatter is the fixture's
    // ONLY defect. This is what makes a project kb's Health REAL: the SAME
    // check that reported 'n/a' above now reports a genuine, freshly-computed
    // 'fail' when it has real content of its own to inspect.
    const defectId = 'f1-defect-project';
    const defectDir = join(iso.root, 'brain', 'projects', defectId);
    mkdirSync(join(defectDir, 'themes'), { recursive: true });
    writeFileSync(
      join(defectDir, 'kb.yaml'),
      `id: ${defectId}\nname: ${defectId}\nbinding: { kind: project, ref: ${defectId} }\ndesc: F1 own-theme-defect fixture.\nbackend: filesystem\n`,
    );
    writeFileSync(
      join(defectDir, 'patterns.md'),
      `# ${defectId} — Patterns\n\n> fixture index.\n\n## Theme pages\n- [\`f1-defect-theme\`](./themes/f1-defect-theme.md) — fixture theme.\n`,
    );
    writeFileSync(
      join(defectDir, 'themes', 'f1-defect-theme.md'),
      '---\ntitle: "F1 Own-Theme Defect Fixture"\ncategory: pattern\ncreated_at: "2026-08-01T00:00:00Z"\nupdated_at: "2026-08-01T00:00:00Z"\n---\n\n' +
      '# F1 Own-Theme Defect Fixture\n\nDeliberately missing `description` — the ONE defect this fixture carries.\n',
    );

    const defectDetail = await getAt(iso.root, `/api/studio/kbs/${defectId}`);
    assert.equal(defectDetail.status, 200, JSON.stringify(defectDetail.json));
    const defectHealth = defectDetail.json['health'] as { checks?: CheckHealthEntry[] } | undefined;
    assert.ok(defectHealth, `health object must be present, got ${JSON.stringify(defectDetail.json)}`);
    const fm = defectHealth!.checks!.find((c) => c.check === 'checkFrontmatter');
    assert.ok(fm, `checks[] must include a checkFrontmatter entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(
      fm!.status,
      'fail',
      `checkFrontmatter is LINT_THEME_FILE_CHECKS-covered and this kb has 1 own theme with a real missing-description defect — must report a genuine 'fail', not 'n/a'/'pass'. Got ${JSON.stringify(fm)}`,
    );
    assert.equal(fm!.errorCount, 1, `checkFrontmatter errorCount must be 1, got ${JSON.stringify(fm)}`);

    // The index verdict stays clean (real 'pass') — the theme IS linked —
    // proving this is a genuine per-check computation, not every check going
    // red together. For a project brain that verdict is
    // checkProjectBrainIndexes': it resolves the index in the project's OWN
    // dir. checkIndexSync resolves it through the ADR 018 category→sub-wiki
    // routing map (pattern→brain/cycles), which governs the forge brains
    // alone, so for this KB it is honestly 'n/a' — it would otherwise look for
    // this theme in brain/cycles/patterns.md and flag every project theme in
    // the repo as unindexed.
    const pbi = defectHealth!.checks!.find((c) => c.check === 'checkProjectBrainIndexes');
    assert.ok(pbi, `checks[] must include a checkProjectBrainIndexes entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(pbi!.status, 'pass', `checkProjectBrainIndexes must be a real 'pass' (theme correctly linked in its own index), got ${JSON.stringify(pbi)}`);
    const idx = defectHealth!.checks!.find((c) => c.check === 'checkIndexSync');
    assert.ok(idx, `checks[] must include a checkIndexSync entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(idx!.status, 'n/a', `checkIndexSync is the forge category→sub-wiki index rule — must be 'n/a' for a project brain, never a verdict it did not compute. Got ${JSON.stringify(idx)}`);

    // checkCategoryScope is 'n/a' even though this KB has an own theme carrying
    // `category: pattern`: the category→sub-wiki routing rule is a three-brain
    // (ADR 018) convention that governs ONLY the forge KBs (cycles/forge-dev),
    // so it is NOT in LINT_THEME_FILE_CHECKS. Reporting 'pass' here would be a
    // vacuous exempt-pass (lintThemeFiles skips the routing check for non-cycles
    // /forge-dev themes anyway) and reporting 'fail' would be the false-FAIL a
    // band/flow KB's own theme would otherwise hit — 'n/a' is the honest state.
    const cat = defectHealth!.checks!.find((c) => c.check === 'checkCategoryScope');
    assert.ok(cat, `checks[] must include a checkCategoryScope entry, got ${JSON.stringify(defectHealth!.checks)}`);
    assert.equal(cat!.status, 'n/a', `checkCategoryScope is a forge-brain-only routing convention — must be 'n/a' for a non-forge KB, never a vacuous 'pass' or a false 'fail'. Got ${JSON.stringify(cat)}`);
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});
