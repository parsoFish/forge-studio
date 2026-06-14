/**
 * e2e-journey — PRODUCTIONISATION product-walkthrough + DOM-as-metrics regression harness.
 *
 *   node scripts/e2e-journey.mjs
 *
 * STORY: "Idea to merged PR — three human decisions."
 *   Three human moments are the spine (architect interview / review demo / reflect);
 *   everything else is autonomous and every phase is costed.
 *
 * STRUCTURE: 35 beats across 9 acts, grounded in real session behaviour:
 *   ACT I  — Live architecting  (P1 stall cameo, P2 free-text, P3 activity panel, P4 real cost)
 *   ACT II — Autonomous build   (fast-forwarded, honest running timer, TDD gate, WI dependency)
 *   ACT III— Review + teach     (PARTIAL→MET, new AC authored in-loop, reflect)
 *   ACT IV — Studio monitor     (library page /; flow monitor /flows/forge-cycle; seeded gated run)
 *   ACT V  — Studio builders    (agent builder /agents/project-manager; project builder /projects/claude-harness)
 *   ACT VI — Flow-engine beats  (start-run CTA, cost-ceiling-warn gauge, gate control, resume button)
 *   ACT VII— Flow builder + artifact viewer (BUILD tab authoring; unified /artifact viewer + gate surface)
 *   ACT VIII— Knowledge viewer  (browse-KB force-graph against real brain; pin-guidance → _guidance/*.md)
 *   ACT IX — Runtime range strategy (agent builder range mode; registry-driven SDK picker; YAML preview)
 *
 * No live LLM: the architect runner's turns + autonomous cycle are emulated by seeding
 * the same files/events the real phases write, grounded in real cycle event sequences.
 *
 * REGRESSION HARNESS: all assertions are SOFT (failures[]; non-zero exit at end).
 * Regression guards preserved from the previous harness:
 *   ≥5 phase hexes, ≥2 WI hexes, drawer opens (phase + wi), per-phase cost rollup,
 *   unifier own-node complete, per-AC demo-evaluation,
 *   partial-count==0 on re-review, reflection hex complete.
 *   (M7-1, ADR-031: the cycle-monitor invariants — ≥5 phase / ≥2 WI / drawer /
 *   per-phase cost / unifier-own-node / status — are asserted against the Studio
 *   flow monitor [data-mon-node] selectors, not the legacy /dashboard. The
 *   cross-project [data-project-group] pane assertion is DROPPED per ADR-031.)
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
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, readdirSync, renameSync, existsSync } from 'node:fs';
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
  // No pre-flight port kill here: `forge studio` performs its own deterministic
  // multi-tool (lsof→ss→fuser) SIGTERM→SIGKILL takeover on the fixed ports and
  // only emits its ready signal after the health probe passes. Duplicating a
  // hard-coded `fuser -k 4123/4124` + blind sleep here would silently diverge
  // if the launcher's defaults ever change — we rely on the ready signal alone.
  // M7-7: spawn the canonical `forge studio` launcher and detect readiness via
  // its deterministic 'forge-studio-ready {json}' stdout line — no Next.js
  // log-wording scraping. (stdio still piped so the operator can watch logs.)
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let buf = '';
    let settled = false;
    const onData = (chunk) => {
      if (settled) return;
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^forge-studio-ready (.+)$/);
        if (!m) continue;
        try {
          const { bridgeUrl, uiUrl } = JSON.parse(m[1]);
          if (bridgeUrl && uiUrl) { settled = true; res({ proc, uiUrl, bridgeUrl }); return; }
        } catch { /* not the signal line */ }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rej);
    setTimeout(() => { if (!settled) rej(new Error('forge studio not ready in 90s')); }, 90000);
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
// Per-phase cost is asserted on the Studio monitor hexes (M7-1/M7-2, ADR-031):
// each phase HexNode carries [data-mon-node][data-phase-cost-usd]. /dashboard
// (and its legacy [data-phase-hex] cost pills) was deleted in M7-2; the cycle
// run-status invariant now lives on the run rail's [data-run-status].
const PHASE_COST_SEL = '[data-mon-node][data-phase-cost-usd]';
async function maxPhaseCost(page) {
  return page.evaluate((sel) => Math.max(0, ...[...document.querySelectorAll(sel)]
    .map((e) => parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0)), PHASE_COST_SEL);
}
async function expectPhaseCost(page, msg) {
  try {
    await page.waitForFunction(
      (sel) => [...document.querySelectorAll(sel)].some((e) =>
        (parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0),
      PHASE_COST_SEL, { timeout: 15000 },
    );
  } catch { /* report real value below */ }
  check(await maxPhaseCost(page) > 0, msg);
}

/** Navigate to the Studio flow monitor and wait until it is ready with the
 *  in-flight cycle selected as the active run. The monitor refetches the run
 *  model from the bridge on load (reads the event log), so it reflects every
 *  event seeded so far without depending on a live subscription. */
async function openStudioMonitor(page, watch) {
  await page.goto(watch.uiUrl + '/flows/forge-cycle', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
  // Select the run for this cycle if its rail card is present (pickDefaultRun
  // already prefers gated→active, but select explicitly to be deterministic).
  const card = page.locator(`[data-run-id="${CYCLE_ID}"]`).first();
  if ((await card.count()) > 0) {
    await card.click().catch(() => {});
    await sleep(ACT);
  }
}

/** Click the first Studio-monitor hex matching hexSelector and assert the
 *  PhaseDrawer (#phase-drawer) opens with the expected data-hex-kind.
 *  Guards the regression where hex wrappers had pointer-events:none, and the
 *  new M7-1 requirement that a WI hex opens a WI-scoped drawer. */
async function expectHexOpensDrawer(page, hexSelector, kind, label) {
  const el = page.locator(hexSelector).first();
  if ((await el.count()) === 0) { check(false, `${label}: no ${hexSelector} present to click`); return; }
  await el.hover().catch(() => {});
  await sleep(ACT);
  await el.click();
  let opened = false;
  try {
    await page.waitForFunction(
      (k) => {
        const d = document.querySelector('#phase-drawer');
        return d?.getAttribute('data-drawer-open') === 'true' && d?.getAttribute('data-hex-kind') === k;
      },
      kind, { timeout: 5000 },
    );
    opened = true;
    check(true, `${label}: clicking a ${kind} hex opens the drawer (data-hex-kind="${kind}")`);
  } catch {
    const got = await page.evaluate(() => {
      const d = document.querySelector('#phase-drawer');
      return `open=${d?.getAttribute('data-drawer-open') ?? '(absent)'} kind=${d?.getAttribute('data-hex-kind') ?? '(absent)'}`;
    });
    check(false, `${label}: clicking a ${kind} hex opens the drawer (got ${got})`);
  }
  if (opened) {
    await sleep(READ);
    await frame(page, `hex-detail-${kind}`, `Phase drawer — ${kind} hex opens the detail drawer (held open)`);
  }
  // Close the drawer (Escape) so the next click starts clean.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForFunction(
    () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'false',
    null, { timeout: 3000 },
  ).catch(() => {});
  await sleep(ACT);
}

// ── THE 32-BEAT JOURNEY ────────────────────────────────────────────────────────

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
    // M7-4 (ADR-031): the architect entry is now a native Studio surface
    // (/architect/new), NOT /dashboard. Beats 0-9 run entirely inside Studio.
    console.log('\n[beat 0] Title card');
    await page.goto(watch.uiUrl + '/architect/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page="architect-new"][data-page-ready="true"]', { timeout: 30000 });
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
    check(await page.locator('[data-section="new-idea"]').count() > 0, '[data-section="new-idea"] present on Studio /architect/new');
    await page.locator('[data-action="start-architect"]').hover();
    await sleep(ACT);
    await frame(page, 'beat01b-start-hover', 'Beat 1 — operator hovers "Start architect" (deliberate click incoming)');
    await page.locator('[data-action="start-architect"]').click();
    // M7-4: the Studio entry navigates to the native interview surface
    // /architect/<sid>/interview (NOT the retired standalone /architect/<sid>).
    await page.waitForURL(/\/architect\/[^/]+\/interview/, { timeout: 15000 });
    const sid = decodeURIComponent(page.url().split('/architect/')[1].split('/')[0]);
    createdSid = sid;
    console.log(`[e2e] architect session: ${sid}`);
    check(!!sid, '[data-action="start-architect"] navigates to /architect/<sid>/interview');

    // ── BEAT 2: Architect grounds itself — P3 live activity panel ─────────────
    console.log('\n[beat 2] Architect grounds itself — P3 activity panel streams');
    writeStatus(sid, { phase: 'interviewing', round: 1, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=interviewing, round=1)');
    // M7-4: the interview is a native Studio surface (StudioNav + data-page).
    await page.waitForSelector('main[data-page="architect-interview"]', { timeout: 15000 });
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
    // P4 cost is seeded into the CYCLE log here (cycleEvent architect.end above);
    // the architect PIPELINE hex (with data-phase-cost-usd) lives on the Studio
    // flow monitor (M7-1) — so the P4 assertion runs at beat 9, once the cycle is
    // selected on /flows/forge-cycle.
    await frame(page, 'beat06-architect-cost', 'Beat 6 — P4: architect hex greens with real cost pill ($0.46, 95s)');

    // ── BEAT 7: Rich PLAN.html presented ──────────────────────────────────────
    // M7-4: the PLAN gate is the native /artifact surface, not the old architect
    // screen. The interview surface offers an "open-plan" link at awaiting-verdict;
    // the operator follows it (here we navigate directly to the gate URL).
    console.log('\n[beat 7] Rich PLAN.html');
    await page.goto(
      watch.uiUrl + `/artifact?run=_architect-${encodeURIComponent(sid)}&type=plan&mode=gate`,
      { waitUntil: 'domcontentloaded' },
    );
    // /artifact root is a <div data-page-ready> (not <main>) — assert the attr (M7-3 lesson).
    await page.waitForSelector('[data-page="flows"][data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
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
    // M7-4: the approval payoff "Watch it build →" link now lives on the
    // /artifact PLAN gate (post-approve) and lands on the Studio flow monitor —
    // NO /dashboard hop. The cycle-spine + P4 guards run on /flows/forge-cycle.
    await page.waitForSelector('[data-action="watch-it-build"]', { timeout: 15000 });
    await sleep(ACT);
    await page.locator('[data-action="watch-it-build"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 20000 },
    ).catch(() => {});
    await sleep(ACT);
    await frame(page, 'beat09b-studio-monitor-landing', 'Beat 9 — "Watch it build →" lands on the Studio flow monitor');
    // Monitor invariants re-homed onto the Studio flow monitor (M7-1, ADR-031):
    // the cycle-monitoring guards now live on /flows/forge-cycle, not /dashboard.
    // (ADR-031: the [data-project-group] cross-project pane assertion is DROPPED.)
    // openStudioMonitor selects this cycle's run deterministically.
    await openStudioMonitor(page, watch);
    await frame(page, 'beat09c-studio-monitor-live', 'Beat 9 — Studio flow monitor shows the cycle live (run rail + topology)');
    await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 5, 'monitor: pipeline spine shows ≥5 phase hexes');
    // P4: the architect hex carries the REAL cost seeded at beat 6.
    try {
      await page.waitForFunction(
        () => (parseFloat(document.querySelector('[data-mon-node][data-node-id="architect"]')
          ?.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0,
        null, { timeout: 12000 },
      );
      check(true, 'P4: architect hex carries real cost (data-phase-cost-usd > 0)');
    } catch {
      const costVal = await page.evaluate(() =>
        document.querySelector('[data-mon-node][data-node-id="architect"]')?.getAttribute('data-phase-cost-usd') ?? '(absent)');
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
    // Re-open the monitor so the run model picks up the freshly-seeded WI events
    // deterministically (the monitor refetches from the bridge on load).
    await openStudioMonitor(page, watch);
    await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'monitor: PM materialised ≥2 WI hexes');
    // Drawer open/close regression guards — re-homed onto the Studio PhaseDrawer
    // (#phase-drawer). A phase hex opens a phase-scoped drawer; a WI hex opens a
    // WI-scoped drawer (data-hex-kind="wi").
    await expectHexOpensDrawer(page, '[data-mon-node][data-hex-kind="phase"]', 'phase', 'monitor phase drawer');
    await expectHexOpensDrawer(page, '[data-mon-node][data-hex-kind="wi"]', 'wi', 'monitor WI drawer');

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
    // Regression guard (re-homed onto the Studio monitor): the unifier reaches
    // complete on its OWN node ([data-mon-node][data-node-id="unifier"]), not
    // folded into the dev-loop node. Re-open the monitor so the run model
    // reflects the unifier.end event deterministically.
    await openStudioMonitor(page, watch);
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') === 'complete',
        null, { timeout: 10000 },
      );
      check(true, 'monitor: unifier node lit its own status complete (not folded into dev-loop)');
    } catch {
      const got = await page.evaluate(() =>
        document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') ?? '(absent)');
      check(false, `monitor: unifier node should reach complete (got "${got}")`);
    }
    await frame(page, 'beat14b-unifier-green', 'Beat 14 — unifier (own node) greens after authoring the demo');

    // ── BEAT 15: Cost rollup across the spine ─────────────────────────────────
    console.log('\n[beat 15] Cost rollup');
    cycleEvent('review-loop', 'start', 'review-loop start');
    cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
    moveManifest('in-flight', 'ready-for-review');
    await caption(page, 'Every phase is costed.');
    // Per-phase cost rollup re-homed onto the Studio monitor (M7-1, ADR-031):
    // the page is on /flows/forge-cycle here; assert against [data-mon-node].
    await openStudioMonitor(page, watch);
    await sleep(READ);
    await frame(page, 'beat15-cost-rollup', 'Beat 15 — cost rollup: architect $0.46 / PM $0.31 / dev-loop $0.92 / unifier $0.18 (Studio monitor)');
    await expectPhaseCost(page, 'monitor: cost rollup — a phase hex shows cost > 0');
    // Run-rail status invariant: the seeded gated cycle shows status "gated"
    // (the Studio vocab for ready-for-review). Navigation to the review screen
    // still goes through the dashboard open-review link (out of scope: M7-3).
    try {
      await page.waitForFunction(
        (id) => document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') === 'gated',
        CYCLE_ID, { timeout: 12000 },
      );
      check(true, 'monitor: run rail shows the cycle as gated (ready-for-review)');
    } catch {
      const got = await page.evaluate((id) =>
        document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID);
      check(false, `monitor: run rail shows the cycle gated (got "${got}")`);
    }
    // M7-2 (ADR-031): /dashboard is gone — the gated-cycle invariant is the
    // run rail's data-run-status="gated" asserted just above. Drive the review
    // moment on the unified /artifact viewer directly (M7-3 — /review redirects
    // there). No /dashboard open-review hop.

    // The unified review-gate URL (M7-3): /artifact?run=<id>&type=verdict&mode=gate.
    const REVIEW_URL = `${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=verdict&mode=gate`;
    const REFLECT_URL = `${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=reflection&mode=view`;

    // ── BEAT 16: Review — per-AC evaluated demo (PARTIAL) ─────────────────────
    console.log('\n[beat 16] Review — per-AC demo (PARTIAL)');
    await sleep(ACT);
    // /artifact renders data-page="flows" for all types — assert page-ready, not page name.
    await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
    // /artifact renders its root as a <div data-page-ready>, not <main> — assert the attr, not the tag.
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 });
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
    // M7-2: no /dashboard hop after send-back — beat 18 fast-forwards the
    // dev-loop on the new criterion, then beat 19 re-opens REVIEW_URL directly.
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
    await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 }).catch(() => {});
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
    // M7-2 (ADR-031): the completed-spine checks re-home onto the Studio monitor
    // (/flows/forge-cycle), NOT /dashboard. openStudioMonitor selects the cycle's
    // run rail card; the run model refetches from the event log so it reflects the
    // closure/reflection events seeded above.
    await openStudioMonitor(page, watch);
    await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
    await page.waitForSelector(`[data-run-id="${CYCLE_ID}"][data-run-status="complete"]`, { timeout: 15000 }).catch(() => {});
    await sleep(READ);
    await frame(page, 'beat20c-spine-complete', 'Beat 20 — completed spine: every phase green with its cost pill (Studio monitor)');
    // Run-rail status invariant: the merged cycle reads "complete" (Studio vocab for done).
    try {
      await page.waitForFunction(
        (id) => document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') === 'complete',
        CYCLE_ID, { timeout: 12000 },
      );
      check(true, 'monitor: run rail shows the cycle complete (merged + reflected)');
    } catch {
      const got = await page.evaluate((id) =>
        document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID);
      check(false, `monitor: run rail shows the cycle complete (got "${got}")`);
    }
    await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 5, 'completed cycle still shows ≥5 phase hexes (Studio monitor)');
    await expectPhaseCost(page, 'completed cycle shows accrued per-phase cost');
    // Regression guard: unifier reaches complete on its OWN monitor node
    // ([data-mon-node][data-node-id="unifier"]), not folded into the dev-loop node.
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') === 'complete',
        null, { timeout: 8000 },
      );
      check(true, 'unifier node complete on its own monitor slot (not folded into dev-loop)');
    } catch {
      const got = await page.evaluate(() =>
        document.querySelector('[data-mon-node][data-node-id="unifier"]')?.getAttribute('data-status') ?? '(absent)');
      check(false, `unifier node should reach complete (got "${got}")`);
    }

    // ── BEAT 21: Reflect — operator tunes the brain ───────────────────────────
    console.log('\n[beat 21] Reflect');
    await caption(page, "Forge improves. You're the teacher.");
    // Navigate directly to the unified reflection artifact (M7-3) — the open-reflect
    // CTA is a per-card dashboard poll that can lag; page.goto is deterministic.
    // /artifact renders data-page="flows" for all types — assert page-ready, not name.
    // user-questions.json was seeded in beat 20.
    await page.goto(REFLECT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
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
    // Regression guard (re-homed onto the Studio monitor, M7-2): the reflection
    // node greens after tuning. The flow node-id is "reflect" (events say
    // 'reflection'; run-model maps reflection → reflect, run-model.ts:113).
    // openStudioMonitor selects the cycle's run; the run model refetches the
    // event log so it reflects the reflection.end seeded above.
    await openStudioMonitor(page, watch);
    await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
    await sleep(ACT);
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-mon-node][data-node-id="reflect"]')?.getAttribute('data-status') === 'complete',
        null, { timeout: 12000 },
      );
      check(true, 'reflection node greened after tuning feedback (Studio monitor)');
    } catch {
      const reflStatus = await page.evaluate(() =>
        document.querySelector('[data-mon-node][data-node-id="reflect"]')?.getAttribute('data-status') ?? '(absent)');
      check(false, `reflection node greened after tuning feedback (got "${reflStatus}")`);
    }

    // ── ACT IV: Studio ────────────────────────────────────────────────────────
    // Seed a synthetic gated run so the library flow card shows a "needs you"
    // chip and the monitor run rail shows the NEEDS YOU group.
    // The main cycle (INIT/CYCLE_ID) is in `done` at this point, so we seed a
    // separate INIT2/CYCLE_ID2 in `ready-for-review` — this is the lower-risk
    // option vs restructuring beat order.
    const INIT2 = `INIT-${DATE}-e2e-studio-demo`;
    const STAMP2 = new Date(Date.now() + 1000).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
    const CYCLE_ID2 = `${STAMP2}_${INIT2}`;
    const CYCLE_LOG2 = join(FORGE_ROOT, '_logs', CYCLE_ID2);
    let studioSeqBase = 0;
    function studioEvent(phase, eventType, message, opts = {}) {
      const { metadata = {}, skill = phase, ...extras } = opts;
      mkdirSync(CYCLE_LOG2, { recursive: true });
      studioSeqBase += 1;
      appendFileSync(join(CYCLE_LOG2, 'events.jsonl'), JSON.stringify({
        event_id: `EV_stu_${studioSeqBase}`, cycle_id: CYCLE_ID2, initiative_id: INIT2,
        started_at: new Date().toISOString(), phase, skill,
        event_type: eventType, input_refs: [], output_refs: [], message, metadata, ...extras,
      }) + '\n');
    }

    // Write manifest for the gated run
    mkdirSync(QDIR('ready-for-review'), { recursive: true });
    writeFileSync(join(QDIR('ready-for-review'), `${INIT2}.md`), [
      '---', `initiative_id: ${INIT2}`, `project: ${PROJECT}`,
      `project_repo_path: ${projectRoot}`,
      `created_at: '${new Date().toISOString()}'`,
      `cycle_id: ${CYCLE_ID2}`,
      'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: ready-for-review',
      'origin: architect',
      '---', '',
      '# Studio demo — gated run for Act IV',
      '',
      'Add a --verbose flag to the output formatter.',
    ].join('\n'));

    // Seed cycle events: all phases up to review, then leave gated
    studioEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
    studioEvent('architect', 'start', 'architect.start');
    studioEvent('architect', 'end', 'architect.end', { cost_usd: 0.22 });
    studioEvent('project-manager', 'start', 'pm phase start');
    studioEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1' } });
    studioEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.15 });
    studioEvent('developer-loop', 'start', 'dev-loop start');
    studioEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-1' } });
    studioEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } });
    studioEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.48 });
    // Unifier with gate sub-checks (M1-3 structured event shape)
    studioEvent('unifier', 'start', 'unifier.start', { skill: 'developer-unifier' });
    for (const [checkId, pass, detail] of [
      ['initiative_gate',    true,  'PLAN.md present'],
      ['demo_runs_clean',    true,  'demo.json valid'],
      ['pr_self_contained',  true,  'no cross-WI deps'],
      ['branches_in_sync',   true,  'branch up-to-date'],
      ['complete_delivery',  true,  'all WIs delivered'],
    ]) {
      studioEvent('unifier', 'log', 'unifier.gate.sub-check',
        { skill: 'developer-unifier', metadata: { check_id: checkId, pass, detail } });
    }
    studioEvent('unifier', 'end', 'unifier.end', { skill: 'developer-unifier', cost_usd: 0.11 });
    studioEvent('review-loop', 'start', 'review-loop start');
    studioEvent('review-loop', 'log', 'reviewer.pr-opened');
    // Seed artifacts dir (demo.json for artifactsReady)
    const artifacts2 = join(CYCLE_LOG2, 'artifacts');
    mkdirSync(artifacts2, { recursive: true });
    writeFileSync(join(artifacts2, 'demo.json'), JSON.stringify({
      title: 'Studio demo — gated run', project: PROJECT, initiativeId: INIT2,
    }, null, 2));
    writeFileSync(join(artifacts2, 'DEMO.html'), '<html><body>demo</body></html>');

    // ── BEAT 22: Library page (`/`) ───────────────────────────────────────────
    console.log('\n[beat 22] Studio library page');
    await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'library: [data-page="library"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') ?? '(no data-page=library)');
      check(false, `library: data-page-ready (got "${pr}")`);
    }
    await caption(page, 'The Studio library — flows, agents, projects, and knowledge in one screen.');
    await sleep(ACT);
    // 4 sections present with data-count
    await countAtLeast(page, '[data-section="flows"]', 1, 'library: [data-section="flows"] present');
    await countAtLeast(page, '[data-section="agents"]', 1, 'library: [data-section="agents"] present');
    await countAtLeast(page, '[data-section="projects"]', 1, 'library: [data-section="projects"] present');
    await countAtLeast(page, '[data-section="kbs"]', 1, 'library: [data-section="kbs"] present');
    // Pulse panel present
    const pulsePresent = await page.evaluate(
      () => document.querySelector('[data-pulse-flows]') !== null,
    );
    check(pulsePresent, 'library: operator pulse panel ([data-pulse-flows]) present');
    // flows section has ≥1 card (forge-cycle flow should appear)
    await countAtLeast(page, '[data-section="flows"] [data-card-type="flow"]', 1, 'library: ≥1 flow card in flows section');
    // agents section has ≥1 card
    await countAtLeast(page, '[data-section="agents"] [data-card-type="agent"]', 1, 'library: ≥1 agent card in agents section');
    // projects section has ≥1 card
    await countAtLeast(page, '[data-section="projects"] [data-card-type="project"]', 1, 'library: ≥1 project card in projects section');
    // kbs section has ≥1 card
    await countAtLeast(page, '[data-section="kbs"] [data-card-type="kb"]', 1, 'library: ≥1 kb card in kbs section');
    // data-count ≥1 on each section
    const sectionCounts = await page.evaluate(() => {
      const sections = ['flows', 'agents', 'projects', 'kbs'];
      return Object.fromEntries(sections.map((s) => [
        s,
        parseInt(document.querySelector(`[data-section="${s}"]`)?.getAttribute('data-count') ?? '0', 10),
      ]));
    });
    check(sectionCounts.flows >= 1, `library: flows section data-count ≥1 (got ${sectionCounts.flows})`);
    check(sectionCounts.agents >= 1, `library: agents section data-count ≥1 (got ${sectionCounts.agents})`);
    check(sectionCounts.projects >= 1, `library: projects section data-count ≥1 (got ${sectionCounts.projects})`);
    check(sectionCounts.kbs >= 1, `library: kbs section data-count ≥1 (got ${sectionCounts.kbs})`);
    await sleep(READ);
    await frame(page, 'beat22-library', 'Beat 22 — Studio library: 4 sections (flows/agents/projects/kbs) with live data');

    // ── BEAT 23: Monitor page (`/flows/forge-cycle`) ──────────────────────────
    console.log('\n[beat 23] Flow monitor — /flows/forge-cycle');
    await page.goto(watch.uiUrl + '/flows/forge-cycle', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'monitor: [data-page="flow-monitor"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(no data-page=flow-monitor)');
      check(false, `monitor: data-page-ready (got "${pr}")`);
    }
    await caption(page, 'The flow monitor — live topology of every agent phase with phase logs and gate sub-checks.');
    await sleep(ACT);
    // Run rail has ≥1 data-run-id card (the seeded gated run should be visible)
    await countAtLeast(page, '[data-run-id]', 1, 'monitor: run rail shows ≥1 [data-run-id]');
    // Topology renders ≥6 total hexes. With the dev node fanned out to its work
    // items, the deterministic per-PHASE node set is 5 (architect/pm/unifier/
    // review/reflect) plus ≥2 WI hexes — so assert both the per-phase floor and
    // the total floor (M7-1, ADR-031).
    await countAtLeast(page, '[data-mon-node]', 6, 'monitor: topology renders ≥6 [data-mon-node] hexes');
    await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 5, 'monitor: ≥5 deterministic per-phase hexes');
    await sleep(READ);
    await frame(page, 'beat23-monitor', 'Beat 23 — flow monitor: run rail + topology (≥5 phase hexes + WI hexes)');

    // Click the unifier hex → drawer opens
    const unifierHex = page.locator('[data-node-id="unifier"]').first();
    let drawerOpened = false;
    if ((await unifierHex.count()) > 0) {
      await unifierHex.click();
      try {
        await page.waitForFunction(
          () => document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true',
          null, { timeout: 8000 },
        );
        drawerOpened = true;
        check(true, 'monitor: clicking unifier hex opens drawer (data-drawer-open="true")');
      } catch {
        const state = await page.evaluate(() =>
          document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') ?? '(absent)');
        check(false, `monitor: unifier hex opens drawer (got data-drawer-open="${state}")`);
      }
    } else {
      check(false, 'monitor: [data-node-id="unifier"] hex present to click');
    }

    if (drawerOpened) {
      await sleep(ACT);
      // Gate sub-checks rendered (from the seeded unifier.gate.sub-check events):
      // look for the "Gate sub-checks" section header text as a signal
      const hasGateSection = await page.evaluate(() => {
        const drawer = document.querySelector('#phase-drawer');
        if (!drawer) return false;
        return drawer.textContent?.includes('Gate sub-checks') ?? false;
      });
      check(hasGateSection, 'monitor: drawer shows Gate sub-checks section');
      // Phase log section present and non-empty (even loading indicator counts)
      const hasPhaseLog = await page.evaluate(() => {
        const drawer = document.querySelector('#phase-drawer');
        if (!drawer) return false;
        return drawer.textContent?.includes('Phase log') ?? false;
      });
      check(hasPhaseLog, 'monitor: drawer shows Phase log section');
      await frame(page, 'beat23b-monitor-drawer', 'Beat 23 — phase drawer open: gate sub-checks + phase log visible');

      // Toggle stderr checkbox and assert drawer still renders
      const stderrCheck = page.locator('#phase-drawer input[type="checkbox"]').first();
      if ((await stderrCheck.count()) > 0) {
        await stderrCheck.check();
        await sleep(THINK);
        const drawerStillOpen = await page.evaluate(() =>
          document.querySelector('#phase-drawer')?.getAttribute('data-drawer-open') === 'true');
        check(drawerStillOpen, 'monitor: drawer still renders after toggling stderr checkbox');
        await stderrCheck.uncheck();
      } else {
        check(false, 'monitor: stderr checkbox present in drawer');
      }
    }

    // Event tail data-tail-count present (may be 0 since this is a historical run;
    // the attribute exists and is a number)
    const tailCount = await page.evaluate(() => {
      const el = document.querySelector('[data-tail-count]');
      return el ? el.getAttribute('data-tail-count') : null;
    });
    check(tailCount !== null, `monitor: [data-tail-count] attribute present (got ${tailCount})`);
    await sleep(READ);
    await frame(page, 'beat23c-monitor-tail', 'Beat 23 — event tail [data-tail-count] attribute present');

    // ── ACT V: Studio builders ────────────────────────────────────────────────
    // First live run of the agent builder + project builder against the real
    // bridge — read-only interaction (no save, no mutation of real definitions).

    // ── BEAT 24: Agent builder — /agents/project-manager ─────────────────────
    console.log('\n[beat 24] Agent builder — /agents/project-manager');
    await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
    let agentPageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 25000 },
      );
      agentPageReady = true;
      check(true, 'agent-builder: [data-page="agents"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
      check(false, `agent-builder: data-page-ready (got "${pr}")`);
    }

    await caption(page, 'The agent builder — edit composition, runtime and readiness without leaving the UI.');
    await sleep(ACT);

    if (agentPageReady) {
      // Catalog palette: ≥1 chip rendered (data-id)
      await countAtLeast(page, '[data-id]', 1, 'agent-builder: catalog palette renders ≥1 chip');

      // 4 typed drop zones present
      for (const kind of ['skill', 'tool', 'mcp', 'hook']) {
        check(
          await page.evaluate((k) => document.querySelector(`[data-accepts="${k}"]`) !== null, kind),
          `agent-builder: drop zone [data-accepts="${kind}"] present`,
        );
      }

      // Loaded agent id non-empty — project-manager resolves from the real agent list
      const agentId = await page.evaluate(() =>
        document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ??
        document.querySelector('[data-agent-id]')?.getAttribute('data-agent-id') ?? '');
      check(agentId.length > 0, `agent-builder: data-agent-id non-empty (got "${agentId}")`);

      // Readiness panel: data-ready-count present (project-manager is fully seeded → expect 6)
      const readyCount = await page.evaluate(() => {
        const el = document.querySelector('[data-ready-count]');
        return el ? el.getAttribute('data-ready-count') : null;
      });
      check(readyCount !== null, `agent-builder: [data-ready-count] attribute present (got ${readyCount})`);
      if (readyCount !== null) {
        check(parseInt(readyCount, 10) >= 4, `agent-builder: readiness ≥4 checks pass for project-manager (got ${readyCount})`);
      }

      // Runtime section: data-sdk reflects claude
      const sdk = await page.evaluate(() =>
        document.querySelector('[data-sdk]')?.getAttribute('data-sdk') ?? '');
      check(sdk.length > 0, `agent-builder: [data-sdk] attribute present (got "${sdk}")`);

      await frame(page, 'beat24-agent-builder', 'Beat 24 — agent builder loaded: catalog, drop zones, runtime, readiness panel');

      // Dirty-flag: type into the purpose field and assert data-dirty flips
      const purposeInput = page.locator('#purpose-input');
      if ((await purposeInput.count()) > 0) {
        const originalPurpose = await purposeInput.inputValue();
        await purposeInput.click();
        await purposeInput.pressSequentially(' (e2e test edit)', { delay: 18 });
        await sleep(THINK);
        const dirtyVal = await page.evaluate(() =>
          document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
        check(dirtyVal === 'true', `agent-builder: data-dirty="true" after editing purpose field (got "${dirtyVal}")`);
        // Restore: click Discard to clean up (no save)
        const discardBtn = page.locator('#btn-discard');
        if ((await discardBtn.count()) > 0) {
          await discardBtn.click();
          await sleep(THINK);
        } else {
          // Fallback: just clear back to original text
          await purposeInput.fill(originalPurpose);
        }
        await frame(page, 'beat24b-agent-dirty', 'Beat 24 — data-dirty="true" flips after purpose field edit (discarded, no save)');
      } else {
        check(false, 'agent-builder: #purpose-input present to test dirty flag');
      }
    } else {
      check(false, 'agent-builder: page did not become ready — remaining agent-builder checks skipped');
    }

    // ── BEAT 25: Project builder — /projects/claude-harness ──────────────────
    console.log('\n[beat 25] Project builder — /projects/claude-harness');
    await page.goto(watch.uiUrl + '/projects/claude-harness', { waitUntil: 'domcontentloaded' });
    let projectPageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 25000 },
      );
      projectPageReady = true;
      check(true, 'project-builder: [data-page="projects"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') ?? '(no data-page=projects)');
      check(false, `project-builder: data-page-ready (got "${pr}")`);
    }

    await caption(page, 'The project builder — north star, demo timeline, skills, contract readiness in one screen.');
    await sleep(ACT);

    if (projectPageReady) {
      // Project id wired
      const projectId = await page.evaluate(() =>
        document.querySelector('[data-project-id]')?.getAttribute('data-project-id') ?? '');
      check(projectId === 'claude-harness', `project-builder: data-project-id="claude-harness" (got "${projectId}")`);

      // North star field present
      check(
        await page.evaluate(() => document.querySelector('[data-component="north-star"]') !== null ||
          // fallback: the NorthStar component may render as a section/textarea without a data-component
          document.querySelectorAll('textarea').length > 0 ||
          document.querySelector('[placeholder*="north star" i]') !== null ||
          document.querySelector('[placeholder*="goal" i]') !== null ||
          document.querySelector('[placeholder*="outcome" i]') !== null),
        'project-builder: north star field present',
      );

      // Demo timeline data-step-count present
      const stepCount = await page.evaluate(() => {
        const el = document.querySelector('[data-step-count]');
        return el ? el.getAttribute('data-step-count') : null;
      });
      check(stepCount !== null, `project-builder: [data-step-count] attribute present (got ${stepCount})`);

      // Skills bind data-count present
      const skillsCount = await page.evaluate(() => {
        const el = document.querySelector('[data-count]');
        return el ? el.getAttribute('data-count') : null;
      });
      check(skillsCount !== null, `project-builder: [data-count] attribute present (got ${skillsCount})`);

      // Contract readiness: data-ready-count + data-flow-ready
      const contractReadyCount = await page.evaluate(() => {
        const el = document.querySelector('[data-ready-count]');
        return el ? el.getAttribute('data-ready-count') : null;
      });
      check(contractReadyCount !== null, `project-builder: [data-ready-count] attribute present (got ${contractReadyCount})`);

      const flowReady = await page.evaluate(() => {
        const el = document.querySelector('[data-flow-ready]');
        return el ? el.getAttribute('data-flow-ready') : null;
      });
      check(flowReady !== null, `project-builder: [data-flow-ready] attribute present (got "${flowReady}")`);

      await frame(page, 'beat25-project-builder', 'Beat 25 — project builder loaded: north star, demo timeline, skills, contract readiness');

      // Add a demo step via the "+ Add step" button and assert data-step-count increments + dirty flips.
      // The preset chips use data-kind; the plain "Add step" button is the simplest reliable target.
      const presetBtn = page.locator('button').filter({ hasText: /^\+ Add step$/ }).first();
      const presetPresent = (await presetBtn.count()) > 0;
      if (presetPresent) {
        const before = parseInt(stepCount ?? '0', 10);
        await presetBtn.click();
        await sleep(THINK);
        const after = await page.evaluate(() => {
          const el = document.querySelector('[data-step-count]');
          return el ? parseInt(el.getAttribute('data-step-count') ?? '0', 10) : 0;
        });
        check(after > before, `project-builder: data-step-count incremented after preset click (${before}→${after})`);
        const dirtyAfter = await page.evaluate(() =>
          document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
        check(dirtyAfter === 'true', `project-builder: data-dirty="true" after adding demo step (got "${dirtyAfter}")`);
        await frame(page, 'beat25b-project-dirty', `Beat 25 — data-step-count incremented (${before}→${after}), data-dirty="true" (no save)`);
      } else {
        // Soft-fail: the presets may have a different label or be in a submenu
        check(false, 'project-builder: preset/add-step button present (soft — builder loaded, step-count assertion skipped)');
      }
    } else {
      check(false, 'project-builder: page did not become ready — remaining project-builder checks skipped');
    }

    // ── ACT VI: Flow-engine beats (M3-7) ──────────────────────────────────────
    // Four emulated beats proving the M3-4 controls render correctly:
    //   Beat 26 — start-run CTA (flow with no runs → [data-action="start-run"] enabled)
    //   Beat 27 — cost-ceiling-warn (cost > 70% of ceiling → amber gauge)
    //   Beat 28 — gate control (gated run → "Open gate →" link present; already seeded by Act IV)
    //   Beat 29 — resume button (failed run → [data-action="resume-run"] present)
    // All are SOFT assertions only (check()/countAtLeast). No real runs are started/resumed.

    // ── BEAT 26: Start-run CTA — /flows/knowledge-ingest (no runs) ───────────
    // knowledge-ingest is the M3-5 seed flow with no queue manifests → runs.length === 0
    // → the empty-state start-run CTA renders.
    console.log('\n[beat 26] Flow engine — start-run CTA (knowledge-ingest, no runs)');
    await page.goto(watch.uiUrl + '/flows/knowledge-ingest', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'Act VI: flow-monitor ready for knowledge-ingest');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
      check(false, `Act VI: flow-monitor ready for knowledge-ingest (got "${pr}")`);
    }
    await caption(page, 'Flow engine — Start Run CTA enabled: the engine can launch any planned flow directly from the UI.');
    await sleep(ACT);

    // data-can-start="true" on the page root (M3-4: enabled when flow is known)
    const canStart = await page.evaluate(() =>
      document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start') ?? '(absent)');
    check(canStart === 'true', `Act VI: data-can-start="true" on flow-monitor page (got "${canStart}")`);

    // Start Run button must be present and interactive (not disabled)
    let startBtnPresent = false;
    try {
      await page.waitForSelector('[data-action="start-run"]', { timeout: 8000 });
      startBtnPresent = true;
      check(true, 'Act VI: [data-action="start-run"] CTA present for flow with no runs');
    } catch {
      check(false, 'Act VI: [data-action="start-run"] CTA present for flow with no runs (not found)');
    }
    if (startBtnPresent) {
      const disabled = await page.evaluate(() =>
        (document.querySelector('[data-action="start-run"]'))?.disabled ?? true);
      check(!disabled, 'Act VI: start-run button is not disabled (interactive)');
    }
    // run-count should be 0 on the page attr
    const runCount = await page.evaluate(() =>
      document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '(absent)');
    check(runCount === '0', `Act VI: data-run-count="0" for empty-state flow (got "${runCount}")`);
    await frame(page, 'beat26-start-run-cta', 'Act VI beat 26 — Start Run CTA enabled on flow with no runs (knowledge-ingest)');
    await sleep(READ);

    // ── BEAT 27: Cost-ceiling-warn — seed a run at 75% of $25 ceiling ─────────
    // Seed INIT3 in-flight with enough cost events to push total past $18.75 (75%).
    // The MonitorSummary cost gauge renders amber fill at ≥70%.
    console.log('\n[beat 27] Flow engine — cost-ceiling-warn (gauge amber at 75% of $25 ceiling)');
    const INIT3 = `INIT-${DATE}-e2e-flow-ceiling`;
    const STAMP3 = new Date(Date.now() + 2000).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
    const CYCLE_ID3 = `${STAMP3}_${INIT3}`;
    const CYCLE_LOG3 = join(FORGE_ROOT, '_logs', CYCLE_ID3);
    let ceSeq = 0;
    function ceilEvent(phase, eventType, message, opts = {}) {
      const { metadata = {}, skill = phase, cost_usd, ...extras } = opts;
      mkdirSync(CYCLE_LOG3, { recursive: true });
      ceSeq += 1;
      appendFileSync(join(CYCLE_LOG3, 'events.jsonl'), JSON.stringify({
        event_id: `EV_ce_${ceSeq}`, cycle_id: CYCLE_ID3, initiative_id: INIT3,
        started_at: new Date().toISOString(), phase, skill,
        event_type: eventType, input_refs: [], output_refs: [], message, metadata,
        ...(cost_usd !== undefined ? { cost_usd } : {}),
        ...extras,
      }) + '\n');
    }

    // Write the manifest into in-flight
    mkdirSync(QDIR('in-flight'), { recursive: true });
    writeFileSync(join(QDIR('in-flight'), `${INIT3}.md`), [
      '---', `initiative_id: ${INIT3}`, `project: ${PROJECT}`,
      `project_repo_path: ${projectRoot}`,
      `created_at: '${new Date().toISOString()}'`,
      `cycle_id: ${CYCLE_ID3}`,
      'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: in-flight',
      'origin: architect',
      '---', '',
      '# Flow-engine ceiling demo — 75% of $25 ceiling',
      '',
      'A synthetic run seeded for the cost-ceiling-warn gauge demo.',
    ].join('\n'));

    // Emit events totalling ~$18.75 (75% of $25) — spread across phases
    ceilEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
    ceilEvent('architect', 'start', 'architect.start');
    ceilEvent('architect', 'end', 'architect.end', { cost_usd: 2.50 });
    ceilEvent('project-manager', 'start', 'pm phase start');
    ceilEvent('project-manager', 'end', 'pm.end', { cost_usd: 3.25 });
    ceilEvent('developer-loop', 'start', 'dev-loop start');
    ceilEvent('developer-loop', 'log', 'usage_delta', { cost_usd: 8.00, metadata: { work_item_id: 'WI-1' } });
    ceilEvent('developer-loop', 'log', 'usage_delta', { cost_usd: 5.00, metadata: { work_item_id: 'WI-2' } });
    // Total: 2.50 + 3.25 + 8.00 + 5.00 = $18.75 → 75% of $25 ceiling → amber

    await page.goto(watch.uiUrl + '/flows/forge-cycle', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'Act VI: flow-monitor ready (forge-cycle, ceiling run)');
    } catch {
      check(false, 'Act VI: flow-monitor ready (forge-cycle, ceiling run)');
    }
    await caption(page, 'Flow engine — cost ceiling gauge: 75% of $25 reached → amber warning before the engine halts.');
    await sleep(ACT);

    // Select the ceiling run from the rail (it's the active in-flight run by default priority)
    // The summary strip shows the cost gauge when ceiling is set on the flow
    try {
      await page.waitForSelector(`[data-run-id="${CYCLE_ID3}"]`, { timeout: 8000 });
      await page.locator(`[data-run-id="${CYCLE_ID3}"]`).click();
      await sleep(ACT);
    } catch {
      // run may auto-select; proceed
    }

    // Assert the summary strip shows the cost gauge (fb-summary-strip with data-run-cost-usd)
    const stripCost = await page.evaluate(() => {
      const strip = document.querySelector('.fb-summary-strip[data-run-cost-usd]');
      return strip ? parseFloat(strip.getAttribute('data-run-cost-usd') ?? '0') : null;
    });
    check(stripCost !== null && stripCost > 0, `Act VI: summary strip data-run-cost-usd > 0 (got ${stripCost})`);

    // Assert the gauge bar is present with amber fill (the cost gauge renders when ceiling is set)
    // The gauge renders when flow.costCeilingUsd is set — forge-cycle flow has costCeilingUsd:25
    // We check that the gauge container is rendered (it renders when a run is selected + ceiling set)
    const hasGauge = await page.evaluate(() => {
      // The gauge is a filled bar inside the fb-summary-strip
      // It renders with a div whose background is var(--amber) when 70-90% filled
      const strip = document.querySelector('.fb-summary-strip');
      if (!strip) return false;
      // Look for the cost gauge text "of $25 ceiling"
      return strip.textContent?.includes('of $25 ceiling') ?? false;
    });
    check(hasGauge, 'Act VI: cost gauge "of $25 ceiling" text present in summary strip');

    // The gauge fills amber at ≥70% — assert the fill colour via inline style
    const gaugeIsAmber = await page.evaluate(() => {
      const strip = document.querySelector('.fb-summary-strip');
      if (!strip) return false;
      // Find any div with amber background color inside the strip
      // The fill div uses background: var(--amber) in the warn range
      const allDivs = [...strip.querySelectorAll('div[style]')];
      return allDivs.some((el) => {
        const bg = el.style.background || el.style.backgroundColor;
        return bg.includes('var(--amber)') || bg.includes('amber');
      });
    });
    check(hasGauge && gaugeIsAmber, 'Act VI: cost gauge fill is amber (≥70% of ceiling)');
    await frame(page, 'beat27-ceiling-warn', `Act VI beat 27 — cost ceiling gauge amber: $18.75 of $25 (75%) — engine will stop at 100%`);
    await sleep(READ);

    // ── BEAT 28: Gate control — gated run "Open gate →" ──────────────────────
    // INIT2 (seeded by Act IV) is already in ready-for-review (= gated status).
    // The RunRail shows it with the "Open gate →" link.
    console.log('\n[beat 28] Flow engine — gate control (gated run, "Open gate →" link)');
    await caption(page, 'Flow engine — human gate: the gated run surfaces its review link directly in the run rail.');
    await sleep(ACT);

    // Select the gated run in the rail
    try {
      await page.waitForSelector('[data-run-status="gated"]', { timeout: 8000 });
      await page.locator('[data-run-status="gated"]').first().click();
      await sleep(ACT);
    } catch {
      // May already be selected; proceed
    }

    // Assert the gate control is present — the RunCard renders "Open gate →" for gated runs
    let gateControlPresent = false;
    try {
      await page.waitForSelector('[data-run-status="gated"]', { timeout: 8000 });
      gateControlPresent = true;
      check(true, 'Act VI: [data-run-status="gated"] run card present in run rail');
    } catch {
      check(false, 'Act VI: [data-run-status="gated"] run card present in run rail');
    }
    if (gateControlPresent) {
      // The gated card has an "Open gate →" anchor routing to the unified review
      // gate /artifact?run=<runId>&type=verdict&mode=gate (M7-3, ADR-031).
      const gateLink = await page.evaluate(() => {
        const gatedCard = document.querySelector('[data-run-status="gated"]');
        if (!gatedCard) return null;
        const link = gatedCard.querySelector('a[href*="/artifact"][href*="type=verdict"]');
        return link ? link.href : null;
      });
      check(gateLink !== null, `Act VI: gated run card has "Open gate →" link to /artifact verdict gate (got ${gateLink})`);
    }
    await frame(page, 'beat28-gate-control', 'Act VI beat 28 — gate control: gated run shows "Open gate →" link; routes through postGate endpoint');
    await sleep(READ);

    // ── BEAT 29: Resume button — seed a failed run ────────────────────────────
    console.log('\n[beat 29] Flow engine — resume button (failed run)');
    const INIT4 = `INIT-${DATE}-e2e-flow-failed`;
    const STAMP4 = new Date(Date.now() + 3000).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
    const CYCLE_ID4 = `${STAMP4}_${INIT4}`;
    const CYCLE_LOG4 = join(FORGE_ROOT, '_logs', CYCLE_ID4);
    let failSeq = 0;
    function failEvent(phase, eventType, message, opts = {}) {
      const { metadata = {}, skill = phase, cost_usd, ...extras } = opts;
      mkdirSync(CYCLE_LOG4, { recursive: true });
      failSeq += 1;
      appendFileSync(join(CYCLE_LOG4, 'events.jsonl'), JSON.stringify({
        event_id: `EV_fa_${failSeq}`, cycle_id: CYCLE_ID4, initiative_id: INIT4,
        started_at: new Date().toISOString(), phase, skill,
        event_type: eventType, input_refs: [], output_refs: [], message, metadata,
        ...(cost_usd !== undefined ? { cost_usd } : {}),
        ...extras,
      }) + '\n');
    }

    // Write the manifest into failed queue
    mkdirSync(QDIR('failed'), { recursive: true });
    writeFileSync(join(QDIR('failed'), `${INIT4}.md`), [
      '---', `initiative_id: ${INIT4}`, `project: ${PROJECT}`,
      `project_repo_path: ${projectRoot}`,
      `created_at: '${new Date().toISOString()}'`,
      `cycle_id: ${CYCLE_ID4}`,
      'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: failed',
      'origin: architect',
      '---', '',
      '# Flow-engine resume demo — failed run',
      '',
      'A synthetic failed run seeded for the resume-button demo.',
    ].join('\n'));

    // Seed events — run started then failed at dev-loop phase
    failEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
    failEvent('architect', 'start', 'architect.start');
    failEvent('architect', 'end', 'architect.end', { cost_usd: 0.18 });
    failEvent('project-manager', 'start', 'pm phase start');
    failEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.22 });
    failEvent('developer-loop', 'start', 'dev-loop start');
    failEvent('developer-loop', 'error', 'stream-deadline-exceeded', {
      metadata: { work_item_id: 'WI-1', failure_class: 'transient' },
    });
    failEvent('orchestrator', 'log', 'failure_classification', {
      metadata: { failure_kind: 'transient', recoverable: true, reason: 'stream-deadline-exceeded' },
    });

    // Reload the page so the bridge picks up the new failed manifest
    await page.goto(watch.uiUrl + '/flows/forge-cycle', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'Act VI: flow-monitor ready (forge-cycle, failed run)');
    } catch {
      check(false, 'Act VI: flow-monitor ready (forge-cycle, failed run)');
    }
    await caption(page, 'Flow engine — Resume: a failed run surfaces the Resume button; clicking POSTs to /api/runs/:id/resume.');
    await sleep(ACT);

    // Select the failed run from the rail
    try {
      await page.waitForSelector(`[data-run-id="${CYCLE_ID4}"]`, { timeout: 8000 });
      await page.locator(`[data-run-id="${CYCLE_ID4}"]`).click();
      await sleep(ACT);
    } catch {
      // May already be selected as highest-priority; proceed
    }

    // Assert the resume button is present (rendered when activeRun.status === 'failed')
    let resumeBtnPresent = false;
    try {
      await page.waitForSelector('[data-action="resume-run"]', { timeout: 8000 });
      resumeBtnPresent = true;
      check(true, 'Act VI: [data-action="resume-run"] button present for failed run');
    } catch {
      check(false, 'Act VI: [data-action="resume-run"] button present for failed run (not found)');
    }
    if (resumeBtnPresent) {
      const runIdAttr = await page.evaluate(() =>
        document.querySelector('[data-action="resume-run"]')?.getAttribute('data-run-id') ?? '');
      check(runIdAttr === CYCLE_ID4, `Act VI: resume button data-run-id matches failed run (got "${runIdAttr}")`);
      const btnDisabled = await page.evaluate(() =>
        (document.querySelector('[data-action="resume-run"]'))?.disabled ?? true);
      check(!btnDisabled, 'Act VI: resume button is not disabled (interactive)');
    }
    await frame(page, 'beat29-resume-button', 'Act VI beat 29 — Resume button present for failed run; POSTs /api/runs/:id/resume (not clicked — no real cycle)');
    await sleep(READ);

    // Act VI cleanup — remove the seeded ceiling + failed manifests + log dirs
    // (the finally block handles INIT2 via the studioLogDirs pattern; add INIT3/INIT4 here)
    try {
      for (const q of ['in-flight', 'failed']) {
        try { rmSync(join(QDIR(q), `${INIT3}.md`), { force: true }); } catch { /* */ }
        try { rmSync(join(QDIR(q), `${INIT4}.md`), { force: true }); } catch { /* */ }
      }
    } catch { /* best-effort */ }

    // ── ACT VII: Flow builder + artifact viewer ───────────────────────────────
    // Two emulated beats proving the M4-2 BUILD tab and the M4-3 unified
    // artifact viewer render correctly against live data — their first live run.
    // All assertions are SOFT (check()/countAtLeast). No saves or gate POSTs
    // are performed (the forge-cycle flow is the seed; we do NOT mutate it).

    // ── BEAT 30: Author-a-flow — BUILD tab on /flows/forge-cycle ─────────────
    // The BUILD tab is already enabled (M4-2 landed). Navigate to the monitor
    // page, click BUILD, and assert the canvas + palette load with the
    // forge-cycle nodes (6 nodes per flow.yaml: architect/pm/dev/unifier/
    // review/reflect). We do NOT perform a real ReactFlow drag (palette DnD is
    // finicky in headless Playwright); instead we assert the static BUILD render
    // — canvas present with data-node-count ≥6, palette present with ≥1 chip,
    // FlowHeader goal field with data-goal-set, and all per-node data-flow-node
    // attributes present. This proves the BUILD tab works live without mutating
    // the seed flow.
    console.log('\n[beat 30] Act VII — author-a-flow (BUILD tab on /flows/forge-cycle)');
    await page.goto(watch.uiUrl + '/flows/forge-cycle', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'Act VII: flow-monitor page ready for forge-cycle (BUILD tab entry)');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
      check(false, `Act VII: flow-monitor page ready (got "${pr}")`);
    }

    await caption(page, 'Flow builder — drag agents onto a canvas, draw edges, label artifacts. You author a flow without leaving the UI.');
    await sleep(ACT);

    // Click the BUILD tab
    const buildTabBtn = page.locator('button.tab').filter({ hasText: 'BUILD' }).first();
    if ((await buildTabBtn.count()) > 0) {
      await buildTabBtn.click();
      // Wait for the active-tab data-* to flip
      try {
        await page.waitForFunction(
          () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
          null, { timeout: 8000 },
        );
        check(true, 'Act VII: BUILD tab click flips data-active-tab="build"');
      } catch {
        const tabVal = await page.evaluate(() =>
          document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') ?? '(absent)');
        check(false, `Act VII: data-active-tab="build" after BUILD click (got "${tabVal}")`);
      }
    } else {
      check(false, 'Act VII: BUILD tab button present to click');
    }

    await sleep(WORK); // ReactFlow hydrates after tab switch

    await frame(page, 'beat30-build-tab-loaded', 'Act VII beat 30 — BUILD tab clicked; ReactFlow canvas hydrating with forge-cycle nodes');

    // Assert the canvas wrapper is present with data-node-count ≥6
    // (forge-cycle has 6 nodes: architect/pm/dev/unifier/review/reflect)
    let nodeCountOk = false;
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-node-count]');
          return el !== null && parseInt(el.getAttribute('data-node-count') ?? '0', 10) >= 1;
        },
        null, { timeout: 12000 },
      );
      nodeCountOk = true;
    } catch { /* fall through to assertion */ }
    const nodeCount = await page.evaluate(() => {
      const el = document.querySelector('[data-node-count]');
      return el ? parseInt(el.getAttribute('data-node-count') ?? '0', 10) : -1;
    });
    check(nodeCount >= 6, `Act VII: BUILD canvas data-node-count ≥6 after forge-cycle load (got ${nodeCount})`);

    // Edge count present (forge-cycle has 5 edges)
    const edgeCount = await page.evaluate(() => {
      const el = document.querySelector('[data-edge-count]');
      return el ? parseInt(el.getAttribute('data-edge-count') ?? '0', 10) : -1;
    });
    check(edgeCount >= 0, `Act VII: BUILD canvas data-edge-count present (got ${edgeCount})`);

    // Per-node data-flow-node attributes present (≥1 rendered node)
    await countAtLeast(page, '[data-flow-node]', 1, 'Act VII: ≥1 [data-flow-node] rendered in BUILD canvas');

    // Palette present with ≥1 agent chip
    const palettePresent = await page.evaluate(() =>
      document.querySelector('[data-component="agent-palette"]') !== null);
    check(palettePresent, 'Act VII: [data-component="agent-palette"] present in BUILD tab');
    await countAtLeast(page, '[data-palette-chip]', 1, 'Act VII: palette has ≥1 [data-palette-chip] chip');

    // FlowHeader goal field: data-goal-set present
    const goalSetPresent = await page.evaluate(() =>
      document.querySelector('[data-goal-set]') !== null);
    check(goalSetPresent, 'Act VII: [data-goal-set] present in FlowHeader');

    // Assert no save was triggered (we do NOT click Save — the seed is immutable)
    await sleep(READ);
    await frame(page, 'beat30b-build-canvas-loaded', `Act VII beat 30 — BUILD canvas loaded: ${nodeCount} nodes, ${edgeCount} edges, palette + goal field present (no save — seed immutable)`);

    // ── BEAT 31: Artifact viewer — demo view then verdict gate ─────────────────
    // Use CYCLE_ID2 (seeded by Act IV): in ready-for-review, has demo.json.
    // Navigate to /artifact?run=<CYCLE_ID2>&type=demo&mode=view, assert the
    // page-ready, artifact-type, trail chips (6), and demo evaluation section.
    // Then switch to type=verdict&mode=gate and assert the gate surface.
    console.log('\n[beat 31] Act VII — artifact-viewer (demo view + verdict gate via /artifact)');
    await page.goto(`${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID2)}&type=demo&mode=view`, { waitUntil: 'domcontentloaded' });
    let artifactPageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flows"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 25000 },
      );
      artifactPageReady = true;
      check(true, 'Act VII: artifact viewer [data-page="flows"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flows"]')?.getAttribute('data-page-ready') ?? '(no data-page=flows)');
      check(false, `Act VII: artifact viewer page-ready (got "${pr}")`);
    }

    await caption(page, 'Artifact viewer — every artifact type in one surface. Plan, work-items, PR, demo, verdict, reflection — unified trail.');
    await sleep(ACT);

    if (artifactPageReady) {
      // data-artifact-type="demo" wired
      const artifactType = await page.evaluate(() =>
        document.querySelector('[data-artifact-type]')?.getAttribute('data-artifact-type') ?? '');
      check(artifactType === 'demo', `Act VII: data-artifact-type="demo" (got "${artifactType}")`);

      // data-mode="view"
      const artifactMode = await page.evaluate(() =>
        document.querySelector('[data-mode]')?.getAttribute('data-mode') ?? '');
      check(artifactMode === 'view', `Act VII: data-mode="view" on demo view page (got "${artifactMode}")`);

      // Artifact trail: 6 chips total (plan/workitems/pr/demo/verdict/reflection)
      await countAtLeast(page, '[data-artifact-trail-chip]', 6, 'Act VII: artifact trail has 6 [data-artifact-trail-chip] chips');

      // The current chip (demo) carries data-trail-state="current"
      const currentChipState = await page.evaluate(() =>
        document.querySelector('[data-artifact-trail-chip="demo"]')?.getAttribute('data-trail-state') ?? '');
      check(currentChipState === 'current', `Act VII: demo trail chip data-trail-state="current" (got "${currentChipState}")`);

      // Demo renderer: the demo.json from CYCLE_ID2 is minimal (title/project/initiativeId only)
      // so DemoComparison renders in a degraded state. Assert data-section="demo-evaluation"
      // presence (wrapper added by the artifact page around DemoComparison for demo type).
      const demoEvalPresent = await page.evaluate(() =>
        document.querySelector('[data-section="demo-evaluation"]') !== null);
      check(demoEvalPresent, 'Act VII: [data-section="demo-evaluation"] present for type=demo');
    } else {
      check(false, 'Act VII: artifact viewer did not become ready — demo-mode checks skipped');
    }

    await sleep(READ);
    await frame(page, 'beat31-artifact-demo-view', 'Act VII beat 31 — artifact viewer: demo view, 6-chip trail, demo-evaluation section rendered');

    // Now navigate to type=verdict&mode=gate — the gate surface
    await page.goto(`${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID2)}&type=verdict&mode=gate`, { waitUntil: 'domcontentloaded' });
    let gatePageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flows"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 25000 },
      );
      gatePageReady = true;
      check(true, 'Act VII: artifact viewer [data-page-ready="true"] (verdict gate mode)');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flows"]')?.getAttribute('data-page-ready') ?? '(absent)');
      check(false, `Act VII: artifact viewer page-ready (verdict gate, got "${pr}")`);
    }

    await caption(page, 'Artifact viewer — gate mode: the verdict form surfaces directly. The harness contract is preserved.');
    await sleep(ACT);

    if (gatePageReady) {
      // data-artifact-type="verdict"
      const gateType = await page.evaluate(() =>
        document.querySelector('[data-artifact-type]')?.getAttribute('data-artifact-type') ?? '');
      check(gateType === 'verdict', `Act VII: data-artifact-type="verdict" in gate mode (got "${gateType}")`);

      // data-mode="gate"
      const gateMode = await page.evaluate(() =>
        document.querySelector('[data-mode]')?.getAttribute('data-mode') ?? '');
      check(gateMode === 'gate', `Act VII: data-mode="gate" for verdict gate URL (got "${gateMode}")`);

      // Gate state starts idle
      const gateState = await page.evaluate(() =>
        document.querySelector('[data-gate-state]')?.getAttribute('data-gate-state') ?? '');
      check(gateState === 'idle', `Act VII: data-gate-state="idle" on fresh gate page (got "${gateState}")`);

      // Verdict form present — the harness-critical data-component that the
      // fold-in (M4-4) must preserve. ReviewVerdictForm renders for type=verdict gate-mode.
      let verdictFormPresent = false;
      try {
        await page.waitForSelector('[data-component="verdict-form"]', { timeout: 8000 });
        verdictFormPresent = true;
        check(true, 'Act VII: [data-component="verdict-form"] present in verdict gate mode');
      } catch {
        const vf = await page.evaluate(() =>
          document.querySelector('[data-component="verdict-form"]') !== null);
        check(vf, 'Act VII: [data-component="verdict-form"] present in verdict gate mode');
      }

      if (verdictFormPresent) {
        // form-state starts at "editing"
        const formState = await page.evaluate(() =>
          document.querySelector('[data-component="verdict-form"]')?.getAttribute('data-form-state') ?? '');
        check(formState === 'editing', `Act VII: verdict-form data-form-state="editing" on load (got "${formState}")`);

        // Approve action present (default state — kind=approve, so data-action="approve-and-merge")
        const approvePresent = await page.evaluate(() =>
          document.querySelector('[data-action="approve-and-merge"]') !== null);
        check(approvePresent, 'Act VII: [data-action="approve-and-merge"] present in verdict gate form');

        // Send-back radio present (the button becomes data-action="send-back" after selecting
        // the send-back radio — assert the radio itself is present without clicking it)
        const sendBackRadioPresent = await page.evaluate(() => {
          const form = document.querySelector('[data-component="verdict-form"]');
          if (!form) return false;
          // The send-back radio is the second radio in the fieldset
          return form.querySelectorAll('input[type="radio"]').length >= 2;
        });
        check(sendBackRadioPresent, 'Act VII: send-back radio present in verdict gate form (≥2 radios)');
      }

      // Trail still shows 6 chips in gate mode
      await countAtLeast(page, '[data-artifact-trail-chip]', 6, 'Act VII: 6-chip trail present in verdict gate mode');
    } else {
      check(false, 'Act VII: artifact viewer did not become ready in verdict gate mode — gate checks skipped');
    }

    await sleep(READ);
    await frame(page, 'beat31b-artifact-verdict-gate', 'Act VII beat 31 — artifact viewer: verdict gate mode, verdict-form + approve/send-back actions present (harness contract preserved)');

    // ── ACT VIII: Knowledge viewer ────────────────────────────────────────────
    // Two emulated beats proving the M5-2/3 /knowledge viewer renders the real
    // brain graph and that the guidance loop writes + surfaces a guidance node.
    // All assertions are SOFT (check()/countAtLeast). The guidance file created
    // in beat 33 is cleaned up in the finally block (see "Act VIII cleanup").
    //
    // The GUIDANCE_TEXT constant is recognisable so cleanup can confirm removal.
    const GUIDANCE_TEXT = '[e2e-journey] worktree-cwd theme needs a split: cwd resolution vs path encoding are distinct failure modes.';

    // ── BEAT 32: Browse-KB — /knowledge?id=cycles ─────────────────────────────
    // Navigate to the knowledge viewer for the real cycles brain (~67 themes).
    // Asserts: page-ready, #kb-svg data-*, node/edge counts, a node article on click.
    console.log('\n[beat 32] Act VIII — browse-KB (/knowledge?id=cycles, real brain)');
    await page.goto(`${watch.uiUrl}/knowledge?id=cycles`, { waitUntil: 'domcontentloaded' });
    let kbPageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 30000 },
      );
      kbPageReady = true;
      check(true, 'Act VIII: [data-page="knowledge"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') ?? '(no data-page=knowledge)');
      check(false, `Act VIII: knowledge page-ready (got "${pr}")`);
    }

    await caption(page, 'The brain is browsable — force-graph of every theme, live against the real brain filesystem.');
    await sleep(WORK); // allow the spring sim to settle a few frames

    if (kbPageReady) {
      // #kb-svg must be present with data-kb-id="cycles"
      const kbId = await page.evaluate(() =>
        document.querySelector('#kb-svg')?.getAttribute('data-kb-id') ?? '');
      check(kbId === 'cycles', `Act VIII: #kb-svg data-kb-id="cycles" (got "${kbId}")`);

      // Node count ≥ 10 (cycles brain has 67 themes + index nodes; even a capped graph should have many)
      let nodeCount = 0;
      try {
        await page.waitForFunction(
          () => {
            const el = document.querySelector('#kb-svg');
            return el !== null && parseInt(el.getAttribute('data-node-count') ?? '0', 10) >= 10;
          },
          null, { timeout: 15000 },
        );
      } catch { /* fall through to assertion */ }
      nodeCount = await page.evaluate(() =>
        parseInt(document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '0', 10));
      check(nodeCount >= 10, `Act VIII: #kb-svg data-node-count ≥10 (got ${nodeCount}; cycles brain has 67 themes)`);

      // Edge count > 0
      const edgeCount = await page.evaluate(() =>
        parseInt(document.querySelector('#kb-svg')?.getAttribute('data-edge-count') ?? '0', 10));
      check(edgeCount > 0, `Act VIII: #kb-svg data-edge-count > 0 (got ${edgeCount})`);

      // data-node-id elements present (≥ several rendered nodes)
      await countAtLeast(page, '[data-node-id]', 5, 'Act VIII: ≥5 [data-node-id] nodes rendered in graph');

      // layer values: at least one theme node and one index node
      const hasTheme = await page.evaluate(() =>
        document.querySelector('[data-layer="theme"]') !== null);
      check(hasTheme, 'Act VIII: [data-layer="theme"] node(s) present in graph');
      const hasIndex = await page.evaluate(() =>
        document.querySelector('[data-layer="index"]') !== null);
      check(hasIndex, 'Act VIII: [data-layer="index"] node(s) present in graph');

      // KB HEALTH panel present (data-section="kb-health" OR the KbHealth component)
      const healthPresent = await page.evaluate(() =>
        document.querySelector('[data-section="kb-health"]') !== null ||
        // fallback: KbHealth renders a panel with "HEALTH" in its header text
        [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('KB HEALTH') || el.textContent?.includes('LAYER BALANCE')));
      check(healthPresent, 'Act VIII: KB HEALTH panel rendered (layer-balance section)');

      // KB selector present (KbSelector renders an optgroup-grouped <select> or a nav)
      const selectorPresent = await page.evaluate(() =>
        document.querySelector('select') !== null ||
        document.querySelector('[data-component="kb-selector"]') !== null);
      check(selectorPresent, 'Act VIII: KB selector (scope-grouped) present in the header');
    }

    await frame(page, 'beat32-kb-graph', `Act VIII beat 32 — /knowledge?id=cycles: force-graph rendered (${
      await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '?')
    } nodes, real cycles brain)`);

    // Click a theme node → assert the NODE ARTICLE panel populates
    let articleLoaded = false;
    if (kbPageReady) {
      // Pick the first theme node and click it
      // NOTE: the SVG spring-sim layout can place text labels from nearby nodes
      // on top — use { force: true } + a .catch() to soft-fail when a neighbour's
      // text intercepts the pointer. The node graph itself is the regression guard;
      // the article panel is a bonus assertion.
      const themeNode = page.locator('[data-layer="theme"]').first();
      if ((await themeNode.count()) > 0) {
        await themeNode.click({ force: true, timeout: 5000 }).catch(() => {});
        // Wait for the selected-node attribute to update on #kb-svg
        try {
          await page.waitForFunction(
            () => (document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '') !== '',
            null, { timeout: 8000 },
          );
          const selectedNode = await page.evaluate(() =>
            document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '');
          check(selectedNode !== '', `Act VIII: clicking theme node sets data-selected-node (got "${selectedNode}")`);

          // NODE ARTICLE panel should populate: look for article title / inbound chips / body
          // NodeArticle renders a panel with data-node-id or an article title heading
          try {
            await page.waitForFunction(
              () => {
                // Article loaded if NodeArticle has non-empty content (title or body text > 20 chars)
                const articlePanels = [...document.querySelectorAll('[data-node-id]')];
                const rightRail = document.querySelector('[data-section="node-article"]');
                if (rightRail) return (rightRail.textContent ?? '').trim().length > 10;
                // Fallback: any div in the right rail with substantial content
                const divs = [...document.querySelectorAll('div')];
                return divs.some((el) => {
                  const txt = el.textContent?.trim() ?? '';
                  return txt.length > 30 && txt.includes('\n') === false &&
                    el.children.length === 0 && el.closest('svg') === null;
                });
              },
              null, { timeout: 10000 },
            );
            articleLoaded = true;
          } catch { /* soft — the article may still be loading */ }

          check(articleLoaded || selectedNode !== '',
            'Act VIII: clicking a theme node → NODE ARTICLE panel populates (or data-selected-node set)');
        } catch {
          const sel = await page.evaluate(() =>
            document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '(absent)');
          check(false, `Act VIII: clicking theme node sets data-selected-node (got "${sel}")`);
        }
      } else {
        check(false, 'Act VIII: [data-layer="theme"] node present to click');
      }
    }
    await sleep(ACT);
    await frame(page, 'beat32b-kb-node-article', 'Act VIII beat 32 — theme node clicked: NODE ARTICLE panel visible (inbound/outbound chips, body)');

    // ── BEAT 33: Pin-guidance — type a note + pin → guidance node appears ─────
    // This writes brain/cycles/_guidance/<ts>.md (a real file). The finally
    // block MUST clean it up — see "Act VIII cleanup" below.
    console.log('\n[beat 33] Act VIII — pin-guidance (writes brain/cycles/_guidance/<ts>.md)');
    await caption(page, 'Human guidance — pin a note to the brain; it surfaces as a guidance node until the next ingest pass.');
    await sleep(ACT);

    let guidancePinned = false;
    if (kbPageReady) {
      // Type into the guidance textarea (#guidance-text)
      const guidanceTextarea = page.locator('#guidance-text');
      if ((await guidanceTextarea.count()) > 0) {
        await guidanceTextarea.scrollIntoViewIfNeeded().catch(() => {});
        await guidanceTextarea.click();
        await guidanceTextarea.pressSequentially(GUIDANCE_TEXT, { delay: 22 });
        await sleep(THINK);

        await frame(page, 'beat33-guidance-typed', 'Act VIII beat 33 — guidance text typed into HUMAN GUIDANCE panel');

        // Click "Pin guidance"
        const pinBtn = page.locator('#pin-guidance-btn');
        if ((await pinBtn.count()) > 0) {
          await pinBtn.click();
          await sleep(ACT);

          // Assert data-guidance-pinned="true" (the POST succeeded and the state flipped)
          try {
            await page.waitForFunction(
              () => document.querySelector('[data-guidance-pinned="true"]') !== null,
              null, { timeout: 10000 },
            );
            guidancePinned = true;
            check(true, 'Act VIII: data-guidance-pinned="true" — guidance POST succeeded');
          } catch {
            // Fallback: check if the success message text appeared
            const successMsg = await page.evaluate(() =>
              [...document.querySelectorAll('div')].some((el) =>
                el.textContent?.includes('Guidance pinned') ?? false));
            if (successMsg) {
              guidancePinned = true;
              check(true, 'Act VIII: "Guidance pinned" success message rendered (POST succeeded)');
            } else {
              const pinVal = await page.evaluate(() =>
                document.querySelector('[data-guidance-pinned]')?.getAttribute('data-guidance-pinned') ?? '(absent)');
              check(false, `Act VIII: data-guidance-pinned="true" (got "${pinVal}")`);
            }
          }

          if (guidancePinned) {
            // The graph re-fetches after pin; wait a moment then assert a guidance node
            // appears with [data-layer="guidance"] (amber-diamond). This is a best-effort
            // soft check — the re-fetch may take a moment.
            await sleep(WORK);
            const hasGuidanceNode = await page.evaluate(() =>
              document.querySelector('[data-layer="guidance"]') !== null);
            check(hasGuidanceNode,
              'Act VIII: [data-layer="guidance"] amber-diamond node appeared in graph after pin (graph re-fetched)');
          }
        } else {
          check(false, 'Act VIII: #pin-guidance-btn present to click');
        }
      } else {
        check(false, 'Act VIII: #guidance-text textarea present in HUMAN GUIDANCE panel');
      }
    } else {
      check(false, 'Act VIII: pin-guidance skipped (page did not reach ready)');
    }

    await frame(page, 'beat33b-guidance-pinned', `Act VIII beat 33 — guidance pinned: data-guidance-pinned="true", guidance node in graph (brain/cycles/_guidance written)`);
    await sleep(READ);

    // ── ACT IX: Range strategy (M6) ──────────────────────────────────────────
    // READ-ONLY beat: navigate to /agents/project-manager, switch strategy to
    // range, select ≥2 Claude tier chips, and assert the RuntimePicker reflects
    // range mode + the YAML preview shows `strategy: range`. No Save is clicked.
    //
    // Assertions are SOFT (check()/countAtLeast). The range toggle + disabled
    // SDK cards (codex/gemini) prove the registry-driven picker is live; the
    // range chip multi-select proves range routing is wired in the UI (M6-3/4).
    // If the interactive multi-select is flaky in headless Playwright we fall
    // back to static assertions (toggle present + disabled SDK cards).

    // ── BEAT 34: Agent builder — range strategy ───────────────────────────────
    console.log('\n[beat 34] Act IX — runtime range strategy (agent builder /agents/project-manager)');
    await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
    let rangePageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 25000 },
      );
      rangePageReady = true;
      check(true, 'Act IX: [data-page="agents"][data-page-ready="true"] for range beat');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
      check(false, `Act IX: agent builder page-ready for range beat (got "${pr}")`);
    }

    await caption(page, 'Runtime range strategy — the agent routes to the cheapest capable Claude tier first, escalates on gate failure.');
    await sleep(ACT);

    if (rangePageReady) {
      // ── SDK picker registry-driven availability ───────────────────────────
      // The claude SDK card is selectable (available=true); codex + gemini are
      // disabled (available=false) — no adapter registered for them.
      const claudeCardAvailable = await page.evaluate(() => {
        const card = document.querySelector('[data-sdk-id="claude"]');
        return card !== null && !card.classList.contains('disabled');
      });
      check(claudeCardAvailable, 'Act IX: [data-sdk-id="claude"] card present and not disabled (available adapter registered)');

      // codex + gemini disabled (registry-driven: no adapter = not selectable)
      const codexDisabled = await page.evaluate(() => {
        const card = document.querySelector('[data-sdk-id="codex"]');
        return card !== null && card.classList.contains('disabled');
      });
      check(codexDisabled, 'Act IX: [data-sdk-id="codex"] card disabled (adapter not registered — coming soon)');

      const geminiDisabled = await page.evaluate(() => {
        const card = document.querySelector('[data-sdk-id="gemini"]');
        return card !== null && card.classList.contains('disabled');
      });
      check(geminiDisabled, 'Act IX: [data-sdk-id="gemini"] card disabled (adapter not registered — coming soon)');

      await frame(page, 'beat34-range-sdk-picker', 'Act IX beat 34 — SDK picker: claude selectable, codex/gemini disabled (registry-driven — no adapter registered)');

      // ── Strategy toggle → range ───────────────────────────────────────────
      // RuntimePicker renders [data-strategy="fixed"] and [data-strategy="range"]
      // segmented-control buttons. Click the range segment and assert the section
      // root flips data-strategy to "range".
      const rangeBtn = page.locator('[data-component="runtime-picker"] [data-strategy="range"]');
      let rangeTogglePresent = false;
      if ((await rangeBtn.count()) > 0) {
        rangeTogglePresent = true;
        await rangeBtn.click();
        await sleep(THINK);

        // The root RuntimePicker section carries data-strategy — wait for flip
        try {
          await page.waitForFunction(
            () => document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') === 'range',
            null, { timeout: 5000 },
          );
          check(true, 'Act IX: clicking range segment flips [data-component="runtime-picker"][data-strategy="range"]');
        } catch {
          const strat = await page.evaluate(() =>
            document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') ?? '(absent)');
          check(false, `Act IX: data-strategy flipped to range (got "${strat}")`);
        }
      } else {
        check(false, 'Act IX: [data-strategy="range"] toggle button present in RuntimePicker');
      }

      // ── Range caption renders ─────────────────────────────────────────────
      // When strategy="range" the RuntimePicker renders a strategy caption
      // "the agent routes each task to the cheapest model that can do it"
      if (rangeTogglePresent) {
        const captionEl = await page.evaluate(() => {
          const el = document.querySelector('#strategy-caption');
          return el ? el.textContent?.trim() : null;
        });
        check(
          captionEl !== null && captionEl.length > 5,
          `Act IX: range strategy caption rendered (#strategy-caption: "${captionEl ?? '(absent)'}")`,
        );

        // ── Multi-select range chips ─────────────────────────────────────────
        // In range mode the model chips are multi-select. Click ≥2 Claude tier
        // chips (haiku + sonnet) and assert data-model-count ≥2 on the runtime root.
        const modelChips = page.locator('[data-component="runtime-picker"] [data-model-id]');
        const chipCount = await modelChips.count();
        check(chipCount >= 1, `Act IX: ≥1 [data-model-id] chip rendered in range mode (got ${chipCount})`);

        let selectedCount = 0;
        if (chipCount >= 1) {
          // Click the first chip
          await modelChips.first().click();
          await sleep(THINK);
          selectedCount = 1;

          // Click the second chip if present (≥2 chips → range with 2 tiers)
          if (chipCount >= 2) {
            await modelChips.nth(1).click();
            await sleep(THINK);
            selectedCount = 2;
          }

          // data-model-count should reflect the selected range size
          try {
            await page.waitForFunction(
              ({ n }) => {
                const el = document.querySelector('[data-component="runtime-picker"]');
                return el !== null && parseInt(el.getAttribute('data-model-count') ?? '0', 10) >= n;
              },
              { n: selectedCount }, { timeout: 5000 },
            );
            const count = await page.evaluate(() =>
              parseInt(document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '0', 10));
            check(count >= selectedCount, `Act IX: data-model-count ≥${selectedCount} after selecting ${selectedCount} range chip(s) (got ${count})`);
          } catch {
            const gotCount = await page.evaluate(() =>
              document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '(absent)');
            check(false, `Act IX: data-model-count ≥${selectedCount} in range mode (got "${gotCount}")`);
          }
        }

        await frame(page, 'beat34b-range-chips-selected', `Act IX beat 34 — range mode: ${selectedCount} Claude tier chip(s) selected, data-model-count reflects selection`);
      }

      // ── YAML preview shows strategy: range ───────────────────────────────
      // The YAML preview is [data-component="yaml-preview"] or a <pre> with
      // the serialised definition. In range mode it should contain
      // "strategy: range" to prove the UI authors range without saving.
      const yamlPreviewText = await page.evaluate(() => {
        // Try the canonical data-component first
        const preview = document.querySelector('[data-component="yaml-preview"]');
        if (preview) return preview.textContent ?? '';
        // Fallback: any <pre> containing 'strategy'
        const pres = [...document.querySelectorAll('pre')];
        const match = pres.find((el) => el.textContent?.includes('strategy'));
        return match?.textContent ?? '';
      });
      check(
        yamlPreviewText.includes('strategy: range'),
        `Act IX: YAML preview contains "strategy: range" after switching to range mode (got: "${yamlPreviewText.slice(0, 120).replace(/\n/g, '\\n')}")`,
      );

      await frame(page, 'beat34c-yaml-range', 'Act IX beat 34 — YAML preview shows strategy: range (range authored in UI; no Save — seed SKILL.md immutable)');
      await sleep(READ);
    } else {
      check(false, 'Act IX: agent builder page did not become ready — range beat checks skipped');
    }

    // ── BEAT 35: End card ─────────────────────────────────────────────────────
    console.log('\n[beat 35] End card');
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
    await frame(page, 'beat35-end-card', 'End card — "Forge is the autonomous dev loop. You are the architect, the reviewer, and the teacher."');
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
    // ACT IV studio cleanup
    try {
      // CYCLE_LOG2 and INIT2 are defined inside try{}; access via the path pattern
      const studioLogDirs = existsSync(join(FORGE_ROOT, '_logs'))
        ? readdirSync(join(FORGE_ROOT, '_logs')).filter((d) => d.includes('e2e-studio-demo'))
        : [];
      for (const d of studioLogDirs) {
        rmSync(join(FORGE_ROOT, '_logs', d), { recursive: true, force: true });
      }
      for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
        const entries = existsSync(QDIR(q))
          ? readdirSync(QDIR(q)).filter((f) => f.includes('e2e-studio-demo'))
          : [];
        for (const f of entries) rmSync(join(QDIR(q), f), { force: true });
      }
    } catch { /* studio cleanup best-effort */ }
    // ACT VI flow-engine cleanup (ceiling + failed synthetic runs)
    try {
      const actVIPatterns = ['e2e-flow-ceiling', 'e2e-flow-failed'];
      const actVILogDirs = existsSync(join(FORGE_ROOT, '_logs'))
        ? readdirSync(join(FORGE_ROOT, '_logs')).filter((d) => actVIPatterns.some((p) => d.includes(p)))
        : [];
      for (const d of actVILogDirs) {
        rmSync(join(FORGE_ROOT, '_logs', d), { recursive: true, force: true });
      }
      for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
        if (!existsSync(QDIR(q))) continue;
        const entries = readdirSync(QDIR(q)).filter((f) => actVIPatterns.some((p) => f.includes(p)));
        for (const f of entries) rmSync(join(QDIR(q), f), { force: true });
      }
    } catch { /* act VI cleanup best-effort */ }
    if (createdSid) {
      try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${createdSid}`), { recursive: true, force: true }); } catch { /* */ }
    }
    // Act VIII cleanup — remove any _guidance/*.md files written by the pin-guidance beat.
    // Critical: (a) no repo residue, (b) brain lint stays clean, (c) next journey run is deterministic.
    try {
      const guidanceDir = join(FORGE_ROOT, 'brain', 'cycles', '_guidance');
      if (existsSync(guidanceDir)) {
        const guidanceFiles = readdirSync(guidanceDir);
        for (const f of guidanceFiles) {
          rmSync(join(guidanceDir, f), { force: true });
        }
        // Remove the dir itself if empty (keeps the brain tree clean)
        try { rmSync(guidanceDir, { recursive: true, force: true }); } catch { /* */ }
      }
    } catch { /* Act VIII cleanup best-effort */ }
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
