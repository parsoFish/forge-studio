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
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, renameSync, existsSync, utimesSync } from 'node:fs';
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
// R4-09-F3: a distinct cycle for the AUTOMATED-mode reflection beat (the shared
// CYCLE_ID above drives the interactive reflect beat).
export const AUTO_CYCLE_ID = `${CYCLE_ID}-automated`;
export const AUTO_CYCLE_LOG = join(FORGE_ROOT, '_logs', AUTO_CYCLE_ID);

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

/**
 * Fill a REACT-CONTROLLED field and prove the value reached React state, not
 * just the DOM. Kills a specific class of race: a beat that gates on an
 * SSR-satisfiable selector (e.g. `[data-section="..."]`, present in the
 * server-rendered HTML before React hydrates) and then treats the page as
 * interactive. If `fill()` lands before hydration attaches, it can set the
 * DOM `.value` directly while React's controlled-input state is still its
 * initial `''`; hydration then re-renders the input back to that state,
 * silently discarding the fill, and any button gated on the field
 * (`disabled={!canSubmit}`) stays disabled forever. This is exactly the
 * failure that killed `stand-up-onboard/su-onboard-project` (J4): a 30s
 * timeout waiting for `[data-action="onboard-project"]` to become enabled.
 *
 * Fills, then checks — after a short settle — that the element's own
 * `.value` still holds what was written; re-fills up to `attempts` times if
 * hydration reset it. THROWS (never silently continues) naming the selector
 * and the last-observed value if the fill never sticks — a silent fallback
 * here would just re-create the exact blindness this helper exists to
 * remove. Do not delete this as ceremony: the retry-and-verify is the fix,
 * not decoration.
 *
 * @param {import('playwright').Page} page
 * @param {string} selector   CSS selector for the controlled input/textarea.
 * @param {string} value      the value to fill.
 * @param {object} [opts]
 * @param {number} [opts.attempts=3]   max fill attempts before throwing.
 * @param {number} [opts.settleMs=300] wait after each fill before re-reading `.value`.
 * @param {number} [opts.timeout=5000] Playwright per-fill locator timeout (ms).
 */
export async function fillWhenLive(page, selector, value, opts = {}) {
  const { attempts = 3, settleMs = 300, timeout = 5000 } = opts;
  let lastSeen = '<never read>';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await page.locator(selector).fill(value, { timeout });
    await sleep(settleMs);
    lastSeen = await page.locator(selector).inputValue().catch(() => '<unreadable>');
    if (lastSeen === value) return;
  }
  throw new Error(
    `fillWhenLive: "${selector}" never held "${value}" after ${attempts} attempt(s) ` +
    `(last observed value: "${lastSeen}"). The field is likely not hydrated yet — ` +
    `React reset the DOM value after a fill landed pre-hydration. Do not silence this ` +
    `error; fix the gate the calling beat waits on before filling.`,
  );
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
    // S9/DEC-3: the RUN demonstration drives the threaded spine. The manifest names
    // forge-develop (the build flow the hand-off repoints onto); the seeded events
    // span architect→pm→dev[fanOut]→unifier→review→reflect under ONE cycle_id, so
    // run-model derives a flowLineage of [forge-architect, forge-develop] (DEC-2;
    // W7-C1 — reflection is a standalone agent run, not a flow, so the reflect
    // phase adds no lineage entry). Under Model B each flow's monitor renders its
    // OWN slice, and the threaded run surfaces under both.
    'flow_id: forge-develop',
    // Real develop dispatch stamps the manifest's cycle_id (enqueue-develop-run);
    // without it the bridge's applyReviewVerdict falls back to the initiative id
    // and the durable verdict.json lands in a DIFFERENT _logs dir than the run
    // page reads (surfaced by the R4-08-F3 view-mode beat; roadmap.mjs already
    // seeds cycle_id the same way).
    `cycle_id: ${CYCLE_ID}`,
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

// R4-15: a SELF-CONTAINED architect session seeded with a multi-initiative
// roadmap draft — three real `serializeManifest`-shaped manifests carrying real
// `depends_on_initiatives` edges, one of which points OUTSIDE the draft set so
// the unresolved-edge path is exercised on real data rather than asserted in a
// unit test that builds its own input.
//
// Deliberately SEPARATE from writePlan()'s canonical session: that session's
// manifests/ is promoted into the queue on approve, so adding initiatives there
// would put extra work into `_queue/` and shift every downstream beat. This one
// is created, read through the real route, and removed inside its own beat — it
// never reaches a gate and never leaves residue in the (repo-committed)
// projects/mdtoc tree.
export const DAG_SESSION_INITIATIVES = [
  { id: `INIT-${DATE}-e2e-dag-root`, deps: [] },
  { id: `INIT-${DATE}-e2e-dag-mid`, deps: [`INIT-${DATE}-e2e-dag-root`] },
  { id: `INIT-${DATE}-e2e-dag-leaf`, deps: [`INIT-${DATE}-e2e-dag-mid`, `INIT-${DATE}-e2e-dag-elsewhere`] },
];
/** The one dependency target deliberately absent from the draft set — an
 *  already-merged initiative is the real-world case, and its edge must be
 *  SURFACED by the renderer, never silently dropped. */
export const DAG_SESSION_UNRESOLVED_DEP = `INIT-${DATE}-e2e-dag-elsewhere`;

export function writeRoadmapDagSession(sid) {
  const dir = archDir(sid);
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  for (const { id, deps } of DAG_SESSION_INITIATIVES) {
    writeFileSync(join(dir, 'manifests', `${id}.md`), [
      '---', `initiative_id: ${id}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
      `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 10', 'cost_budget_usd: 4',
      'phase: pending', 'origin: architect',
      ...(deps.length > 0 ? ['depends_on_initiatives:', ...deps.map((d) => `  - ${d}`)] : []),
      '---', '',
      `# ${id}`, '',
      'Given the architect drafted a dependency-ordered roadmap, when the operator opens the session, then the draft renders as a DAG with its edges intact.',
    ].join('\n'));
  }
  writeStatus(sid, { phase: 'awaiting-verdict', round: 1, idea: IDEA });
}

export function cleanRoadmapDagSession(sid) {
  try { rmSync(archDir(sid), { recursive: true, force: true }); } catch { /* */ }
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
/** Sugar for the unifier phase — phase:'unifier', skill:'developer-unifier'.
 *  Retained for pre-R4-10 corpus grounding; the LIVE forge-develop flow uses
 *  the demo + adversarial-review nodes below (R4-10-F1). */
export function unifierEvent(eventType, message, opts = {}) {
  return cycleEvent('unifier', eventType, message, { ...opts, skill: 'developer-unifier' });
}

/** Sugar for the demo node (R4-10-F1) — phase:'orchestrator', skill:'demo-agent',
 *  metadata.agent_slug:'demo-agent' (the frozen generic-agent event contract that
 *  eventToNodeId resolves straight to the `demo` flow node). */
export function demoAgentEvent(eventType, message, opts = {}) {
  const { metadata = {}, ...rest } = opts;
  return cycleEvent('orchestrator', eventType, message, {
    ...rest,
    skill: 'demo-agent',
    metadata: { agent_slug: 'demo-agent', ...metadata },
  });
}

/** Sugar for the adversarial-review node (R4-10-F1) — phase:'orchestrator',
 *  skill:'adversarial-review', metadata.agent_slug:'adversarial-review'. */
export function adversarialReviewEvent(eventType, message, opts = {}) {
  const { metadata = {}, ...rest } = opts;
  return cycleEvent('orchestrator', eventType, message, {
    ...rest,
    skill: 'adversarial-review',
    metadata: { agent_slug: 'adversarial-review', ...metadata },
  });
}

/** Write the relocated PR body (.forge/pr-description.md) into the cycle-log
 *  artifacts dir — the demo node authors it now (R4-10-F1), and the run page's
 *  `pr` artifact readiness resolves it there. */
export function writePrDescription() {
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'pr-description.md'), [
    '## Why', '',
    'mdtoc regenerates a table of contents but only to stdout — there is no way to update a doc in place.',
    '', '## What', '',
    'Adds a `--write` mode that inserts or refreshes the generated TOC between the `<!-- toc -->` / `<!-- /toc -->` markers, idempotently.',
    '', '## How', '',
    'A new pure `src/inject.ts` computes the marker-bounded replacement; `src/cli.ts` wires the `--write` flag; a unit suite + a creds-free acceptance read-back cover it.',
    '',
  ].join('\n'));
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
  // ADR-040: seed the dev queue with the SAME two complete WIs the event stream
  // describes (corpus-grounded — a real ready-for-review worktree carries the
  // built WI specs), so the real send-back handler's compiler appends the fix
  // WI as WI-3 (append-only over the existing ids) and its scope union is
  // derived from real dev scopes, exactly as in a live cycle.
  const devWis = [
    {
      work_item_id: 'WI-1', initiative_id: INIT, status: 'complete', depends_on: [],
      acceptance_criteria: [{
        given: 'a markdown doc with <!-- toc --> / <!-- /toc --> markers',
        when: 'mdtoc --write runs against it',
        then: 'the generated TOC is inserted between the markers in place',
      }],
      files_in_scope: ['src/inject.ts', 'test/inject.test.ts'],
      creates: ['src/inject.ts', 'test/inject.test.ts'],
      quality_gate_cmd: ['npm', 'test'], estimated_iterations: 3,
    },
    {
      work_item_id: 'WI-2', initiative_id: INIT, status: 'complete', depends_on: ['WI-1'],
      acceptance_criteria: [{
        given: 'a doc whose TOC is already current',
        when: 'mdtoc --write runs a second time',
        then: 'the file is byte-identical (idempotent re-write)',
      }],
      files_in_scope: ['src/inject.ts', 'src/idempotency.ts', 'test/idempotency.test.ts'],
      creates: ['src/idempotency.ts', 'test/idempotency.test.ts'],
      quality_gate_cmd: ['npm', 'test'], estimated_iterations: 2,
    },
  ];
  for (const wi of devWis) {
    writeFileSync(join(wt, '.forge', 'work-items', `${wi.work_item_id}.md`),
      `---\n${yaml.dump(wi)}---\n\n# ${wi.work_item_id} — seeded (mirrors the event stream's dev WIs).\n`);
  }
  // Seed the static UWI-1 ("unify & prep the PR") the unifier normally writes —
  // since ADR-040 it is the queue's ONLY item (send-backs compile fix WIs onto
  // the dev queue above; the fix-loop drain re-arms this mission per round).
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

// ── R4-14 SHOWCASE fixtures ─────────────────────────────────────────────────
// Purpose-built, clip-only cycles for the /projects/[id]/showcase journey —
// deliberately NOT the shared CYCLE_ID/INIT above (flows-run/roadmap own that
// lifecycle end-to-end, through to `_queue/done/`, and this journey must
// leave it byte-unchanged) and NOT demo-builder's `.forge/demo/` dir
// (cleanDemoBuilderSession unconditionally wipes that shared, non-sid-scoped
// directory on every run — a showcase cycle seeded there would vanish out
// from under this journey the moment demo-builder's own cleanup fires).
//
// Two real, already-grounded mdtoc roadmap-feature stories, corpus-grounded
// the same way writeDemoJson (above) is: the OLDER cycle mirrors writeDemoJson's
// own shipped `--write` in-place TOC injection story; the NEWER cycle mirrors
// the `--check` CI drift-guard milestone already used as fixture prose in
// roadmap.mjs's INIT_DEV manifest body ("mdtoc — `--check` mode (CI drift
// guard)" / "Given a doc whose embedded TOC has drifted, when `mdtoc --check`
// runs, then it exits non-zero so CI can fail."). A genuinely different real
// feature — not a relabelled copy — with a different AC/test count, so the
// refresh beat's data-ac-eval-count flip is a real structural signal. NEVER
// invented betterado/PR-#61 strings (the mockup's own run-agent-demo-runner
// script — see story-registry.mjs).
//
// Fixed, deterministic cycleId timestamps (no trailing 'Z' — deriveShowcase-
// CycleId's cycleId-stamp fallback regex requires the timestamp segment to be
// followed immediately by `_`, which STAMP's real-run-derived 'Z' suffix
// above breaks; the production cycleId generator, orchestrator/cycle.ts's
// newCycleId, never appends one — these constants mirror THAT real shape,
// mirroring agents.mjs's own R6_06_FLOW_CYCLE_ID fixed-timestamp precedent).
export const SHOWCASE_INIT_1 = 'INIT-r4-14-showcase-evidence-a';
export const SHOWCASE_CYCLE_ID_1 = `2026-09-01T00-00-00_${SHOWCASE_INIT_1}`;
export const SHOWCASE_CYCLE_LOG_1 = join(FORGE_ROOT, '_logs', SHOWCASE_CYCLE_ID_1);

// A later leading timestamp than CYCLE_ID_1 — scanCycles() never sets
// Cycle.startedAt/endedAt from a real bridge scan, so deriveShowcaseCycleId's
// fallback chain (endedAt ?? startedAt ?? cycleId stamp) always lands on the
// cycleId stamp here; that is the ONLY thing that needs to be newer.
export const SHOWCASE_INIT_2 = 'INIT-r4-14-showcase-evidence-b';
export const SHOWCASE_CYCLE_ID_2 = `2026-09-02T00-00-00_${SHOWCASE_INIT_2}`;
export const SHOWCASE_CYCLE_LOG_2 = join(FORGE_ROOT, '_logs', SHOWCASE_CYCLE_ID_2);

// A second, distinct project id — NEVER `mdtoc` itself — for the honest-empty
// beat: carries only an in-flight manifest (real activity, nothing terminal),
// the "declared-data-fails-open" edge case the page's own WI-2 brief calls
// out, without mutating the real mdtoc project or its cycle history.
export const SHOWCASE_EMPTY_PROJECT = `${PROJECT}-showcase-empty-clip`;
export const SHOWCASE_EMPTY_INIT = 'INIT-r4-14-showcase-empty-inflight';

function showcaseManifest({ initId, project, phase }) {
  return [
    '---', `initiative_id: ${initId}`, `project: ${project}`, `project_repo_path: ${projectRoot}`,
    `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 8', 'cost_budget_usd: 12',
    `phase: ${phase}`, 'origin: architect',
    '---', '', `# ${initId} — seeded for the R4-14 demo-showcase journey.`,
  ].join('\n');
}

/**
 * Seed the OLDER showcase-worthy cycle: a `done` manifest + a real-shaped
 * demo.json (DemoModel — cli/demo-model.ts) mirroring writeDemoJson's own
 * `--write` TOC-injection story, under distinct clip-only ids.
 */
export function writeShowcaseCycleOne() {
  mkdirSync(QDIR('done'), { recursive: true });
  writeFileSync(join(QDIR('done'), `${SHOWCASE_INIT_1}.md`), showcaseManifest({ initId: SHOWCASE_INIT_1, project: PROJECT, phase: 'done' }));
  const artifacts = join(SHOWCASE_CYCLE_LOG_1, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'demo.json'), JSON.stringify({
    title: 'mdtoc: --write in-place TOC injection',
    essence: 'Adds a `--write` mode that inserts or refreshes the generated table of contents between <!-- toc --> / <!-- /toc --> markers via a new pure src/inject.ts, wired into the CLI. Idempotent — re-running --write on a current doc produces no diff.',
    project: PROJECT, initiativeId: SHOWCASE_INIT_1, baseRef: 'main', changedRef: `forge/${SHOWCASE_INIT_1}`,
    diffStat: ' src/inject.ts       |  38 ++++++++\n src/cli.ts          |  21 +++-\n test/inject.test.ts |  95 ++++++++++++\n 3 files changed, 154 insertions(+)',
    acEvaluations: [
      { criterion: 'marker slice + insert: --write replaces only the marker region; acceptance reads back the built CLI', verdict: 'met',
        evidence: 'injectToc_ReplacesMarkerRegion → PASS (npm test) + npm run acceptance reads back the exact TOC from dist/cli.js, exit 0' },
      { criterion: 'idempotency: re-running --write on a current doc produces no diff', verdict: 'met',
        evidence: 'injectToc_IsIdempotent → PASS, diff === "" on the 2nd and 3rd consecutive --write run' },
    ],
    summary: { bullets: ['Adds a pure src/inject.ts marker-region injector, wired into the CLI as --write.'], branch: `forge/${SHOWCASE_INIT_1}`, commitSha: 'b7c4e9a' },
    testEvidence: [
      { name: 'injectToc_ReplacesMarkerRegion', result: 'pass' },
      { name: 'injectToc_IsIdempotent', result: 'pass' },
      { name: 'acceptance: --write read-back vs test/fixtures/release-notes.md', result: 'pass' },
    ],
    checkpoints: [
      { label: 'Unit suite — injectToc_ReplacesMarkerRegion + injectToc_IsIdempotent', kind: 'harness',
        caption: 'marker-region slice replaces only the TOC; a second --write is byte-identical' },
    ],
  }, null, 2));
}

export function cleanShowcaseCycleOne() {
  try { rmSync(join(QDIR('done'), `${SHOWCASE_INIT_1}.md`), { force: true }); } catch { /* */ }
  try { rmSync(SHOWCASE_CYCLE_LOG_1, { recursive: true, force: true }); } catch { /* */ }
}

/**
 * Seed the NEWER showcase cycle: a `merged` manifest + a demo.json for a
 * DIFFERENT, also-grounded mdtoc roadmap feature (roadmap.mjs's INIT_DEV
 * fixture story: `--check` mode / CI drift guard) — a genuinely different
 * AC/test count from cycle one, so the showcase's re-derivation onto this
 * cycle is a real structural (data-ac-eval-count) flip, not a relabel.
 */
export function writeShowcaseCycleTwo() {
  mkdirSync(QDIR('merged'), { recursive: true });
  writeFileSync(join(QDIR('merged'), `${SHOWCASE_INIT_2}.md`), showcaseManifest({ initId: SHOWCASE_INIT_2, project: PROJECT, phase: 'merged' }));
  const artifacts = join(SHOWCASE_CYCLE_LOG_2, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'demo.json'), JSON.stringify({
    title: 'mdtoc: --check mode (CI drift guard)',
    essence: 'Given a doc whose embedded TOC has drifted, `mdtoc --check` exits non-zero so CI can fail the build on a stale table of contents.',
    project: PROJECT, initiativeId: SHOWCASE_INIT_2, baseRef: 'main', changedRef: `forge/${SHOWCASE_INIT_2}`,
    diffStat: ' src/check.ts        |  24 ++++++\n src/cli.ts          |   9 ++-\n 2 files changed, 31 insertions(+), 2 deletions(-)',
    acEvaluations: [
      { criterion: '--check exits non-zero when the embedded TOC has drifted from the generated one', verdict: 'met',
        evidence: 'checkToc_ExitsNonZeroOnDrift → PASS (npm test)' },
    ],
    summary: { bullets: ['Adds a pure src/check.ts comparator + --check CLI wiring for CI.'], branch: `forge/${SHOWCASE_INIT_2}`, commitSha: 'a1c93f0' },
    testEvidence: [
      { name: 'checkToc_ExitsNonZeroOnDrift', result: 'pass' },
      { name: 'checkToc_ExitsZeroWhenCurrent', result: 'pass' },
    ],
    checkpoints: [
      { label: 'Unit suite — checkToc_ExitsNonZeroOnDrift + checkToc_ExitsZeroWhenCurrent', kind: 'harness',
        caption: '--check exits non-zero on drift, zero when the embedded TOC is current' },
    ],
  }, null, 2));
}

export function cleanShowcaseCycleTwo() {
  try { rmSync(join(QDIR('merged'), `${SHOWCASE_INIT_2}.md`), { force: true }); } catch { /* */ }
  try { rmSync(SHOWCASE_CYCLE_LOG_2, { recursive: true, force: true }); } catch { /* */ }
}

/**
 * Seed the honest-empty fixture: a distinct project id with only an
 * in-flight manifest — real activity, nothing terminal — so
 * deriveShowcaseCycleId legitimately returns null and the showcase page
 * renders [data-section="showcase-empty"], never a fabricated gallery. No
 * `_logs/` dir needed: scanCycles() surfaces an in-flight manifest with no
 * log dir yet via its own "just-claimed, pre-first-event" fallback.
 */
/**
 * The empty-showcase project is a clip-only, REGISTERED project: since W7-A4
 * (projects-23) the showcase renders the shared NotFound for an id the roster
 * does not list, so a zero-cycle showcase can only be reached for a project
 * that exists — a bare dir under projects/ is discovered by `discoverProjects`
 * (orchestrator/studio/registry.ts; no `.forge/project.json` needed to be
 * LISTED — the same half-onboarded shape J4's own cleanup removes). Both the
 * dir and the in-flight manifest are removed in the beat tail (state ownership,
 * journey-sync rule 3).
 */
export const SHOWCASE_EMPTY_PROJECT_DIR = join(FORGE_ROOT, 'projects', SHOWCASE_EMPTY_PROJECT);

export function writeShowcaseEmptyFixture() {
  mkdirSync(SHOWCASE_EMPTY_PROJECT_DIR, { recursive: true });
  mkdirSync(QDIR('in-flight'), { recursive: true });
  writeFileSync(
    join(QDIR('in-flight'), `${SHOWCASE_EMPTY_INIT}.md`),
    showcaseManifest({ initId: SHOWCASE_EMPTY_INIT, project: SHOWCASE_EMPTY_PROJECT, phase: 'in-flight' }),
  );
}

export function cleanShowcaseEmptyFixture() {
  try { rmSync(join(QDIR('in-flight'), `${SHOWCASE_EMPTY_INIT}.md`), { force: true }); } catch { /* */ }
  try { rmSync(SHOWCASE_EMPTY_PROJECT_DIR, { recursive: true, force: true }); } catch { /* */ }
}

/**
 * R4-08-F3: the adversarial-review findings artifact beside the demo evidence.
 * Mirrors what the real critique pipeline persists (orchestrator/phases/
 * adversarial-review.ts → _logs/<cycleId>/artifacts/review-findings.json) —
 * grounded in the same mdtoc --write story the demo.json fixture tells:
 * round 1 carries one major contract-fit finding on the idempotency AC (the
 * same gap the operator sends back on); round 2 is an explicit clean pass.
 */
export function writeReviewFindings(revision) {
  const artifacts = join(CYCLE_LOG, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(join(artifacts, 'review-findings.json'), JSON.stringify({
    initiative_id: INIT,
    cycleId: CYCLE_ID,
    baseRef: 'main',
    headSha: revision > 1 ? 'c9d2f1b' : 'b7c4e9a',
    reviewedAt: '2026-07-16T03:24:00.000Z',
    summary: revision > 1
      ? 'Clean pass — the trailing-newline drift is fixed and asserted across consecutive writes; no correctness or regression findings against the round-2 diff.'
      : 'One major contract-fit finding: the idempotency AC is only partially demonstrable — the second --write pass drifts a trailing newline, so the demo cannot show byte-identical re-runs.',
    findings: revision > 1 ? [] : [
      {
        id: 'RF-1',
        severity: 'major',
        category: 'contract-fit',
        title: 'idempotency AC not byte-identical on the second --write pass',
        detail: 'injectToc appends a trailing newline when the marker region ends the file, so the 2nd write produces a one-line diff — the AC promises no diff on every re-run.',
        evidence: [{ file: 'src/inject.ts', line: 31, excerpt: "out.push('') // trailing newline appended unconditionally" }],
        acRef: 'idempotency: re-running --write on a current doc produces no diff',
      },
    ],
  }, null, 2) + '\n');
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

/** R4-09-F3: seed an AUTOMATED-mode reflection — every question carries a
 *  reflector-inferred answer (inferred:true) with a grounded citation, and
 *  user-feedback.md is machine-authored, so the ReflectionGate renders the
 *  read-only inferred view (data-reflect-automated) instead of the operator
 *  form. Seeded on a DISTINCT cycle so it doesn't collide with the interactive
 *  reflect beat's live-submitted answers. */
export function writeAutomatedReflection() {
  mkdirSync(AUTO_CYCLE_LOG, { recursive: true });
  // R4-09-F3: the durable mode sidecar — the bridge GET surfaces it as the
  // authoritative automated signal (independent of per-question inferred marks).
  writeFileSync(join(AUTO_CYCLE_LOG, 'reflect-mode.json'), JSON.stringify({ mode: 'automated' }));
  writeFileSync(join(AUTO_CYCLE_LOG, 'user-questions.json'), JSON.stringify([
    {
      question: 'Was the 2-work-item split the right size?',
      header: 'WI sizing',
      options: [
        { label: 'Right size', description: 'Both WIs mapped cleanly to the two ACs.' },
        { label: 'Too small', description: 'Could have been one WI.' },
        { label: 'Too large', description: 'Should have split further.' },
      ],
      inferred: true,
      answer: 'Right size — both WIs delivered (dev-loop.delivered shows 2 files changed each)',
    },
    {
      question: 'Did the implementation match the design intent and stay on goal?',
      header: 'Design fit',
      options: [],
      inferred: true,
      answer: 'Exact match — the shipped diff implements the PR-stated --write idempotency (pr-description.md)',
    },
    {
      question: 'Any other notes on this initiative?',
      header: 'Notes',
      options: [],
      inferred: true,
      answer: 'Clean cycle — 0 wedge events in the log',
    },
  ], null, 2));
  // Machine-authored feedback (the automated Stage-3 self-write) — makes the
  // reflection `answered`, which the read-only inferred view renders through.
  writeFileSync(join(AUTO_CYCLE_LOG, 'user-feedback.md'), [
    '_(inferred by the reflector — no operator feedback this cycle)_',
    '',
    '1. Right size.',
    '2. Exact match.',
    '3. Clean cycle, no wedges.',
    '',
  ].join('\n'));
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
    phase: 'instructions', skill: 'instructions-runner',
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
/** W7-C2 T1 review (P0-1) — read the answers.json the REAL bridge wrote when
 *  the AI-1 beat submitted the per-question interview form. The beat's POST
 *  is the only thing that ever creates this file, so its presence (and its
 *  question text + questionId) is the structural proof the submit actually
 *  landed — the old beat swallowed both its fill and its click and then
 *  force-wrote the next phase, so it passed while doing nothing at all.
 *  Returns null until the bridge has written it. */
export function readInstrAnswers(sid) {
  try {
    return JSON.parse(readFileSync(join(instrDir(sid), 'answers.json'), 'utf8'));
  } catch {
    return null;
  }
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

/**
 * W7-A2 — seed a CRASHED instructions session: status.json left at the
 * working phase `drafting` (the runner refuses to advance on a throw) with an
 * OLDER mtime, plus `_logs/_instructions-<sid>/stderr.log` holding a runner
 * error written AFTER it — the exact on-disk shape the operator's stuck
 * community-refresh 2026-08-18T12-54-32 / kb-cleanup 12-36-59 sessions had
 * (historical: community-refresh itself is retired, W8-B5b WI-3; provenance
 * here is their real stderr.log text, transposed to the instructions kind so
 * it lives under the shared mdtoc reference project like every other
 * instructions fixture). The bridge derives `state: crashed` + the error at
 * read time from these two facts (cli/bridge-studio-lifecycle.ts) — nothing
 * is written into status.json to say "crashed".
 */
export const CRASHED_INSTR_STDERR = [
  'InteractiveRunnerError: runInteractiveTurn: session kind "instructions" phase "drafting" declares writes: [draft], but the turn produced no files there — refusing to advance the session with an empty package rather than persisting a ghost turn to status.json.',
  '    at runAgentStyleStep (file:///home/parso/forge/orchestrator/interactive-runner.ts:493:11)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
  '    at async runInteractiveTurn (file:///home/parso/forge/orchestrator/interactive-runner.ts:328:16)',
  '',
].join('\n');
export function writeCrashedInstrSession(sid) {
  writeInstrStatus(sid, { phase: 'drafting', round: 2 });
  const statusPath = join(instrDir(sid), 'status.json');
  const tenMinAgo = (Date.now() - 10 * 60_000) / 1000;
  utimesSync(statusPath, tenMinAgo, tenMinAgo);
  const logDir = join(FORGE_ROOT, '_logs', `_instructions-${sid}`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'events.jsonl'), JSON.stringify({ event_id: 'EV_crash_1', cycle_id: `_instructions-${sid}`, initiative_id: `instructions-${sid}`, started_at: new Date().toISOString(), phase: 'instructions', skill: 'instructions-runner', event_type: 'start', input_refs: [], output_refs: [], message: 'instructions turn' }) + '\n');
  writeFileSync(join(logDir, 'stderr.log'), CRASHED_INSTR_STDERR);
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
/** W7-C2 T1 review (A14) — read the verdicts.json / feedback.md the REAL
 *  bridge wrote when the demo journey sent a `revise`. The revise SEND path
 *  had no end-to-end coverage at all: the DOM contract gained
 *  `verdict-revise` / `session-revise` / `session-revise-feedback` /
 *  `verdict-revise-send`, but only the render of the FIRST was ever asserted.
 *  Returns null until the bridge has written the file. */
export function readDemoVerdicts(sid) {
  try {
    return JSON.parse(readFileSync(join(demoDir(sid), 'verdicts.json'), 'utf8'));
  } catch {
    return null;
  }
}
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
    phase: 'demo', skill: 'demo-builder-runner',
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

/** R4-16 — snapshot ONE demo generation into the SESSION dir, byte-mirroring
 *  what `orchestrator/demo-builder-runner.ts` writes at the end of a real
 *  generate turn: `generations/<n>/{DEMO.html,SKILL.md,meta.json}`.
 *
 *  Honest boundary (stated, not blurred): journeys run the bridge with
 *  `FORGE_ARCHITECT_NO_SPAWN=1`, so the demo-builder agent and its runner NEVER
 *  execute — the harness writes what the runner would have written, the same
 *  stand-in contract `writeDemoArtifacts()` already uses for DEMO.html. The
 *  runner's own snapshot write is pinned in the CI-enforced node --test home
 *  (`orchestrator/demo-builder-runner.test.ts`). What the journey therefore
 *  proves for real is everything downstream of the snapshot: the derivation,
 *  the session route, the client parse, the view model and the DOM.
 *
 *  `feedback` is READ FROM THE REAL `feedback.md` the bridge's
 *  `POST /api/demo-builder/feedback` route just wrote (exactly as the runner
 *  reads it), never passed in — so a beat asserting the operator's typed words
 *  in the gallery is asserting a real round-trip, not its own fixture. */
export function writeDemoGeneration(sid, n, note = '') {
  const sessionDir = demoDir(sid);
  const genDir = join(sessionDir, 'generations', String(n));
  mkdirSync(genDir, { recursive: true });
  writeFileSync(join(genDir, 'DEMO.html'), composedDemoHtml());
  writeFileSync(join(genDir, 'SKILL.md'),
    `# demo-design (generation ${n})\n\nHarness stand-in for the generator skill the real ` +
    `demo-builder agent authors.${note ? `\n\nSteering applied: ${note}\n` : '\n'}`);
  // Mirrors `readFeedback` (orchestrator/demo-builder-runner.ts) EXACTLY,
  // trim and empty→null included: an empty-but-present feedback.md must
  // produce `null`, not `''`, or the gallery's `hasFeedback` check would see a
  // shape production never emits (round-2 review, fidelity gap — latent, fixed
  // before it could become a lie).
  let feedback = null;
  try {
    const raw = readFileSync(join(sessionDir, 'feedback.md'), 'utf8').trim();
    feedback = raw || null;
  } catch { /* generation 1 — no feedback file yet */ }
  writeFileSync(join(genDir, 'meta.json'), `${JSON.stringify({
    iteration: n,
    createdAt: new Date().toISOString(),
    feedback,
    targetElement: null,
    composed: true,
    skillRelPath: '.forge/skills/demo-design/SKILL.md',
  }, null, 2)}\n`);
}

export function writeDemoLock(sid, prompt, generation = null) {
  mkdirSync(DEMO_FORGE_DIR, { recursive: true });
  const lock = {
    session_id: sid, project: PROJECT, prompt: prompt ?? '',
    iterations: 1,
    // R4-16: `generation` is the finalized generation number (null when the
    // operator locked whatever was in the repo rather than choosing a
    // snapshot) — mirrors runLockStep's lock shape, which never attributes
    // `iteration` to it.
    generation,
    demo_skill: generation === null ? null : '.forge/skills/demo-design/SKILL.md',
    demo_html: '.forge/demo/DEMO.html',
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
// ONE constant for the throughline skill's description: skills.mjs SK-3 types
// it into the real /skills/new form AND seedThroughlineSkillFixture() below
// writes it straight to disk — sharing the literal pins the two paths to the
// same artifact bytes for the same slug (W7-FIX-B-UI review finding 2).
export const SK_NEW_DESC = 'Review an API surface for contract-breaking changes before merge.';
// The create CLIP records in a fresh context and clicks Create for real — it
// uses its own slug so it never collides with the main beat's SK_NEW_SLUG
// artifact. SK_NEW_SLUG is the walkthrough's THROUGHLINE skill (a later
// agents-journey block composes it into an agent build): nothing may remove it
// mid-run; the runner's finally sweeps it via cleanSkillArtifacts().
export const SK_CLIP_NAME = 'API contract review clip';
export const SK_CLIP_SLUG = 'api-contract-review-clip';

/**
 * Seed the walkthrough's throughline skill (SK_NEW_SLUG) when the skills
 * journey has not authored it — W7-FIX-B-UI. agents/agents-scratch-build
 * composes this skill into the from-scratch agent as a live palette chip
 * (R3-01-F2 filesystem discovery). In the FULL walkthrough, skills/
 * skills-create (SK-3) authors it through the real /skills/new form and this
 * is a strict no-op; under a scoped `--journey` run without the skills
 * journey, the beat seeds it here so every journey stays self-contained
 * (the ordering contract in scripts/journeys/index.mjs). The written shape
 * mirrors POST /api/studio/skills (cli/bridge-studio-skills.ts): frontmatter
 * name/description/`library: true`, NO runtime block — the exact plain-skill
 * shape orchestrator/studio/registry.ts listPlainSkills unions into the
 * palette, pinned by scripts/journey-scoped-selfcontainment.test.ts against
 * that real scanner. Cleanup is unchanged: the runner's finally sweeps
 * SK_NEW_SLUG via cleanSkillArtifacts() on every run, scoped or full.
 *
 * @param {string} [root] forge root (parameterised for the pin test)
 * @returns {boolean} true if this call seeded the fixture, false no-op
 */
export function seedThroughlineSkillFixture(root = FORGE_ROOT) {
  const dir = join(root, 'skills', SK_NEW_SLUG);
  const skillMdPath = join(dir, 'SKILL.md');
  if (existsSync(skillMdPath)) return false; // SK-3 (or a prior seed) owns it
  mkdirSync(dir, { recursive: true });
  writeFileSync(skillMdPath, [
    '---',
    `name: ${SK_NEW_NAME}`,
    `description: ${SK_NEW_DESC}`,
    'library: true',
    '---',
    '',
    `# ${SK_NEW_NAME}`,
    '',
    'Review the proposed API change against the last published contract.',
    'Flag removed fields, renamed endpoints, and narrowed types as breaking.',
    '',
  ].join('\n'));
  return true;
}

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

// R3-01-F3/F4 — the skills-install-approve beat's own scratch id. The SOURCE
// package lives outside the repo (an mkdtempSync'd dir the beat owns and
// removes itself), but installSkillPackage lands the RESULT under
// skills/<id>/ exactly like a real install, plus a ledger entry in
// studio/installed-skills.yaml (skill-install-ledger.ts) — both swept here so
// a crash mid-beat never leaves a stray draft/approved skill or a false
// "installed" ledger record behind.
export const SK_INSTALL_ID = 'journey-installed-skill';
export const SK_INSTALL_DIR = join(FORGE_ROOT, 'skills', SK_INSTALL_ID);
const SK_INSTALL_LEDGER_PATH = join(FORGE_ROOT, 'studio', 'installed-skills.yaml');

// The ledger's EXACT prior state, captured once per process on the FIRST
// sweep call — `undefined` = not yet captured, `null` = no ledger file
// existed before this run, a string = its exact original bytes. Restoring to
// this (rather than merely filtering out this beat's own entry) is what
// fixes the "installed: []` dirt left behind when no ledger file existed
// before the run" defect (R3-01-F4, ui:journey-found): a plain entry-filter
// still WRITES the file (with an empty `installed: []`) even when it never
// existed pre-run.
let skInstallLedgerStash;

/** Narrow sweep for the skills-install-approve beat's OWN artifacts only —
 *  its installed skill dir (SK_INSTALL_DIR) and its studio/installed-skills.yaml
 *  ledger entry, restored to the exact state captured before this run ever
 *  touched either. Deliberately does NOT touch SK_NEW_SLUG/SK_CLIP_SLUG (the
 *  skills-create beat's throughline artifact a LATER agents-journey beat
 *  composes into an agent build) or the edit-beat's stash — that broad reach
 *  belongs to cleanSkillArtifacts() only, never to this beat's own sweep
 *  (ui:journey-found defect: the broad sweep, called at this beat's own
 *  start/end, deleted the throughline skill mid-run). Idempotent + best-effort:
 *  safe to call at both the beat's start (stale-state sweep) and its end (real
 *  cleanup), any number of times. */
export function cleanSkillInstallArtifacts() {
  if (skInstallLedgerStash === undefined) {
    skInstallLedgerStash = existsSync(SK_INSTALL_LEDGER_PATH) ? readFileSync(SK_INSTALL_LEDGER_PATH, 'utf8') : null;
  }
  try { rmSync(SK_INSTALL_DIR, { recursive: true, force: true }); } catch { /* */ }
  if (skInstallLedgerStash === null) {
    try { rmSync(SK_INSTALL_LEDGER_PATH, { force: true }); } catch { /* */ }
  } else {
    try { writeFileSync(SK_INSTALL_LEDGER_PATH, skInstallLedgerStash, 'utf8'); } catch { /* */ }
  }
}

export function cleanSkillArtifacts() {
  restoreRealSkill(); // crash-safe: the runner's finally routes through here
  for (const slug of [SK_NEW_SLUG, SK_CLIP_SLUG]) {
    try { rmSync(join(FORGE_ROOT, 'skills', slug), { recursive: true, force: true }); } catch { /* */ }
  }
  try { rmSync(DEMO_DESIGN_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
  cleanSkillInstallArtifacts(); // crash-safe backstop for the install-approve beat too
  // R4-21 T3 — crash-safe backstop for the build-skill beat (authoring
  // session + its landed/installed package); AUTH_SKILL_DIR/landed dir
  // removal + the shared ledger restore, defined below cleanSkillInstallArtifacts.
  try { rmSync(AUTH_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(AUTH_LANDED_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
  cleanAuthoringSessions();
}

// ── HOOKS-PILLAR HELPERS (R3-03-F4) ─────────────────────────────────────────
// Three hooks the journey authors through the REAL /hooks/new form (mirrors
// the skills-pillar SK_* fixtures above): HK_NEW (a benign PreToolUse guard,
// created unbound then bound to a real agent), HK_SECURITY (2026-08-04
// BLOCKER 2, a32a8305 — a script that DECLARES a secret-shaped env grant +
// network egress and curls the secret out; this is the shape that could
// actually leak, since only a manifest-granted var reaches the child at spawn
// time (hook-runtime.ts's buildHookChildEnv) — and the fix that closed the
// vulnerability was making a declared secret-shaped grant score `critical`
// exactly like an undeclared one, never downgraded), and HK_UNDECLARED (the
// contrast case — the same shape with nothing declared: it still scores
// `blocked` on the scan, but it is the INERT one, since the undeclared var
// never reaches the child even if approved and run). None of these three are
// ever bound to anything. All three names are ALREADY valid lowercase-kebab
// slugs so the bridge's create-route slugify
// (`name.toLowerCase().replace(/\s+/g,'-')...`) is a no-op — no need to
// re-derive the id from a human-readable name.
export const HK_NEW_ID = 'journey-stack-base-guard';
export const HK_NEW_DIR = join(FORGE_ROOT, 'studio', 'hooks', HK_NEW_ID);
export const HK_SECURITY_ID = 'journey-exfil-probe';
export const HK_SECURITY_DIR = join(FORGE_ROOT, 'studio', 'hooks', HK_SECURITY_ID);
export const HK_UNDECLARED_ID = 'journey-undeclared-probe';
export const HK_UNDECLARED_DIR = join(FORGE_ROOT, 'studio', 'hooks', HK_UNDECLARED_ID);

// The real agent HK_NEW is bound into — a low-risk pick no other journey
// module stashes (project-manager: agents.mjs's own local PM_SKILL_PATH
// stash; project-scoped-review: SK_EDIT_SLUG above) and thematically apt:
// the pre-pr-security-review OOTB seed's own matcher is `Bash(gh pr
// create)`, so binding a lifecycle hook onto the Developer agent mirrors the
// mockup's own "bind it — from the Developer's builder" beat.
export const HK_BIND_AGENT_SLUG = 'developer-ralph';
export const HK_BIND_AGENT_PATH = join(FORGE_ROOT, 'skills', HK_BIND_AGENT_SLUG, 'SKILL.md');
let hkBindAgentStash = null;
export function stashHookBindAgent() {
  if (hkBindAgentStash === null) hkBindAgentStash = readFileSync(HK_BIND_AGENT_PATH, 'utf8');
  return hkBindAgentStash;
}
export function restoreHookBindAgent() {
  if (hkBindAgentStash === null) return;
  try { writeFileSync(HK_BIND_AGENT_PATH, hkBindAgentStash); } catch { /* best-effort */ }
}

// studio/hook-approvals.yaml — a SECOND, git-tracked ledger (mirrors
// SK_INSTALL_LEDGER_PATH's handling immediately above): approve/override on
// HK_SECURITY writes an entry here. The file does not exist pre-run (no
// studio/hook-approvals.yaml is checked in), so restoring to "did not exist"
// rather than merely filtering an entry out is what keeps a run leaving zero
// residue — same rationale as skInstallLedgerStash's own doc comment.
const HK_APPROVAL_LEDGER_PATH = join(FORGE_ROOT, 'studio', 'hook-approvals.yaml');
let hkApprovalLedgerStash;
function restoreHookApprovalLedger() {
  if (hkApprovalLedgerStash === undefined) {
    hkApprovalLedgerStash = existsSync(HK_APPROVAL_LEDGER_PATH) ? readFileSync(HK_APPROVAL_LEDGER_PATH, 'utf8') : null;
  }
  if (hkApprovalLedgerStash === null) {
    try { rmSync(HK_APPROVAL_LEDGER_PATH, { force: true }); } catch { /* */ }
  } else {
    try { writeFileSync(HK_APPROVAL_LEDGER_PATH, hkApprovalLedgerStash, 'utf8'); } catch { /* */ }
  }
}

/** Narrow sweep for the hooks-security beat's OWN artifacts only — both its
 *  studio/hooks/<id>/ packages (HK_SECURITY, the declared-exfil flagship, AND
 *  HK_UNDECLARED, the inert contrast) + the approval ledger, restored to its
 *  exact prior state. Idempotent + best-effort: safe to call at the beat's
 *  start (stale-state sweep), between its main pass and its clip (the clip
 *  reuses HK_SECURITY's id sequentially rather than a second scratch id,
 *  since neither artifact is a throughline past this one beat — a POST to an
 *  already-existing id 409s, so the id must be fully cleared first), and at
 *  the beat's own end. */
export function cleanHookSecurityArtifacts() {
  for (const dir of [HK_SECURITY_DIR, HK_UNDECLARED_DIR]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
  restoreHookApprovalLedger();
}

/** Narrow sweep for the hooks-create/hooks-bind beats' OWN artifact — the
 *  hook package created via /hooks/new that later gets bound to
 *  HK_BIND_AGENT_SLUG. A throughline WITHIN this journey only (created in
 *  hooks-create, consumed in hooks-bind); nothing outside scripts/journeys/
 *  hooks.mjs depends on it, so it is swept once, at hooks-bind's own end. */
export function cleanHookCreateArtifacts() {
  try { rmSync(HK_NEW_DIR, { recursive: true, force: true }); } catch { /* */ }
}

/** Broad, journey-scoped sweep — every artifact THIS journey (hooks.mjs)
 *  creates, nothing from any other pillar. Used ONLY as a stale-state
 *  pre-sweep at the top of the journey's first MUTATING beat (mirrors where
 *  cleanSkillArtifacts first appears in skills.mjs — SK-2, not SK-0/SK-0b —
 *  narrowed here to this journey's own ids). */
export function cleanHookArtifacts() {
  cleanHookSecurityArtifacts();
  cleanHookCreateArtifacts();
  restoreHookBindAgent();
  // R4-21 T3 — crash-safe backstop for the build-hook beat (authoring
  // session + its landed/installed package).
  try { rmSync(AUTH_HOOK_DIR, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(AUTH_LANDED_HOOK_DIR, { recursive: true, force: true }); } catch { /* */ }
  cleanAuthoringSessions();
}

// ── ONBOARD-EXISTING HELPERS ────────────────────────────────────────────────────
// The onboard-existing preflight-resolution arc: onboard clean, then seed disk state
// so the AUTO-tier ARTIFACTS clause fails, and resolve it deterministically (no LLM).
export const ONB_EXISTING_SLUG = 'journey-onboard-existing';
export function cleanOnboardedProject(slug) {
  try { rmSync(join(FORGE_ROOT, 'projects', slug), { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(join(FORGE_ROOT, 'brain', 'projects', slug), { recursive: true, force: true }); } catch { /* */ }
}

// ── AUTHORING-SESSION HELPERS (R4-21 phase 2, T3 — build-skill/build-hook) ──
// The creation-agent authoring session (/sessions/authoring/<sid>) drafts a
// skill or hook PACKAGE into the session's own `staging/` subdirectory
// (studio/session-kinds.yaml's `authoring` descriptor: turnSpec phase
// `analyzing: {step: agent, writes: [staging], next: awaiting-review}`).
// Under this harness's FORGE_ARCHITECT_NO_SPAWN=1 the real spawn
// (`forge agent run authoring <sid> --project <p>`, cli/dry-bridge.ts) is a
// no-op, so after the REAL `POST /api/studio/authoring/start` the session
// sits at status.json `phase:'analyzing'` with an empty `staging/`. The seed
// functions below write exactly what that suppressed turn would have
// written — the drafted package + the `analyzing -> awaiting-review`
// transition the turnSpec table itself declares — as a merge-patch onto the
// REAL status.json the start route already wrote (project/runId/prompt/
// startedAt all stay real). Everything from there on is unsuppressed, real
// product code: `POST /api/studio/authoring/finalize` runs the real
// `copyStagingToLibrary` finalizer + the real skill/hook install.
//
// PROVENANCE (binding — never hand-invent an agent's output): the seeded
// bytes are committed, byte-identical copies of a real, live, unsuppressed
// creation-agent turn the orchestrator captured for this port
// (session R4-21-live-capture) — copied via `cp`, never retyped, from
// `_wave5/gate-logs/R4-21-live-capture/{skill/SKILL.md,hook/hook.yaml,
// hook/scripts/run.sh}` (that path is gitignored campaign scratch, cited
// here ONLY as the provenance record — nothing at runtime reads from it) into
// this repo's own `scripts/journeys/fixtures/r4-21-live-capture/`, which IS
// what the seed functions below read. sha256 verified equal on both sides
// after the copy:
//   skill/SKILL.md       f8c53c4fd15c31b88554d9f62933d506e360f92bd566990bb762ff4e288305c5
//   hook/hook.yaml        266e3356cd32f030a999e0648ba9f230f7b16b676fc5fc2426d18f12552a9681
//   hook/scripts/run.sh   337873ab28280df413d72fdcbbaebf2799aff33436f101adc74a85bdfb4f69ac
const AUTH_FIXTURES_DIR = join(FORGE_ROOT, 'scripts', 'journeys', 'fixtures', 'r4-21-live-capture');
const AUTH_LIVE_SKILL_MD = readFileSync(join(AUTH_FIXTURES_DIR, 'skill', 'SKILL.md'), 'utf8');
const AUTH_LIVE_HOOK_YAML = readFileSync(join(AUTH_FIXTURES_DIR, 'hook', 'hook.yaml'), 'utf8');
const AUTH_LIVE_HOOK_RUN_SH = readFileSync(join(AUTH_FIXTURES_DIR, 'hook', 'scripts', 'run.sh'), 'utf8');

// Fixed ids (mirrors HK_NEW_ID's own fixed-slug precedent) — the operator
// types this into [data-field="authoring-id"] at finalize time; it need not
// match the drafted content's own `name:`, but doing so keeps the fixture
// honest (this id names the SAME package the captured turn drafted).
export const AUTH_SKILL_ID = 'journey-live-proof-skill';
export const AUTH_SKILL_DIR = join(FORGE_ROOT, 'skills', AUTH_SKILL_ID);
export const AUTH_HOOK_ID = 'journey-live-proof-hook';
export const AUTH_HOOK_DIR = join(FORGE_ROOT, 'studio', 'hooks', AUTH_HOOK_ID);
// `_interactive-library/<id>/` — the finalize route's own landing root
// (INTERACTIVE_LIBRARY_DIRNAME, cli/bridge-studio-authoring.ts), gitignored.
const AUTH_LANDED_SKILL_DIR = join(FORGE_ROOT, '_interactive-library', AUTH_SKILL_ID);
const AUTH_LANDED_HOOK_DIR = join(FORGE_ROOT, '_interactive-library', AUTH_HOOK_ID);

export function authoringDir(sid) { return join(projectRoot, '_authoring', sid); }

/** Parse a real authoring session id out of a `/sessions/authoring/<sid>` URL
 *  (null if not there) — shared by both skills.mjs and hooks.mjs's own new
 *  build beats, mirroring instrSidFromUrl/pbSidFromUrl's own loose
 *  substring-match shape in stand-up-create.mjs. */
export function authoringSidFromUrl(url) {
  const m = /\/authoring\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Merge-patch the REAL status.json the real POST /start already wrote
 *  (phase/project/runId/prompt/startedAt) — every field the real route wrote
 *  stays real; only the fields named in `patch` move. Mirrors writePbStatus's
 *  shape but PATCHES rather than overwrites, since (unlike project-brain/
 *  instructions, whose sessions this harness originates itself) an authoring
 *  session's status.json is always seeded by a REAL bridge route first. */
function patchAuthoringStatus(sid, patch) {
  const path = join(authoringDir(sid), 'status.json');
  const current = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...current, ...patch }, null, 2));
}

/** Seeds the real, suppressed creation-agent turn's would-be output — the
 *  drafted SKILL.md at staging/SKILL.md — then flips phase to
 *  'awaiting-review', the exact analyzing -> awaiting-review transition the
 *  turnSpec table declares, minus the spawn itself. */
export function seedAuthoringSkillDraft(sid) {
  const staging = join(authoringDir(sid), 'staging');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'SKILL.md'), AUTH_LIVE_SKILL_MD);
  patchAuthoringStatus(sid, { phase: 'awaiting-review' });
}

/** Same shape for a hook draft — staging/hook.yaml + staging/scripts/run.sh,
 *  the 2-file package shape skills/creation-agent/SKILL.md itself declares. */
export function seedAuthoringHookDraft(sid) {
  const staging = join(authoringDir(sid), 'staging');
  mkdirSync(join(staging, 'scripts'), { recursive: true });
  writeFileSync(join(staging, 'hook.yaml'), AUTH_LIVE_HOOK_YAML);
  writeFileSync(join(staging, 'scripts', 'run.sh'), AUTH_LIVE_HOOK_RUN_SH);
  patchAuthoringStatus(sid, { phase: 'awaiting-review' });
}

/** Removes ONE session's own `_authoring/<sid>/` dir — the crash-safe,
 *  per-session cleanup a runner finally block calls via ctx.seeded. */
export function cleanAuthoringSession(sid) {
  if (!sid) return;
  try { rmSync(authoringDir(sid), { recursive: true, force: true }); } catch { /* */ }
}

/** Broad sweep — every `_authoring/` session under this project, regardless
 *  of id (session dirs are server-minted timestamps, never a fixed slug this
 *  module could name individually). Safe to call unconditionally: `_authoring`
 *  is exclusively this R4-21 kind's own scratch — nothing else in forge ever
 *  writes there, and no `_authoring` content is ever checked into mdtoc. */
export function cleanAuthoringSessions() {
  try { rmSync(join(projectRoot, '_authoring'), { recursive: true, force: true }); } catch { /* */ }
}

/** Narrow sweep for the build-skill beat's own installed artifact — the
 *  landed package, the installed skill dir, AND (mirrors
 *  cleanSkillInstallArtifacts' own ledger-restore discipline exactly, since
 *  installSkillPackage always writes studio/installed-skills.yaml
 *  regardless of upstream.source) the shared install ledger, via the SAME
 *  exported sweep skills-install-approve already uses — one shared stash,
 *  restored to its true pre-run state regardless of which beat touched it
 *  first.
 *
 *  R4-21 T3 pin round 6, correction C: called with `sid === null` at the
 *  beat's OWN start as a crash-safe stale-state sweep (the same idiom every
 *  other beat's pre-sweep uses) — but `cleanAuthoringSession(null)`
 *  early-returns (session dirs are server-minted timestamps this module
 *  cannot name individually), so that pre-sweep call was a documented no-op
 *  in prose only, never in effect: a session dir orphaned by a crashed prior
 *  run would survive every subsequent run's "stale-state sweep" untouched.
 *  Fixed by routing the no-`sid` case through the BROAD, journey-scoped
 *  `cleanAuthoringSessions()` (every `_authoring/` session under this
 *  project, regardless of id) instead — the same sweep `cleanSkillArtifacts`
 *  already uses as ITS crash-safe backstop. The per-`sid` path (every
 *  end-of-beat call, which always has a real sid) is untouched — narrow and
 *  exact there, same as before. */
export function cleanAuthoringSkillArtifacts(sid) {
  if (sid) cleanAuthoringSession(sid); else cleanAuthoringSessions();
  try { rmSync(AUTH_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(AUTH_LANDED_SKILL_DIR, { recursive: true, force: true }); } catch { /* */ }
  cleanSkillInstallArtifacts();
}

/** Narrow sweep for the build-hook beat's own installed artifact — the
 *  landed package + the installed hook dir. No approval ledger to restore
 *  here (unlike hooks-security's HK_SECURITY/HK_UNDECLARED arc): this beat
 *  never approves or overrides, so studio/hook-approvals.yaml is never
 *  touched.
 *
 *  R4-21 T3 pin round 6, correction C: same fix as
 *  `cleanAuthoringSkillArtifacts` above, same reason — see its doc comment. */
export function cleanAuthoringHookArtifacts(sid) {
  if (sid) cleanAuthoringSession(sid); else cleanAuthoringSessions();
  try { rmSync(AUTH_HOOK_DIR, { recursive: true, force: true }); } catch { /* */ }
  try { rmSync(AUTH_LANDED_HOOK_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// ── FLOW MONITOR NAV ─────────────────────────────────────────────────────────
// Referenced from inside beat drive() bodies; takes `page` explicitly (no
// runner-scope closure), so it moves cleanly alongside the other helpers.

/** Select a run in the flow monitor's RAIL. W7-FIX-A3 (the flows-run reflect
 *  regression): the selector is scoped to the rail card
 *  (`[data-run-group] [data-run-id=…]`), NEVER a bare `[data-run-id]` — the
 *  HistoryLedger row carries the same attribute on an `<a>`, and once the
 *  COMPLETE group collapsed (>10 archived runs) that row was the first match:
 *  the "select" click NAVIGATED to the run-detail page. A collapsed group is
 *  expanded first when the card is not rendered (the rail keeps only the
 *  SELECTED run visible inside a collapsed group). Returns true when the card
 *  was clicked. */
export async function selectRailRun(page, runId) {
  const card = () => page.locator(`[data-run-group] [data-run-id="${runId}"]`).first();
  if ((await card().count()) === 0) {
    const collapsed = page.locator('[data-run-group][data-group-collapsed="true"] [data-action="toggle-run-group"]');
    for (let guard = 0; guard < 6 && (await collapsed.count()) > 0; guard++) {
      await collapsed.first().click().catch(() => {});
      await sleep(150);
    }
  }
  if ((await card().count()) > 0) {
    await card().click().catch(() => {});
    await sleep(ACT);
    return true;
  }
  return false;
}

/** Navigate to a Studio flow monitor and wait until it is ready with the cycle's
 *  run selected. The monitor refetches the run model from the bridge on load. */
export async function openStudioMonitor(page, watch, flowId = 'forge-develop', runId = CYCLE_ID) {
  await page.goto(watch.uiUrl + `/flows/${flowId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
    null, { timeout: 20000 },
  ).catch(() => {});
  await selectRailRun(page, runId);
}
