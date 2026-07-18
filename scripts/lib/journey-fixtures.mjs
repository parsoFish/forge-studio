/**
 * journey-fixtures — shared grounding constants + seed/cleanup helpers for the
 * e2e-journey modules.
 *
 * Extracted from scripts/e2e-journey.mjs (behavior-neutral move — no logic
 * changes). Holds everything path/id-shaped that the harness's beats and
 * per-journey modules share: the FORGE_ROOT/PROJECT grounding, the mdtoc
 * roadmap-feature grounding, the ACT-1 author-from-scratch flow-definition
 * data, the TEMPO pacing model, presentation helpers, and the emulation
 * helpers that seed the same files/events the real architect / dev-loop /
 * instructions-creator / project-brain-builder phases write (the
 * FORGE_ARCHITECT_NO_SPAWN seam).
 *
 * Provenance notes referencing the real cycles these fixtures are grounded on
 * will be added by a later task.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { sleep } from './journey-assertions.mjs';
import { PACE } from './journey-runtime.mjs';

// journey-fixtures.mjs lives one level deeper than e2e-journey.mjs
// (scripts/lib/ vs scripts/), so FORGE_ROOT climbs two levels, not one.
export const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// PROJECT is parameterised (FORGE_E2E_PROJECT) so the walkthrough can be
// grounded on any managed project; the default is `mdtoc`, forge's creds-free
// out-of-the-box reference project (markdown-TOC CLI). The seeded artifacts
// below are grounded on a real mdtoc roadmap feature so the demo reads true.
export const PROJECT = process.env.FORGE_E2E_PROJECT || 'mdtoc';
export const projectRoot = join(FORGE_ROOT, 'projects', PROJECT);

// SAFETY: this harness seeds + then deletes scratch. A REAL, pre-existing
// project must NEVER have its directory removed — only the demo's own scratch
// (the one architect session it creates, its cycle log, its queue manifest).
// `mdtoc` is a checked-in reference project (lives inside forge's own repo, so
// it has no nested `.git`); `betterado` is a separate git clone. EITHER way the
// project directory pre-exists with real source, so it is NOT synthetic and
// cleanProjectDir is a no-op. We only treat a project as synthetic (disposable)
// if its directory did not exist before this harness ran.
export const PROJECT_PREEXISTED = existsSync(projectRoot);
export const IS_SYNTHETIC = !PROJECT_PREEXISTED;
export function cleanProjectDir() {
  if (IS_SYNTHETIC) rmSync(projectRoot, { recursive: true, force: true });
}
/** Remove only the demo's seeded architect session from a real project (never
 *  _archived/ or other sessions). No-op for a synthetic project (whole dir goes). */
export function cleanSeededSession(sid) {
  if (IS_SYNTHETIC || !sid) return;
  try { rmSync(join(projectRoot, '_architect', sid), { recursive: true, force: true }); } catch { /* */ }
}

export const OUT = join(FORGE_ROOT, 'demos/e2e');
export const FRAMES = join(OUT, 'frames');
export const VIDEO = join(OUT, 'video');
// CLIPS: short muted autoplay-loop .webm captures of the building/generating
// interactions (the "GIFs"). Each is recorded in its own ephemeral browser
// context (recordVideo is per-context; a fresh context's webm ≈ one interaction).
export const CLIPS = join(OUT, 'clips');

// ── MDTOC GROUNDING ─────────────────────────────────────────────────────────────
// A real, small mdtoc roadmap feature (Milestone 1 — In-place TOC injection):
// `mdtoc --write <file>` inserts (or refreshes) the generated table of contents
// between `<!-- toc -->` / `<!-- /toc -->` markers, idempotently. Creds-free —
// the change is proven by running the BUILT CLI against a fixture (the `cli-diff`
// demo shape), not against an external system.
export const IDEA = 'Add a --write mode to mdtoc that inserts or refreshes the generated table of contents in-place between <!-- toc --> / <!-- /toc --> marker comments, idempotently (re-running --write produces no diff).';
export const DATE = new Date().toISOString().slice(0, 10);
export const INIT = `INIT-${DATE}-e2e-toc-write-mode`;
export const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
export const CYCLE_ID = `${STAMP}_${INIT}`;
export const CYCLE_LOG = join(FORGE_ROOT, '_logs', CYCLE_ID);

// Acceptance coordinates: mdtoc is creds-free, so the demo evidence is a captured
// CLI read-back (the `acceptance` gate runs the BUILT CLI against the fixture and
// asserts the exact generated TOC) rather than a live REST GET. Kept as concrete
// constants so the seeded demo carries a real, greppable evidence block
// (demos-are-visual-evidence policy — for a CLI project the "real resource" is the
// command's captured output, not a test-name table).
export const ACC_CMD = 'npm run acceptance';
export const ACC_FIXTURE = 'test/fixtures/release-notes.md';
export const TOC_SENTINEL = 'sentinel-7f3a9c';

// ── ACT-1 AUTHOR: author-from-scratch flow definition ──────────────────────────
// The forge cycle rebuilt from first principles as a flow definition: three
// agent nodes, two artifact edges, one human gate. Proves the cycle is
// subsumed by data (ADR-028) — the operator builds this flow LIVE in the
// Studio BUILD-tab canvas (drag agents from the palette, wire edges via
// handle-drag, toggle the human gate, save) rather than a pre-boot seed file;
// `forge studio lint` validates the saved result and a topological compare
// (agent-ref multiset + edge artifact labels + gate placement — not literal
// node ids, which the canvas always auto-generates) proves it matches the
// production seed's shape. SCRATCH_FLOW/SCRATCH_FLOW_DIR name the slug the UI
// derives from the operator's chosen flow name; cleanScratchFlow() sweeps the
// UI-authored result before + after the run.
// S8/DEC-3: the forge-cycle monolith was retired; the AUTHOR proof re-anchors on
// forge-develop — the build flow of the 3-flow set — rebuilt from scratch as data
// and proven structurally identical to the shipped seed.
export const SCRATCH_FLOW = 'forge-develop-scratch';
export const SCRATCH_FLOW_DIR = join(FORGE_ROOT, 'studio', 'flows', SCRATCH_FLOW);
export const SEED_FLOW_PATH = join(FORGE_ROOT, 'studio', 'flows', 'forge-develop', 'flow.yaml');
export function cleanScratchFlow() {
  try { rmSync(SCRATCH_FLOW_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// J2: the three agents the operator authors from the curated starter library.
// Created live under skills/<slug>/ via the UI; removed in the finally block.
export const STARTER_AGENT_SLUGS = ['plan', 'dev', 'review'];
export function cleanStarterAgents() {
  for (const slug of STARTER_AGENT_SLUGS) {
    try { rmSync(join(FORGE_ROOT, 'skills', slug), { recursive: true, force: true }); } catch { /* */ }
  }
}

/** Poll until a file exists (deterministic save confirmation), up to ms. */
export async function waitForFile(path, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(120);
  }
  return existsSync(path);
}

// J3: the flow the operator authors from the basic starter (new-flow builder).
export const J3_FLOW = 'my-first-flow';
export const J3_FLOW_DIR = join(FORGE_ROOT, 'studio', 'flows', J3_FLOW);
export function cleanFirstFlow() {
  try { rmSync(J3_FLOW_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// J4: the project the operator onboards via the UI. Projects are now
// auto-discovered from disk (B1) — onboarding writes a project dir under
// projects/ (no tracked registry file), so cleanup just removes that dir.
export const J4_PROJECT = 'journey-demo-project';
export const J4_PROJECT_DIR = join(FORGE_ROOT, 'projects', J4_PROJECT);
export function cleanFirstProject() {
  try { rmSync(J4_PROJECT_DIR, { recursive: true, force: true }); } catch { /* */ }
  // Onboarding seeds a Brain-3 KB (seedProjectBrain) under brain/projects/<slug>/ —
  // remove it too so an onboarded scratch project leaves no residue.
  try { rmSync(join(FORGE_ROOT, 'brain', 'projects', J4_PROJECT), { recursive: true, force: true }); } catch { /* */ }
}

// J5: a seeded run of the AUTHORED flow (my-first-flow) given work against the
// onboarded project — proves the monitor renders a user-authored flow's run.
export const J5_INIT = `INIT-${DATE}-authored-flow-run`;
export const J5_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
export const J5_CYCLE_ID = `${J5_STAMP}_${J5_INIT}`;
export const J5_CYCLE_LOG = join(FORGE_ROOT, '_logs', J5_CYCLE_ID);
export function cleanFirstFlowRun() {
  // R4-11-F1: sweep `merged/` too — a crash mid-journey could leave the
  // seeded manifest in the transient pass-through dir (QueueState, not the
  // unrelated CycleOutcome 'merged' value) rather than its terminal home.
  for (const q of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    try { rmSync(join(FORGE_ROOT, '_queue', q, `${J5_INIT}.md`), { force: true }); } catch { /* */ }
  }
  try { rmSync(J5_CYCLE_LOG, { recursive: true, force: true }); } catch { /* */ }
}
/** Append one event to the J5 run's events.jsonl (phase = node id for the authored flow). */
let j5Seq = 0;
export function j5Event(phase, eventType, message, metadata = {}, extras = {}) {
  mkdirSync(J5_CYCLE_LOG, { recursive: true });
  j5Seq += 1;
  appendFileSync(join(J5_CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id: `EV_j5_${j5Seq}`, cycle_id: J5_CYCLE_ID, initiative_id: J5_INIT,
    started_at: new Date().toISOString(), phase, skill: phase, event_type: eventType,
    input_refs: [], output_refs: [], message, metadata, ...extras,
  }) + '\n');
}
/** Parse the saved flow.yaml → { version, nodes } (nodes carry persisted x/y). */
export function readSavedFlow(slug) {
  try {
    const doc = yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'flows', slug, 'flow.yaml'), 'utf8'));
    return { version: typeof doc?.version === 'number' ? doc.version : 0, nodes: Array.isArray(doc?.nodes) ? doc.nodes : [] };
  } catch { return { version: 0, nodes: [] }; }
}
export function readSavedFlowNodes(slug) { return readSavedFlow(slug).nodes; }
/** Wait until the saved flow's version reaches at least minVersion (save landed). */
export async function waitForFlowVersion(slug, minVersion, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (readSavedFlow(slug).version >= minVersion) return true;
    await sleep(150);
  }
  return readSavedFlow(slug).version >= minVersion;
}
/** Parse node ids, gate placements + edge count out of a flow.yaml text (the
 *  inline-map style) — enough for a structural parity assertion without a YAML dep. */
export function parseFlowStructure(text) {
  const nodeIds = [];
  const gates = {};
  let edgeCount = 0;
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === 'nodes:') { section = 'nodes'; continue; }
    if (line === 'edges:') { section = 'edges'; continue; }
    if (line === 'triggers: []' || line.startsWith('triggers:')) { section = ''; continue; }
    if (!line.startsWith('- ')) continue;
    if (section === 'nodes') {
      const id = /id:\s*([\w-]+)/.exec(line)?.[1];
      const gate = /gate:\s*([\w-]+)/.exec(line)?.[1];
      if (id) { nodeIds.push(id); if (gate) gates[id] = gate; }
    } else if (section === 'edges') {
      edgeCount += 1;
    }
  }
  return { nodeIds: nodeIds.sort(), gates, edgeCount };
}

// ── TEMPO MODEL ──────────────────────────────────────────────────────────────
// Re-derived from journey-runtime's PACE (scripts/lib/journey-runtime.mjs)
// where the values coincide; fastForward has no PACE equivalent and stays a
// local constant. Exported names (READ/WORK/ACT/THINK) are unchanged so every
// beat drive() body keeps working without edits.
export const READ   = PACE.dwell;   // dwell — a page the operator reads carefully
export const WORK   = PACE.scroll;  // scroll — watching autonomous work happen
export const ACT    = PACE.act;     // action beat after a click
export const THINK  = PACE.think;   // brief gap during live bursts / between decisions

const TEMPO = {
  skip:        () => Promise.resolve(),
  fastForward: () => sleep(200),
  realTime:    () => sleep(THINK),
  dwell:       () => sleep(READ),
  scroll:      () => sleep(WORK),
};
export function pace(tempo) { return (TEMPO[tempo] ?? TEMPO.dwell)(); }

export const QDIR = (q) => join(FORGE_ROOT, '_queue', q);

// ── PRESENTATION HELPERS ──────────────────────────────────────────────────────

/** Inject / update a single fixed lower-third caption overlay. */
export async function caption(page, text) {
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

/** Show / hide an "autonomous — Nm Ns" overlay during fast-forward stretches. */
export async function runningTimer(page, on, baseMs = 0) {
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

export function archDir(sid) { return join(projectRoot, '_architect', sid); }
export function writeStatus(sid, status) {
  const dir = archDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    ...status, session_id: sid, project: PROJECT, project_repo_path: projectRoot,
    updated_at: new Date().toISOString(),
  }, null, 2));
}
let archSeq = 0;
export function archEvent(sid, eventType, message, metadata = {}) {
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
export function archReasoning(sid, text) {
  archEvent(sid, 'log', text, { kind: 'reasoning', text });
}
export async function burst(sid, tools) {
  for (const t of tools) {
    archEvent(sid, 'tool_use', `tool.${t}`, { tool: t });
    await sleep(THINK);
  }
}
export async function paced(thunks, gap = THINK) {
  for (const fn of thunks) { fn(); await sleep(gap); }
}

export function writeQuestions(sid) {
  writeFileSync(join(archDir(sid), 'questions.json'), JSON.stringify([
    {
      question: 'How should --write find the region to replace?', header: 'Marker strategy',
      options: [
        { label: 'Explicit <!-- toc --> / <!-- /toc --> markers', description: 'Only rewrite between the marker comments; no markers means no write — predictable and idempotent.' },
        { label: 'Heuristic (first list after the H1)', description: 'Guess the TOC location; risks clobbering unrelated content.' },
      ],
    },
    {
      question: 'What should --write do when no markers are present?', header: 'No-marker behaviour',
      options: [
        { label: 'Exit non-zero with a clear message', description: 'Fail fast — the user must add markers before --write can be idempotent.' },
        { label: 'Insert markers after the first heading', description: 'Convenient, but mutates the doc structure on first run.' },
      ],
    },
  ], null, 2));
}

// P4: emulated architect telemetry — mirrors what the real finalize step stamps.
// Grounded (S5 corpus-grounding): real cycles show architect cost as ALWAYS $0 —
// it is metered out-of-cycle (see docs/known-gaps.md item 2), not a harness gap.
// Source: gitpulse projects/gitpulse/_architect/2026-07-11T17-22-24/manifests/
// INIT-2026-07-11-cli-sort-flag.md (architect_cost_usd: 0, architect_duration_ms
// in the 239486-2338556ms real range across the corpus).
export const EMULATED_ARCHITECT_COST_USD = 0;
export const EMULATED_ARCHITECT_DURATION_MS = 239486;

export function writePlan(sid, round) {
  const dir = archDir(sid);
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'manifests', `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
    // Grounded (S5): real budget distribution is 6-24 iterations / $4-$80 — source
    // _queue/done/INIT-2026-07-11-exclude-path-filter.md (gitpulse).
    `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 10', 'cost_budget_usd: 4', 'phase: pending',
    'origin: architect',
    // S9/DEC-3: the RUN demonstration drives the 3-stage spine. The manifest names
    // forge-develop (the build flow the hand-off repoints onto); the seeded events
    // span architect→pm→dev[fanOut]→unifier→review→reflect under ONE cycle_id, so
    // run-model derives a flowLineage of [forge-architect, forge-develop,
    // forge-reflect] (DEC-2). Under Model B each flow's monitor renders its OWN
    // slice, and the threaded run surfaces under all three.
    'flow_id: forge-develop',
    `architect_session_id: ${sid}`,
    `architect_cost_usd: ${EMULATED_ARCHITECT_COST_USD}`,
    `architect_duration_ms: ${EMULATED_ARCHITECT_DURATION_MS}`,
    '---', '',
    '# mdtoc — `--write` in-place TOC injection', '',
    'Given a Markdown file with <!-- toc --> / <!-- /toc --> markers, when `mdtoc --write <file>` runs, then the generated table of contents is inserted between the markers and the surrounding content is left untouched.',
    'Given a file whose embedded TOC is already current, when `mdtoc --write <file>` runs again, then the file is unchanged (idempotent — re-running produces no diff).',
  ].join('\n'));
  writeFileSync(join(dir, 'PLAN.html'), `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:14px ui-sans-serif,system-ui;background:#0d1117;color:#e6edf3;margin:0;padding:24px}
    h1{font-size:18px}h2{font-size:14px;color:#d2a8ff}.card{border:1px solid #30363d;border-radius:8px;padding:14px;margin:12px 0;background:#161b22}
    .r{color:#7ee787}</style></head>
    <body><h1>PLAN — mdtoc \`--write\` in-place TOC injection ${round > 1 ? '<span class="r">(revised)</span>' : ''}</h1>
    <p>Operator brief: add a <code>--write</code> mode that inserts (or refreshes) the generated TOC between <code>&lt;!-- toc --&gt;</code> / <code>&lt;!-- /toc --&gt;</code> marker comments, idempotently, via a new pure <code>src/inject.ts</code> wired into the CLI.</p>
    <div class="card"><h2>AC-1 — marker slice + insert</h2><p>GIVEN a doc with <code>&lt;!-- toc --&gt;</code> / <code>&lt;!-- /toc --&gt;</code> markers WHEN <code>mdtoc --write file.md</code> runs THEN the generated TOC replaces the marker region and nothing outside it changes; <code>npm run acceptance</code> reads back the built CLI's output.</p></div>
    <div class="card"><h2>AC-2 — idempotency${round > 1 ? ' (every run)' : ''}</h2><p>GIVEN the embedded TOC is already current WHEN <code>mdtoc --write file.md</code> runs again THEN the file is byte-identical (no diff). The PM sizes the work items directly off these acceptance criteria.</p></div></body></html>`);
  writeStatus(sid, { phase: 'awaiting-verdict', round, idea: IDEA });
}

let cycleSeq = 0;
// Grounded (S5, fix item 3): the real skill names are more granular than the
// phase id (source: gitpulse/betterado events.jsonl). review-loop defaults to
// review-router (the routing skill); the verdict-recording event overrides to
// review-verdict explicitly at its call site.
const PHASE_SKILL_DEFAULTS = {
  'developer-loop': 'developer-ralph',
  'review-loop': 'review-router',
};
// Grounded (S5, fix item 4): chain parent_event_id start→end/iteration/log per
// phase, like the real event schema (source: gitpulse events.jsonl) — a 'start'
// event opens a new parent for that phase; every subsequent event on the same
// phase (until the next 'start') is its child.
const lastStartEventIdByPhase = {};
export function cycleEvent(phase, eventType, message, opts = {}) {
  const { metadata = {}, skill = PHASE_SKILL_DEFAULTS[phase] ?? phase, input_refs = [], output_refs = [], ...extras } = opts;
  mkdirSync(CYCLE_LOG, { recursive: true });
  cycleSeq += 1;
  const event_id = `EV_cyc_${cycleSeq}`;
  const parent_event_id = eventType === 'start' ? undefined : lastStartEventIdByPhase[phase];
  if (eventType === 'start') lastStartEventIdByPhase[phase] = event_id;
  appendFileSync(join(CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id, cycle_id: CYCLE_ID, initiative_id: INIT,
    started_at: new Date().toISOString(), phase, skill,
    ...(parent_event_id ? { parent_event_id } : {}),
    event_type: eventType, input_refs, output_refs, message, metadata, ...extras,
  }) + '\n');
}
/** Sugar for the unifier phase — phase:'unifier', skill:'developer-unifier'. */
export function unifierEvent(eventType, message, opts = {}) {
  return cycleEvent('unifier', eventType, message, { ...opts, skill: 'developer-unifier' });
}

export function moveManifest(from, to) {
  mkdirSync(QDIR(to), { recursive: true });
  // R4-11-F1: `merged` is the transient QueueState pass-through dir between
  // a confirmed PR merge and closure's own merged→done promotion — include
  // it in the search so a journey beat can move a manifest into/out of it.
  const search = [from, 'pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed'];
  for (const q of search) {
    const src = join(QDIR(q), `${INIT}.md`);
    if (existsSync(src)) {
      if (q !== to) renameSync(src, join(QDIR(to), `${INIT}.md`));
      return;
    }
  }
  throw new Error(`moveManifest: ${INIT}.md not found in any queue dir (wanted ${from} → ${to})`);
}

/**
 * S7: seed a live worktree + stamp `worktree_path` onto the manifest so the
 * comment-derived send-back genuinely appends a UWI in place (ADR-026), rather
 * than 409'ing with no worktree. Returns the worktree path.
 */
export function seedReviewWorktree() {
  const wt = join(FORGE_ROOT, '_worktrees', INIT);
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  mkdirSync(join(wt, '.forge', 'unifier-items'), { recursive: true });
  writeFileSync(join(wt, 'package.json'), JSON.stringify({ name: 'mdtoc-review-wt', private: true }, null, 2));
  // SANDBOX (incident 2026-07-16): the real approve handler runs release-finalize
  // + `gh pr merge` with this dir as cwd. As a plain dir inside the forge repo,
  // every git op bubbled up to forge's own .git (a real finalise 0.5.1 got
  // committed AND pushed onto the working branch). Making it a standalone repo
  // with no remote contains any residual git/gh escape.
  try {
    execFileSync('git', ['init', '-q'], { cwd: wt });
    execFileSync('git', ['-c', 'user.email=e2e@forge.local', '-c', 'user.name=forge-e2e', 'commit', '-q', '--allow-empty', '-m', 'e2e sandbox'], { cwd: wt });
  } catch (err) { console.warn(`[e2e] review-worktree sandbox git init failed: ${err.message}`); }
  // Seed the static UWI-1 ("unify & prep the PR") the unifier normally writes, so a
  // review send-back appends UWI-2 (depends_on:[UWI-1]) rather than a self-cyclic UWI-1.
  // Grounded (S5, fix item 13): real unifier-authored WI frontmatter always
  // carries an ADR-037 `creates:` list (the structural PM/unifier validator
  // rejects a pure-modification WI without it) — source gitpulse WI-1.md/WI-3.md.
  const uwi1 = {
    work_item_id: 'UWI-1', initiative_id: INIT, status: 'pending', depends_on: [],
    acceptance_criteria: [{
      given: 'every dev work item is committed on the initiative branch',
      when: 'the unifier integrates the branch into one cohesive, self-contained PR',
      then: 'the quality gate passes against branch tip and demo.json + .forge/pr-description.md exist',
    }],
    files_in_scope: ['.forge/pr-description.md', `demo/${INIT}/demo.json`],
    creates: ['.forge/pr-description.md', `demo/${INIT}/demo.json`],
    quality_gate_cmd: ['npm', 'test'], kind: 'packaging', estimated_iterations: 1,
  };
  writeFileSync(join(wt, '.forge', 'unifier-items', 'UWI-1.md'),
    `---\n${yaml.dump(uwi1)}---\n\n# UWI-1 — unify & prep the PR (seeded for the review demo).\n`);
  for (const q of ['ready-for-review', 'in-flight', 'pending']) {
    const p = join(QDIR(q), `${INIT}.md`);
    if (existsSync(p)) {
      let txt = readFileSync(p, 'utf8');
      if (!/^worktree_path:/m.test(txt)) {
        txt = txt.replace(/^phase:.*$/m, (m) => `${m}\nworktree_path: ${wt}`);
        writeFileSync(p, txt);
      }
      break;
    }
  }
  return wt;
}

export function writeDemoJson(revision) {
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'demo.json'), JSON.stringify({
    title: `mdtoc: --write in-place TOC injection${revision > 1 ? ' (round ' + revision + ')' : ''}`,
    essence: 'Adds a `--write` mode that inserts or refreshes the generated table of contents between <!-- toc --> / <!-- /toc --> markers via a new pure src/inject.ts, wired into the CLI. Idempotent — re-running --write on a current doc produces no diff; covered by a new unit suite and the creds-free acceptance read-back against the built CLI.',
    project: PROJECT, initiativeId: INIT, baseRef: 'main', changedRef: `forge/${INIT}`,
    diffStat: ' src/inject.ts                |  38 ++++++++\n src/cli.ts                   |  21 +++-\n test/inject.test.ts          | 142 ++++++++++++++++++++++\n test/acceptance/run.ts       |  18 ++-\n 4 files changed, 213 insertions(+), 6 deletions(-)',
    acceptanceCriteria: [
      'GIVEN a doc with <!-- toc --> / <!-- /toc --> markers WHEN `mdtoc --write file.md` runs THEN the generated TOC replaces the marker region, nothing outside it changes, and `npm run acceptance` reads back the built CLI output',
      `GIVEN the embedded TOC is already current WHEN \`mdtoc --write file.md\` runs again THEN the file is byte-identical${revision > 1 ? ' on every run — verified across two consecutive --write passes now (added this round on review feedback)' : ''}`,
    ],
    // Round 1: AC-2 PARTIAL (a trailing newline drifts on the 2nd write) — what the
    // operator sends back on. Round 2: both ACs MET — the payoff (PARTIAL→MET).
    acEvaluations: [
      {
        criterion: 'marker slice + insert: --write replaces only the marker region; acceptance reads back the built CLI',
        verdict: 'met',
        evidence: 'injectToc_ReplacesMarkerRegion → PASS (npm test, node:test, suite green) + npm run acceptance reads back the exact TOC from dist/cli.js against test/fixtures/release-notes.md, exit 0',
      },
      {
        criterion: 'idempotency: re-running --write on a current doc produces no diff',
        verdict: revision > 1 ? 'met' : 'partial',
        evidence: revision > 1
          ? 'two consecutive --write passes are byte-identical; injectToc_IsIdempotent asserts diff === "" on the 2nd AND 3rd run (fixed the trailing-newline drift this round)'
          : 'first --write is correct, but a trailing newline drifts on the 2nd write → a one-line diff — operator asked for byte-identical on every run',
      },
    ],
    summary: {
      bullets: [
        'Added a pure src/inject.ts (doc string + toc string → new doc string) that slices the <!-- toc --> / <!-- /toc --> region.',
        'Wired --write into the CLI — read file, inject, write back; no markers means a clear non-zero exit.',
        'Covered by a unit suite (insert + idempotency) and the creds-free acceptance read-back against the built CLI.',
      ],
      branch: `forge/${INIT}`, commitSha: 'b7c4e9a',
    },
    apiDiff: [
      { name: 'mdtoc --write <file>', change: 'added',
        before: '(flag absent — mdtoc only printed the TOC to stdout)',
        after: `Refreshes the TOC in-place between <!-- toc --> / <!-- /toc --> markers, idempotently${revision > 1 ? ' (byte-identical on every run)' : ''}` },
    ],
    testEvidence: [
      { name: 'injectToc_ReplacesMarkerRegion', result: 'pass' },
      { name: 'injectToc_IsIdempotent', result: 'pass' },
      { name: 'acceptance: --write read-back vs test/fixtures/release-notes.md', result: 'pass' },
    ],
    checkpoints: [
      // S7 visual review: a before/after screenshot checkpoint drives the
      // img-comparison-slider on the interactive review page (data: URIs so the
      // UI renders them directly — no remote fetch).
      { label: 'README TOC region — before vs after --write', kind: 'screenshot',
        caption: 'The embedded TOC region: empty markers before, the generated table after `mdtoc --write`.',
        beforeNote: 'Markers present, no TOC between them.',
        afterNote: 'Generated TOC injected between the markers; surrounding prose untouched.',
        beforeImage: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#161b22"/><text x="16" y="40" fill="#8b949e" font-family="monospace" font-size="13">&lt;!-- toc --&gt;</text><text x="16" y="64" fill="#6e7681" font-family="monospace" font-size="13">(empty)</text><text x="16" y="88" fill="#8b949e" font-family="monospace" font-size="13">&lt;!-- /toc --&gt;</text><text x="16" y="160" fill="#d29922" font-family="sans-serif" font-size="12">before</text></svg>'),
        afterImage: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#0d1117"/><text x="16" y="40" fill="#8b949e" font-family="monospace" font-size="13">&lt;!-- toc --&gt;</text><text x="16" y="62" fill="#58a6ff" font-family="monospace" font-size="12">- [Intro](#intro)</text><text x="16" y="80" fill="#58a6ff" font-family="monospace" font-size="12">- [Usage](#usage)</text><text x="16" y="100" fill="#8b949e" font-family="monospace" font-size="13">&lt;!-- /toc --&gt;</text><text x="16" y="160" fill="#3fb950" font-family="sans-serif" font-size="12">after</text></svg>'),
      },
      { label: 'Unit suite — injectToc_ReplacesMarkerRegion + injectToc_IsIdempotent', kind: 'harness',
        caption: 'marker-region slice replaces only the TOC; a second --write is byte-identical',
        metrics: [
          { label: 'mdtoc unit tests', before: 'N tests, 0 fail', after: 'N+2 tests, 0 fail', deltaPct: null, parity: 'within' },
          { label: 'idempotent re-write — no diff', before: 'n/a', after: 'diff === ""', deltaPct: null, parity: 'match' },
        ] },
      // CAPTURED EVIDENCE (demos-are-visual-evidence policy): for a creds-free CLI
      // project the "real resource" is the command's captured output, not a
      // test-name table. The acceptance driver runs the BUILT CLI (dist/cli.js)
      // against the fixture and reads back the exact generated TOC — including the
      // non-default sentinel heading — proving the change end-to-end. Kept as a
      // `harness`-kind checkpoint so demo-model validation accepts it.
      { label: `Captured CLI read-back — ${ACC_CMD} against ${ACC_FIXTURE}`, kind: 'harness',
        caption: `The built mdtoc CLI runs --write against the fixture; the captured TOC reads back the non-default ${TOC_SENTINEL} section.`,
        metrics: [
          { label: 'acceptance read-back (dist/cli.js)', before: 'no --write', after: 'TOC injected + idempotent', deltaPct: null, parity: 'match' },
          { label: `sentinel heading present (${TOC_SENTINEL})`, before: 'n/a', after: 'present in captured TOC', deltaPct: null, parity: 'match' },
        ] },
    ],
    usage_example: '```bash\n# README.md contains:\n#   <!-- toc -->\n#   <!-- /toc -->\nmdtoc --write README.md   # injects the TOC between the markers\nmdtoc --write README.md   # idempotent — no diff on the second run\n```',
    impact: [
      'Closes the manual-TOC gap — mdtoc now keeps an embedded table of contents current in-place, not just on stdout.',
      'Verified the way that counts for a CLI: run the BUILT binary against a fixture and read back its captured output.',
      'Idempotent --write is safe to wire into CI (a future --check mode can fail when the embedded TOC drifts).',
    ],
  }, null, 2));

  // F4 single DEMO.md — the human/PR-facing markdown the S7 review page renders
  // (markdown-it → sandbox iframe). Derived from demo.json by `forge demo render`
  // in a real cycle; seeded here so the interactive review reads true.
  writeFileSync(join(artifacts, 'DEMO.md'), [
    `# mdtoc: \`--write\` in-place TOC injection${revision > 1 ? ' (round ' + revision + ')' : ''}`,
    '',
    '> Adds a `--write` mode that inserts or refreshes the generated table of contents between',
    '> `<!-- toc -->` / `<!-- /toc -->` markers, idempotently.',
    '',
    '## Intent & Outcome',
    '',
    '| # | Acceptance criterion | Verdict |',
    '| - | -------------------- | ------- |',
    '| 1 | `--write` replaces only the marker region; acceptance reads back the built CLI | **met** |',
    `| 2 | re-running \`--write\` on a current doc produces no diff | **${revision > 1 ? 'met' : 'partial'}** |`,
    '',
    '## Usage',
    '',
    '```bash',
    'mdtoc --write README.md   # injects the TOC between the markers',
    'mdtoc --write README.md   # idempotent — no diff on the second run',
    '```',
  ].join('\n'));
}

/** Reflector stage-2 emit: operator-facing questions for the reflect screen.
 *  S8: the deeper retrospective — beyond WI sizing, the reflector now surfaces
 *  repeated actions / roadblocks it found in the cycle log + a general-notes
 *  freeform, all rendered through the same user-questions → ReflectionGate pipe. */
export function writeReflectionQuestions() {
  mkdirSync(CYCLE_LOG, { recursive: true });
  writeFileSync(join(CYCLE_LOG, 'user-questions.json'), JSON.stringify([
    {
      question: 'Was the 2-work-item split (pure inject.ts, then --write wiring + acceptance read-back) the right size?',
      header: 'WI sizing',
      options: [
        { label: 'Right size', description: 'The pure injector and the CLI-wiring + acceptance test mapped cleanly to the two ACs.' },
        { label: 'Too small', description: 'Could have been a single work item.' },
        { label: 'Too large', description: 'Should have been split further.' },
      ],
    },
    {
      question: 'Repeated actions / roadblocks: the dev-loop re-ran the acceptance read-back 3× while tuning the marker regex. Worth a forge fix or a new tool?',
      header: 'Roadblocks',
      options: [
        { label: 'New tool', description: 'A marker-aware fixture helper would have avoided the repeated read-back churn.' },
        { label: 'Leave as-is', description: 'Three iterations is acceptable for a behaviour change like this.' },
        { label: 'Forge fix', description: 'The acceptance gate should cache the build between read-backs.' },
      ],
    },
    {
      question: 'Any other notes on this initiative? (free-form)',
      header: 'Notes',
      options: [],
    },
  ], null, 2));
}

/** S5 corpus-grounding (fix item 11): seed the reflector's full real artifact
 *  set — recap.md, retro.md, report.md, brain-lint.md, artifacts/reflection.json
 *  — mirroring the shapes a real cycle writes (source: betterado
 *  `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/`). NOTE:
 *  user-feedback.md is deliberately NOT seeded here — ReflectionGate.tsx writes
 *  it live from the operator's submitted answers (pre-seeding would conflict).
 *  R5-01-FIX2: this holds true under the journey's own FORGE_DRY_BRIDGE=1 run,
 *  too — reflect-answer is dry-bridge `stub-actions` (bookkeeping proceeds,
 *  only the detached reflector rerun is skipped), so the live write still
 *  lands for real; only the agent-turn side effect is suppressed. */
export function writeReflectionArtifacts() {
  mkdirSync(CYCLE_LOG, { recursive: true });
  writeFileSync(join(CYCLE_LOG, 'recap.md'), [
    `# Cycle recap — ${INIT}`, '',
    '## Outcome', '',
    `merged — project \`${PROJECT}\`, cycle \`${CYCLE_ID}\`.`, '',
    '## Stats', '',
    '- Cost (total): $3.83',
    '- Duration: 9m 12s',
    '- Send-back rounds: 1',
    '- Dev-loop iterations: 2', '',
    '## Themes written', '',
    '- _(none yet — reflected live during the walkthrough)_', '',
    '## Brain gaps', '',
    '- Closed (0): _(none)_',
    '- Outstanding (0): _(none)_', '',
    '## Lint', '',
    '- Status: clean',
    `- Report: _logs/${CYCLE_ID}/brain-lint.md`, '',
    '## Links', '',
    `- Retro: _logs/${CYCLE_ID}/retro.md`,
    `- Manifest: _queue/done/${INIT}.md`,
  ].join('\n'));
  writeFileSync(join(CYCLE_LOG, 'retro.md'), [
    `# Retro — ${INIT}`, '',
    '## Self-reflection', '',
    '### Repeated actions', '',
    '| Action | Count | Notes |',
    '|---|---|---|',
    '| Acceptance read-back re-run while tuning the marker regex | 3 | Trailing-newline drift on the 2nd `--write` (the send-back). |',
    '',
    '### Roadblocks / wedges', '',
    '1. **Idempotency drift (send-back).** A second `--write` on an already-current doc left a trailing-newline diff; the operator sent it back on AC-2. Fixed on the dev-loop rerun.',
    '',
    '### Notable patterns', '',
    '- Dependency ordering held: WI-2 (`--write` wiring + acceptance read-back) only started once WI-1 (pure `inject.ts`) was done.',
    '', '---', '',
    '## User questions', '',
    '_(answered live on the reflect screen — see user-questions.json)_',
  ].join('\n'));
  writeFileSync(join(CYCLE_LOG, 'report.md'), [
    `# Cycle report — ${INIT}`, '',
    `Project: \`${PROJECT}\`. Outcome: merged.`, '',
    '## Work items', '',
    '- WI-1 — pure inject.ts marker-slice',
    '- WI-2 — --write CLI wiring + acceptance read-back', '',
    '## Send-back', '',
    '- Round 1: AC-2 (idempotency) PARTIAL — a trailing-newline drift on the 2nd `--write`. Fixed on rerun (PARTIAL→MET).',
  ].join('\n'));
  writeFileSync(join(CYCLE_LOG, 'brain-lint.md'), [
    '# Brain-lint report', '',
    '## Flags (0)', '',
    'Summary: 0 error(s), 0 flag(s), 0 auto-fix(es).',
  ].join('\n'));
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'reflection.json'), JSON.stringify({
    friction: [
      'Idempotency drift on the 2nd --write (trailing newline) — caught by the send-back.',
    ],
  }, null, 2));
}

/** S5 corpus-grounding (fix item 10): seed the release-finalize artifact the
 *  real closure phase writes after a merge — field shape verified against
 *  betterado's real artifacts/release.json (camelCase changelogPath/
 *  finalizedAt). The bridge's own release-finalize path is neutralised for the
 *  whole ui:journey run (e2e-journey.mjs strips project.json's releaseProcess
 *  for the run), so this is purely seeded fixture data — no collision with a
 *  real backend write. */
export function writeReleaseArtifact(version = '0.2.0') {
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const path = join(artifacts, 'release.json');
  writeFileSync(path, JSON.stringify({
    initiative_id: INIT, cycleId: CYCLE_ID, project: PROJECT, version,
    changelogPath: 'CHANGELOG.md', branch: `forge/${INIT}`, finalizedAt: new Date().toISOString(),
  }, null, 2));
  return path;
}

// ── AI-GENERATION EMULATION (instructions / project-brain) ──────────────────────
// The instructions-creator, project-brain-builder and demo-builder sessions all
// honour the SAME no-spawn seam as the architect (FORGE_ARCHITECT_NO_SPAWN=1): the
// bridge writes status transitions the operator drives, but the LLM runner never
// runs — so we seed the files the runner would have written (mirroring the architect
// emulation). Cleaned up in the finally block.

// instructions-creator (AGENTS.md). Session dir: projects/<p>/_instructions/<sid>/.
export function instrDir(sid) { return join(projectRoot, '_instructions', sid); }
export function writeInstrStatus(sid, patch) {
  const dir = instrDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sid, project: PROJECT, project_repo_path: projectRoot,
    mode: 'init', round: 1, prompt: 'Keep it short; document the build + lint gate.',
    ...patch, updated_at: new Date().toISOString(),
  }, null, 2));
}
let instrSeq = 0;
export function instrEvent(sid, eventType, message, metadata = {}) {
  const dir = join(FORGE_ROOT, '_logs', `_instructions-${sid}`);
  mkdirSync(dir, { recursive: true });
  instrSeq += 1;
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({
    event_id: `EV_instr_${instrSeq}`, cycle_id: `_instructions-${sid}`,
    initiative_id: `instructions-${sid}`, started_at: new Date().toISOString(),
    phase: 'architect', skill: 'instructions-runner',
    event_type: eventType, input_refs: [], output_refs: [], message, metadata,
  }) + '\n');
}
export async function instrBurst(sid, tools) {
  for (const t of tools) { instrEvent(sid, 'tool_use', `tool.${t}`, { tool: t }); await sleep(THINK); }
}
export function writeInstrQuestions(sid) {
  writeFileSync(join(instrDir(sid), 'questions.json'), JSON.stringify([
    { question: 'Who is the primary audience for AGENTS.md?', header: 'Audience', options: [
      { label: 'Forge dev-loop only', description: 'Terse machine-facing gate + convention notes.' },
      { label: 'Humans + agents', description: 'Add onboarding context and a purpose paragraph.' },
    ] },
    { question: 'Which command is the quality gate?', header: 'Gate', options: [
      { label: 'npm test', description: 'The full suite is the gate forge runs each iteration.' },
      { label: 'npm run lint', description: 'Lint is the fast gate; tests run separately.' },
    ] },
  ], null, 2));
}
export function writeInstrDraft(sid) {
  mkdirSync(instrDir(sid), { recursive: true });
  writeFileSync(join(instrDir(sid), 'AGENTS.draft.md'),
    '# AGENTS.md\n\n> mdtoc — a markdown table-of-contents CLI.\n\n## Build & test\n\nBuild: `npm run build`. Gate: `npm test`. Acceptance: `npm run acceptance`.\n\n## Conventions\n\nPure functions return new objects; errors fail fast at the CLI boundary.\n');
}
export function cleanInstructionsSession(sid) {
  if (!sid) return;
  try { rmSync(join(projectRoot, '_instructions', sid), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(join(FORGE_ROOT, '_logs', `_instructions-${sid}`), { recursive: true, force: true }); } catch { /* */ }
}

// project-brain-builder (seed a project's KB so it grows). Session dir:
// projects/<p>/_project-brain/<sid>/ (status.json + themes/). The commit step is
// flip-only (the UI reads phase from status.json; it never verifies the central
// brain) so nothing is written under brain/ — safe on the real mdtoc project.
export function pbDir(sid) { return join(projectRoot, '_project-brain', sid); }
export function writePbStatus(sid, phase, prompt = '') {
  const dir = pbDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sid, project: PROJECT, project_repo_path: projectRoot,
    phase, prompt, updated_at: new Date().toISOString(),
  }, null, 2));
}
export function seedStagedBrain(sid) {
  const themes = join(pbDir(sid), 'themes');
  mkdirSync(themes, { recursive: true });
  const fm = (name, description, category) =>
    ['---', `title: ${name}`, `description: ${description}`, `category: ${category}`,
     `created_at: ${new Date().toISOString()}`, `updated_at: ${new Date().toISOString()}`, '---', ''].join('\n');
  writeFileSync(join(themes, 'structure.md'), fm('structure', 'mdtoc module layout + entry points', 'reference') +
    'CLI entry is `src/cli.ts`; TOC generation in `src/toc.ts`, heading parsing in `src/headings.ts`, slugging in `src/anchor.ts`.');
  writeFileSync(join(themes, 'conventions.md'), fm('conventions', 'Immutable, feature-organised TypeScript; explicit errors', 'pattern') +
    'Pure functions return new objects (`src/toc.ts`); no in-place mutation. Errors fail fast at the CLI boundary.');
  writeFileSync(join(themes, 'build-and-test.md'), fm('build-and-test', 'Exact build + focused-test commands', 'operation') +
    '`npm run build` compiles TS; `npm test` runs the suite; `npm run acceptance` runs the built CLI against fixtures.');
  writeFileSync(join(themes, 'profile.md'), fm('profile', 'One-page overview planners read first', 'reference') +
    'mdtoc — a markdown table-of-contents CLI (TypeScript, Node). Modules: cli / toc / headings / anchor.');
  writePbStatus(sid, 'awaiting-review', 'emphasise the build/test conventions and the module layout');
}
export function cleanSeededBrain(bsid) {
  if (!bsid) return;
  try { rmSync(join(projectRoot, '_project-brain', bsid), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(join(FORGE_ROOT, '_logs', `_project-brain-${bsid}`), { recursive: true, force: true }); } catch { /* */ }
}

// ── DEMO-BUILDER HELPERS ────────────────────────────────────────────────────────
// Regenerate a project's demo page, element by element. Session dir:
// projects/<p>/_demo/<sid>/status.json. Real path constants mirrored from
// orchestrator/demo-builder-runner.ts: DEMO_REL_DIR = .forge/demo,
// DEMO_HTML_REL_PATH = .forge/demo/DEMO.html, DEMO_LOCK_REL_PATH =
// .forge/demo/demo.lock.json, DEMO_HISTORY_REL_DIR = .forge/demo/history,
// DEMO_FRAGMENTS_REL_DIR = .forge/demo/fragments. Spawn is guarded the same way
// (FORGE_ARCHITECT_NO_SPAWN=1) — clicking a real action button only flips
// status.json.phase server-side; the harness hand-writes every artifact.
export function demoDir(sid) { return join(projectRoot, '_demo', sid); }
export function writeDemoStatus(sid, patch) {
  const dir = demoDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sid, project: PROJECT, project_repo_path: projectRoot,
    phase: 'briefing', mode: 'create', iteration: 1, prompt: '',
    ...patch, updated_at: new Date().toISOString(),
  }, null, 2));
}
let demoSeq = 0;
export function demoEvent(sid, eventType, message, metadata = {}) {
  const dir = join(FORGE_ROOT, '_logs', `_demo-${sid}`);
  mkdirSync(dir, { recursive: true });
  demoSeq += 1;
  appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({
    event_id: `EV_demo_${demoSeq}`, cycle_id: `_demo-${sid}`,
    initiative_id: `demo-${sid}`, started_at: new Date().toISOString(),
    phase: 'unifier', skill: 'demo-builder-runner',
    event_type: eventType, input_refs: [], output_refs: [], message, metadata,
  }) + '\n');
}
export async function demoBurst(sid, tools) {
  for (const t of tools) { demoEvent(sid, 'tool_use', `tool.${t}`, { tool: t }); await sleep(THINK); }
}

export const DEMO_ELEMENT_TRIO = [
  { kind: 'capture', text: 'Run the mdtoc CLI baseline vs changed and capture real stdout.', element: 'cli-capture' },
  { kind: 'verify', text: 'Run npm test on the changed tree and capture the real result.', element: 'test-evidence' },
  { kind: 'present', text: 'A tight prose lead on what changed and why it matters.', element: 'narrative' },
];

export function projectJsonPath() { return join(projectRoot, '.forge', 'project.json'); }
export function patchDemoProcess() {
  const path = projectJsonPath();
  const original = readFileSync(path, 'utf8');
  const cfg = JSON.parse(original);
  cfg.demoProcess = DEMO_ELEMENT_TRIO;
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  return original;
}
export function restoreProjectJson(stashedText) {
  if (!stashedText) return;
  try { writeFileSync(projectJsonPath(), stashedText); } catch { /* best-effort */ }
}

const DEMO_FRAG_CSS = 'body{background:#0a0e14;color:#e6edf3;font:14px/1.5 ui-sans-serif,system-ui;margin:0;padding:20px}' +
  '.demo-card{background:#11161d;border:1px solid #21262d;border-radius:8px;padding:16px 20px;margin-bottom:16px}' +
  'h1{font-size:20px}h2{font-size:16px;color:#e6edf3}h3{font-size:14px;color:#8b949e;margin-top:0}' +
  'p{color:#e6edf3}em{color:#8b949e}code,pre{background:#0a0f16;color:#e6edf3;border-radius:6px;padding:2px 6px}' +
  'a{color:#1f6feb}';

const DEMO_FORGE_DIR = join(projectRoot, '.forge', 'demo');
function demoFragment(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${DEMO_FRAG_CSS}</style></head>` +
    `<body><div class="demo-card"><h3>${title}</h3>${body}</div></body></html>`;
}
function composedDemoHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>mdtoc — demo</title>` +
    `<style>${DEMO_FRAG_CSS}</style></head><body>` +
    `<h1>mdtoc — demo</h1>` +
    `<p><em>Harness stand-in for the e2e journey — the real demo-builder agent composes this page ` +
    `element by element (capture → verify → present) and inlines studio/demo/forge-demo.css.</em></p>` +
    `<div class="demo-card"><h3>CLI before/after</h3><p><em>Harness stand-in — the real agent runs the CLI baseline vs changed and captures real stdout here.</em></p></div>` +
    `<div class="demo-card"><h3>Test evidence</h3><p><em>Harness stand-in — the real agent runs the quality gate and shows the pass/fail result here.</em></p></div>` +
    `<div class="demo-card"><h3>Narrative essence</h3><p><em>Harness stand-in — the real agent writes a one-to-three sentence essence of the change here.</em></p></div>` +
    `</body></html>`;
}
export function writeDemoArtifacts() {
  const fragDir = join(DEMO_FORGE_DIR, 'fragments');
  mkdirSync(fragDir, { recursive: true });
  writeFileSync(join(fragDir, 'cli-capture.html'), demoFragment('CLI before/after',
    '<p><em>Harness stand-in — the real agent runs the CLI baseline vs changed and captures real stdout here.</em></p>'));
  writeFileSync(join(fragDir, 'test-evidence.html'), demoFragment('Test evidence',
    '<p><em>Harness stand-in — the real agent runs the quality gate and shows the pass/fail result here.</em></p>'));
  writeFileSync(join(fragDir, 'narrative.html'), demoFragment('Narrative essence',
    '<p><em>Harness stand-in — the real agent writes a one-to-three sentence essence of the change here.</em></p>'));
  writeFileSync(join(DEMO_FORGE_DIR, 'DEMO.html'), composedDemoHtml());
}

export function writeDemoLock(sid, prompt) {
  mkdirSync(DEMO_FORGE_DIR, { recursive: true });
  const lock = {
    session_id: sid, project: PROJECT, prompt: prompt ?? '',
    iterations: 1, demo_skill: null, demo_html: '.forge/demo/DEMO.html',
    locked_at: new Date().toISOString(),
  };
  const lockText = `${JSON.stringify(lock, null, 2)}\n`;
  writeFileSync(join(DEMO_FORGE_DIR, 'demo.lock.json'), lockText);
  const histDir = join(DEMO_FORGE_DIR, 'history', sid);
  mkdirSync(histDir, { recursive: true });
  writeFileSync(join(histDir, 'DEMO.html'), readFileSync(join(DEMO_FORGE_DIR, 'DEMO.html'), 'utf8'));
  writeFileSync(join(histDir, 'meta.json'), lockText);
}

export function cleanDemoBuilderSession(sid) {
  if (!sid) return;
  try { rmSync(join(projectRoot, '_demo', sid), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(join(FORGE_ROOT, '_logs', `_demo-${sid}`), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(DEMO_FORGE_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// ── SKILLS-PILLAR HELPERS ───────────────────────────────────────────────────────
// OOTB skill ids that must surface as draggable chips (studio/catalog.yaml community-skills).
export const OOTB_SKILL_IDS = ['handoff', 'superpowers-tdd', 'security-review'];
// The edit beat opens a REAL shipped skill (no fabricated seed). The
// /agents/<slug> editor only opens STUDIO agents — a SKILL.md with a `runtime:`
// block and `library !== false` (orchestrator/studio/registry.ts isStudioAgent)
// — so plain skills like handoff/brain-query are not editable there.
// `project-scoped-review` is the low-risk pick: a library-listed (library: true),
// operator-triggered, read-only audit skill that no flow node references and no
// other journey depends on. Its original bytes are stashed below and restored
// after every real save (a save round-trips through serializeAgentDefinition,
// which normalises the file — only a byte-restore is faithful).
export const SK_EDIT_SLUG = 'project-scoped-review';
export const SK_EDIT_PATH = join(FORGE_ROOT, 'skills', SK_EDIT_SLUG, 'SKILL.md');
export const SK_NEW_NAME = 'API contract review';
export const SK_NEW_SLUG = 'api-contract-review';   // = name.toLowerCase().replace(/\s+/g,'-')
// The create CLIP records in a fresh context and clicks Create for real — it
// uses its own slug so it never collides with the main beat's SK_NEW_SLUG
// artifact. SK_NEW_SLUG is the walkthrough's THROUGHLINE skill (a later
// agents-journey block composes it into an agent build): nothing may remove it
// mid-run; the runner's finally sweeps it via cleanSkillArtifacts().
export const SK_CLIP_NAME = 'API contract review clip';
export const SK_CLIP_SLUG = 'api-contract-review-clip';

// Byte-stash of the real skill under edit (mirrors patchDemoProcess /
// restoreProjectJson): module-level so BOTH the beat's own tail and the
// runner's finally (which routes through cleanSkillArtifacts) can restore
// after a crash mid-edit. Restore is idempotent; the stash survives for the
// process lifetime.
let skEditStash = null;
export function stashRealSkill() {
  if (skEditStash === null) skEditStash = readFileSync(SK_EDIT_PATH, 'utf8');
  return skEditStash;
}
export function restoreRealSkill() {
  if (skEditStash === null) return;
  try { writeFileSync(SK_EDIT_PATH, skEditStash); } catch { /* best-effort */ }
}

// The agentic-author beat's staged artifact — the EXACT path the real
// demo-builder agent writes (orchestrator/demo-builder-runner.ts
// DEMO_SKILL_REL_PATH = '.forge/skills/demo-design/SKILL.md') and the path the
// preflight DEMO-SKILL clause checks (cli/preflight.ts checkDemoSkill). It is
// UNTRACKED in the mdtoc subtree, so the runner-finally `git checkout --
// projects/<p>` does NOT cover it — it is swept in cleanSkillArtifacts instead.
export const DEMO_DESIGN_SKILL_DIR = join(projectRoot, '.forge', 'skills', 'demo-design');
export function writeDemoDesignSkill() {
  mkdirSync(DEMO_DESIGN_SKILL_DIR, { recursive: true });
  writeFileSync(join(DEMO_DESIGN_SKILL_DIR, 'SKILL.md'), [
    '---',
    'name: demo-design',
    `description: Generated demo machinery for ${PROJECT} — renders a before/after demo of an initiative's changes.`,
    '---',
    '',
    `# demo-design (${PROJECT})`,
    '',
    'Composes the project demo page from its demo-process elements, in order:',
    '',
    '1. **Capture** — run `npm run demo` (the BUILT CLI against',
    '   test/fixtures/release-notes.md) and keep the real stdout.',
    '2. **Verify** — read the captured TOC back against the expected output',
    `   (the ${TOC_SENTINEL} section must be present; the fenced fake heading must not).`,
    '3. **Present** — assemble the fragments into .forge/demo/DEMO.html with the base CSS.',
    '',
    '> Staged artifact: the e2e walkthrough hand-writes this file at the exact path',
    '> the real demo-builder agent uses, under the FORGE_ARCHITECT_NO_SPAWN seam;',
    '> the beat removes it again after the preflight clause flips to resolved.',
    '',
  ].join('\n'));
}

export function cleanSkillArtifacts() {
  restoreRealSkill(); // crash-safe: the runner's finally routes through here
  for (const slug of [SK_NEW_SLUG, SK_CLIP_SLUG]) {
    try { rmSync(join(FORGE_ROOT, 'skills', slug), { recursive: true, force: true }); } catch { /* */ }
  }
  try { rmSync(DEMO_DESIGN_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// ── ONBOARD-EXISTING HELPERS ────────────────────────────────────────────────────
// The onboard-existing preflight-resolution arc: onboard clean, then seed disk state
// so the AUTO-tier ARTIFACTS clause fails, and resolve it deterministically (no LLM).
export const ONB_EXISTING_SLUG = 'journey-onboard-existing';
export function cleanOnboardedProject(slug) {
  try { rmSync(join(FORGE_ROOT, 'projects', slug), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(join(FORGE_ROOT, 'brain', 'projects', slug), { recursive: true, force: true }); } catch { /* */ }
}

// ── FLOW MONITOR NAV ─────────────────────────────────────────────────────────
// Referenced from inside beat drive() bodies; takes `page` explicitly (no
// runner-scope closure), so it moves cleanly alongside the other helpers.

/** Navigate to a Studio flow monitor and wait until it is ready with the cycle's
 *  run selected. The monitor refetches the run model from the bridge on load. */
export async function openStudioMonitor(page, watch, flowId = 'forge-develop', runId = CYCLE_ID) {
  await page.goto(watch.uiUrl + `/flows/${flowId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
  const card = page.locator(`[data-run-id="${runId}"]`).first();
  if ((await card.count()) > 0) {
    await card.click().catch(() => {});
    await sleep(ACT);
  }
}
