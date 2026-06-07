/**
 * e2e-journey — the canonical end-to-end operator journey through the
 * centralised forge UI (ADR 020 + 021), recorded as a video + frame gallery.
 *
 *   node scripts/e2e-journey.mjs
 *
 * This walks the operator's 13-step vision verbatim (docs/operator-journey.md),
 * at a watchable pace, demonstrating the TARGET high-level behaviour:
 *
 *   1.  new idea provided
 *   2.  architect reviews the project + explores edge cases
 *   3.  architect returns questions to clarify
 *   4.  operator answers → planning stage rolls them in
 *   5.  draft → review council → plan options from the council's feedback
 *   6.  on feedback, the architect reruns the last step
 *   7.  on approval → PM
 *   8.  PM decomposes the initiative's acceptance criteria directly into work items
 *   9.  developer loop progresses work items, respecting dependencies
 *   10. unifier reviews + loops to clean the output
 *   11. unifier runs the demo skill → a rich, INTERACTIVE demo page
 *   12. operator reviews + pokes the new capability live, then sends back / approves
 *   13. on approval → reflect
 *
 * No live LLM: the architect runner's turns + the autonomous cycle are emulated
 * by seeding the same files/events the real phases write (or will write, for
 * the aspirational steps), grounded in the real cycle event sequence.
 *
 * This is also the UI REGRESSION HARNESS (the old scripts/forge-ui-harness.mjs
 * S1–S4 checks were merged in here, 2026-05-30): alongside recording the video
 * it asserts the DOM-as-metrics invariants at each beat (status transitions,
 * ≥5 phase hexes, materialised WI hexes, the per-phase cost rollup, and the
 * interactive demo surfaces).
 * Assertions are SOFT — they record into `failures[]` and log ✓/✗ so the video
 * always finishes; a non-zero exit at the end flags any regression for CI.
 *
 * Output: forge-ui/.demo-shots/e2e/{video/journey.webm, frames/*.png, index.html}.
 * Cleans up the throwaway projects/_e2e-demo/ + _logs/_queue state afterwards.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'claude-harness';
const projectRoot = join(FORGE_ROOT, 'projects', PROJECT);
// SAFETY: this harness seeds + then deletes scratch. A REAL project (git-backed)
// must NEVER have its directory removed — only the demo's own scratch (the one
// architect session it creates, its cycle log, its queue manifest). A synthetic
// throwaway project (no .git) is fully removed as before. cleanProjectDir() is
// the ONLY place the project dir may be rm'd, and it refuses a git-backed dir.
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

// Watchable pacing — the recording is a continuous clip a human follows, so
// each beat dwells like a person actually working through that page.
const READ = 4200;  // a page the operator reads carefully (plan, demo)
const WORK = 3200;  // watching autonomous work happen (events fire during this)
const ACT = 1500;   // a brief beat after an action (a click, an answer)
const THINK = 1000; // between live tool bursts so the hex visibly pulses
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QDIR = (q) => join(FORGE_ROOT, '_queue', q);

// ---- emulation helpers (write what the real phases write) -----------------

function archDir(sid) { return join(projectRoot, '_architect', sid); }
function writeStatus(sid, status) {
  const dir = archDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...status, session_id: sid, project: PROJECT, project_repo_path: projectRoot, updated_at: new Date().toISOString() }, null, 2));
}
let archSeq = 0;
function archEvent(sid, eventType, message, metadata = {}) {
  const dir = join(FORGE_ROOT, '_logs', `_architect-${sid}`);
  mkdirSync(dir, { recursive: true });
  archSeq += 1;
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({
    event_id: `EV_arch_${archSeq}`, cycle_id: `_architect-${sid}`, initiative_id: `architect-session-${sid}`,
    started_at: new Date().toISOString(), phase: 'architect', skill: 'architect-runner',
    event_type: eventType, input_refs: [], output_refs: [], message, metadata,
  }) + '\n');
}
/** Stream a sequence of architect tool bursts so the hex visibly pulses, with a
 *  pause between each (step 2: reviewing the project + exploring edge cases). */
async function burst(sid, tools) {
  for (const t of tools) { archEvent(sid, 'tool_use', `tool.${t}`, { tool: t }); await sleep(THINK); }
}
/** Fire a sequence of cycle events with a gap between each, so the live hex
 *  pipeline visibly advances as work is (mock-)done rather than jumping. */
async function paced(thunks, gap = THINK) {
  for (const fn of thunks) { fn(); await sleep(gap); }
}

function writeQuestions(sid) {
  writeFileSync(join(archDir(sid), 'questions.json'), JSON.stringify([
    { question: 'Which sections should --compact include?', header: 'Sections',
      options: [
        { label: 'Title + verdict + cost', description: 'A 3-line terminal glance: "# Trail — INIT-X", "Verdict: approve", "Total: $0.24".' },
        { label: 'Full Summary block', description: 'Keep the whole ## Summary section — about 6 lines.' },
      ] },
    { question: 'How should --compact interact with --format json?', header: 'JSON compat',
      options: [
        { label: 'Markdown-only — error on json', description: '--compact is a display shortcut; combining with --format json exits non-zero.' },
        { label: 'Orthogonal — both work', description: 'Emit a minimal JSON object with the compact fields.' },
      ] },
  ], null, 2));
}
function writePlan(sid, round) {
  const dir = archDir(sid);
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'manifests', `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
    `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: pending',
    'origin: architect', '---', '',
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
  writeFileSync(join(dir, 'escalations.json'), JSON.stringify([
    { id: 'esc-0', critic: 'design', question: 'What does --compact show when the cycle has no verdict yet?',
      options: [{ label: 'Placeholders', rationale: 'Keep the strict 3-line shape: "Verdict: (unknown)", "Total: $0.00".' }, { label: 'Error', rationale: 'Refuse — --compact is for completed cycles only.' }] },
    { id: 'esc-1', critic: 'eng', question: 'Should --compact compose with --out (write to file)?',
      options: [{ label: 'Reject --out', rationale: 'Pure terminal-glance; stay stdout-only + single-cycle.' }, { label: 'Support --out', rationale: 'Pipe a compact summary to a file for CI/Slack.' }] },
  ], null, 2));
  writeStatus(sid, { phase: 'awaiting-verdict', round, idea: IDEA });
}

let cycleSeq = 0;
function cycleEvent(phase, eventType, message, opts = {}) {
  // `skill` defaults to the phase (the canonical case) but can be OVERRIDDEN via
  // opts.skill. The unifier emits `phase: 'unifier'` directly now (the Fix-B
  // root-unify, 2026-06-07): it is its own phase, not a developer-loop sub-phase,
  // so there is no UI skill→phase remap any more. Unifier beats are seeded via
  // `unifierEvent` below with phase 'unifier' (+ skill 'developer-unifier' for
  // fidelity) so they light the dedicated unifier hex.
  const { metadata = {}, skill = phase, ...extras } = opts;
  mkdirSync(CYCLE_LOG, { recursive: true });
  cycleSeq += 1;
  appendFileSync(join(CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id: `EV_cyc_${cycleSeq}`, cycle_id: CYCLE_ID, initiative_id: INIT,
    started_at: new Date().toISOString(), phase, skill, event_type: eventType,
    input_refs: [], output_refs: [], message, metadata, ...extras,
  }) + '\n');
}
// Sugar for the unifier phase: post Fix-B it emits `phase: 'unifier'` directly
// (its own identity, not a developer-loop sub-phase). skill='developer-unifier'
// is kept for fidelity with the real runtime. This lights the dedicated unifier hex.
function unifierEvent(eventType, message, opts = {}) {
  return cycleEvent('unifier', eventType, message, { ...opts, skill: 'developer-unifier' });
}
function moveManifest(from, to) {
  mkdirSync(QDIR(to), { recursive: true });
  // Robust to the REAL bridge having moved the manifest out from under us — the
  // /review send-back now does a real requeue (ui-bridge /api/verdict → runRequeue
  // moves ready-for-review → pending, ADR 019/D1), so a hard-coded `from` ENOENTs.
  // Find the manifest wherever it currently lives.
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
  // The real captured output the `live-query` interactive surface serves — the
  // operator runs it right on the review page to SEE what `--compact` prints
  // (interactive review, re-review #8), not just read a metric table.
  writeFileSync(join(artifacts, 'compact-output.txt'),
    '# Trail — INIT-2026-06-04-demo-cycle\nVerdict: approve\nTotal: $0.24\n');
  writeFileSync(join(artifacts, 'demo.json'), JSON.stringify({
    title: `claude-trail --compact: a 3-line glance view${revision > 1 ? ' (round ' + revision + ')' : ''}`,
    essence: 'Running `claude-trail <id> --compact` now prints a terse 3-line summary (title / Verdict / Cost) instead of the full multi-section trail. Mutually exclusive with --format json / --out / --since; default output unchanged.',
    project: PROJECT, initiativeId: INIT, baseRef: 'main', changedRef: `forge/${INIT}`,
    diffStat: ' src/trail.ts                 | 18 ++++\n src/cli.ts                   | 30 ++++--\n tests/compact-flag.test.ts   | 292 +++++++++\n 3 files changed, 334 insertions(+)',
    acceptanceCriteria: [
      'GIVEN a cycle WHEN `claude-trail <id> --compact` THEN stdout is exactly the title, Verdict, and Total cost (3 lines)',
      `GIVEN --compact combined with --format json WHEN the command runs THEN it exits non-zero${revision > 1 ? ' and stderr names BOTH flags (added this round on review feedback)' : ''}`,
    ],
    // ── Rich git-truth sections (the current demo contract — REV-4 / Wave C) ──
    summary: {
      bullets: [
        'Added a `--compact` flag to `claude-trail` — a 3-line glance (title / Verdict / Cost).',
        'Default (full) output is byte-for-byte unchanged — no regression.',
        '`--compact` is mutually exclusive with `--format json` / `--out` / `--since` (exits non-zero).',
      ],
      branch: `forge/${INIT}`,
      commitSha: 'a1b2c3d',
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
      { label: 'compact', kind: 'harness', caption: 'The 3-line glance matches the golden byte-for-byte',
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
    // ── Interactive review surfaces (re-review #8, Stage 0/1) ──
    interactiveSurfaces: [
      { kind: 'live-query', label: 'Show the real `--compact` output (captured)', artifact: 'compact-output.txt' },
      { kind: 'cli-run', label: 'Re-run `claude-trail … --compact` yourself', seed: 'claude-trail INIT-2026-06-04-demo-cycle --compact' },
    ],
  }, null, 2));
}

/** Emulate the reflector's Stage-2 emit: the operator-facing questions it writes
 *  to `_logs/<cycleId>/user-questions.json` for the reflect screen to render. */
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

// ---- boot + frames --------------------------------------------------------

async function startWatch() {
  try { execSync('fuser -k 4123/tcp 4124/tcp', { stdio: 'ignore' }); } catch { /* none */ }
  await sleep(800);
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath, ['--experimental-strip-types', 'orchestrator/cli.ts', 'watch', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let uiUrl = null, bridgeUrl = null;
    const onData = (chunk) => {
      const t = chunk.toString();
      const u = t.match(/http:\/\/localhost:\d+/); const b = t.match(/bridge at (http:\/\/127\.0\.0\.1:\d+)/);
      if (b && !bridgeUrl) bridgeUrl = b[1];
      if (u && !uiUrl) uiUrl = u[0];
      if (t.includes('Ready in') && uiUrl && bridgeUrl) res({ proc, uiUrl, bridgeUrl });
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData); proc.on('error', rej);
    setTimeout(() => { if (!uiUrl || !bridgeUrl) rej(new Error('watch not ready in 90s')); }, 90000);
  });
}

const captions = [];
let seq = 0;
async function frame(page, name, caption) {
  seq += 1;
  const file = `${String(seq).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(FRAMES, file), fullPage: true });
  captions.push({ file, caption });
  console.log(`  [${String(seq).padStart(2, '0')}] ${caption}`);
}
function writeIndex(videoName) {
  const figs = captions.map((c) => `<figure><img src="frames/${c.file}" loading="lazy"/><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`).join('\n');
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>forge — e2e operator journey</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui;margin:32px auto;max-width:1280px;padding:0 24px}
h1{letter-spacing:.4px}video{width:100%;border:1px solid #30363d;border-radius:8px;background:#000}
figure{margin:24px 0;padding:0}figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
figcaption{color:#8b949e;font-size:12px;padding-top:6px}code{color:#d2a8ff}ol{line-height:1.8}</style></head>
<body><h1>forge — end-to-end operator journey (centralised UI)</h1>
<p>The operator's 13-step vision (docs/operator-journey.md), walked at a watchable pace. Recorded ${new Date().toISOString()}.</p>
<h2>video</h2><video src="${videoName}" controls autoplay muted loop></video>
<h2>frames</h2>${figs}</body></html>`);
}

// ---- assertions (the regression layer, merged from forge-ui-harness) -------
// Soft asserts: every check runs and records, the video always finishes, and a
// non-zero exit at the end flags any DOM-as-metrics invariant that regressed.
const failures = [];
function check(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); }
  else { failures.push(msg); console.error(`  ✗ ${msg}`); }
}
async function countAtLeast(page, selector, n, msg) {
  // Poll — these counts depend on events streaming from the bridge tail and/or a
  // cost re-fetch (≤10s), so a one-shot read RACES the propagation (the old
  // flakiness: WI hexes / cost intermittently read 0). Wait, then report the real count.
  try {
    await page.waitForFunction(({ s, k }) => document.querySelectorAll(s).length >= k, { s: selector, k: n }, { timeout: 15000 });
  } catch { /* fall through and report the actual count */ }
  const got = await page.evaluate((s) => document.querySelectorAll(s).length, selector);
  check(got >= n, `${msg} (found ${got}, want ≥${n})`);
}
/** Poll the dashboard cycle card for an expected data-cycle-status. */
async function expectCycleStatus(page, status) {
  try {
    await page.waitForFunction(
      ({ id, s }) => document.querySelector(`[data-cycle-id="${id}"]`)?.getAttribute('data-cycle-status') === s,
      { id: CYCLE_ID, s: status }, { timeout: 8000 },
    );
    check(true, `cycle status → ${status}`);
  } catch {
    const got = await page.evaluate((id) => document.querySelector(`[data-cycle-id="${id}"]`)?.getAttribute('data-cycle-status') ?? '(absent)', CYCLE_ID);
    check(false, `cycle status → ${status} (got "${got}")`);
  }
}
/** Highest data-phase-cost-usd across the pipeline hexes (the cost rollup, S3). */
async function maxPhaseCost(page) {
  return page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-phase-hex]')]
    .map((e) => parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0)));
}
/** Poll for the per-phase cost rollup to populate (fetchCost re-fetches ≤10s),
 *  then assert — avoids the one-shot race where cost reads 0 before the fetch. */
async function expectPhaseCost(page, msg) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-phase-hex]')].some((e) => (parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0),
      null, { timeout: 15000 },
    );
  } catch { /* report the real value below */ }
  check(await maxPhaseCost(page) > 0, msg);
}
/** Click the first hex matching `hexSelector` and assert the HexDetailDrawer
 *  opens with the expected kind. Guards the regression where only WI hexes were
 *  clickable (phase-hex wrappers had pointer-events:none). Closes after. */
async function expectHexOpensDrawer(page, hexSelector, kind, label) {
  const el = page.locator(hexSelector).first();
  if ((await el.count()) === 0) { check(false, `${label}: no ${hexSelector} present to click`); return; }
  // Settle on the hex before clicking so the click isn't a flash.
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
  // Watchable: let the viewer READ the OPEN drawer (and capture a frame of it
  // open) before closing — otherwise the menu just flashes open-and-shut.
  if (opened) {
    await sleep(READ);
    await frame(page, `hex-detail-${kind}`, `Hex detail — clicking a ${kind} hex opens the detail drawer (held open)`);
  }
  const close = page.locator('[data-action="close-hex-detail"]');
  if ((await close.count()) > 0) {
    await sleep(ACT);          // pause before closing so open→close reads as deliberate
    await close.click();
    await page.waitForSelector('[data-section="hex-detail"]', { state: 'detached', timeout: 3000 }).catch(() => {});
    await sleep(ACT);          // settle after the drawer closes
  }
}

// ---- the journey ----------------------------------------------------------

async function main() {
  cleanProjectDir(); // synthetic only — a real (git-backed) project dir is preserved
  mkdirSync(join(projectRoot, '_architect'), { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(VIDEO, { recursive: true });

  console.log('[e2e] booting forge watch (cold compile ~20-40s)…');
  const watch = await startWatch();
  console.log(`[e2e] ready: ${watch.uiUrl}`);
  try { execSync(`curl -s -m 60 ${watch.uiUrl}/ -o /dev/null`); } catch { /* warm */ }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1380, height: 1600 }, recordVideo: { dir: VIDEO, size: { width: 1380, height: 1600 } } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

  let createdSid = null;
  try {
    // STEP 1 — new idea provided.
    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="new-idea"]', { timeout: 10000 });
    await sleep(ACT); // let the dashboard settle before the operator starts typing
    await page.locator('[data-section="new-idea"] [data-field="project"]').fill(PROJECT);
    // Type the idea like a person would, not a paste, so the video shows it being written.
    await page.locator('[data-section="new-idea"] [data-field="idea"]').click();
    await page.locator('[data-section="new-idea"] [data-field="idea"]').pressSequentially(IDEA, { delay: 28 });
    await sleep(THINK);
    await frame(page, 'step01-new-idea', 'Step 1 — the operator types the idea on the dashboard');
    // Show the deliberate button press that kicks off the architect.
    await page.locator('[data-action="start-architect"]').hover();
    await sleep(ACT);
    await frame(page, 'step01b-start', 'Step 1 — the operator presses "Start architect"');
    await page.locator('[data-action="start-architect"]').click();
    await page.waitForURL(/\/architect\//, { timeout: 15000 });
    const sid = decodeURIComponent(page.url().split('/architect/')[1]);
    createdSid = sid; // tracked so cleanup can scope to this session on a real project
    console.log(`[e2e] architect session: ${sid}`);

    // STEP 2 — architect reviews the project + explores edge cases (live hex bursts).
    writeStatus(sid, { phase: 'interviewing', round: 1, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=interviewing, round=1)');
    await page.waitForSelector('[data-component="architect-hex"]', { timeout: 15000 });
    await sleep(ACT); // settle on the architect screen before the live bursts begin
    await burst(sid, ['Read', 'Grep', 'Glob', 'Read', 'Grep']); // reviewing project + brain, exploring edge cases
    await frame(page, 'step02-architect-explores', 'Step 2 — the architect reviews the project + explores edge cases (live bursts on the hex)');

    // STEP 3 — architect returns questions to clarify.
    writeQuestions(sid);
    writeStatus(sid, { phase: 'awaiting-answers', round: 1, idea: IDEA });
    archEvent(sid, 'log', 'interview round 1 — 2 question(s) for the operator');
    await page.waitForSelector('[data-section="architect-interview"]', { timeout: 15000 });
    await sleep(READ);
    await frame(page, 'step03-architect-questions', 'Step 3 — the architect returns clarifying questions');

    // STEP 4 — operator answers; planning stage rolls them in.
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check();
    await page.locator('[data-question-index="1"] input[type="radio"]').first().check();
    await sleep(THINK);
    await frame(page, 'step04-operator-answers', 'Step 4 — the operator answers; the architect will roll the answers into planning');
    await page.locator('[data-action="submit-answers"]').click();
    await sleep(ACT);
    // The architect takes its planning turn; the screen updates live (WS) — no reload.
    writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=drafting) — rolling in answers');
    await page.waitForSelector('[data-section="architect-interview"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await burst(sid, ['Read', 'Edit']);
    await frame(page, 'step04b-planning', 'Step 4 — planning stage: the architect drafts with the answers folded in');

    // STEP 5 — draft → review council → plan options from the council's feedback.
    archEvent(sid, 'tool_use', 'tool.council', { tool: 'council:ceo/eng/design/dx' });
    await burst(sid, ['council', 'council', 'council']);
    writePlan(sid, 1);
    archEvent(sid, 'log', 'plan-emitted (council surfaced 2 design decisions)');
    await page.waitForSelector('[data-section="plan-gate"]', { timeout: 15000 });
    await sleep(READ);
    await frame(page, 'step05-council-plan', 'Step 5 — the council reviewed the draft; the plan presents options shaped by its feedback');

    // STEP 6 — on operator feedback, the architect reruns the last step.
    await page.locator('[data-component="plan-gate"] [data-field="rationale"], [data-section="plan-gate"] [data-field="rationale"]').first()
      .fill('Also reject --compact --out (not just --format json) — keep it stdout-only — before drafting.').catch(() => {});
    await frame(page, 'step06-send-back', 'Step 6 — the operator sends the plan back with feedback');
    await page.locator('[data-action="revise-plan"]').click();
    await sleep(ACT);
    // The architect reruns the last step (re-council + re-plan); the screen
    // transitions live through "drafting" back to a fresh PLAN gate.
    writeStatus(sid, { phase: 'drafting', round: 3, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=drafting) — rerun with operator feedback');
    await page.waitForSelector('[data-section="plan-gate"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await burst(sid, ['Read', 'council', 'council']);
    writePlan(sid, 2);
    archEvent(sid, 'log', 'plan-emitted (revised — --compact also rejects --out)');
    await page.waitForSelector('[data-section="plan-gate"][data-decisions-resolved="false"]', { timeout: 15000 });
    await sleep(READ);
    await frame(page, 'step06b-replan', 'Step 6 — the architect reran the last step; the revised plan is re-presented');

    // STEP 7 — on operator approval → PM. Approve, then take the natural
    // in-UI transition ("Watch it build →") back to the dashboard (client-side,
    // no reload) — the journey stays one continuous clip.
    await page.locator('[data-escalation-id="esc-0"] input[type="radio"]').first().check();
    await page.locator('[data-escalation-id="esc-1"] input[type="radio"]').first().check();
    await page.waitForSelector('[data-section="plan-gate"][data-decisions-resolved="true"]', { timeout: 5000 });
    await sleep(ACT);
    await frame(page, 'step07-approve', 'Step 7 — the operator resolves the decisions and approves');
    await page.locator('[data-action="approve-plan"]').click();
    await sleep(ACT);
    // Emulate finalize → the autonomous loop claims the initiative.
    mkdirSync(QDIR('pending'), { recursive: true });
    execSync(`cp ${join(archDir(sid), 'manifests', `${INIT}.md`)} ${join(QDIR('pending'), `${INIT}.md`)}`);
    writeStatus(sid, { phase: 'committed', round: 3, idea: IDEA });
    cycleEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
    // Record the architect's work + cost in the cycle's lineage so its hex on
    // the dashboard pipeline shows GREEN with a cost pill (the architect ran in
    // the in-UI session before this cycle).
    cycleEvent('architect', 'start', 'architect (in-UI session) — idea → plan');
    cycleEvent('architect', 'end', 'architect.end', { cost_usd: 0.46, duration_ms: 95000 });
    moveManifest('pending', 'in-flight');
    // The screen flips to "Approved — Watch it build →" once finalize lands; take it.
    await page.waitForSelector('[data-action="watch-it-build"]', { timeout: 15000 });
    await sleep(ACT);
    await page.locator('[data-action="watch-it-build"]').click(); // natural transition → dashboard
    // Settle on the destination (dashboard, our cycle present) so the screen
    // change reads as a navigation, not a pop-in/out flash.
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"]`, { timeout: 15000 });
    await sleep(ACT);
    // Explicitly SELECT our cycle so its events/cost stream into the canvas. The
    // dashboard auto-selects snapshot.live[0], which is NOT necessarily this
    // cycle when another cycle is already live (e.g. a real betterado cycle in
    // the queue) — selecting our own makes the demo robust to that and forces a
    // fetchEvents/fetchCost for THIS cycle (the WI-hex + cost-rollup source).
    await page.locator(`[data-cycle-id="${CYCLE_ID}"]`).click().catch(() => {});
    await sleep(ACT);
    await frame(page, 'step07b-to-pm', 'Step 7 — approved; "Watch it build →" lands on the dashboard, cycle live');
    // S1 + S4: the cycle is live and the pipeline spine renders for it.
    await expectCycleStatus(page, 'in-flight');
    await countAtLeast(page, '[data-phase-hex]', 5, 'pipeline spine shows ≥5 phase hexes');

    // STEP 8 — PM decomposes initiative ACs directly into work items (events stream live).
    await paced([
      () => cycleEvent('project-manager', 'start', 'pm phase start'),
      () => cycleEvent('project-manager', 'tool_use', 'pm.brain-query', { metadata: { tool: 'brain-query' } }),
      () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1' } }),
      () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-2' } }),
      () => cycleEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.31, duration_ms: 28000, metadata: { work_item_count: 2 } }),
    ]);
    await sleep(WORK);
    await frame(page, 'step08-pm', 'Step 8 — the PM decomposes the initiative into work items (the pipeline advances live)');
    // PM decomposition materialised the WI tier on the canvas (no feature tier).
    await countAtLeast(page, '[data-wi-hex]', 2, 'PM materialised ≥2 WI hexes');

    // S5 (operator 2026-06-02): EVERY hex kind must open the HexDetailDrawer —
    // not just work items. Regression guard for the pointer-events:none bug on
    // non-selectable phase wrappers. Feature tier is gone; only phase + wi hexes exist.
    await expectHexOpensDrawer(page, '[data-phase-hex]', 'phase', 'hex-detail');
    await expectHexOpensDrawer(page, '[data-wi-hex]', 'wi', 'hex-detail');
    await frame(page, 'step08b-hex-detail', 'Step 8b — every hex (phase / work-item) opens the detail drawer');

    // STEP 9 — developer loop progresses WIs, respecting dependencies. WI-1
    // runs and goes GREEN (per-WI `end`); only THEN does WI-2 (depends_on WI-1)
    // start. The dev-loop PHASE hex stays blue through the per-WI ends (they are
    // non-terminal for the phase) and greens on the phase-level ralph.end once
    // both WIs are done (below) — BEFORE the unifier runs.
    await paced([
      () => cycleEvent('developer-loop', 'start', 'dev-loop start'),
      () => cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-1', tool: 'Edit' } }),
      () => cycleEvent('developer-loop', 'iteration', 'WI-1 iteration', { iteration: 1, metadata: { work_item_id: 'WI-1' } }),
      () => cycleEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } }), // → WI-1 green
    ]);
    await sleep(WORK);
    await frame(page, 'step09-dev-loop', 'Step 9 — WI-1 done (green); WI-2 (depends on WI-1) only now starts');
    await paced([
      () => cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } }),
      () => cycleEvent('developer-loop', 'iteration', 'WI-2 iteration', { iteration: 1, metadata: { work_item_id: 'WI-2' } }),
      () => cycleEvent('developer-loop', 'end', 'WI-2 complete', { metadata: { work_item_id: 'WI-2' } }), // → WI-2 green
      // Matches the real runtime: the dev-loop PHASE end (ralph.end, no
      // work_item_id, WI-only cost) fires once the WIs are done — BEFORE the
      // unifier runs (developer-loop.ts emits this end before calling runUnifier).
      // So the dev-loop hex GREENS here and the unifier is the only active hex
      // during its run; the unifier's cost is its own, not the dev-loop's.
      () => cycleEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.92, duration_ms: 140000 }), // → dev-loop hex green
    ]);
    await sleep(WORK);
    await frame(page, 'step09b-wis-green', 'Step 9 — both work items green and the dev-loop hex GREENS (WIs done, WI-only cost); the unifier runs next on its own hex');

    // STEP 10 — unifier reviews + loops to clean the output. These events carry
    // phase 'unifier' (via unifierEvent; Fix-B root-unify) so they land on the
    // unifier's OWN hex directly — no UI remap. The unifier hex goes BLUE here
    // (start, no end yet) and we dwell so it is visibly blue/pulsing before it
    // greens on its phase-level end in Step 11.
    await paced([
      () => unifierEvent('start', 'unifier.start — reviewing the merged work-item output'),
      () => unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: npm test' } }),
      () => unifierEvent('log', 'unifier.gate — initiative gate green; cleaning output'),
    ], WORK); // pace each beat by WORK so the unifier hex is visibly blue between them
    await sleep(WORK);
    await frame(page, 'step10-unifier-clean', 'Step 10 — the unifier (its own hex, blue) reviews the whole branch and loops to clean the output');

    // STEP 11 — unifier runs the demo skill → forge-ui-themed demo page; cycle ready.
    // The demo-skill beats are the unifier's (phase 'unifier'), then the unifier's
    // OWN phase-level `end` (no work_item_id) greens the unifier hex — paced AFTER
    // a visibly-blue dwell. (The dev-loop hex already greened at WI-completion,
    // above — the unifier is a separate phase with its own cost.)
    await paced([
      () => unifierEvent('log', 'unifier.demo-skill — authoring demo.json (forge-ui themed)'),
      () => unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: forge demo render' } }),
      // The unifier finishes: phase-level `end` (no work_item_id) on the
      // developer-unifier skill → the unifier hex goes GREEN with its cost pill.
      () => { writeDemoJson(1); unifierEvent('end', 'unifier.end — demo authored, branch clean', { cost_usd: 0.18, duration_ms: 46000 }); },
      // Review phase OPENS (hex goes blue) — but it does NOT close out until the
      // operator finishes reviewing (the closeout fires on approve, step 13).
      () => cycleEvent('review-loop', 'start', 'review-loop start'),
      () => cycleEvent('review-loop', 'log', 'reviewer.pr-opened'),
    ], WORK); // dwell WORK between beats so the unifier hex is visibly blue, then visibly greens
    moveManifest('in-flight', 'ready-for-review');
    await page.waitForSelector(`[data-action="open-review"][href*="${INIT}"]`, { timeout: 15000 });
    // Key beat: the unifier hex has just greened and the cycle is reviewable —
    // dwell at READ length so the viewer sees the unifier complete (not a flash).
    await sleep(READ);
    await frame(page, 'step11-demo-ready', 'Step 11 — the unifier (its own hex, now green) ran the demo skill; a "Review →" entry appears');
    // S1 + S3: the cycle is reviewable and the per-phase cost rollup is live
    // (architect / PM / dev-loop have all reported cost by now).
    await expectCycleStatus(page, 'ready-for-review');
    await expectPhaseCost(page, 'cost rollup: a phase hex shows cost > 0');

    // STEP 12 — operator reviews; Ralph dev-loops rerun with operator input until approve.
    await sleep(ACT); // settle before the navigation click
    await page.locator(`[data-action="open-review"][href*="${INIT}"]`).click(); // natural transition → review
    await page.waitForSelector('main[data-page="review-cycle"][data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await sleep(READ); // let the review page settle + be read, not a pop-in
    await frame(page, 'step12-review-demo', 'Step 12 — the operator reviews the themed demo page');

    // STEP 12a — interactive review (re-review #8): the operator doesn't just READ
    // the demo, they POKE the new capability on the review page — running the
    // captured `--compact` output live to see exactly what it prints.
    const hasInteractive = await page.locator('[data-section="demo-interactive"]').count() > 0;
    check(hasInteractive, 'review page renders the interactive "Try it" surfaces');
    if (hasInteractive) {
      const liveQuery = page.locator('[data-interactive-surface="live-query"] [data-action="run-live-query"]');
      if (await liveQuery.count() > 0) {
        await liveQuery.first().click();
        await page.waitForSelector('[data-interactive-surface="live-query"][data-surface-state="done"]', { timeout: 8000 }).catch(() => {});
        await sleep(READ);
        const ran = await page.locator('[data-interactive-surface="live-query"][data-surface-state="done"]').count() > 0;
        check(ran, 'interactive: the live-query surface ran and rendered the captured output');
        await frame(page, 'step12a-interactive', 'Step 12 — the operator runs the captured --compact output right on the review page (interactive review)');
      }
    }

    // Send back with a new acceptance criterion.
    await page.locator('[data-component="verdict-form"] input[type="radio"]').nth(1).check();
    await page.locator('[data-component="verdict-form"] textarea').fill('Close — but the --compact + --format json error must name BOTH flags before this merges.');
    await page.locator('[data-component="verdict-form"] [data-section="acceptance-criteria"] input').nth(0).fill('a cycle dir and the flags --compact --format json');
    await page.locator('[data-component="verdict-form"] [data-section="acceptance-criteria"] input').nth(1).fill('claude-trail is run');
    await page.locator('[data-component="verdict-form"] [data-section="acceptance-criteria"] input').nth(2).fill('it exits non-zero and stderr names both --compact and json');
    await sleep(ACT);
    await frame(page, 'step12b-send-back', 'Step 12 — operator sends back with a new acceptance criterion (error must name both flags)');
    await page.locator('[data-action="send-back"]').click();
    await sleep(ACT);
    // Return to the dashboard (natural) while the dev-loop reruns on the feedback.
    await page.locator('[data-action="back-to-dashboard"]').click();
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 });
    await sleep(ACT); // settle on the dashboard before work streams in
    moveManifest('ready-for-review', 'in-flight');
    // The rerun re-exercises the unifier's demo-skill too, so its demo-skill beat
    // is a unifierEvent (own hex) and the round closes with the unifier's own
    // phase-level `end` (re-greens the unifier hex) alongside ralph.end (dev hex).
    await paced([
      () => cycleEvent('developer-loop', 'start', 'dev-loop rerun — addressing review feedback'),
      () => cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } }),
      () => unifierEvent('log', 'unifier.demo-skill — re-rendering demo.json (error names both flags)'),
      () => { writeDemoJson(2); unifierEvent('end', 'unifier.end (round 2) — demo re-rendered', { cost_usd: 0.06 }); },
      () => cycleEvent('developer-loop', 'end', 'ralph.end (round 2)'),
    ]);
    moveManifest('in-flight', 'ready-for-review');
    await sleep(WORK);
    await frame(page, 'step12c-rerun', 'Step 12 — the dev-loop reran on the operator feedback; back to "Review →"');
    // Re-review: the updated demo + a fresh verdict.
    await sleep(ACT); // settle before the navigation click
    await page.locator(`[data-action="open-review"][href*="${INIT}"]`).click();
    await page.waitForSelector('main[data-page="review-cycle"][data-page-ready="true"]', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await sleep(READ); // let the re-review page settle + be read
    await frame(page, 'step12d-re-review', 'Step 12 — the operator re-reviews the updated demo (error now names both flags)');

    // STEP 13 — approve → merge → reflect (its own page) → done.
    await page.locator('[data-component="verdict-form"] textarea').fill('LGTM — 3-line glance, default output unchanged, and the conflict error names both flags. All ACs met.');
    await sleep(ACT);
    await frame(page, 'step13-approve', 'Step 13 — the operator approves');
    await page.locator('[data-action="approve-and-merge"]').click();
    await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
    // NOW the review phase closes out (it stayed blue all through the operator's
    // review): the review-loop ends + closure merges → the review hex goes green.
    cycleEvent('review-loop', 'end', 'review-loop end — operator approved', { cost_usd: 0.21 });
    cycleEvent('closure', 'start', 'closure.start');
    cycleEvent('closure', 'log', 'closure.pr-merged');
    cycleEvent('closure', 'end', 'closure.end');
    moveManifest('ready-for-review', 'done');
    cycleEvent('reflection', 'start', 'reflection.start');
    cycleEvent('reflection', 'tool_use', 'reflection.brain-query', { metadata: { tool: 'brain-query' } });
    writeReflectionQuestions();
    await page.waitForSelector('[data-action="open-reflect"]', { timeout: 15000 });
    await sleep(ACT);
    await frame(page, 'step13b-reflect-link', 'Step 13 — merged; "Reflect on this cycle →" surfaces the final human moment');

    // The reflection screen — the third moment, in-UI.
    await sleep(ACT); // settle before the navigation click
    await page.locator('[data-action="open-reflect"]').click();
    await page.waitForSelector('main[data-page="reflect-cycle"][data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="reflect-questions"]', { timeout: 15000 });
    await sleep(READ); // let the reflect page settle + be read, not a pop-in
    await frame(page, 'step13c-reflect-page', 'Step 13 — the reflection screen asks how the cycle went');
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check();
    await page.locator('[data-field="freeform"]').fill('Dependency ordering held; the error-message send-back was the right call.');
    await sleep(ACT);
    await page.locator('[data-action="submit-reflection"]').click();
    await page.waitForSelector('[data-section="reflect-done"]', { timeout: 10000 }).catch(() => {});
    await paced([
      () => cycleEvent('reflection', 'tool_use', 'reflection.write', { metadata: { tool: 'Write brain theme' } }),
      () => cycleEvent('reflection', 'end', 'reflection.end', { cost_usd: 0.12 }),
    ]);
    await sleep(ACT);
    await frame(page, 'step13d-reflected', 'Step 13 — feedback captured; the reflector folds it into the brain');

    // The logical endpoint: the whole completed cycle with per-phase costs.
    await sleep(ACT); // settle before the navigation click
    await page.locator('[data-action="back-to-dashboard"]').click();
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 15000 });
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"]`, { timeout: 15000 }).catch(() => {});
    await sleep(ACT); // settle on the dashboard before selecting our cycle
    await page.locator(`[data-cycle-id="${CYCLE_ID}"]`).click().catch(() => {}); // select OUR completed cycle
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"][data-cycle-status="done"]`, { timeout: 15000 }).catch(() => {});
    // The final endpoint — dwell at READ length so the viewer takes in the whole
    // completed spine (every phase green, the unifier among them, with its cost).
    await sleep(READ);
    await frame(page, 'step13e-cycle-complete', 'Done — the full cycle, every phase green with its cost, in the hex pane');
    // S1 + S3 + S4 final: cycle done, the spine intact, total cost accrued.
    await expectCycleStatus(page, 'done');
    await countAtLeast(page, '[data-phase-hex]', 5, 'completed cycle still shows ≥5 phase hexes');
    await expectPhaseCost(page, 'completed cycle shows accrued per-phase cost');
    // Operator fix: the unifier is its OWN hex — its events (skill 'developer-unifier')
    // must light it up (blue→green), not fold into the dev-loop hex. Regression guard.
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-phase-hex][data-phase="unifier"]')?.getAttribute('data-phase-status') === 'complete',
        null, { timeout: 8000 },
      );
      check(true, 'unifier hex lit its own status (blue→green), not folded into dev-loop');
    } catch {
      const got = await page.evaluate(() => document.querySelector('[data-phase-hex][data-phase="unifier"]')?.getAttribute('data-phase-status') ?? '(absent)');
      check(false, `unifier hex should reach complete (got "${got}")`);
    }

    console.log('\n[e2e] journey complete.');
  } finally {
    await ctx.close();
    await browser.close();
    try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
    cleanProjectDir();            // synthetic only — preserves a real project dir
    cleanSeededSession(createdSid); // real project: drop only THIS demo's session
    rmSync(CYCLE_LOG, { recursive: true, force: true });
    for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      try { rmSync(join(QDIR(q), `${INIT}.md`), { force: true }); } catch { /* */ }
      try { rmSync(join(QDIR(q), `${INIT}.verdict-response.md`), { force: true }); } catch { /* */ }
    }
    // Only the demo's own architect-session log (not every _architect-* in _logs).
    if (createdSid) { try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${createdSid}`), { recursive: true, force: true }); } catch { /* */ } }
  }

  const vids = readdirSync(VIDEO).filter((f) => f.endsWith('.webm'));
  let videoName = vids[0] ?? '';
  if (videoName) { renameSync(join(VIDEO, videoName), join(VIDEO, 'journey.webm')); videoName = 'video/journey.webm'; }
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
