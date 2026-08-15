/**
 * ACCEPTANCE TESTS (bead forge-2am, exit row 12) — must be RED until the
 * per-KB lint summary is implemented.
 *
 * Pins the seam `cli/kb-lint-summary.ts` (extracted from `cli/bridge-studio-kbs.ts`,
 * which must SHRINK, not grow):
 *
 *   export type KbLintSummary = {
 *     errors: number; flags: number; checksRun: number; checksTotal: number;
 *     error?: string;
 *   };
 *   export function computeKbLintChecks(forgeRoot, kbId, findings): { checks, lintErrors, lintFlags };
 *   export function summarizeKbLintChecks(r): KbLintSummary;
 *   export function attachKbLintSummaries<T extends {id:string}>(forgeRoot, kbs): (T & {lint: KbLintSummary})[];
 *
 * ...folded into the EXISTING `GET /api/studio/kbs` list response so Home
 * reads it through the SAME existing `fetchStudioKbs()` — no new polling
 * path, no persisted status field anywhere (derive-don't-store,
 * brain/cycles/themes/derive-status-dont-store-it.md).
 *
 * Every finding count below was hand-verified against the REAL check
 * functions in cli/brain-lint.ts (checkFrontmatter, checkIndexSync,
 * checkOrphans, checkProjectBrainIndexes, CHECK_SCOPE, LINT_THEME_FILE_CHECKS)
 * — see the per-fixture comments for the arithmetic.
 *
 * RUN: node --test --experimental-strip-types cli/kb-lint-summary.test.ts
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';
import { CHECK_NAMES } from './brain-lint.ts';
// The module under test. This import throws at load time (module not found)
// until cli/kb-lint-summary.ts exists — the intended "module missing" RED
// for the WHOLE file, not a syntax error.
import { attachKbLintSummaries } from './kb-lint-summary.ts';
import type { KbLintSummary } from './kb-lint-summary.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Minimal _queue + _logs scaffolding startBridge/listRuns expect. */
function initQueueDirs(forgeRoot: string): void {
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
}

async function get(base: string, path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** A theme file with valid, complete frontmatter by default. No links, no
 *  keywords, short body — deliberately clean so every OTHER full-scope check
 *  (checkSourceLinks/checkStaleness/checkContradictions/checkLengthSoftCap)
 *  reports nothing, keeping fixture finding-counts hand-verifiable.
 *  `withUpdatedAt: false` drops the `updated_at` field, the ONE deliberate
 *  defect checkFrontmatter's REQUIRED_FRONTMATTER_FIELDS really flags. */
function themeMd(opts: { title: string; desc: string; category?: string; withUpdatedAt?: boolean }): string {
  const cat = opts.category ?? 'pattern';
  const lines = [
    '---',
    `title: "${opts.title}"`,
    `description: "${opts.desc}"`,
    `category: ${cat}`,
    'created_at: "2026-08-01T00:00:00Z"',
  ];
  if (opts.withUpdatedAt !== false) lines.push('updated_at: "2026-08-01T00:00:00Z"');
  lines.push(
    '---',
    '',
    `# ${opts.title}`,
    '',
    'No links, no keywords — deliberately clean for exact-count fixtures (cli/kb-lint-summary.test.ts).',
    '',
  );
  return lines.join('\n');
}

/** Recursive {relPath: "size:mtimeMs"} snapshot — size makes the "did the
 *  mutation actually touch disk" precondition deterministic even when a fast
 *  filesystem's mtime resolution can't distinguish two writes in the same
 *  tick; mtime is still carried so the "read path wrote nothing" comparison
 *  is the strict names+mtimes check the acceptance criteria call for. */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const st = statSync(p);
        out[relative(dir, p)] = `${st.size}:${st.mtimeMs}`;
      }
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// AT-1, AT-2, AT-3, AT-7 — one shared, never-mutated fixture.
// ---------------------------------------------------------------------------

describe('kb-lint-summary — list descriptor honesty (AT-1, AT-2, AT-3, AT-7)', () => {
  let forgeRoot: string;
  let bridgeUrl: string;
  let closeBridge: () => Promise<void>;

  before(async () => {
    forgeRoot = tmp('kb-lint-summary-main-');
    initQueueDirs(forgeRoot);

    // KB "cycles" (forge-side, Brain 2) — ONE theme with a genuinely broken
    // frontmatter (missing `updated_at`), and patterns.md correctly links +
    // lists it so checkOrphans/checkIndexSync stay clean. By hand: exactly
    // 1 checkFrontmatter error, 0 flags, for this KB.
    const cyclesDir = join(forgeRoot, 'brain', 'cycles');
    mkdirSync(join(cyclesDir, 'themes'), { recursive: true });
    writeFileSync(
      join(cyclesDir, 'kb.yaml'),
      'id: cycles\nname: Cycles Brain\nbinding: { kind: unique }\ndesc: AT-1/AT-2/AT-3/AT-7 fixture.\n',
    );
    writeFileSync(
      join(cyclesDir, 'themes', 'broken-fm.md'),
      themeMd({ title: 'Broken FM Fixture Theme', desc: 'Deliberately missing updated_at.', withUpdatedAt: false }),
    );
    writeFileSync(
      join(cyclesDir, 'patterns.md'),
      '# Cycles — Patterns\n\n## Theme pages\n\n- [Broken FM](./themes/broken-fm.md)\n',
    );

    // KB "alpha" (central project brain, ADR 035) — themes/ dir EXISTS but is
    // EMPTY. checkProjectBrainIndexes (CHECK_SCOPE 'project-indexes') is the
    // ONLY check whose scan domain even reaches a project KB's dir, and it
    // skips an empty themes dir with zero findings — so alpha's lint is
    // {errors:0, flags:0} and only 1 of CHECK_NAMES.length checks ever gets a
    // real verdict (the AT-3 honesty-invariant fixture).
    const alphaDir = join(forgeRoot, 'brain', 'projects', 'alpha');
    mkdirSync(join(alphaDir, 'themes'), { recursive: true });
    writeFileSync(
      join(alphaDir, 'kb.yaml'),
      'id: alpha\nname: Alpha Project Brain\nbinding: { kind: project, ref: alpha }\ndesc: AT-1/AT-3 fixture (ADR 035 central project brain).\n',
    );

    const started = await startBridge({ forgeRoot, port: 0 });
    bridgeUrl = started.url;
    closeBridge = started.close;
  });

  after(async () => {
    await closeBridge?.();
    if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  });

  test('AT-1: GET /api/studio/kbs — every kb carries a REAL lint summary matching its actual findings', async () => {
    const { status, json } = await get(bridgeUrl, '/api/studio/kbs');
    assert.equal(status, 200, JSON.stringify(json));
    const kbs = json['kbs'] as Array<Record<string, unknown>>;
    const byId = new Map(kbs.map((k) => [k['id'], k]));

    const cyclesLint = byId.get('cycles')?.['lint'] as KbLintSummary | undefined;
    const alphaLint = byId.get('alpha')?.['lint'] as KbLintSummary | undefined;
    assert.ok(cyclesLint, `expected kbs[].lint for "cycles", got ${JSON.stringify(byId.get('cycles'))}`);
    assert.ok(alphaLint, `expected kbs[].lint for "alpha", got ${JSON.stringify(byId.get('alpha'))}`);

    // Kills: a summary field that is declared + serialized but hardcoded to
    // {errors:0,flags:0} (declared-data-fails-open, this campaign's #1
    // defect class). "cycles" has exactly ONE genuinely broken theme
    // (missing `updated_at`) — a hardcoded-zero implementation reports 0
    // here and this assertion catches it.
    assert.equal(
      cyclesLint!.errors,
      1,
      `"cycles" must report exactly 1 error (the seeded missing-updated_at finding), got ${JSON.stringify(cyclesLint)}`,
    );
    assert.equal(
      cyclesLint!.flags,
      0,
      `"cycles" must report 0 flags (every other full-scope check is clean by fixture design), got ${JSON.stringify(cyclesLint)}`,
    );
    assert.equal(alphaLint!.errors, 0, `"alpha" (empty themes/) must report 0 errors, got ${JSON.stringify(alphaLint)}`);
    assert.equal(alphaLint!.flags, 0, `"alpha" (empty themes/) must report 0 flags, got ${JSON.stringify(alphaLint)}`);
    assert.equal(cyclesLint!.checksTotal, CHECK_NAMES.length);
    assert.equal(alphaLint!.checksTotal, CHECK_NAMES.length);
  });

  test('AT-2: list.lint byte-matches the per-KB detail route health (ONE derivation, not two)', async () => {
    const list = await get(bridgeUrl, '/api/studio/kbs');
    assert.equal(list.status, 200, JSON.stringify(list.json));
    const kbs = list.json['kbs'] as Array<{ id: string; lint?: KbLintSummary }>;
    assert.ok(kbs.length >= 2, 'fixture must carry both cycles + alpha');

    let sawNonzeroChecksRun = false;
    for (const kb of kbs) {
      const detail = await get(bridgeUrl, `/api/studio/kbs/${kb.id}`);
      assert.equal(detail.status, 200, JSON.stringify(detail.json));
      const health = detail.json['health'] as {
        lintErrors: number;
        lintFlags: number;
        checks: Array<{ status: string }>;
      };
      assert.ok(kb.lint, `kbs[].lint missing for "${kb.id}"`);
      // Kills: a second, forked summariser that drifts from buildKbHealth —
      // the exact failure derive-status-dont-store-it rule 2 names.
      assert.equal(
        kb.lint!.errors,
        health.lintErrors,
        `"${kb.id}": list.lint.errors must byte-match detail.health.lintErrors — list=${kb.lint!.errors} detail=${health.lintErrors}`,
      );
      assert.equal(
        kb.lint!.flags,
        health.lintFlags,
        `"${kb.id}": list.lint.flags must byte-match detail.health.lintFlags — list=${kb.lint!.flags} detail=${health.lintFlags}`,
      );
      const realVerdicts = health.checks.filter((c) => c.status === 'pass' || c.status === 'warn' || c.status === 'fail').length;
      assert.equal(
        kb.lint!.checksRun,
        realVerdicts,
        `"${kb.id}": list.lint.checksRun must equal the count of detail.health.checks[] with a real pass/warn/fail verdict (never 'n/a') — list=${kb.lint!.checksRun} detail-derived=${realVerdicts}`,
      );
      if (realVerdicts > 0) sawNonzeroChecksRun = true;
    }
    assert.ok(sawNonzeroChecksRun, 'fixture precondition: at least one kb must have checksRun > 0 (otherwise this equality is vacuous)');
  });

  test('AT-3: the n/a honesty invariant survives into the summary — "alpha" (0 own theme files) reports checksRun < checksTotal', async () => {
    const { status, json } = await get(bridgeUrl, '/api/studio/kbs');
    assert.equal(status, 200, JSON.stringify(json));
    const kbs = json['kbs'] as Array<{ id: string; lint?: KbLintSummary }>;
    const alpha = kbs.find((k) => k.id === 'alpha');
    assert.ok(alpha?.lint, `expected lint for "alpha", got ${JSON.stringify(alpha)}`);

    // Arithmetic (CHECK_SCOPE + LINT_THEME_FILE_CHECKS, cli/brain-lint.ts):
    // alpha's brainDir is brain/projects/alpha. Of the CHECK_NAMES.length=10
    // full-scope checks, only checkProjectBrainIndexes has
    // CHECK_SCOPE==='project-indexes' AND dirname(brainDir)===brain/projects
    // — so it is the ONLY "applicable" check (1). alpha's own themes/ dir is
    // EMPTY, so ownThemeFiles.length===0 and NO check is "coveredByOwn"
    // (LINT_THEME_FILE_CHECKS requires ownThemeFiles.length>0). checksRun =
    // applicable(1) + coveredByOwn(0), no double-count = 1.
    const expectedChecksRun = 1;
    assert.equal(
      alpha!.lint!.checksRun,
      expectedChecksRun,
      `expected checksRun=${expectedChecksRun} (only checkProjectBrainIndexes applicable; see arithmetic comment above), got ${JSON.stringify(alpha!.lint)}`,
    );
    assert.equal(alpha!.lint!.checksTotal, CHECK_NAMES.length);
    assert.ok(
      alpha!.lint!.checksRun < alpha!.lint!.checksTotal,
      `checksRun (${alpha!.lint!.checksRun}) must be < checksTotal (${alpha!.lint!.checksTotal}) — a KB most checks never inspect must never look "fully checked"`,
    );
    // Kills: a summary that silently counts never-run checks as passes — the
    // errors/flags below must be the real (zero) computed values, never a
    // fabricated all-clear derived from treating n/a as pass.
    assert.equal(alpha!.lint!.errors, 0);
    assert.equal(alpha!.lint!.flags, 0);
  });

  test('AT-7: attachKbLintSummaries returns NEW objects and leaves its input untouched', () => {
    const inputKbs: Array<{ id: string; name: string }> = [
      { id: 'cycles', name: 'Cycles Brain' },
      { id: 'alpha', name: 'Alpha Project Brain' },
    ];
    const snapshotBefore = JSON.parse(JSON.stringify(inputKbs));

    const result = attachKbLintSummaries(forgeRoot, inputKbs);

    assert.notEqual(result, inputKbs, 'attachKbLintSummaries must return a NEW array, not the same reference');
    assert.equal(result.length, inputKbs.length);
    for (let i = 0; i < inputKbs.length; i++) {
      assert.notEqual(result[i], inputKbs[i], `result[${i}] must be a NEW object, not the same reference as the input`);
      assert.ok(!('lint' in inputKbs[i]), `input kb "${inputKbs[i].id}" must not be mutated to carry a "lint" key`);
      assert.ok(result[i].lint, `result[${i}] must carry a "lint" summary`);
      const lint: KbLintSummary = result[i].lint;
      assert.equal(typeof lint.errors, 'number');
      assert.equal(typeof lint.flags, 'number');
      assert.equal(typeof lint.checksRun, 'number');
      assert.equal(typeof lint.checksTotal, 'number');
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(inputKbs)),
      snapshotBefore,
      'input objects must be byte-identical after the call (no mutation)',
    );
  });
});

// ---------------------------------------------------------------------------
// AT-4 — structural, source-level: one lint per list call.
// ---------------------------------------------------------------------------

/** Strips block + line comments so a JSDoc example mentioning `runBrainLint(`
 *  in prose (the spec's own doc comment for attachKbLintSummaries does
 *  exactly this) can't masquerade as a second call site, and can't corrupt
 *  brace-depth counting below. Good enough for this codebase's style — not a
 *  full tokenizer, but runBrainLint( never legitimately appears inside a
 *  string literal here. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Extract a top-level `function <fnName>` declaration's BODY only — not its
 * generic constraint (`<T extends {id:string}>`) and not an inline
 * return-type object annotation (`): { checks: ...; lintErrors: number }`),
 * both of which the exact spec signatures carry and both of which contain
 * their OWN balanced `{...}` before the real body opens. The body is the
 * LAST top-level (depth 0→1→0) brace block within the span from the
 * signature to the next top-level `export`.
 */
function extractFunctionBody(src: string, fnName: string, fileLabel: string): string {
  const clean = stripComments(src);
  const sigIdx = clean.indexOf(`function ${fnName}`);
  assert.ok(sigIdx >= 0, `expected a "function ${fnName}" declaration in ${fileLabel}`);
  let nextIdx = clean.indexOf('\nexport ', sigIdx + 1);
  if (nextIdx === -1) nextIdx = clean.length;
  const span = clean.slice(sigIdx, nextIdx);

  let depth = 0;
  let blockStart = -1;
  let lastBlock: [number, number] | null = null;
  for (let i = 0; i < span.length; i++) {
    if (span[i] === '{') {
      if (depth === 0) blockStart = i;
      depth++;
    } else if (span[i] === '}') {
      depth--;
      if (depth === 0 && blockStart >= 0) {
        lastBlock = [blockStart, i];
        blockStart = -1;
      }
    }
  }
  assert.ok(lastBlock, `could not locate a { } body for ${fnName} in ${fileLabel}`);
  const [start, end] = lastBlock as [number, number];
  return span.slice(start, end + 1);
}

describe('kb-lint-summary — one lint per list call, structural (AT-4)', () => {
  const KB_LINT_SUMMARY_FILE = join(ROOT, 'cli', 'kb-lint-summary.ts');
  const BRIDGE_KBS_FILE = join(ROOT, 'cli', 'bridge-studio-kbs.ts');

  test('AT-4a: cli/kb-lint-summary.ts contains exactly ONE literal runBrainLint( call site, and it lives inside runBrainLintFullMemoized (W6-P2 memo) — not computeKbLintChecks or attachKbLintSummaries directly', () => {
    assert.ok(
      existsSync(KB_LINT_SUMMARY_FILE),
      `cli/kb-lint-summary.ts must exist (RED at base — forge-2am not yet implemented) at ${KB_LINT_SUMMARY_FILE}`,
    );
    const src = stripComments(readFileSync(KB_LINT_SUMMARY_FILE, 'utf8'));

    // Kills: an N-fan-out that re-runs the full brain lint once per KB — the
    // exact cost _wave5/parks/R6-07-kb-skew-report-dont-patch.md option (a)
    // refused. W6-P2 (ADR 044) moved the ONE call site behind
    // runBrainLintFullMemoized's cache; attachKbLintSummaries now calls THAT
    // wrapper instead of runBrainLint directly, but the invariant this test
    // guards — one real lint per list call at most — still holds.
    const callSites = src.match(/\brunBrainLint\s*\(/g) ?? [];
    assert.equal(
      callSites.length,
      1,
      `expected exactly ONE literal runBrainLint( call site in cli/kb-lint-summary.ts (the memo wraps it — one real full-corpus lint per cache miss, not one per KB), found ${callSites.length}`,
    );

    const computeBody = extractFunctionBody(src, 'computeKbLintChecks', 'cli/kb-lint-summary.ts');
    assert.ok(
      !/\brunBrainLint\s*\(/.test(computeBody),
      'computeKbLintChecks must NOT call runBrainLint — it takes ALREADY-COMPUTED findings and structurally cannot re-run the lint itself',
    );

    const attachBody = extractFunctionBody(src, 'attachKbLintSummaries', 'cli/kb-lint-summary.ts');
    assert.ok(
      !/\brunBrainLint\s*\(/.test(attachBody),
      'attachKbLintSummaries must NOT call runBrainLint directly — it must go through runBrainLintFullMemoized so GET /api/studio/kbs benefits from the W6-P2 memo',
    );
    assert.ok(
      /\brunBrainLintFullMemoized\s*\(/.test(attachBody),
      'attachKbLintSummaries must call runBrainLintFullMemoized exactly once for the whole kbs list',
    );

    const memoBody = extractFunctionBody(src, 'runBrainLintFullMemoized', 'cli/kb-lint-summary.ts');
    assert.ok(
      /\brunBrainLint\s*\(/.test(memoBody),
      'runBrainLintFullMemoized must be the ONE place that calls the real runBrainLint, on a cache miss',
    );
  });

  test("AT-4b: cli/bridge-studio-kbs.ts's loadKbDescriptors body still has NO runBrainLint( call (the other 4 call sites stay cheap)", () => {
    assert.ok(existsSync(BRIDGE_KBS_FILE), `cli/bridge-studio-kbs.ts must exist at ${BRIDGE_KBS_FILE}`);
    const src = stripComments(readFileSync(BRIDGE_KBS_FILE, 'utf8'));
    const body = extractFunctionBody(src, 'loadKbDescriptors', 'cli/bridge-studio-kbs.ts');
    assert.ok(
      !/\brunBrainLint\s*\(/.test(body),
      'loadKbDescriptors must stay cheap — the resolve-node route, the node-article route, the create-KB flow, and the guidance route all call it and must not pay the full lint cost',
    );
  });
});

// ---------------------------------------------------------------------------
// AT-5 — a throwing lint fails HONEST, never silently clean.
// ---------------------------------------------------------------------------

describe('kb-lint-summary — a throwing lint fails HONEST (AT-5)', () => {
  let forgeRoot: string;
  let bridgeUrl: string;
  let closeBridge: () => Promise<void>;

  before(async () => {
    forgeRoot = tmp('kb-lint-summary-throw-');
    initQueueDirs(forgeRoot);

    // KB "cycles" — present so we can assert EVERY kb (not just the broken
    // one) degrades honestly; the whole-list runBrainLint() throw is global,
    // not per-kb.
    const cyclesDir = join(forgeRoot, 'brain', 'cycles');
    mkdirSync(join(cyclesDir, 'themes'), { recursive: true });
    writeFileSync(join(cyclesDir, 'kb.yaml'), 'id: cycles\nname: Cycles Brain\nbinding: { kind: unique }\ndesc: AT-5 fixture.\n');

    // KB "throwkb" (project brain) — patterns.md planted as a DIRECTORY, the
    // known repro documented in buildKbHealth's RULING-3 comment
    // (cli/bridge-studio-kbs.ts): readIndexEntries' readFileSync throws
    // EISDIR inside checkProjectBrainIndexes, uncaught by runBrainLint.
    // Mirrors cli/bridge-studio-kbs.test.ts's
    // seedProjectBrain(..., {patternsAsDir:true}) fixture shape.
    const throwDir = join(forgeRoot, 'brain', 'projects', 'throwkb');
    mkdirSync(join(throwDir, 'themes'), { recursive: true });
    writeFileSync(
      join(throwDir, 'kb.yaml'),
      'id: throwkb\nname: Throwkb\nbinding: { kind: project, ref: throwkb }\ndesc: AT-5 EISDIR fixture.\nbackend: filesystem\n',
    );
    mkdirSync(join(throwDir, 'patterns.md'), { recursive: true }); // a DIRECTORY, not a file
    writeFileSync(join(throwDir, 'themes', 't-one.md'), themeMd({ title: 'T One', desc: 'AT-5 EISDIR trigger theme.' }));

    const started = await startBridge({ forgeRoot, port: 0 });
    bridgeUrl = started.url;
    closeBridge = started.close;
  });

  after(async () => {
    await closeBridge?.();
    if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  });

  test('AT-5: GET /api/studio/kbs still 200s with the list, but every kb.lint degrades honestly (error set, checksRun=0) — never fail-open clean', async () => {
    const { status, json } = await get(bridgeUrl, '/api/studio/kbs');
    assert.equal(
      status,
      200,
      `the list route must still 200 even when the whole-corpus lint run throws — the SUMMARY degrades, not the route: ${JSON.stringify(json)}`,
    );
    const kbs = json['kbs'] as Array<{ id: string; lint?: KbLintSummary }>;
    assert.ok(kbs.length >= 2, 'fixture must carry both cycles + throwkb');
    for (const kb of kbs) {
      assert.ok(kb.lint, `kb "${kb.id}" must still carry a lint object, got ${JSON.stringify(kb)}`);
      // Kills: a catch{} that returns {errors:0,flags:0} — a fail-open that
      // reports a broken brain as healthy.
      assert.equal(
        typeof kb.lint!.error,
        'string',
        `kb "${kb.id}".lint.error must be a non-empty string when the lint run throws, got ${JSON.stringify(kb.lint)}`,
      );
      assert.ok(kb.lint!.error!.length > 0, `kb "${kb.id}".lint.error must be non-empty`);
      assert.equal(kb.lint!.checksRun, 0, `kb "${kb.id}".lint.checksRun must be 0 when the lint run threw, got ${JSON.stringify(kb.lint)}`);
      assert.equal(
        kb.lint!.checksTotal,
        CHECK_NAMES.length,
        `kb "${kb.id}".lint.checksTotal is a static constant (CHECK_NAMES.length) and must still be present even on error`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AT-6 — derived, not stored (recompute proof).
// ---------------------------------------------------------------------------

describe('kb-lint-summary — derived, not stored (AT-6)', () => {
  let forgeRoot: string;
  let bridgeUrl: string;
  let closeBridge: () => Promise<void>;
  let cyclesDir: string;

  before(async () => {
    forgeRoot = tmp('kb-lint-summary-recompute-');
    initQueueDirs(forgeRoot);
    cyclesDir = join(forgeRoot, 'brain', 'cycles');
    mkdirSync(join(cyclesDir, 'themes'), { recursive: true });
    writeFileSync(join(cyclesDir, 'kb.yaml'), 'id: cycles\nname: Cycles Brain\nbinding: { kind: unique }\ndesc: AT-6 recompute fixture.\n');
    writeFileSync(
      join(cyclesDir, 'themes', 'theme-recompute.md'),
      themeMd({ title: 'Recompute Theme', desc: 'AT-6 — valid initially.', withUpdatedAt: true }),
    );
    writeFileSync(
      join(cyclesDir, 'patterns.md'),
      '# Cycles — Patterns\n\n## Theme pages\n\n- [Recompute Theme](./themes/theme-recompute.md)\n',
    );

    const started = await startBridge({ forgeRoot, port: 0 });
    bridgeUrl = started.url;
    closeBridge = started.close;
  });

  after(async () => {
    await closeBridge?.();
    if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  });

  test('AT-6: the list summary is RECOMPUTED per call, not persisted or memoised', async () => {
    const first = await get(bridgeUrl, '/api/studio/kbs');
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const firstKbs = first.json['kbs'] as Array<{ id: string; lint?: KbLintSummary }>;
    const firstCycles = firstKbs.find((k) => k.id === 'cycles');
    assert.ok(firstCycles?.lint, `expected lint for "cycles" on first read, got ${JSON.stringify(firstCycles)}`);
    assert.equal(
      firstCycles!.lint!.errors,
      0,
      `precondition: the theme is valid before mutation, expected 0 errors, got ${JSON.stringify(firstCycles!.lint)}`,
    );

    const snapAfterFirstRead = snapshotTree(join(forgeRoot, 'brain'));

    // MUTATE the theme on disk — drop `updated_at`, a genuinely new
    // checkFrontmatter error the first read could not have seen.
    writeFileSync(
      join(cyclesDir, 'themes', 'theme-recompute.md'),
      themeMd({ title: 'Recompute Theme', desc: 'AT-6 — valid initially.', withUpdatedAt: false }),
    );
    const snapAfterMutation = snapshotTree(join(forgeRoot, 'brain'));
    assert.notDeepEqual(snapAfterMutation, snapAfterFirstRead, 'fixture precondition: the mutation must actually touch the brain/ tree');

    const second = await get(bridgeUrl, '/api/studio/kbs');
    assert.equal(second.status, 200, JSON.stringify(second.json));
    const secondKbs = second.json['kbs'] as Array<{ id: string; lint?: KbLintSummary }>;
    const secondCycles = secondKbs.find((k) => k.id === 'cycles');
    assert.ok(secondCycles?.lint, `expected lint for "cycles" on second read, got ${JSON.stringify(secondCycles)}`);

    // Kills: any implementation that persists a status field or memoises a
    // stale value (derive-status-dont-store-it) — the second read, in the
    // SAME process, must reflect the on-disk mutation.
    assert.equal(secondCycles!.lint!.errors, 1, `second read must reflect the new checkFrontmatter finding, got ${JSON.stringify(secondCycles!.lint)}`);
    assert.notDeepEqual(secondCycles!.lint, firstCycles!.lint, 'the lint summary must have CHANGED between the two reads');

    // The read path itself must not write anything to brain/ — no persisted
    // status field, no cache file.
    const snapAfterSecondRead = snapshotTree(join(forgeRoot, 'brain'));
    assert.deepEqual(
      snapAfterSecondRead,
      snapAfterMutation,
      `GET /api/studio/kbs must not write to brain/ — snapshot changed: before=${JSON.stringify(snapAfterMutation)} after=${JSON.stringify(snapAfterSecondRead)}`,
    );
  });
});
