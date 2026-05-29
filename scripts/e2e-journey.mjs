/**
 * e2e-journey — the full operator journey through the centralised forge UI
 * (ADR 020 + 021), recorded as a video + frame gallery.
 *
 *   node scripts/e2e-journey.mjs
 *
 * Emulates exactly what an operator now does end-to-end, all in the UI:
 *   1. Dashboard → type a new idea → Start architect.
 *   2. /architect/<sid> → answer the interview (file-handoff) → plan ready.
 *   3. PLAN gate → resolve design decisions → Approve → manifest queued.
 *   4. Autonomous cycle (PM → dev-loop → review-loop → closure) progresses on
 *      the dashboard's grouped initiative pane + live hex pipeline.
 *   5. /review/<cycleId> → the structured demo renders → approve verdict.
 *   6. Closure merges + reflection → done.
 *
 * Grounded in the real cycle event sequence (orchestrator → project-manager →
 * developer-loop → review-loop → closure → reflection, per _logs/ archives).
 * No live LLM: the architect runner's turns + the autonomous cycle are emulated
 * by seeding the same files/events the real phases write (FORGE_ARCHITECT_NO_SPAWN).
 *
 * Output: forge-ui/.demo-shots/e2e/{video/*.webm, frames/*.png, index.html}.
 * Seeds a throwaway projects/_e2e-demo/ (gitignored) + _logs/_queue entries,
 * all cleaned up afterwards.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = '_e2e-demo';
const projectRoot = join(FORGE_ROOT, 'projects', PROJECT);
const OUT = join(FORGE_ROOT, 'forge-ui/.demo-shots/e2e');
const FRAMES = join(OUT, 'frames');
const VIDEO = join(OUT, 'video');
const IDEA = 'Add a dark-mode toggle to the settings page that follows the OS by default.';
const DATE = new Date().toISOString().slice(0, 10);
const INIT = `INIT-${DATE}-e2e-dark-mode`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const CYCLE_ID = `${STAMP}_${INIT}`;
const CYCLE_LOG = join(FORGE_ROOT, '_logs', CYCLE_ID);

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

/** Emulate the runner's interview turn: ask the operator a round of questions. */
function emulateInterviewTurn(sid, round) {
  archEvent(sid, 'start', `architect turn (phase=interviewing, round=${round})`);
  archEvent(sid, 'tool_use', 'tool.Grep', { tool: 'Grep' });
  archEvent(sid, 'tool_use', 'tool.Read', { tool: 'Read' });
  writeFileSync(join(archDir(sid), 'questions.json'), JSON.stringify([
    { question: 'Should dark mode follow the OS setting by default?', header: 'OS sync',
      options: [
        { label: 'Follow OS', description: 'Match the system theme automatically on first load.' },
        { label: 'Manual only', description: 'Default to light; the operator toggles it explicitly.' },
      ] },
    { question: 'Where should the toggle live?', header: 'Placement',
      options: [
        { label: 'Settings page', description: 'A row in the existing settings form.' },
        { label: 'Top nav', description: 'A persistent icon button in the header.' },
      ] },
  ], null, 2));
  writeStatus(sid, { phase: 'awaiting-answers', round, idea: IDEA });
  archEvent(sid, 'log', `interview round ${round} — 2 question(s) for the operator`);
}

/** Emulate the runner's draft turn: council + PLAN + manifests → awaiting verdict. */
function emulateDraftTurn(sid) {
  archEvent(sid, 'start', 'architect turn (phase=drafting)');
  for (const t of ['Read', 'Grep', 'Glob', 'Bash']) archEvent(sid, 'tool_use', `tool.${t}`, { tool: t });
  const dir = archDir(sid);
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'manifests', `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
    `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: pending',
    'origin: architect', 'features:', '  - feature_id: FEAT-1', '    title: Theme context + OS sync', '    depends_on: []',
    '  - feature_id: FEAT-2', '    title: Settings toggle UI', '    depends_on: [FEAT-1]', '---', '',
    '# Dark mode toggle', '', 'GIVEN settings WHEN toggled THEN the theme persists across reloads.',
  ].join('\n'));
  writeFileSync(join(dir, 'PLAN.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:14px ui-sans-serif,system-ui;background:#0d1117;color:#e6edf3;margin:0;padding:24px}
    h1{font-size:18px}h2{font-size:14px;color:#d2a8ff}.card{border:1px solid #30363d;border-radius:8px;padding:14px;margin:12px 0;background:#161b22}</style></head>
    <body><h1>PLAN — dark-mode toggle</h1><p>Operator brief: a dark-mode toggle that follows the OS by default.</p>
    <div class="card"><h2>FEAT-1 Theme context + OS sync</h2><p>GIVEN settings WHEN toggled THEN theme persists across reloads.</p></div>
    <div class="card"><h2>FEAT-2 Settings toggle UI</h2><p>Depends on FEAT-1. A row in the settings form.</p></div></body></html>`);
  writeFileSync(join(dir, 'escalations.json'), JSON.stringify([
    { id: 'esc-0', critic: 'design', question: 'Default theme on first load?',
      options: [{ label: 'Follow OS', rationale: 'Least surprise; matches platform conventions.' }, { label: 'Light', rationale: 'Keeps the brand default for new users.' }] },
    { id: 'esc-1', critic: 'eng', question: 'Persist the preference where?',
      options: [{ label: 'localStorage', rationale: 'Zero backend; instant.' }, { label: 'User profile', rationale: 'Syncs across devices; needs an API call.' }] },
  ], null, 2));
  writeStatus(sid, { phase: 'awaiting-verdict', round: 2, idea: IDEA });
  archEvent(sid, 'log', 'plan-emitted (1 initiative, 2 escalations)');
}

let cycleSeq = 0;
function cycleEvent(phase, eventType, message, opts = {}) {
  const { metadata = {}, ...extras } = opts;
  mkdirSync(CYCLE_LOG, { recursive: true });
  cycleSeq += 1;
  appendFileSync(join(CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id: `EV_cyc_${cycleSeq}`, cycle_id: CYCLE_ID, initiative_id: INIT,
    started_at: new Date().toISOString(), phase, skill: phase, event_type: eventType,
    input_refs: [], output_refs: [], message, metadata, ...extras,
  }) + '\n');
}

function moveManifest(from, to) {
  mkdirSync(QDIR(to), { recursive: true });
  renameSync(join(QDIR(from), `${INIT}.md`), join(QDIR(to), `${INIT}.md`));
}

/** Emulate the autonomous cycle from claim through ready-for-review, grounded
 *  in the real event sequence. Writes the structured demo.json into artifacts. */
function emulateCycle() {
  cycleEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
  cycleEvent('project-manager', 'start', 'pm phase start');
  cycleEvent('project-manager', 'tool_use', 'pm.brain-query', { metadata: { tool: 'brain-query' } });
  cycleEvent('project-manager', 'log', 'pm.feature-decomposed', { metadata: { feature_id: 'FEAT-1' } });
  cycleEvent('project-manager', 'log', 'pm.feature-decomposed', { metadata: { feature_id: 'FEAT-2' } });
  cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1', feature_id: 'FEAT-1' } });
  cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-2', feature_id: 'FEAT-2' } });
  cycleEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.31, duration_ms: 28000 });
  cycleEvent('developer-loop', 'start', 'dev-loop start');
  for (const wi of ['WI-1', 'WI-2']) {
    cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: wi, tool: 'Edit' } });
    cycleEvent('developer-loop', 'iteration', `wi ${wi} iteration`, { iteration: 1, metadata: { work_item_id: wi } });
  }
  cycleEvent('developer-loop', 'log', 'ralph.unifier demo.json authored');
  cycleEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.92, duration_ms: 140000 });
  cycleEvent('review-loop', 'start', 'review-loop start');
  cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
  cycleEvent('review-loop', 'end', 'review-loop end', { cost_usd: 0.21 });
  // Structured demo (what the unifier authors; mirrored into artifacts by snapshotCycleArtefacts).
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'demo.json'), JSON.stringify({
    title: 'Dark-mode toggle that follows the OS',
    essence: 'Adds a settings toggle; the theme now persists and defaults to the OS preference on first load.',
    project: PROJECT, initiativeId: INIT, baseRef: 'main', changedRef: `forge/${INIT}`,
    diffStat: ' src/theme.ts        | 38 ++++++++\n src/SettingsRow.tsx | 21 +++++\n 2 files changed, 59 insertions(+)',
    acceptanceCriteria: ['GIVEN settings WHEN the toggle is flipped THEN the theme persists across reloads'],
    checkpoints: [
      { label: 'sync', kind: 'harness', caption: 'Theme resolves from the OS preference on first load',
        metrics: [
          { label: 'first-paint theme matches OS', before: 'no', after: 'yes', deltaPct: null, parity: 'diverged' },
          { label: 'preference persisted across reload', before: 'no', after: 'yes', deltaPct: null, parity: 'diverged' },
        ] },
      { label: 'toggle', kind: 'screenshot', caption: 'The settings row gains a dark-mode toggle',
        beforeNote: 'No theme control existed in settings.', afterNote: 'A labelled toggle persists the choice.' },
    ],
  }, null, 2));
  cycleEvent('closure', 'start', 'closure.start');
  cycleEvent('closure', 'log', 'closure.manifest-moved-to-ready-for-review');
  cycleEvent('closure', 'end', 'closure.end');
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
  console.log(`  frame ${file} — ${caption}`);
}

function writeIndex(videoName) {
  const figs = captions.map((c) => `<figure><img src="frames/${c.file}" loading="lazy"/><figcaption><code>${c.file}</code> — ${c.caption}</figcaption></figure>`).join('\n');
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>forge — e2e operator journey</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui;margin:32px auto;max-width:1280px;padding:0 24px}
h1{letter-spacing:.4px}video{width:100%;border:1px solid #30363d;border-radius:8px;background:#000}
figure{margin:24px 0;padding:0}figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
figcaption{color:#8b949e;font-size:12px;padding-top:6px}code{color:#d2a8ff}</style></head>
<body><h1>forge — end-to-end operator journey (centralised UI)</h1>
<p>idea → architect interview → PLAN gate → autonomous cycle → review → reflection. Recorded ${new Date().toISOString()}.</p>
<h2>video</h2><video src="${videoName}" controls autoplay muted loop></video>
<h2>frames</h2>${figs}</body></html>`);
}

// ---- the journey ----------------------------------------------------------

async function main() {
  rmSync(projectRoot, { recursive: true, force: true });
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

  try {
    // 1. Dashboard — type the idea, start the architect.
    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="new-idea"]', { timeout: 10000 });
    await page.locator('[data-section="new-idea"] [data-field="project"]').fill(PROJECT);
    await page.locator('[data-section="new-idea"] [data-field="idea"]').fill(IDEA);
    await frame(page, 'dashboard-new-idea', 'Operator types a new idea on the dashboard');
    await page.locator('[data-action="start-architect"]').click();

    // The UI navigates to /architect/<sid>. Read the sid, emulate the runner's interview turn.
    await page.waitForURL(/\/architect\//, { timeout: 15000 });
    const sid = decodeURIComponent(page.url().split('/architect/')[1]);
    console.log(`[e2e] architect session: ${sid}`);
    emulateInterviewTurn(sid, 1);
    await page.waitForSelector('[data-section="architect-interview"]', { timeout: 15000 });
    await frame(page, 'architect-interview', 'Architect screen: the interview round (file-handoff) with the hex live');

    // 2. Answer the interview.
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check();
    await page.locator('[data-question-index="1"] input[type="radio"]').first().check();
    await frame(page, 'architect-interview-answered', 'Operator answers the interview questions');
    await page.locator('[data-action="submit-answers"]').click();
    await sleep(600); // bridge writes answers (spawn disabled); emulate the draft turn
    emulateDraftTurn(sid);

    // 3. PLAN gate — resolve decisions, approve.
    await page.waitForSelector('[data-section="plan-gate"]', { timeout: 15000 });
    await frame(page, 'plan-gate', 'PLAN gate: rich PLAN.html + design decisions to resolve');
    await page.locator('[data-escalation-id="esc-0"] input[type="radio"]').first().check();
    await page.locator('[data-escalation-id="esc-1"] input[type="radio"]').first().check();
    await page.waitForSelector('[data-section="plan-gate"][data-decisions-resolved="true"]', { timeout: 5000 });
    await frame(page, 'plan-gate-resolved', 'All decisions resolved — Approve enabled');
    await page.locator('[data-action="approve-plan"]').click();
    await sleep(600);
    // Emulate finalize: promote the manifest to the queue (the autonomous loop's entry).
    mkdirSync(QDIR('pending'), { recursive: true });
    execSync(`cp ${join(archDir(sid), 'manifests', `${INIT}.md`)} ${join(QDIR('pending'), `${INIT}.md`)}`);
    writeStatus(sid, { phase: 'committed', round: 2, idea: IDEA });

    // 4. Autonomous cycle progresses; back to the dashboard.
    emulateCycle();
    moveManifest('pending', 'in-flight');
    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"]`, { timeout: 15000 });
    await frame(page, 'dashboard-cycle-live', 'Dashboard: the cycle runs in the grouped initiative pane + live hex pipeline');

    // 5. Cycle reaches ready-for-review → Review screen.
    moveManifest('in-flight', 'ready-for-review');
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"][data-cycle-status="ready-for-review"]`, { timeout: 15000 }).catch(() => {});
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-action="open-review"]', { timeout: 15000 });
    await frame(page, 'dashboard-review-ready', 'Cycle ready for review — a "Review →" entry appears');
    await page.goto(`${watch.uiUrl}/review/${encodeURIComponent(CYCLE_ID)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page="review-cycle"][data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await frame(page, 'review-demo', 'Review screen: the structured demo renders (hex + before/after + metrics)');

    // 6. Approve the verdict → closure merges → reflection.
    await page.locator('[data-component="verdict-form"] textarea').fill('LGTM — follows the OS by default and persists; both ACs met.');
    await frame(page, 'review-verdict', 'Operator writes the approval rationale');
    await page.locator('[data-action="approve-and-merge"]').click();
    await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
    cycleEvent('closure', 'log', 'closure.pr-merged');
    moveManifest('ready-for-review', 'done');
    cycleEvent('reflection', 'start', 'reflection.start');
    cycleEvent('reflection', 'tool_use', 'tool.Write', { metadata: { tool: 'Write' } });
    cycleEvent('reflection', 'end', 'reflection.end', { cost_usd: 0.12 });
    await frame(page, 'review-approved', 'Approved — closure merges the PR; reflection follows');

    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector(`[data-cycle-id="${CYCLE_ID}"][data-cycle-status="done"]`, { timeout: 15000 }).catch(() => {});
    await frame(page, 'dashboard-done', 'Cycle done — merged + reflected. Journey complete.');

    console.log('\n[e2e] journey complete.');
  } finally {
    await ctx.close(); // flushes the video
    await browser.close();
    try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
    // Clean up the synthetic project + cycle + queue entries.
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(CYCLE_LOG, { recursive: true, force: true });
    for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      try { rmSync(join(QDIR(q), `${INIT}.md`), { force: true }); } catch { /* */ }
      try { rmSync(join(QDIR(q), `${INIT}.verdict-response.md`), { force: true }); } catch { /* */ }
    }
    // architect event logs
    try {
      for (const d of readdirSync(join(FORGE_ROOT, '_logs'))) {
        if (d.startsWith('_architect-')) rmSync(join(FORGE_ROOT, '_logs', d), { recursive: true, force: true });
      }
    } catch { /* */ }
  }

  // Name the recorded video deterministically + write the index.
  const vids = readdirSync(VIDEO).filter((f) => f.endsWith('.webm'));
  let videoName = vids[0] ?? '';
  if (videoName) { renameSync(join(VIDEO, videoName), join(VIDEO, 'journey.webm')); videoName = 'video/journey.webm'; }
  writeIndex(videoName);
  console.log(`[e2e] OK — ${OUT}/index.html (${captions.length} frames + video)`);
}

main().catch((err) => { console.error(err); rmSync(projectRoot, { recursive: true, force: true }); process.exit(1); });
