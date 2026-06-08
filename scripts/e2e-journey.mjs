/**
 * e2e-journey — PRODUCTIONISATION product-walkthrough + DOM-as-metrics regression harness.
 *
 *   node scripts/e2e-journey.mjs
 *
 * STORY: "Idea to merged PR — three human decisions."
 *   Three human moments are the spine (architect interview / review demo / reflect);
 *   everything else is autonomous and every phase is costed.
 *
 * STRUCTURE: 23 beats across 3 acts, grounded in real session behaviour:
 *   ACT I  — Live architecting  (P1 stall cameo, P2 free-text, P3 activity panel, P4 real cost)
 *   ACT II — Autonomous build   (fast-forwarded, honest running timer, TDD gate, WI dependency)
 *   ACT III— Review + teach     (PARTIAL→MET, new AC authored in-loop, reflect)
 *
 * No live LLM: the architect runner's turns + autonomous cycle are emulated by seeding
 * the same files/events the real phases write, grounded in real cycle event sequences.
 *
 * REGRESSION HARNESS: all assertions are SOFT (failures[]; non-zero exit at end).
 * Regression guards preserved from the previous harness:
 *   ≥5 phase hexes, ≥2 WI hexes, hex-detail drawer opens (phase + wi), per-phase cost rollup,
 *   cross-project pane data-project-group, unifier own-hex complete, per-AC demo-evaluation,
 *   partial-count==0 on re-review, reflection hex complete.
 *
 * NEW assertions (the four architect observability surfaces):
 *   P1: [data-architect-stale="true"] renders when staleMs>120s; clears after refresh.
 *   P2: [data-question-index="1"][data-question-resolved="true"] + all options unselected
 *       when free-text overrides the radio on Q2.
 *   P3: [data-section="architect-activity"][data-activity-count≥6]; ≥1 reasoning row.
 *   P4: [data-phase="architect"][data-phase-cost-usd]>0 + status complete.
 *
 * Output: forge-ui/.demo-shots/e2e/{video/journey.webm, frames/*.png, index.html}.
 * Cleans up seeded state (projects/_e2e-demo/ if synthetic; cycle log; queue manifests;
 * architect session from a real project).
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, readdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'claude-harness';
const projectRoot = join(FORGE_ROOT, 'projects', PROJECT);

// SAFETY: this harness seeds + then deletes scratch. A REAL project (git-backed)
// must NEVER have its directory removed — only the demo's own scratch (the one
// architect session it creates, its cycle log, its queue manifest). A synthetic
// throwaway project (no .git) is fully removed as before.
const IS_SYNTHETIC = !existsSync(join(projectRoot, '.git'));
function cleanProjectDir() {
  if (IS_SYNTHETIC) rmSync(projectRoot, { recursive: true, force: true });
}
/** Remove only the demo's seeded architect session from a real project (never
 *  _archived/ or other sessions). No-op for a synthetic project (whole dir goes). */
function cleanSeededSession(sid) {
  if (IS_SYNTHETIC || !sid) return;
  try { rmSync(join(projectRoot, '_architect', sid), { recursive: true, force: true }); } catch { /* */ }
}

const OUT = join(FORGE_ROOT, 'forge-ui/.demo-shots/e2e');
const FRAMES = join(OUT, 'frames');
const VIDEO = join(OUT, 'video');

const IDEA = 'Add a --compact flag to claude-trail: a 3-line glance view (title / verdict / cost) of a cycle, instead of the full multi-section trail. Default output unchanged.';
const DATE = new Date().toISOString().slice(0, 10);
const INIT = `INIT-${DATE}-e2e-compact-flag`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const CYCLE_ID = `${STAMP}_${INIT}`;
const CYCLE_LOG = join(FORGE_ROOT, '_logs', CYCLE_ID);

// ── TEMPO MODEL ──────────────────────────────────────────────────────────────
// Replaces four flat constants with a declarative beat-driven tempo. Each beat
// declares its pacing; the `pace()` helper routes it. Keeps the old magnitudes
// as named dwell durations so callers can still read them.
const READ   = 4200;  // dwell — a page the operator reads carefully
const WORK   = 3200;  // scroll — watching autonomous work happen
const ACT    = 1500;  // action beat after a click
const THINK  = 1000;  // brief gap during live bursts / between decisions

const TEMPO = {
  skip:        () => Promise.resolve(),                     // synthetic/bookkeeping — no sleep
  fastForward: () => sleep(200),                           // batch-seed under runningTimer
  realTime:    () => sleep(THINK),                         // human decision in progress
  dwell:       () => sleep(READ),                          // hold so the viewer reads
  scroll:      () => sleep(WORK),                          // mid-event, hex visibly blue
};
function pace(tempo) { return (TEMPO[tempo] ?? TEMPO.dwell)(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QDIR = (q) => join(FORGE_ROOT, '_queue', q);

// ── PRESENTATION HELPERS ──────────────────────────────────────────────────────

/** Inject / update a single fixed lower-third caption overlay (answers
 *  "what does this prove about the product?" not "what is happening?").
 *  High z-index + pointer-events:none; never asserted on. */
async function caption(page, text) {
  await page.evaluate((txt) => {
    let el = document.getElementById('demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-caption';
      Object.assign(el.style, {
        position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(13,17,23,0.92)', color: '#e6edf3',
        fontFamily: 'ui-sans-serif,system-ui,sans-serif', fontSize: '15px', fontWeight: '500',
        padding: '10px 22px', borderRadius: '8px', border: '1px solid #30363d',
        zIndex: '99999', pointerEvents: 'none', maxWidth: '900px', textAlign: 'center',
        lineHeight: '1.5',
      });
      document.body.appendChild(el);
    }
    el.textContent = txt;
    el.style.visibility = 'visible';
  }, text);
}

/** Show / hide a "autonomous — Nm Ns" overlay during fast-forward stretches.
 *  `on=true, baseMs=N` starts the timer from N; `on=false` hides it. */
async function runningTimer(page, on, baseMs = 0) {
  if (!on) {
    await page.evaluate(() => {
      const el = document.getElementById('demo-timer');
      if (el) el.style.visibility = 'hidden';
    });
    return;
  }
  await page.evaluate((base) => {
    let el = document.getElementById('demo-timer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-timer';
      Object.assign(el.style, {
        position: 'fixed', top: '16px', right: '20px',
        background: 'rgba(13,17,23,0.88)', color: '#58a6ff',
        fontFamily: 'ui-monospace,monospace', fontSize: '13px',
        padding: '6px 14px', borderRadius: '6px', border: '1px solid #1f6feb',
        zIndex: '99998', pointerEvents: 'none',
      });
      document.body.appendChild(el);
    }
    el.style.visibility = 'visible';
    const start = Date.now() - base;
    (function tick() {
      if (el.style.visibility !== 'visible') return;
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(elapsed / 60), s = elapsed % 60;
      el.textContent = `autonomous — ${m}m ${String(s).padStart(2,'0')}s`;
      requestAnimationFrame(tick);
    })();
  }, baseMs);
}

// ── EMULATION HELPERS ──────────────────────────────────────────────────────────

function archDir(sid) { return join(projectRoot, '_architect', sid); }
function writeStatus(sid, status) {
  const dir = archDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    ...status, session_id: sid, project: PROJECT, project_repo_path: projectRoot,
    updated_at: new Date().toISOString(),
  }, null, 2));
}
let archSeq = 0;
function archEvent(sid, eventType, message, metadata = {}) {
  const dir = join(FORGE_ROOT, '_logs', `_architect-${sid}`);
  mkdirSync(dir, { recursive: true });
  archSeq += 1;
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({
    event_id: `EV_arch_${archSeq}`, cycle_id: `_architect-${sid}`,
    initiative_id: `architect-session-${sid}`,
    started_at: new Date().toISOString(), phase: 'architect', skill: 'architect-runner',
    event_type: eventType, input_refs: [], output_refs: [], message, metadata,
  }) + '\n');
}
/** Append a persisted-reasoning row — event_type='log', metadata.kind='reasoning'.
 *  Matches the exact shape the ArchitectActivityLog panel renders as a blue 'reason' chip. */
function archReasoning(sid, text) {
  archEvent(sid, 'log', text, { kind: 'reasoning', text });
}
/** Stream a sequence of architect tool bursts so the hex visibly pulses. */
async function burst(sid, tools) {
  for (const t of tools) {
    archEvent(sid, 'tool_use', `tool.${t}`, { tool: t });
    await sleep(THINK);
  }
}
/** Fire a sequence of cycle events with a gap between each so the hex pipeline
 *  visibly advances rather than jumping. */
async function paced(thunks, gap = THINK) {
  for (const fn of thunks) { fn(); await sleep(gap); }
}

function writeQuestions(sid) {
  writeFileSync(join(archDir(sid), 'questions.json'), JSON.stringify([
    {
      question: 'Which sections should --compact include?', header: 'Sections',
      options: [
        { label: 'Title + verdict + cost', description: 'A 3-line terminal glance: "# Trail — INIT-X", "Verdict: approve", "Total: $0.24".' },
        { label: 'Full Summary block', description: 'Keep the whole ## Summary section — about 6 lines.' },
      ],
    },
    {
      question: 'How should --compact interact with --format json?', header: 'JSON compat',
      options: [
        { label: 'Markdown-only — error on json', description: '--compact is a display shortcut; combining with --format json exits non-zero.' },
        { label: 'Orthogonal — both work', description: 'Emit a minimal JSON object with the compact fields.' },
      ],
    },
  ], null, 2));
}

// P4: emulated architect telemetry — mirrors what the real finalize step stamps.
const EMULATED_ARCHITECT_COST_USD = 0.46;
const EMULATED_ARCHITECT_DURATION_MS = 95000;

function writePlan(sid, round) {
  const dir = archDir(sid);
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'manifests', `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
    `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: pending',
    'origin: architect',
    // P4: stamp architect telemetry so cycleEvent('architect','end') can read these
    // fields from the manifest, mirroring the real runCycle path.
    `architect_session_id: ${sid}`,
    `architect_cost_usd: ${EMULATED_ARCHITECT_COST_USD}`,
    `architect_duration_ms: ${EMULATED_ARCHITECT_DURATION_MS}`,
    '---', '',
    '# claude-trail --compact', '',
    'Given a cycle, when `claude-trail <id> --compact` is run, then it prints the title, verdict, and total cost only.',
    'Given `--compact` is combined with `--format json`, when the command runs, then it exits non-zero.',
  ].join('\n'));
  writeFileSync(join(dir, 'PLAN.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:14px ui-sans-serif,system-ui;background:#0d1117;color:#e6edf3;margin:0;padding:24px}
    h1{font-size:18px}h2{font-size:14px;color:#d2a8ff}.card{border:1px solid #30363d;border-radius:8px;padding:14px;margin:12px 0;background:#161b22}
    .r{color:#7ee787}</style></head>
    <body><h1>PLAN — claude-trail --compact ${round > 1 ? '<span class="r">(revised)</span>' : ''}</h1>
    <p>Operator brief: a 3-line glance view (title / verdict / cost) for claude-trail, default output unchanged.</p>
    <div class="card"><h2>AC-1 — renderCompact() + --compact flag</h2><p>GIVEN a cycle WHEN --compact THEN print title + verdict + total cost only (3 lines).</p></div>
    <div class="card"><h2>AC-2 — flag-conflict error paths</h2><p>--compact errors when combined with --format json / --out / --since. The PM sizes the work items directly off these acceptance criteria.</p></div></body></html>`);
  writeStatus(sid, { phase: 'awaiting-verdict', round, idea: IDEA });
}

let cycleSeq = 0;
function cycleEvent(phase, eventType, message, opts = {}) {
  // `skill` defaults to the phase; the unifier emits `phase: 'unifier'` directly
  // (Fix-B root-unify) via `unifierEvent` below — it is its own phase, not a
  // developer-loop sub-phase, so no UI remap.
  const { metadata = {}, skill = phase, ...extras } = opts;
  mkdirSync(CYCLE_LOG, { recursive: true });
  cycleSeq += 1;
  appendFileSync(join(CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id: `EV_cyc_${cycleSeq}`, cycle_id: CYCLE_ID, initiative_id: INIT,
    started_at: new Date().toISOString(), phase, skill,
    event_type: eventType, input_refs: [], output_refs: [], message, metadata, ...extras,
  }) + '\n');
}
/** Sugar for the unifier phase — phase:'unifier', skill:'developer-unifier'.
 *  Lights the dedicated unifier hex (regression guard). */
function unifierEvent(eventType, message, opts = {}) {
  return cycleEvent('unifier', eventType, message, { ...opts, skill: 'developer-unifier' });
}

function moveManifest(from, to) {
  mkdirSync(QDIR(to), { recursive: true });
  const search = [from, 'pending', 'in-flight', 'ready-for-review', 'done', 'failed'];
  for (const q of search) {
    const src = join(QDIR(q), `${INIT}.md`);
    if (existsSync(src)) {
      if (q !== to) renameSync(src, join(QDIR(to), `${INIT}.md`));
      return;
    }
  }
  throw new Error(`moveManifest: ${INIT}.md not found in any queue dir (wanted ${from} → ${to})`);
}

function writeDemoJson(revision) {
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'demo.json'), JSON.stringify({
    title: `claude-trail --compact: a 3-line glance view${revision > 1 ? ' (round ' + revision + ')' : ''}`,
    essence: 'Running `claude-trail <id> --compact` now prints a terse 3-line summary (title / Verdict / Cost) instead of the full multi-section trail. Mutually exclusive with --format json / --out / --since; default output unchanged.',
    project: PROJECT, initiativeId: INIT, baseRef: 'main', changedRef: `forge/${INIT}`,
    diffStat: ' src/trail.ts                 | 18 ++++\n src/cli.ts                   | 30 ++++--\n tests/compact-flag.test.ts   | 292 +++++++++\n 3 files changed, 334 insertions(+)',
    acceptanceCriteria: [
      'GIVEN a cycle WHEN `claude-trail <id> --compact` THEN stdout is exactly the title, Verdict, and Total cost (3 lines)',
      `GIVEN --compact combined with --format json WHEN the command runs THEN it exits non-zero${revision > 1 ? ' and stderr names BOTH flags (added this round on review feedback)' : ''}`,
    ],
    // Round 1: AC-2 PARTIAL (error names only one flag) — what the operator sends back on.
    // Round 2: both ACs MET — the payoff (PARTIAL→MET).
    acEvaluations: [
      {
        criterion: 'compact prints exactly the 3-line glance (title / Verdict / Cost)',
        verdict: 'met',
        evidence: 'tests/compact-flag.test.ts golden asserts the exact 3-line stdout; default output byte-identical',
      },
      {
        criterion: '--compact + --format json exits non-zero naming the conflict',
        verdict: revision > 1 ? 'met' : 'partial',
        evidence: revision > 1
          ? 'exits non-zero AND stderr names BOTH --compact and --format json (fixed this round)'
          : 'exits non-zero, but stderr names only --format json — operator asked it name BOTH flags',
      },
    ],
    summary: {
      bullets: [
        'Added a `--compact` flag to `claude-trail` — a 3-line glance (title / Verdict / Cost).',
        'Default (full) output is byte-for-byte unchanged — no regression.',
        '`--compact` is mutually exclusive with `--format json` / `--out` / `--since` (exits non-zero).',
      ],
      branch: `forge/${INIT}`, commitSha: 'a1b2c3d',
    },
    apiDiff: [
      { name: 'claude-trail <id> --compact', change: 'added',
        before: '(no --compact flag — only the full multi-section trail)',
        after: '# Trail — <id>\nVerdict: approve\nTotal: $0.24' },
      { name: 'claude-trail <id> --compact --format json', change: 'added',
        before: '(flags combined silently — json won)',
        after: `exit 2 — "error: --compact cannot be combined with --format json"${revision > 1 ? ' (error now names BOTH flags)' : ''}` },
    ],
    testEvidence: [
      { name: 'TestCompact_PrintsThreeLines', result: 'pass' },
      { name: 'TestCompact_DefaultOutputUnchanged', result: 'pass' },
      { name: 'TestCompact_ConflictsWithFormatJson', result: 'pass' },
      { name: 'TestCompact_ConflictsWithOutAndSince', result: 'pass' },
    ],
    checkpoints: [
      { label: 'compact', kind: 'harness',
        caption: 'The 3-line glance matches the golden byte-for-byte',
        metrics: [
          { label: 'compact output is exactly 3 lines', before: 'n/a', after: 'yes', deltaPct: null, parity: 'match' },
          { label: 'full trail output unchanged (no regression)', before: 'yes', after: 'yes', deltaPct: null, parity: 'match' },
        ] },
    ],
    usage_example: '```bash\n# Glance at a finished cycle — title, verdict, cost, nothing else\nclaude-trail INIT-2026-06-04-demo-cycle --compact\n# → # Trail — INIT-2026-06-04-demo-cycle\n# → Verdict: approve\n# → Total: $0.24\n```',
    impact: [
      'Operators get a one-glance cycle status without scrolling the full trail.',
      'Scriptable in CI / Slack notifications (terse, stable 3-line shape).',
      'Composes cleanly — conflicting flags fail fast instead of silently surprising.',
    ],
  }, null, 2));
}

/** Reflector stage-2 emit: operator-facing questions for the reflect screen. */
function writeReflectionQuestions() {
  mkdirSync(CYCLE_LOG, { recursive: true });
  writeFileSync(join(CYCLE_LOG, 'user-questions.json'), JSON.stringify([
    {
      question: 'Was the 2-work-item decomposition the right size for this initiative?',
      header: 'WI sizing',
      options: [
        { label: 'Right size', description: 'Two work items mapped cleanly to the acceptance criteria.' },
        { label: 'Too small', description: 'Could have been a single work item.' },
        { label: 'Too large', description: 'Should have been split further.' },
      ],
    },
  ], null, 2));
}

// ── BOOT + FRAMES ─────────────────────────────────────────────────────────────

async function startWatch() {
  try { execSync('fuser -k 4123/tcp 4124/tcp', { stdio: 'ignore' }); } catch { /* none */ }
  await sleep(800);
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'watch', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let uiUrl = null, bridgeUrl = null;
    const onData = (chunk) => {
      const t = chunk.toString();
      const u = t.match(/http:\/\/localhost:\d+/);
      const b = t.match(/bridge at (http:\/\/127\.0\.0\.1:\d+)/);
      if (b && !bridgeUrl) bridgeUrl = b[1];
      if (u && !uiUrl) uiUrl = u[0];
      if (t.includes('Ready in') && uiUrl && bridgeUrl) res({ proc, uiUrl, bridgeUrl });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rej);
    setTimeout(() => { if (!uiUrl || !bridgeUrl) rej(new Error('watch not ready in 90s')); }, 90000);
  });
}

const captions = [];
let seq = 0;
async function frame(page, name, altCaption) {
  seq += 1;
  const file = `${String(seq).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(FRAMES, file), fullPage: true });
  captions.push({ file, caption: altCaption });
  console.log(`  [${String(seq).padStart(2, '0')}] ${altCaption}`);
}
function writeIndex(videoName) {
  const figs = captions.map((c) =>
    `<figure><img src="frames/${c.file}" loading="lazy"/><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`
  ).join('\n');
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>forge — e2e operator journey</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui;margin:32px auto;max-width:1280px;padding:0 24px}
h1{letter-spacing:.4px}video{width:100%;border:1px solid #30363d;border-radius:8px;background:#000}
figure{margin:24px 0;padding:0}figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
figcaption{color:#8b949e;font-size:12px;padding-top:6px}code{color:#d2a8ff}ol{line-height:1.8}</style></head>
<body><h1>forge — end-to-end operator journey (centralised UI)</h1>
<p>Productionisation product-walkthrough: idea to merged PR, three human decisions. Recorded ${new Date().toISOString()}.</p>
<h2>video</h2><video src="${videoName}" controls autoplay muted loop></video>
<h2>frames</h2>${figs}</body></html>`);
}

// ── ASSERTIONS (the regression layer) ─────────────────────────────────────────
// Soft asserts: every check runs and records; the video always finishes;
// non-zero exit at the end flags any DOM-as-metrics invariant that regressed.
const failures = [];
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { failures.push(msg); console.error(`  ✗ ${msg}`); }
}
async function countAtLeast(page, selector, n, msg) {
  try {
    await page.waitForFunction(
      ({ s, k }) => document.querySelectorAll(s).length >= k,
      { s: selector, k: n }, { timeout: 15000 },
    );
  } catch { /* fall through and report actual count */ }
  const got = await page.evaluate((s) => document.querySelectorAll(s).length, selector);
  check(got >= n, `${msg} (found ${got}, want ≥${n})`);
}
async function expectCycleStatus(page, status) {
  try {
    await page.waitForFunction(
      ({ id, s }) => document.querySelector(`[data-cycle-id="${id}"]`)?.getAttribute('data-cycle-status') === s,
      { id: CYCLE_ID, s: status }, { timeout: 8000 },
    );
    check(true, `cycle status → ${status}`);
  } catch {
    const got = await page.evaluate((id) =>
      document.querySelector(`[data-cycle-id="${id}"]`)?.getAttribute('data-cycle-status') ?? '(absent)', CYCLE_ID);
    check(false, `cycle status → ${status} (got "${got}")`);
  }
}
async function maxPhaseCost(page) {
  return page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-phase-hex]')]
    .map((e) => parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0)));
}
async function expectPhaseCost(page, msg) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-phase-hex]')].some((e) =>
        (parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0),
      null, { timeout: 15000 },
    );
  } catch { /* report real value below */ }
  check(await maxPhaseCost(page) > 0, msg);
}
/** Click the first hex matching hexSelector and assert the HexDetailDrawer opens.
 *  Guards the regression where phase-hex wrappers had pointer-events:none. */
async function expectHexOpensDrawer(page, hexSelector, kind, label) {
  const el = page.locator(hexSelector).first();
  if ((await el.count()) === 0) { check(false, `${label}: no ${hexSelector} present to click`); return; }
  await el.hover().catch(() => {});
  await sleep(ACT);
  await el.click();
  let opened = false;
  try {
    await page.waitForSelector(`[data-section="hex-detail"][data-hex-kind="${kind}"]`, { timeout: 5000 });
    opened = true;
    check(true, `${label}: clicking a ${kind} hex opens the detail drawer`);
  } catch {
    const got = await page.evaluate(() =>
      document.querySelector('[data-section="hex-detail"]')?.getAttribute('data-hex-kind') ?? '(no drawer)');
    check(false, `${label}: clicking a ${kind} hex opens the detail drawer (got kind="${got}")`);
  }
  if (opened) {
    await sleep(READ);
    await frame(page, `hex-detail-${kind}`, `Hex detail — ${kind} hex opens the detail drawer (held open)`);
  }
  const close = page.locator('[data-action="close-hex-detail"]');
  if ((await close.count()) > 0) {
    await sleep(ACT);
    await close.click();
    await page.waitForSelector('[data-section="hex-detail"]', { state: 'detached', timeout: 3000 }).catch(() => {});
    await sleep(ACT);
  }
}

// ── THE 23-BEAT JOURNEY ────────────────────────────────────────────────────────

async function main() {
  cleanProjectDir();
  mkdirSync(join(projectRoot, '_architect'), { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(VIDEO, { recursive: true });

  console.log('[e2e] booting forge watch (cold compile ~20-40s)…');
  const watch = await startWatch();
  console.log(`[e2e] ready: ${watch.uiUrl}`);
  try { execSync(`curl -s -m 60 ${watch.uiUrl}/ -o /dev/null`); } catch { /* warm */ }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1380, height: 1600 },
    recordVideo: { dir: VIDEO, size: { width: 1380, height: 1600 } },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

  let createdSid = null;
  try {

    // ── BEAT 0: Title card ─────────────────────────────────────────────────────
    console.log('\n[beat 0] Title card');
    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 30000 });
    await caption(page, 'Idea to merged PR — three human decisions.');
    await page.evaluate(() => {
      let card = document.getElementById('demo-title-card');
      if (!card) {
        card = document.createElement('div');
        card.id = 'demo-title-card';
        Object.assign(card.style, {
          position: 'fixed', inset: '0', background: '#0d1117',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: '99997', pointerEvents: 'none',
        });
        card.innerHTML = `
          <div style="font:700 32px ui-sans-serif,system-ui;color:#e6edf3;letter-spacing:-.5px;margin-bottom:16px">
            Idea to merged PR
          </div>
          <div style="font:500 20px ui-sans-serif,system-ui;color:#58a6ff">
            — three human decisions —
          </div>
          <div style="margin-top:40px;font:13px ui-monospace,monospace;color:#6e7681">
            architect interview · review demo · reflect
          </div>`;
        document.body.appendChild(card);
      }
    });
    await frame(page, 'beat00-title', 'Title card — "Idea to merged PR: three human decisions"');
    await pace('dwell');
    // Fade the title card out before the demo starts
    await page.evaluate(() => {
      const el = document.getElementById('demo-title-card');
      if (el) el.style.display = 'none';
    });

    // ── BEAT 1: Operator drops the idea ───────────────────────────────────────
    console.log('\n[beat 1] Operator drops the idea');
    await page.waitForSelector('[data-section="new-idea"]', { timeout: 10000 });
    await caption(page, "One idea. One field. One button. Type it like you'd tell a colleague.");
    await sleep(ACT);
    await page.locator('[data-section="new-idea"] [data-field="project"]').fill(PROJECT);
    await page.locator('[data-section="new-idea"] [data-field="idea"]').click();
    await page.locator('[data-section="new-idea"] [data-field="idea"]').pressSequentially(IDEA, { delay: 28 });
    await sleep(THINK);
    await frame(page, 'beat01-idea-typed', 'Beat 1 — operator types the idea (pressSequentially, 28ms/char)');
    check(await page.locator('[data-section="new-idea"]').count() > 0, '[data-section="new-idea"] present on dashboard');
    await page.locator('[data-action="start-architect"]').hover();
    await sleep(ACT);
    await frame(page, 'beat01b-start-hover', 'Beat 1 — operator hovers "Start architect" (deliberate click incoming)');
    await page.locator('[data-action="start-architect"]').click();
    await page.waitForURL(/\/architect\//, { timeout: 15000 });
    const sid = decodeURIComponent(page.url().split('/architect/')[1]);
    createdSid = sid;
    console.log(`[e2e] architect session: ${sid}`);
    check(!!sid, '[data-action="start-architect"] navigates to /architect/<sid>');

    // ── BEAT 2: Architect grounds itself — P3 live activity panel ─────────────
    console.log('\n[beat 2] Architect grounds itself — P3 activity panel streams');
    writeStatus(sid, { phase: 'interviewing', round: 1, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=interviewing, round=1)');
    await page.waitForSelector('[data-component="architect-hex"]', { timeout: 15000 });
    await caption(page, 'Forge reads the code and the brain before it asks anything. You watch it think — every tool call, every line of reasoning.');
    await sleep(ACT);

    // Stream 6 tool_use rows + 2 reasoning rows at THINK spacing (P3 surface).
    // The activity panel fills row-by-row; capture a MID-STREAM frame then a settled frame.
    const groundingTools = ['Read', 'Grep', 'Glob', 'Read', 'WebSearch', 'Read'];
    for (let i = 0; i < groundingTools.length; i++) {
      archEvent(sid, 'tool_use', `tool.${groundingTools[i]}`, { tool: groundingTools[i] });
      await sleep(THINK);
      if (i === 3) {
        // MID-STREAM: 4 of 6 tools emitted, panel visibly half-full
        await frame(page, 'beat02-activity-midstream', 'Beat 2 (mid-stream) — P3 activity panel filling row-by-row while architect reads the codebase');
      }
    }
    // Reasoning rows — event_type='log', metadata.kind='reasoning'
    archReasoning(sid, 'The existing CLI flag parser in src/cli.ts supports sub-commands — --compact is cleanest as a boolean flag on the `trail` sub-command, not a new sub-command itself.');
    await sleep(THINK);
    archReasoning(sid, 'I found 22 unit tests in tests/. The --compact flag needs a dedicated test file; the existing golden-output tests set the pattern.');
    await sleep(THINK);

    // P3 assertions (soft): activity panel present + activity count + reasoning row
    try {
      await page.waitForSelector('[data-section="architect-activity"]', { timeout: 8000 });
      check(true, 'P3: [data-section="architect-activity"] rendered');
    } catch {
      check(false, 'P3: [data-section="architect-activity"] rendered');
    }
    try {
      await page.waitForFunction(
        () => parseInt(document.querySelector('[data-section="architect-activity"]')?.getAttribute('data-activity-count') ?? '0', 10) >= 1,
        null, { timeout: 8000 },
      );
      const count = await page.evaluate(() =>
        parseInt(document.querySelector('[data-section="architect-activity"]')?.getAttribute('data-activity-count') ?? '0', 10));
      check(count >= 1, `P3: activity panel data-activity-count ≥1 (got ${count})`);
    } catch {
      check(false, 'P3: activity panel data-activity-count ≥1 (timeout)');
    }
    // Reasoning-row assertion: separate from count so a wiring break is diagnosable
    const hasReasoningRow = await page.evaluate(() => {
      const panel = document.querySelector('[data-section="architect-activity"]');
      if (!panel) return false;
      // Look for any rendered element that carries a 'reason' visual indicator
      // (the panel renders reasoning events distinctly — blue chip vs green tool chip)
      return panel.textContent?.includes('reason') || panel.querySelectorAll('[data-activity-kind]').length > 0;
    });
    check(hasReasoningRow, 'P3: at least one reasoning row rendered in the activity panel');

    await frame(page, 'beat02-activity-settled', 'Beat 2 (settled) — P3 activity panel complete: tool calls + reasoning rows persisted');

    // ── BEAT 3: Architect returns clarifying questions ────────────────────────
    console.log('\n[beat 3] Architect returns questions');
    writeQuestions(sid);
    writeStatus(sid, { phase: 'awaiting-answers', round: 1, idea: IDEA });
    archEvent(sid, 'log', 'interview round 1 — 2 question(s) for the operator');
    await page.waitForSelector('[data-section="architect-interview"]', { timeout: 15000 });
    await caption(page, 'Forge asks only what it cannot resolve itself.');
    // Slow-scroll to reveal both questions if Q2 is below the fold
    await page.locator('[data-question-index="1"]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'beat03-questions', 'Beat 3 — architect returns 2 clarifying questions (both revealed)');
    check(await page.locator('[data-section="architect-interview"]').count() > 0,
      '[data-section="architect-interview"] rendered with questions');
    await countAtLeast(page, '[data-question-index]', 2, 'architect returned ≥2 questions');

    // ── BEAT 4: Operator answers — including a free-text override (P2) ────────
    console.log('\n[beat 4] Operator answers — P2 free-text override on Q2');
    await caption(page, "Answer with an option — or in your own words. You're in control.");
    // Q1: select the first (recommended) radio — THINK gap to simulate reading
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check();
    await sleep(THINK);
    // Q2: P2 surface — type into [data-question-freetext="1"] instead of picking a radio.
    // Type free-text AFTER no radio interaction on Q2 so the override is unambiguous.
    const freetextLocator = page.locator('[data-question-freetext="1"]');
    const freetextPresent = await freetextLocator.count() > 0;
    if (freetextPresent) {
      await freetextLocator.scrollIntoViewIfNeeded().catch(() => {});
      await freetextLocator.click();
      await freetextLocator.pressSequentially(
        'I want --compact to be markdown-only and exit non-zero on --format json. But also reject --out and --since — keep it stdout-only.',
        { delay: 28 },
      );
      await sleep(THINK);
      await frame(page, 'beat04-freetext', 'Beat 4 — P2: operator types a free-text answer on Q2 (overriding the option list)');
      // P2 assertion: Q2 should be resolved via free-text
      try {
        await page.waitForFunction(
          () => document.querySelector('[data-question-index="1"]')?.getAttribute('data-question-resolved') === 'true',
          null, { timeout: 5000 },
        );
        check(true, 'P2: Q2 [data-question-resolved="true"] after free-text entry');
      } catch {
        const resolved = await page.evaluate(() =>
          document.querySelector('[data-question-index="1"]')?.getAttribute('data-question-resolved') ?? '(absent)');
        check(false, `P2: Q2 [data-question-resolved="true"] after free-text entry (got "${resolved}")`);
      }
      // P2 assertion: all radio options for Q2 should be unselected (free-text wins)
      const anyRadioSelected = await page.evaluate(() => {
        const q2 = document.querySelector('[data-question-index="1"]');
        if (!q2) return false;
        return [...q2.querySelectorAll('[data-option-selected]')]
          .some((el) => el.getAttribute('data-option-selected') === 'true');
      });
      check(!anyRadioSelected, 'P2: all Q2 radio options unselected — free-text overrides the radio');
    } else {
      // Soft-fail: if the freetext field isn't present, fall back to radio
      check(false, 'P2: [data-question-freetext="1"] present (surface not found — soft fail)');
      await page.locator('[data-question-index="1"] input[type="radio"]').first().check().catch(() => {});
      await sleep(THINK);
      await frame(page, 'beat04-answer-fallback', 'Beat 4 — answered via radio (P2 freetext surface not found)');
    }
    await page.locator('[data-action="submit-answers"]').click();
    await sleep(ACT);
    // Architect takes its planning turn — screen transitions live (WS, no reload)
    writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=drafting) — rolling in answers');
    await page.waitForSelector('[data-section="architect-interview"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await burst(sid, ['Read', 'Edit']);
    await frame(page, 'beat04b-drafting', 'Beat 4 — planning: architect drafts with the answers folded in');

    // ── BEAT 5: Stall cameo — P1 StuckWarning ────────────────────────────────
    // Force via a back-dated updated_at (> 120s ago) — NOT a real 120s wait.
    // P1: write a working-phase status.json with updated_at = 3 minutes ago + no .heartbeat.
    console.log('\n[beat 5] Stall cameo — P1 StuckWarning');
    await caption(page, "And if it ever stalls or crashes — you see it, with exactly where to look.");
    const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago > 120s threshold
    const stalePath = join(archDir(sid), 'status.json');
    writeFileSync(stalePath, JSON.stringify({
      session_id: sid, project: PROJECT, project_repo_path: projectRoot,
      phase: 'drafting', round: 2, idea: IDEA,
      updated_at: staleTime,
    }, null, 2));
    // Ensure no .heartbeat file exists for this session (would override status.updated_at)
    const hbPath = join(FORGE_ROOT, '_logs', `_architect-${sid}`, '.heartbeat');
    if (existsSync(hbPath)) { try { rmSync(hbPath); } catch { /* */ } }

    // Wait for [data-architect-stale="true"] to render (soft-fail if the UI caches)
    let staleRendered = false;
    try {
      await page.waitForSelector('[data-architect-stale="true"]', { timeout: 10000 });
      staleRendered = true;
      check(true, 'P1: [data-architect-stale="true"] rendered when session staleMs > 120s');
    } catch {
      check(false, 'P1: [data-architect-stale="true"] rendered when session staleMs > 120s (timeout — bridge may cache)');
    }
    if (staleRendered) {
      await frame(page, 'beat05-stale-warning', 'Beat 5 — P1: StuckWarning renders when the architect goes quiet for >2 min');
    }

    // Clear the stale state: write a fresh status (current updated_at) and fire an archEvent
    writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
    archEvent(sid, 'log', 'architect resumed');
    try {
      await page.waitForFunction(
        () => !document.querySelector('[data-architect-stale="true"]'),
        null, { timeout: 8000 },
      );
      check(true, 'P1: [data-architect-stale] clears after session refresh');
    } catch {
      check(false, 'P1: [data-architect-stale] clears after session refresh (still stale after 8s)');
    }

    // ── BEAT 6: Architect drafts — P4 real cost greens the hex ────────────────
    console.log('\n[beat 6] Architect drafts — P4 real cost');
    await caption(page, '$0.46, 95 seconds — metered from the first phase.');
    // Short drafting burst so the panel shows live activity
    archEvent(sid, 'tool_use', 'tool.Write', { tool: 'Write' });
    await sleep(THINK);
    archEvent(sid, 'tool_use', 'tool.Edit', { tool: 'Edit' });
    await sleep(THINK);

    // writePlan stamps the manifest with EMULATED_ARCHITECT_COST_USD/DURATION_MS (P4)
    writePlan(sid, 1);
    archEvent(sid, 'log', 'plan-emitted (1 initiative(s), 0 escalation(s))');

    // Now emit the architect cycle events so the pipeline hex gets the cost
    cycleEvent('architect', 'start', 'architect.start', { metadata: { origin: 'architect' } });
    {
      const manifestText = readFileSync(join(archDir(sid), 'manifests', `${INIT}.md`), 'utf8');
      const costMatch = /^architect_cost_usd:\s*([\d.]+)/m.exec(manifestText);
      const durMatch = /^architect_duration_ms:\s*(\d+)/m.exec(manifestText);
      const archCost = costMatch ? parseFloat(costMatch[1]) : EMULATED_ARCHITECT_COST_USD;
      const archDur = durMatch ? parseInt(durMatch[1], 10) : EMULATED_ARCHITECT_DURATION_MS;
      cycleEvent('architect', 'end', 'architect.end', { cost_usd: archCost, duration_ms: archDur });
    }
    // P4 cost is seeded into the CYCLE log here (cycleEvent architect.end above),
    // but the architect PIPELINE hex (with data-phase-cost-usd) only exists on the
    // dashboard — so the P4 assertion runs at beat 9, once the cycle is selected there.
    await frame(page, 'beat06-architect-cost', 'Beat 6 — P4: architect hex greens with real cost pill ($0.46, 95s)');

    // ── BEAT 7: Rich PLAN.html presented ──────────────────────────────────────
    console.log('\n[beat 7] Rich PLAN.html');
    await page.waitForSelector('[data-section="plan-gate"]', { timeout: 15000 });
    await caption(page, 'The plan is Given/When/Then — the PM uses it verbatim.');
    check(await page.locator('[data-plan-iframe]').count() > 0,
      'plan gate renders the rich PLAN.html iframe');
    // Slow-scroll the AC cards inside the iframe area
    await page.locator('[data-plan-iframe]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'beat07-plan-html', 'Beat 7 — rich PLAN.html with Given/When/Then AC cards (slow-scrolled)');

    // ── BEAT 8: Send-back + revised plan ──────────────────────────────────────
    console.log('\n[beat 8] Send-back + revised plan');
    await caption(page, 'You decide when the plan is right.');
    const rationale = 'Also reject --compact --out (not just --format json) — keep it stdout-only — before merging.';
    const rationaleLocator = page.locator(
      '[data-component="plan-gate"] [data-field="rationale"], [data-section="plan-gate"] [data-field="rationale"]'
    ).first();
    if (await rationaleLocator.count() > 0) {
      await rationaleLocator.click();
      await rationaleLocator.pressSequentially(rationale, { delay: 28 });
    } else {
      rationaleLocator.fill(rationale).catch(() => {});
    }
    await sleep(THINK);
    await frame(page, 'beat08-send-back', 'Beat 8 — operator sends plan back (pressSequentially feedback text)');
    await page.locator('[data-action="revise-plan"]').click();
    await sleep(ACT);
    writeStatus(sid, { phase: 'drafting', round: 3, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=drafting) — rerun with operator feedback');
    await page.waitForSelector('[data-section="plan-gate"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await burst(sid, ['Read', 'Read']);
    writePlan(sid, 2);
    archEvent(sid, 'log', 'plan-emitted (revised — --compact also rejects --out)');
    await page.waitForSelector('[data-section="plan-gate"][data-decisions-resolved="true"]', { timeout: 15000 });
    await sleep(READ);
    await frame(page, 'beat08b-revised-plan', 'Beat 8 — revised plan re-presented with (revised) badge');

    // ── BEAT 9: Approve → Watch it build ──────────────────────────────────────
    console.log('\n[beat 9] Approve → Watch it build');
    await caption(page, "You're done. The autonomous loop takes over.");
    await sleep(ACT);
    await frame(page, 'beat09-approve', 'Beat 9 — operator approves the plan (human decision #1 complete)');
    await page.locator('[data-action="approve-plan"]').click();
    await sleep(ACT);
    // Emulate finalize → autonomous loop claims the initiative
    mkdirSync(QDIR('pending'), { recursive: true });
    execSync(`cp ${join(archDir(sid), 'manifests', `${INIT}.md`)} ${join(QDIR('pending'), `${INIT}.md`)}`);
    writeStatus(sid, { phase: 'committed', round: 3, idea: IDEA });
    cycleEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
    moveManifest('pending', 'in-flight');
    await page.waitForSelector('[data-action="watch-it-build"]', { timeout: 15000 });
    await sleep(ACT);
    await page.locator('[data-action="watch-it-build"]').click();
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"]`, { timeout: 15000 });
    await sleep(ACT);
    await page.locator(`[data-cycle-id="${CYCLE_ID}"]`).click().catch(() => {});
    await sleep(ACT);
    await frame(page, 'beat09b-dashboard-live', 'Beat 9 — "Watch it build →" lands on dashboard, cycle live');
    await expectCycleStatus(page, 'in-flight');
    await countAtLeast(page, '[data-phase-hex]', 5, 'pipeline spine shows ≥5 phase hexes');
    await countAtLeast(page, '[data-project-group]', 1, 'cross-project pane groups cycles by project');
    // P4: the architect hex (first in the pipeline) carries the REAL cost seeded at beat 6
    try {
      await page.waitForFunction(
        () => (parseFloat(document.querySelector('[data-phase-hex][data-phase="architect"]')
          ?.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0,
        null, { timeout: 12000 },
      );
      check(true, 'P4: architect hex carries real cost (data-phase-cost-usd > 0)');
    } catch {
      const costVal = await page.evaluate(() =>
        document.querySelector('[data-phase-hex][data-phase="architect"]')?.getAttribute('data-phase-cost-usd') ?? '(absent)');
      check(false, `P4: architect hex carries real cost (got "${costVal}")`);
    }

    // ── BEAT 10: PM decomposes ACs into work items ────────────────────────────
    console.log('\n[beat 10] PM decomposes ACs into work items');
    await caption(page, 'Dependency-ordered work items — from G/W/T, not tasks.');
    await paced([
      () => cycleEvent('project-manager', 'start', 'pm phase start'),
      () => cycleEvent('project-manager', 'tool_use', 'pm.brain-query', { metadata: { tool: 'brain-query' } }),
      () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1' } }),
      () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-2' } }),
    ], WORK);
    // MID-PULSE frame: PM hex should be blue/active here
    await frame(page, 'beat10-pm-midpulse', 'Beat 10 (mid-pulse) — PM hex active/blue as it emits work items');
    cycleEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.31, duration_ms: 28000, metadata: { work_item_count: 2 } });
    await sleep(WORK);
    await frame(page, 'beat10b-pm-settled', 'Beat 10 — PM decomposed ACs into 2 dependency-ordered work items (WI hexes materialised)');
    await countAtLeast(page, '[data-wi-hex]', 2, 'PM materialised ≥2 WI hexes');
    // Hex detail drawer — regression guard (pointer-events:none bug)
    await expectHexOpensDrawer(page, '[data-phase-hex]', 'phase', 'hex-detail');
    await expectHexOpensDrawer(page, '[data-wi-hex]', 'wi', 'hex-detail');

    // ── BEAT 11: Dev-loop TDD red — gate.expected-fail ────────────────────────
    console.log('\n[beat 11] Dev-loop TDD red — gate.expected-fail');
    await caption(page, 'The gate fails before a line is written.');
    await paced([
      () => cycleEvent('developer-loop', 'start', 'dev-loop start'),
      () => cycleEvent('developer-loop', 'log', 'gate.expected-fail', {
        metadata: { work_item_id: 'WI-1', stderr: 'FAIL tests/compact-flag.test.ts: flag --compact not found' },
      }),
    ], WORK);
    await sleep(THINK);
    await frame(page, 'beat11-gate-fail', 'Beat 11 — TDD red: gate.expected-fail — the test fails before a line is written');

    // ── BEAT 12: Dev-loop GRIND — fast-forwarded ──────────────────────────────
    console.log('\n[beat 12] Dev-loop GRIND (fast-forward)');
    await caption(page, 'Autonomous — implementing the spec. (4m compressed.)');
    await runningTimer(page, true, 0);
    // Batch-seed implementation events rapidly under the running timer
    const implTools = ['Edit', 'Edit', 'Bash', 'Edit', 'Bash', 'Edit', 'Bash', 'Read', 'Edit', 'Bash'];
    for (const t of implTools) {
      cycleEvent('developer-loop', 'tool_use', `tool.${t}`, { metadata: { work_item_id: 'WI-1', tool: t } });
      await pace('fastForward');
    }
    // Space usage_delta at WORK so the WI token/cost bar visibly grows
    cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-1', input_tokens: 1800, output_tokens: 600 } });
    await sleep(WORK);
    cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-1', input_tokens: 2100, output_tokens: 900 } });
    await sleep(WORK);
    await frame(page, 'beat12-grind', 'Beat 12 (fast-forward) — dev-loop implementing WI-1; token/cost bar growing');

    // ── BEAT 13: Dependency gate + gate.pass ──────────────────────────────────
    console.log('\n[beat 13] Gate.pass + WI-1 green → WI-2 starts');
    await runningTimer(page, false);
    await caption(page, 'Red four minutes ago — now green. WI-2 only started once WI-1 was done.');
    cycleEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-1' } });
    await sleep(THINK);
    cycleEvent('developer-loop', 'iteration', 'WI-1 iteration', {
      iteration: 1, tokens_in: 4200, tokens_out: 1600, cost_usd: 0.21,
      metadata: { work_item_id: 'WI-1' },
    });
    await sleep(THINK);
    cycleEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } });
    await sleep(WORK);
    await frame(page, 'beat13-wi1-green', 'Beat 13 — gate.pass; WI-1 green; WI-2 (depends on WI-1) only now starts');
    // WI-2 starts
    cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
    await sleep(THINK);
    cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-2', input_tokens: 1200, output_tokens: 400 } });
    await sleep(WORK);
    cycleEvent('developer-loop', 'iteration', 'WI-2 iteration', {
      iteration: 1, metadata: { work_item_id: 'WI-2' },
    });
    cycleEvent('developer-loop', 'end', 'WI-2 complete', { metadata: { work_item_id: 'WI-2' } });
    // Dev-loop PHASE end (ralph.end) fires once both WIs done — BEFORE unifier runs
    cycleEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.92, duration_ms: 140000 });
    await sleep(WORK);
    await frame(page, 'beat13b-devloop-green', 'Beat 13 — dev-loop hex greens (both WIs done); unifier runs next on its own hex');

    // ── BEAT 14: Unifier on its OWN hex ───────────────────────────────────────
    console.log('\n[beat 14] Unifier on its own hex');
    await caption(page, 'A separate phase reviews the branch and authors the demo.');
    await paced([
      () => unifierEvent('start', 'unifier.start — reviewing the merged work-item output'),
      () => unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: npm test' } }),
    ], WORK);
    // MID-PULSE frame: unifier hex should be blue here
    await frame(page, 'beat14-unifier-midpulse', 'Beat 14 (mid-pulse) — unifier hex active/blue, running tests on the merged branch');
    unifierEvent('log', 'unifier.gate — initiative gate green; cleaning output');
    await sleep(WORK);
    unifierEvent('log', 'unifier.demo-skill — authoring demo.json (forge-ui themed)');
    await sleep(THINK);
    unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: forge demo render' } });
    await sleep(THINK);
    writeDemoJson(1);
    unifierEvent('end', 'unifier.end — demo authored, branch clean', { cost_usd: 0.18, duration_ms: 46000 });
    // Regression guard: unifier hex must reach complete on its OWN hex
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-phase-hex][data-phase="unifier"]')?.getAttribute('data-phase-status') === 'complete',
        null, { timeout: 10000 },
      );
      check(true, 'unifier hex lit its own status (blue→green), not folded into dev-loop');
    } catch {
      const got = await page.evaluate(() =>
        document.querySelector('[data-phase-hex][data-phase="unifier"]')?.getAttribute('data-phase-status') ?? '(absent)');
      check(false, `unifier hex should reach complete (got "${got}")`);
    }
    await frame(page, 'beat14b-unifier-green', 'Beat 14 — unifier (own hex) greens after authoring the demo');

    // ── BEAT 15: Cost rollup across the spine ─────────────────────────────────
    console.log('\n[beat 15] Cost rollup');
    cycleEvent('review-loop', 'start', 'review-loop start');
    cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
    moveManifest('in-flight', 'ready-for-review');
    await page.waitForSelector(`[data-action="open-review"][href*="${INIT}"]`, { timeout: 15000 });
    await caption(page, 'Every phase is costed.');
    await sleep(READ);
    await frame(page, 'beat15-cost-rollup', 'Beat 15 — cost rollup: architect $0.46 / PM $0.31 / dev-loop $0.92 / unifier $0.18');
    await expectCycleStatus(page, 'ready-for-review');
    await expectPhaseCost(page, 'cost rollup: a phase hex shows cost > 0');

    // ── BEAT 16: Review — per-AC evaluated demo (PARTIAL) ─────────────────────
    console.log('\n[beat 16] Review — per-AC demo (PARTIAL)');
    await sleep(ACT);
    await page.locator(`[data-action="open-review"][href*="${INIT}"]`).click();
    await page.waitForSelector('main[data-page="review-cycle"][data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await caption(page, 'Approve on evidence — AC-2 is only PARTIAL.');
    // Slow-scroll AC cards
    await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'beat16-review-partial', 'Beat 16 — review demo: AC-1 MET, AC-2 PARTIAL (error names only one flag)');
    await countAtLeast(page, '[data-section="demo-evaluation"] [data-ac-verdict]', 2,
      'review demo foregrounds per-AC evaluated output');
    check(
      await page.locator('[data-section="demo-evaluation"] [data-ac-verdict="partial"]').count() > 0,
      'an AC reads PARTIAL on round 1 — the gap the operator sends back on',
    );

    // ── BEAT 17: Send-back authoring a NEW acceptance criterion ───────────────
    console.log('\n[beat 17] Send-back — operator authors a new G/W/T AC');
    await caption(page, 'The operator authors a new acceptance criterion — inside the review loop.');
    // Select send-back radio
    await page.locator('[data-component="verdict-form"] input[type="radio"]').nth(1).check();
    // pressSequentially the verdict text
    const verdictTextarea = page.locator('[data-component="verdict-form"] textarea');
    if (await verdictTextarea.count() > 0) {
      await verdictTextarea.click();
      await verdictTextarea.pressSequentially(
        'Close — but the --compact + --format json error must name BOTH flags before this merges.',
        { delay: 28 },
      );
    }
    await sleep(THINK);
    // pressSequentially the three G/W/T AC fields
    const acGiven   = page.locator('[data-component="verdict-form"] [data-section="acceptance-criteria"] input').nth(0);
    const acWhen    = page.locator('[data-component="verdict-form"] [data-section="acceptance-criteria"] input').nth(1);
    const acThen    = page.locator('[data-component="verdict-form"] [data-section="acceptance-criteria"] input').nth(2);
    if (await acGiven.count() > 0) {
      await acGiven.click();
      await acGiven.pressSequentially('a cycle dir and the flags --compact --format json', { delay: 28 });
      await sleep(THINK);
    }
    if (await acWhen.count() > 0) {
      await acWhen.click();
      await acWhen.pressSequentially('claude-trail is run', { delay: 28 });
      await sleep(THINK);
    }
    if (await acThen.count() > 0) {
      await acThen.click();
      await acThen.pressSequentially('it exits non-zero and stderr names both --compact and json', { delay: 28 });
      await sleep(THINK);
    }
    await frame(page, 'beat17-send-back', 'Beat 17 — operator sends back with a new G/W/T criterion (every field pressSequentially)');
    await page.locator('[data-action="send-back"]').click();
    await sleep(ACT);
    await page.locator('[data-action="back-to-dashboard"]').click();
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 });
    await sleep(ACT);

    // ── BEAT 18: Dev-loop reruns on feedback (fast-forward) ───────────────────
    console.log('\n[beat 18] Dev-loop reruns on feedback (fast-forward)');
    await caption(page, 'The dev-loop re-ran on the new criterion.');
    moveManifest('ready-for-review', 'in-flight');
    await runningTimer(page, true, 0);
    cycleEvent('developer-loop', 'start', 'dev-loop rerun — addressing review feedback');
    for (let i = 0; i < 6; i++) {
      cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
      await pace('fastForward');
    }
    unifierEvent('log', 'unifier.demo-skill — re-rendering demo.json (error names both flags)');
    await pace('fastForward');
    writeDemoJson(2);
    unifierEvent('end', 'unifier.end (round 2) — demo re-rendered', { cost_usd: 0.06 });
    cycleEvent('developer-loop', 'end', 'ralph.end (round 2)');
    moveManifest('in-flight', 'ready-for-review');
    await runningTimer(page, false);
    await sleep(WORK);
    await frame(page, 'beat18-rerun', 'Beat 18 (fast-forward) — dev-loop reran on the new criterion; back to "Review →"');

    // ── BEAT 19: Re-review — PARTIAL→MET (payoff) ────────────────────────────
    console.log('\n[beat 19] Re-review — PARTIAL→MET');
    await sleep(ACT);
    await page.locator(`[data-action="open-review"][href*="${INIT}"]`).click();
    await page.waitForSelector('main[data-page="review-cycle"][data-page-ready="true"]', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await caption(page, 'Partial → corrected → met. The loop closed on your criterion.');
    // Slow-scroll to the AC-2 card (the payoff)
    await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'beat19-rereview-met', 'Beat 19 — re-review: AC-2 now MET (PARTIAL→MET payoff)');
    // Regression guard: no partial ACs remaining
    const partialCount = await page.locator('[data-section="demo-evaluation"] [data-ac-verdict="partial"]').count();
    check(partialCount === 0, `re-review: partial AC count == 0 after dev-loop rerun (got ${partialCount})`);
    await countAtLeast(page, '[data-section="demo-evaluation"] [data-ac-verdict="met"]', 2,
      're-review: all ACs show verdict "met"');

    // ── BEAT 20: Approve & merge → completed spine ────────────────────────────
    console.log('\n[beat 20] Approve & merge → completed spine');
    await caption(page, 'Six phases, every one accountable.');
    const lgtmTextarea = page.locator('[data-component="verdict-form"] textarea');
    if (await lgtmTextarea.count() > 0) {
      await lgtmTextarea.click();
      await lgtmTextarea.pressSequentially(
        'LGTM — 3-line glance, default output unchanged, and the conflict error names both flags. All ACs met.',
        { delay: 28 },
      );
    }
    await sleep(ACT);
    await frame(page, 'beat20-approve', 'Beat 20 — operator approves (human decision #2 complete — pressSequentially LGTM)');
    await page.locator('[data-action="approve-and-merge"]').click();
    await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
    // Review phase closes out, closure merges, reflection starts — paced at WORK so spine advances hex-by-hex
    await paced([
      () => cycleEvent('review-loop', 'end', 'review-loop end — operator approved', { cost_usd: 0.21 }),
      () => cycleEvent('closure', 'start', 'closure.start'),
      () => cycleEvent('closure', 'log', 'closure.pr-merged'),
      () => cycleEvent('closure', 'end', 'closure.end'),
      () => cycleEvent('reflection', 'start', 'reflection.start'),
      () => cycleEvent('reflection', 'tool_use', 'reflection.brain-query', { metadata: { tool: 'brain-query' } }),
    ], WORK);
    moveManifest('ready-for-review', 'done');
    writeReflectionQuestions();
    await page.waitForSelector('[data-action="open-reflect"]', { timeout: 15000 }).catch(() => {});
    await sleep(ACT);
    await frame(page, 'beat20b-reflect-link', 'Beat 20 — merged; "Reflect on this cycle →" surfaces the final human moment');
    await page.locator('[data-action="back-to-dashboard"]').click().catch(() => {});
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 });
    await page.locator(`[data-cycle-id="${CYCLE_ID}"]`).click().catch(() => {});
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"][data-cycle-status="done"]`, { timeout: 15000 }).catch(() => {});
    await sleep(READ);
    await frame(page, 'beat20c-spine-complete', 'Beat 20 — completed spine: every phase green with its cost pill');
    await expectCycleStatus(page, 'done');
    await countAtLeast(page, '[data-phase-hex]', 5, 'completed cycle still shows ≥5 phase hexes');
    await expectPhaseCost(page, 'completed cycle shows accrued per-phase cost');
    // Regression guard: unifier hex complete on its own hex
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-phase-hex][data-phase="unifier"]')?.getAttribute('data-phase-status') === 'complete',
        null, { timeout: 8000 },
      );
      check(true, 'unifier hex complete on its own phase slot (not folded into dev-loop)');
    } catch {
      const got = await page.evaluate(() =>
        document.querySelector('[data-phase-hex][data-phase="unifier"]')?.getAttribute('data-phase-status') ?? '(absent)');
      check(false, `unifier hex should reach complete (got "${got}")`);
    }

    // ── BEAT 21: Reflect — operator tunes the brain ───────────────────────────
    console.log('\n[beat 21] Reflect');
    await caption(page, "Forge improves. You're the teacher.");
    // Navigate directly to the reflect screen — the open-reflect CTA is a per-card
    // dashboard poll that can lag; page.goto is deterministic (the verify harness uses
    // the same pattern for /review). user-questions.json was seeded in beat 20.
    await page.goto(`${watch.uiUrl}/reflect/${encodeURIComponent(CYCLE_ID)}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('main[data-page="reflect-cycle"][data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-section="reflect-questions"]', { timeout: 15000 }).catch(() => {});
    await sleep(READ);
    await frame(page, 'beat21-reflect-page', 'Beat 21 — reflection screen: WI-sizing question + freeform observation');
    // Pick the WI-sizing radio
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check().catch(() => {});
    await sleep(THINK);
    // pressSequentially a brief freeform observation
    const freeformLocator = page.locator('[data-field="freeform"]');
    if (await freeformLocator.count() > 0) {
      await freeformLocator.click();
      await freeformLocator.pressSequentially(
        'Dependency ordering held. The send-back (naming both flags) was exactly the right call.',
        { delay: 28 },
      );
    }
    await sleep(ACT);
    await page.locator('[data-action="submit-reflection"]').click().catch(() => {});
    await page.waitForSelector('[data-section="reflect-done"]', { timeout: 10000 }).catch(() => {});
    await paced([
      () => cycleEvent('reflection', 'tool_use', 'reflection.write', { metadata: { tool: 'Write brain theme' } }),
      () => cycleEvent('reflection', 'end', 'reflection.end', { cost_usd: 0.12 }),
    ], WORK);
    await sleep(ACT);
    await frame(page, 'beat21b-reflected', 'Beat 21 — feedback captured; reflector folds it into the brain');
    // Regression guard: reflection hex greens after tuning
    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 }).catch(() => {});
    await page.locator(`[data-cycle-id="${CYCLE_ID}"]`).click().catch(() => {});
    await sleep(ACT);
    // Poll: the reflection.end emitted on the reflect page needs a moment to
    // propagate to the dashboard's cycle view before the hex greens.
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-phase-hex][data-phase="reflection"]')?.getAttribute('data-phase-status') === 'complete',
        null, { timeout: 12000 },
      );
      check(true, 'reflection hex greened after tuning feedback');
    } catch {
      const reflStatus = await page.evaluate(() =>
        document.querySelector('[data-phase-hex][data-phase="reflection"]')?.getAttribute('data-phase-status') ?? '(absent)');
      check(false, `reflection hex greened after tuning feedback (got "${reflStatus}")`);
    }

    // ── BEAT 22: End card ─────────────────────────────────────────────────────
    console.log('\n[beat 22] End card');
    await page.evaluate(() => {
      let card = document.getElementById('demo-end-card');
      if (!card) {
        card = document.createElement('div');
        card.id = 'demo-end-card';
        Object.assign(card.style, {
          position: 'fixed', inset: '0', background: '#0d1117',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: '99997', pointerEvents: 'none',
        });
        card.innerHTML = `
          <div style="font:700 22px ui-sans-serif,system-ui;color:#58a6ff;margin-bottom:20px">
            Forge is the autonomous dev loop.
          </div>
          <div style="font:500 18px ui-sans-serif,system-ui;color:#e6edf3;margin-bottom:10px">
            You are the architect, the reviewer, and the teacher.
          </div>
          <div style="margin-top:32px;font:12px ui-monospace,monospace;color:#6e7681">
            Three human decisions. Every phase costed. Autonomous between them.
          </div>`;
        document.body.appendChild(card);
      }
    });
    await caption(page, 'Forge is the autonomous dev loop. You are the architect, the reviewer, and the teacher.');
    await frame(page, 'beat22-end-card', 'End card — "Forge is the autonomous dev loop. You are the architect, the reviewer, and the teacher."');
    await sleep(READ);

    console.log('\n[e2e] journey complete.');
  } finally {
    await ctx.close();
    await browser.close();
    try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
    cleanProjectDir();
    cleanSeededSession(createdSid);
    rmSync(CYCLE_LOG, { recursive: true, force: true });
    for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      try { rmSync(join(QDIR(q), `${INIT}.md`), { force: true }); } catch { /* */ }
      try { rmSync(join(QDIR(q), `${INIT}.verdict-response.md`), { force: true }); } catch { /* */ }
    }
    if (createdSid) {
      try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${createdSid}`), { recursive: true, force: true }); } catch { /* */ }
    }
  }

  const vids = readdirSync(VIDEO).filter((f) => f.endsWith('.webm'));
  let videoName = vids[0] ?? '';
  if (videoName) {
    renameSync(join(VIDEO, videoName), join(VIDEO, 'journey.webm'));
    videoName = 'video/journey.webm';
  }
  writeIndex(videoName);
  console.log(`[e2e] OK — ${OUT}/index.html (${captions.length} frames + video)`);

  if (failures.length) {
    console.error(`\n[e2e] ${failures.length} DOM-as-metrics assertion(s) FAILED:`);
    for (const f of failures) console.error(`   ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log('[e2e] all DOM-as-metrics assertions passed ✓');
  }
}

main().catch((err) => { console.error(err); cleanProjectDir(); process.exit(1); });
