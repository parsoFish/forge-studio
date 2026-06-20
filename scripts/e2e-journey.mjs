/**
 * e2e-journey — Forge Studio product-walkthrough + DOM-as-metrics regression harness.
 *
 *   node scripts/e2e-journey.mjs   (npm run ui:journey)
 *
 * STORY: "Forge Studio — author a flow, run it, swap its engine."
 *   Post-M8 the platform is the hero, not one linear cycle. The forge cycle is
 *   just ONE flow definition (studio/flows/forge-cycle/flow.yaml) interpreted by
 *   the node-executor registry (ADR-028). The journey proves the three things the
 *   platform now does, in order:
 *
 *   ACT 1 — AUTHOR   everything in Studio is data you can edit
 *     · library (/) — flows / agents / projects / KBs as cards + operator pulse
 *     · BUILD THE FORGE CYCLE FROM SCRATCH — author forge-cycle-scratch as a flow
 *       definition (6 agents, 5 artifact edges, 2 gates), validate it with
 *       `forge studio lint`, prove structural parity with the production seed, and
 *       render it live in the flow builder. The hardcoded cycle is subsumed by data.
 *     · agent builder (/agents/project-manager) — composition + runtime + budgets
 *     · project builder (/projects/mdtoc) — north star, creds-free demo timeline,
 *       skills, KB binding, C-contract readiness (FORGE_E2E_PROJECT overrides)
 *
 *   ACT 2 — RUN   the cycle as the proof case, grounded on a REAL mdtoc feature
 *     · idea (/architect/new) → interview (P1 stall / P2 free-text / P3 activity / P4 cost)
 *     · PLAN gate (/artifact ...type=plan&mode=gate) — send-back → revise → approve
 *     · autonomous build on /flows/forge-cycle — PM decomposes → WIs fan off dev →
 *       TDD red → grind → gate.pass (dependency-ordered) → unifier on its OWN hex
 *       authors the mdtoc demo (captured CLI read-back evidence)
 *     · verdict gate — per-AC evaluated demo (AC-2 PARTIAL) → operator authors a new
 *       G/W/T criterion → dev-loop reruns → re-review PARTIAL→MET → approve + merge
 *     · reflect — operator tunes the brain
 *
 *   ACT 3 — SWAP   the seams — the platform is modular, not hardcoded (subsumption)
 *     · flow-engine controls — start-run CTA / cost-ceiling gauge / gate / resume
 *     · runtime-adapter seam (ADR-029) — registry-driven SDK picker (claude live;
 *       gemini/aider/codex disabled until provisioned) + range strategy
 *     · KB-backend seam (ADR-027 §4) — knowledge force-graph + pin-guidance
 *       (FilesystemKbBackend default; Zep descriptor swap)
 *
 * No live LLM: the architect runner's turns + the autonomous cycle are emulated by
 * seeding the same files/events the real phases write, grounded on a real mdtoc
 * roadmap feature (the `--write` in-place TOC injection mode) so the artifacts read true.
 *
 * REGRESSION HARNESS: all assertions are SOFT (shared journey-assertions module;
 * non-zero exit at end). Guards preserved: ≥5 phase hexes, ≥2 WI hexes, drawer
 * opens (phase + wi), per-phase cost rollup, unifier own-node complete, per-AC
 * demo-evaluation, partial-count==0 on re-review, reflection hex complete, the
 * four architect observability surfaces (P1–P4), plus the NEW author-from-scratch
 * parity + `forge studio lint` proof.
 *
 * Output: forge-ui/.demo-shots/e2e/{video/journey.webm, frames/*.png, index.html}.
 * Cleans up all seeded state (architect session, cycle logs, queue manifests,
 * the forge-cycle-scratch flow, any _guidance/*.md) in the finally block.
 */
import { spawn, execSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { chromium } from 'playwright-core';
import { createAssertions, sleep } from './lib/journey-assertions.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// PROJECT is parameterised (FORGE_E2E_PROJECT) so the walkthrough can be
// grounded on any managed project; the default is `mdtoc`, forge's creds-free
// out-of-the-box reference project (markdown-TOC CLI). The seeded artifacts
// below are grounded on a real mdtoc roadmap feature so the demo reads true.
const PROJECT = process.env.FORGE_E2E_PROJECT || 'mdtoc';
const projectRoot = join(FORGE_ROOT, 'projects', PROJECT);

// SAFETY: this harness seeds + then deletes scratch. A REAL, pre-existing
// project must NEVER have its directory removed — only the demo's own scratch
// (the one architect session it creates, its cycle log, its queue manifest).
// `mdtoc` is a checked-in reference project (lives inside forge's own repo, so
// it has no nested `.git`); `betterado` is a separate git clone. EITHER way the
// project directory pre-exists with real source, so it is NOT synthetic and
// cleanProjectDir is a no-op. We only treat a project as synthetic (disposable)
// if its directory did not exist before this harness ran.
const PROJECT_PREEXISTED = existsSync(projectRoot);
const IS_SYNTHETIC = !PROJECT_PREEXISTED;
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

// ── MDTOC GROUNDING ─────────────────────────────────────────────────────────────
// A real, small mdtoc roadmap feature (Milestone 1 — In-place TOC injection):
// `mdtoc --write <file>` inserts (or refreshes) the generated table of contents
// between `<!-- toc -->` / `<!-- /toc -->` markers, idempotently. Creds-free —
// the change is proven by running the BUILT CLI against a fixture (the `cli-diff`
// demo shape), not against an external system.
const IDEA = 'Add a --write mode to mdtoc that inserts or refreshes the generated table of contents in-place between <!-- toc --> / <!-- /toc --> marker comments, idempotently (re-running --write produces no diff).';
const DATE = new Date().toISOString().slice(0, 10);
const INIT = `INIT-${DATE}-e2e-toc-write-mode`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const CYCLE_ID = `${STAMP}_${INIT}`;
const CYCLE_LOG = join(FORGE_ROOT, '_logs', CYCLE_ID);

// Acceptance coordinates: mdtoc is creds-free, so the demo evidence is a captured
// CLI read-back (the `acceptance` gate runs the BUILT CLI against the fixture and
// asserts the exact generated TOC) rather than a live REST GET. Kept as concrete
// constants so the seeded demo carries a real, greppable evidence block
// (demos-are-visual-evidence policy — for a CLI project the "real resource" is the
// command's captured output, not a test-name table).
const ACC_CMD = 'npm run acceptance';
const ACC_FIXTURE = 'test/fixtures/release-notes.md';
const TOC_SENTINEL = 'sentinel-7f3a9c';

// ── ACT-1 AUTHOR: author-from-scratch flow definition ──────────────────────────
// The forge cycle rebuilt from first principles as a flow definition: six named
// agents, five artifact edges, two human gates. Proves the cycle is subsumed by
// data (ADR-028) — `forge studio lint` validates it and it is structurally
// identical to the production seed. Written before the bridge boots so the UI can
// load it; removed in the finally block.
const SCRATCH_FLOW = 'forge-cycle-scratch';
const SCRATCH_FLOW_DIR = join(FORGE_ROOT, 'studio', 'flows', SCRATCH_FLOW);
const SEED_FLOW_PATH = join(FORGE_ROOT, 'studio', 'flows', 'forge-cycle', 'flow.yaml');
/** The explicit, from-scratch authoring spec (NOT a copy of the seed file). */
const SCRATCH_SPEC = {
  nodes: [
    { id: 'architect', agent: 'architect', gate: 'plan' },
    { id: 'pm', agent: 'project-manager' },
    { id: 'dev', agent: 'developer-ralph', fanOut: 'work-items' },
    { id: 'unifier', agent: 'developer-unifier', resumable: true },
    { id: 'review', gate: 'verdict' },
    { id: 'reflect', agent: 'reflector' },
  ],
  edges: [
    { from: 'architect', to: 'pm', artifact: 'plan' },
    { from: 'pm', to: 'dev', artifact: 'work-items' },
    { from: 'dev', to: 'unifier', artifact: 'wi-branches' },
    { from: 'unifier', to: 'review', artifact: 'pr' },
    { from: 'review', to: 'reflect', artifact: 'verdict' },
  ],
};
function inlineYaml(obj) {
  // Render { id: x, agent: y } as the flow.yaml inline-map style. String() coerces
  // booleans (resumable: true) + everything else to their YAML scalar form.
  return '{ ' + Object.entries(obj).map(([k, v]) => `${k}: ${String(v)}`).join(', ') + ' }';
}
function writeScratchFlow() {
  mkdirSync(SCRATCH_FLOW_DIR, { recursive: true });
  const lines = [
    `id: ${SCRATCH_FLOW}`,
    'name: Forge Cycle (authored from scratch)',
    'version: 1',
    'goal: Author-from-scratch proof — the forge cycle rebuilt as a flow definition.',
    'project: null',
    'kb: cycles',
    'costCeilingUsd: 25',
    'origin: user',
    'nodes:',
    ...SCRATCH_SPEC.nodes.map((n) => `  - ${inlineYaml(n)}`),
    'edges:',
    ...SCRATCH_SPEC.edges.map((e) => `  - ${inlineYaml(e)}`),
    'triggers: []',
    '',
  ];
  writeFileSync(join(SCRATCH_FLOW_DIR, 'flow.yaml'), lines.join('\n'));
}
function cleanScratchFlow() {
  try { rmSync(SCRATCH_FLOW_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// J2: the three agents the operator authors from the curated starter library.
// Created live under skills/<slug>/ via the UI; removed in the finally block.
const STARTER_AGENT_SLUGS = ['plan', 'dev', 'review'];
function cleanStarterAgents() {
  for (const slug of STARTER_AGENT_SLUGS) {
    try { rmSync(join(FORGE_ROOT, 'skills', slug), { recursive: true, force: true }); } catch { /* */ }
  }
}

/** Poll until a file exists (deterministic save confirmation), up to ms. */
async function waitForFile(path, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await sleep(120);
  }
  return existsSync(path);
}

// J3: the flow the operator authors from the basic starter (new-flow builder).
const J3_FLOW = 'my-first-flow';
const J3_FLOW_DIR = join(FORGE_ROOT, 'studio', 'flows', J3_FLOW);
function cleanFirstFlow() {
  try { rmSync(J3_FLOW_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// J4: the project the operator onboards via the UI. Projects are now
// auto-discovered from disk (B1) — onboarding writes a project dir under
// projects/ (no tracked registry file), so cleanup just removes that dir.
const J4_PROJECT = 'journey-demo-project';
const J4_PROJECT_DIR = join(FORGE_ROOT, 'projects', J4_PROJECT);
function cleanFirstProject() {
  try { rmSync(J4_PROJECT_DIR, { recursive: true, force: true }); } catch { /* */ }
}

// J5: a seeded run of the AUTHORED flow (my-first-flow) given work against the
// onboarded project — proves the monitor renders a user-authored flow's run.
const J5_INIT = `INIT-${DATE}-authored-flow-run`;
const J5_STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const J5_CYCLE_ID = `${J5_STAMP}_${J5_INIT}`;
const J5_CYCLE_LOG = join(FORGE_ROOT, '_logs', J5_CYCLE_ID);
function cleanFirstFlowRun() {
  for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    try { rmSync(join(FORGE_ROOT, '_queue', q, `${J5_INIT}.md`), { force: true }); } catch { /* */ }
  }
  try { rmSync(J5_CYCLE_LOG, { recursive: true, force: true }); } catch { /* */ }
}
/** Append one event to the J5 run's events.jsonl (phase = node id for the authored flow). */
let j5Seq = 0;
function j5Event(phase, eventType, message, metadata = {}, extras = {}) {
  mkdirSync(J5_CYCLE_LOG, { recursive: true });
  j5Seq += 1;
  appendFileSync(join(J5_CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id: `EV_j5_${j5Seq}`, cycle_id: J5_CYCLE_ID, initiative_id: J5_INIT,
    started_at: new Date().toISOString(), phase, skill: phase, event_type: eventType,
    input_refs: [], output_refs: [], message, metadata, ...extras,
  }) + '\n');
}
/** Parse the saved flow.yaml → { version, nodes } (nodes carry persisted x/y). */
function readSavedFlow(slug) {
  try {
    const doc = yaml.load(readFileSync(join(FORGE_ROOT, 'studio', 'flows', slug, 'flow.yaml'), 'utf8'));
    return { version: typeof doc?.version === 'number' ? doc.version : 0, nodes: Array.isArray(doc?.nodes) ? doc.nodes : [] };
  } catch { return { version: 0, nodes: [] }; }
}
function readSavedFlowNodes(slug) { return readSavedFlow(slug).nodes; }
/** Wait until the saved flow's version reaches at least minVersion (save landed). */
async function waitForFlowVersion(slug, minVersion, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (readSavedFlow(slug).version >= minVersion) return true;
    await sleep(150);
  }
  return readSavedFlow(slug).version >= minVersion;
}
/** Parse node ids, gate placements + edge count out of a flow.yaml text (the
 *  inline-map style) — enough for a structural parity assertion without a YAML dep. */
function parseFlowStructure(text) {
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
const READ   = 4200;  // dwell — a page the operator reads carefully
const WORK   = 3200;  // scroll — watching autonomous work happen
const ACT    = 1500;  // action beat after a click
const THINK  = 1000;  // brief gap during live bursts / between decisions

const TEMPO = {
  skip:        () => Promise.resolve(),
  fastForward: () => sleep(200),
  realTime:    () => sleep(THINK),
  dwell:       () => sleep(READ),
  scroll:      () => sleep(WORK),
};
function pace(tempo) { return (TEMPO[tempo] ?? TEMPO.dwell)(); }

const QDIR = (q) => join(FORGE_ROOT, '_queue', q);

// ── PRESENTATION HELPERS ──────────────────────────────────────────────────────

/** Inject / update a single fixed lower-third caption overlay. */
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

/** Show / hide an "autonomous — Nm Ns" overlay during fast-forward stretches. */
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
function archReasoning(sid, text) {
  archEvent(sid, 'log', text, { kind: 'reasoning', text });
}
async function burst(sid, tools) {
  for (const t of tools) {
    archEvent(sid, 'tool_use', `tool.${t}`, { tool: t });
    await sleep(THINK);
  }
}
async function paced(thunks, gap = THINK) {
  for (const fn of thunks) { fn(); await sleep(gap); }
}

function writeQuestions(sid) {
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
const EMULATED_ARCHITECT_COST_USD = 0.46;
const EMULATED_ARCHITECT_DURATION_MS = 95000;

function writePlan(sid, round) {
  const dir = archDir(sid);
  mkdirSync(join(dir, 'manifests'), { recursive: true });
  writeFileSync(join(dir, 'manifests', `${INIT}.md`), [
    '---', `initiative_id: ${INIT}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
    `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: pending',
    'origin: architect',
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
function cycleEvent(phase, eventType, message, opts = {}) {
  const { metadata = {}, skill = phase, ...extras } = opts;
  mkdirSync(CYCLE_LOG, { recursive: true });
  cycleSeq += 1;
  appendFileSync(join(CYCLE_LOG, 'events.jsonl'), JSON.stringify({
    event_id: `EV_cyc_${cycleSeq}`, cycle_id: CYCLE_ID, initiative_id: INIT,
    started_at: new Date().toISOString(), phase, skill,
    event_type: eventType, input_refs: [], output_refs: [], message, metadata, ...extras,
  }) + '\n');
}
/** Sugar for the unifier phase — phase:'unifier', skill:'developer-unifier'. */
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

/**
 * S7: seed a live worktree + stamp `worktree_path` onto the manifest so the
 * comment-derived send-back genuinely appends a UWI in place (ADR-026), rather
 * than 409'ing with no worktree. Returns the worktree path.
 */
function seedReviewWorktree() {
  const wt = join(FORGE_ROOT, '_worktrees', INIT);
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  mkdirSync(join(wt, '.forge', 'unifier-items'), { recursive: true });
  writeFileSync(join(wt, 'package.json'), JSON.stringify({ name: 'mdtoc-review-wt', private: true }, null, 2));
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

function writeDemoJson(revision) {
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

/** Reflector stage-2 emit: operator-facing questions for the reflect screen. */
function writeReflectionQuestions() {
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
  ], null, 2));
}

// ── BOOT + FRAMES ─────────────────────────────────────────────────────────────

async function startWatch() {
  // M7-7: spawn the canonical `forge studio` launcher and detect readiness via
  // its deterministic 'forge-studio-ready {json}' stdout line (no log scraping).
  // F1: `--force-takeover` so the harness always binds its OWN fresh bridge — a
  // leftover bridge from a crashed prior run must be replaced, not attached to
  // (the attach path is read-only and never emits the ready signal).
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open', '--force-takeover'],
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
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>forge — Studio operator journey</title>
<style>body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui;margin:32px auto;max-width:1280px;padding:0 24px}
h1{letter-spacing:.4px}video{width:100%;border:1px solid #30363d;border-radius:8px;background:#000}
figure{margin:24px 0;padding:0}figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
figcaption{color:#8b949e;font-size:12px;padding-top:6px}code{color:#d2a8ff}ol{line-height:1.8}</style></head>
<body><h1>forge — Forge Studio operator journey</h1>
<p>Author a flow · run it · swap its engine. Grounded on a real mdtoc roadmap feature (in-place TOC injection). Recorded ${new Date().toISOString()}.</p>
<h2>video</h2><video src="${videoName}" controls autoplay muted loop></video>
<h2>frames</h2>${figs}</body></html>`);
}

// ── ASSERTIONS (shared regression layer) ──────────────────────────────────────
const { failures, check, countAtLeast, expectPhaseCost, expectHexOpensDrawer } =
  createAssertions({ frame, dwellMs: READ, actMs: ACT });

/** Navigate to a Studio flow monitor and wait until it is ready with the cycle's
 *  run selected. The monitor refetches the run model from the bridge on load. */
async function openStudioMonitor(page, watch, flowId = 'forge-cycle', runId = CYCLE_ID) {
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

// ── THE JOURNEY ────────────────────────────────────────────────────────────────

async function main() {
  cleanProjectDir();
  mkdirSync(join(projectRoot, '_architect'), { recursive: true });
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(VIDEO, { recursive: true });

  // Author the from-scratch flow BEFORE booting the bridge so the UI + lint can
  // load it. (Cleaned up in finally.) This is the data the ACT-1 build beat shows.
  cleanScratchFlow();
  cleanStarterAgents();
  cleanFirstFlow();
  cleanFirstProject();
  cleanFirstFlowRun();
  writeScratchFlow();

  console.log('[e2e] booting forge studio (cold compile ~20-40s)…');
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

    // ════════════════════════════════════════════════════════════════════════
    // ACT 1 — AUTHOR. Everything in Studio is data you can edit.
    // ════════════════════════════════════════════════════════════════════════

    // ── A1.0: Title card on the library ───────────────────────────────────────
    console.log('\n[A1.0] Title card — Studio library');
    await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 30000 },
      );
      check(true, 'library: [data-page="library"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') ?? '(no data-page=library)');
      check(false, `library: data-page-ready (got "${pr}")`);
    }
    await caption(page, 'Forge Studio — author a flow, run it, swap its engine.');
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
            Forge Studio
          </div>
          <div style="font:500 20px ui-sans-serif,system-ui;color:#58a6ff">
            — author a flow · run it · swap its engine —
          </div>
          <div style="margin-top:40px;font:13px ui-monospace,monospace;color:#6e7681">
            the forge cycle is just one flow definition
          </div>`;
        document.body.appendChild(card);
      }
    });
    await frame(page, 'a1-0-title', 'Title — "Forge Studio: author a flow, run it, swap its engine"');
    await pace('dwell');
    await page.evaluate(() => { const el = document.getElementById('demo-title-card'); if (el) el.style.display = 'none'; });

    // ── A1.1: Library — flows / agents / projects / KBs as data ───────────────
    console.log('\n[A1.1] Library — everything is data');
    await caption(page, 'Flows, agents, projects, and knowledge — one screen, all editable definitions.');
    await sleep(ACT);
    await countAtLeast(page, '[data-section="flows"]', 1, 'library: [data-section="flows"] present');
    await countAtLeast(page, '[data-section="agents"]', 1, 'library: [data-section="agents"] present');
    await countAtLeast(page, '[data-section="projects"]', 1, 'library: [data-section="projects"] present');
    await countAtLeast(page, '[data-section="kbs"]', 1, 'library: [data-section="kbs"] present');
    const pulsePresent = await page.evaluate(() => document.querySelector('[data-pulse-flows]') !== null);
    check(pulsePresent, 'library: operator pulse panel ([data-pulse-flows]) present');
    await countAtLeast(page, '[data-section="flows"] [data-card-type="flow"]', 1, 'library: ≥1 flow card in flows section');
    await countAtLeast(page, '[data-section="agents"] [data-card-type="agent"]', 1, 'library: ≥1 agent card in agents section');
    await countAtLeast(page, '[data-section="projects"] [data-card-type="project"]', 1, 'library: ≥1 project card in projects section');
    await countAtLeast(page, '[data-section="kbs"] [data-card-type="kb"]', 1, 'library: ≥1 kb card in kbs section');
    const sectionCounts = await page.evaluate(() => {
      const sections = ['flows', 'agents', 'projects', 'kbs'];
      return Object.fromEntries(sections.map((s) => [
        s, parseInt(document.querySelector(`[data-section="${s}"]`)?.getAttribute('data-count') ?? '0', 10),
      ]));
    });
    check(sectionCounts.flows >= 1, `library: flows section data-count ≥1 (got ${sectionCounts.flows})`);
    check(sectionCounts.agents >= 1, `library: agents section data-count ≥1 (got ${sectionCounts.agents})`);
    check(sectionCounts.projects >= 1, `library: projects section data-count ≥1 (got ${sectionCounts.projects})`);
    check(sectionCounts.kbs >= 1, `library: kbs section data-count ≥1 (got ${sectionCounts.kbs})`);
    // The from-scratch flow we authored before boot should appear as a flow card.
    const scratchCardPresent = await page.evaluate((id) =>
      document.querySelector(`[data-card-type="flow"][data-card-id="${id}"]`) !== null ||
      [...document.querySelectorAll('[data-card-type="flow"]')].some((el) => (el.getAttribute('href') ?? '').includes(id)) ||
      (document.querySelector('[data-section="flows"]')?.textContent ?? '').includes(id),
      SCRATCH_FLOW);
    check(scratchCardPresent, `library: the authored "${SCRATCH_FLOW}" flow appears as a card (registered as data)`);

    // ── J1: first-run orientation + discoverable creation ─────────────────────
    // Creation must be discoverable from the library (not URL-only): the
    // "+ New Agent" CTA is a real, enabled link to the builder.
    const newAgentCta = await page.evaluate(() => {
      const el = document.querySelector('[data-action="new-agent"]');
      if (!el) return { present: false };
      return {
        present: true,
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        href: el.getAttribute('href') ?? '',
        tag: el.tagName.toLowerCase(),
      };
    });
    check(newAgentCta.present, 'J1: library "+ New Agent" creation CTA ([data-action="new-agent"]) is present');
    check(newAgentCta.present && !newAgentCta.disabled, 'J1: "+ New Agent" CTA is enabled (creation is discoverable, not a dead greyed button)');
    check(newAgentCta.href?.includes('/agents/new'), `J1: "+ New Agent" routes to the agent builder (got "${newAgentCta.href}")`);
    // No false welcome: with a populated library the orientation panel is absent
    // and data-first-run reflects it.
    const firstRunAttr = await page.evaluate(() =>
      document.querySelector('[data-page="library"]')?.getAttribute('data-first-run'));
    check(firstRunAttr === 'false', `J1: populated library reports data-first-run="false" (got "${firstRunAttr}")`);
    const orientationAbsent = await page.evaluate(() => document.querySelector('[data-section="orientation"]') === null);
    check(orientationAbsent, 'J1: orientation panel correctly hidden when the library is populated (shown only on a fresh install)');

    await sleep(READ);
    await frame(page, 'a1-1-library', 'A1 — Studio library: flows/agents/projects/KBs as data + operator pulse');

    // ── J2: BUILD THE THREE AGENTS FROM THE CURATED STARTER LIBRARY ───────────
    // A brand-new user creates plan/dev/review agents from starters — required
    // fields only, advanced config collapsed (UX spec §2). Proves the agents
    // land on disk as SKILL.md + pass the platform's own lint gate.
    console.log('\n[J2] Author plan/dev/review agents from the starter library');
    cleanStarterAgents(); // clear any prior-run residue first
    await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    const pickerPresent = await page.evaluate(() => document.querySelector('[data-section="starter-picker"]') !== null);
    check(pickerPresent, 'J2: new-agent shows the curated starter picker ([data-section="starter-picker"])');
    const advHiddenOnPicker = await page.evaluate(() => document.querySelector('[data-section="advanced"]') === null);
    check(advHiddenOnPicker, 'J2: advanced config is not dumped on the picker (progressive disclosure)');
    const starterOptionCount = await page.evaluate(() => document.querySelectorAll('[data-starter-option]').length);
    check(starterOptionCount >= 4, `J2: picker offers ≥3 starters + blank (got ${starterOptionCount} options)`);
    await frame(page, 'j2-0-starter-picker', 'J2 — new agent: pick a curated starter (plan/dev/review) or blank');

    for (const role of STARTER_AGENT_SLUGS) {
      await page.goto(watch.uiUrl + '/agents/new', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(`[data-starter-option="${role}"]`, { timeout: 15000 });
      await page.locator(`[data-starter-option="${role}"]`).click();
      await page.waitForSelector('[data-action="save-agent"]', { timeout: 10000 });
      if (role === STARTER_AGENT_SLUGS[0]) {
        const advClosed = await page.evaluate(() =>
          document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open'));
        check(advClosed === 'false', `J2: advanced config collapsed by default after picking a starter (got "${advClosed}")`);
        const requiredVisible = await page.evaluate(() =>
          document.querySelector('#purpose-input') !== null && document.querySelector('#process-input') !== null);
        check(requiredVisible, 'J2: required fields (purpose, process) visible without opening Advanced');
        const dirtyAfterPick = await page.evaluate(() =>
          document.querySelector('[data-page="agents"] [data-dirty]')?.getAttribute('data-dirty')
          ?? document.querySelector('#col-center')?.getAttribute('data-dirty'));
        check(dirtyAfterPick === 'true', `J2: picking a starter pre-fills + marks the form dirty (got "${dirtyAfterPick}")`);
        await frame(page, 'j2-1-builder-prefilled', 'J2 — starter pre-fills required fields; advanced collapsed');
      }
      await page.locator('[data-action="save-agent"]').click();
      const skillPath = join(FORGE_ROOT, 'skills', role, 'SKILL.md');
      const landed = await waitForFile(skillPath, 12000);
      check(landed, `J2: saving the "${role}" starter writes skills/${role}/SKILL.md`);
    }

    // The three authored agents are now LIVE studio objects — they must pass lint.
    let j2LintOk = false;
    try {
      execFileSync(process.execPath,
        ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
        { cwd: FORGE_ROOT, stdio: 'pipe' });
      j2LintOk = true;
    } catch (e) {
      console.error(`  [studio lint J2] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
    }
    check(j2LintOk, 'J2: `forge studio lint` validates the three authored agents (exit 0)');
    await frame(page, 'j2-2-agents-authored', 'J2 — plan/dev/review agents authored from starters, lint-green');

    // ── J3: STRING THE THREE AGENTS INTO A FLOW (new-flow builder) ────────────
    // From the library "+ New Flow" → canvas seeded from the basic starter
    // (plan → dev → review + verdict gate). Name it, save (slug derived), and
    // prove: lint-green, runnable, and node positions PERSIST across reload.
    console.log('\n[J3] String plan/dev/review into a flow (new-flow builder)');
    cleanFirstFlow();
    // discoverable creation: the library "+ New Flow" CTA is a real enabled link
    await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    const newFlowCta = await page.evaluate(() => {
      const el = document.querySelector('[data-action="new-flow"]');
      return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
    });
    check(newFlowCta !== null && !newFlowCta.disabled && (newFlowCta.href ?? '').includes('/flows/new'),
      'J3: library "+ New Flow" CTA is enabled and routes to the flow builder');

    await page.goto(watch.uiUrl + '/flows/new', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
      null, { timeout: 15000 },
    ).catch(() => {});
    // Seeded from the basic starter: ≥3 nodes on the canvas.
    await page.waitForFunction(
      () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
      null, { timeout: 15000 },
    ).catch(() => {});
    const seededNodeCount = await page.evaluate(() =>
      parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
    check(seededNodeCount >= 3, `J3: new-flow canvas seeded from the basic starter (≥3 nodes, got ${seededNodeCount})`);
    const flowAdvCollapsed = await page.evaluate(() => {
      const d = document.querySelector('[data-section="flow-advanced"]');
      return d ? !(d).open : false;
    });
    check(flowAdvCollapsed, 'J3: project/KB/triggers collapsed under Advanced by default (progressive disclosure)');
    await frame(page, 'j3-0-new-flow-seeded', 'J3 — new flow seeded from the basic starter (plan → dev → review)');

    // Name the flow + save (slug derived from name → /flows/my-first-flow).
    await page.locator('[data-field="flow-name"]').fill('My First Flow');
    await page.locator('[data-action="save-flow"]').click();
    const flowYamlPath = join(J3_FLOW_DIR, 'flow.yaml');
    const flowLanded = await waitForFile(flowYamlPath, 12000);
    check(flowLanded, `J3: saving the new flow writes studio/flows/${J3_FLOW}/flow.yaml`);

    // Persistence: every node carries a numeric x/y (the J3 schema addition).
    const nodesV1 = readSavedFlowNodes(J3_FLOW);
    const allHaveXY = nodesV1.length >= 3 && nodesV1.every((n) => typeof n.x === 'number' && typeof n.y === 'number');
    check(allHaveXY, `J3: saved flow persists node positions (every node has numeric x/y; ${nodesV1.length} nodes)`);
    const gatePresent = nodesV1.some((n) => typeof n.gate === 'string');
    check(gatePresent, 'J3: authored flow keeps the human verdict gate (zero-gate flows are rejected)');

    // lint validates the authored flow; it is runnable.
    let j3LintOk = false;
    try {
      execFileSync(process.execPath,
        ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
        { cwd: FORGE_ROOT, stdio: 'pipe' });
      j3LintOk = true;
    } catch (e) {
      console.error(`  [studio lint J3] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
    }
    check(j3LintOk, 'J3: `forge studio lint` validates the authored flow (exit 0)');

    // Saving a new flow auto-redirects to its real route — wait for that
    // navigation rather than racing it with our own goto.
    await page.waitForURL(new RegExp(`/flows/${J3_FLOW}`), { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(
      () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    const j3CanStart = await page.evaluate(() =>
      document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start'));
    check(j3CanStart === 'true', `J3: authored flow is runnable (data-can-start="true", got "${j3CanStart}")`);

    // Position round-trip: drag a node, save, reload, save again — the dragged
    // position must survive (proves x/y are honoured on load, not recomputed).
    await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
    await page.waitForFunction(
      () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
      null, { timeout: 15000 },
    ).catch(() => {});
    const dragId = nodesV1[0]?.id ?? 'plan';
    const x0 = nodesV1.find((n) => n.id === dragId)?.x ?? 0;
    const vBeforeDrag = readSavedFlow(J3_FLOW).version;
    let dragged = false;
    try {
      const nodeEl = page.locator(`.react-flow__node:has([data-node-id="${dragId}"])`).first();
      const box = await nodeEl.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 230, box.y + box.height / 2 + 150, { steps: 12 });
        await page.mouse.up();
        dragged = true;
      }
    } catch { /* drag unavailable */ }
    await sleep(THINK);
    await page.locator('[data-action="save-flow"]').click();
    // Wait for the async save to land (version bumps) — not a fixed sleep.
    await waitForFlowVersion(J3_FLOW, vBeforeDrag + 1, 15000);
    const xDrag = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? x0;
    check(dragged && Math.abs(xDrag - x0) > 40, `J3: dragging node "${dragId}" moved + saved its position (x ${x0}→${xDrag})`);
    await frame(page, 'j3-1-flow-arranged', 'J3 — authored flow, node hand-arranged on the canvas');

    // Reload + save again (no move): the dragged position survives the reload
    // (proves persisted x/y are honoured on load, not recomputed by autolayout).
    const vBeforeReload = readSavedFlow(J3_FLOW).version;
    await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
    await page.waitForFunction(
      () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
      null, { timeout: 15000 },
    ).catch(() => {});
    await page.locator('[data-action="save-flow"]').click();
    await waitForFlowVersion(J3_FLOW, vBeforeReload + 1, 15000);
    const xReload = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? -9999;
    check(Math.abs(xReload - xDrag) < 30, `J3: node position PERSISTS across reload (x ${xDrag} → ${xReload})`);
    await frame(page, 'j3-2-flow-persisted', 'J3 — node positions persist across reload (authored flow is durable)');

    // ── J4: ONBOARD A PROJECT (in the UI) ─────────────────────────────────────
    // The library "+ New Project" CTA opens a minimal onboarding form (name +
    // quality gate + north star); submitting registers the project + scaffolds
    // .forge/project.json. Proves: registry + config on disk, readiness renders,
    // the project appears in the library, lint stays green.
    console.log('\n[J4] Onboard a project from the UI');
    cleanFirstProject();
    await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    // Baseline project count BEFORE onboarding — the discoverable-on-disk projects
    // vary by checkout (this de-betterado'd worktree ships only the mdtoc reference
    // project + scratch dirs), so the assertion is RELATIVE: onboarding must add
    // exactly one project. Stronger than an absolute floor, and checkout-agnostic.
    const projCountBefore = await page.evaluate(() =>
      parseInt(document.querySelector('[data-section="projects"]')?.getAttribute('data-count') ?? '0', 10));
    const newProjCta = await page.evaluate(() => {
      const el = document.querySelector('[data-action="new-project"]');
      return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
    });
    check(newProjCta !== null && !newProjCta.disabled && (newProjCta.href ?? '').includes('/projects/new'),
      'J4: library "+ New Project" CTA is enabled and routes to onboarding');

    await page.goto(watch.uiUrl + '/projects/new', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-section="project-onboard"]') !== null,
      null, { timeout: 15000 },
    ).catch(() => {});
    const onboardForm = await page.evaluate(() => document.querySelector('[data-section="project-onboard"]') !== null);
    check(onboardForm, 'J4: new-project shows the onboarding form ([data-section="project-onboard"])');
    const onbAdvCollapsed = await page.evaluate(() => {
      const d = document.querySelector('[data-section="onboard-advanced"]');
      return d ? !d.open : false;
    });
    check(onbAdvCollapsed, 'J4: advanced contract clauses collapsed by default (only required fields shown)');
    await frame(page, 'j4-0-onboard-form', 'J4 — onboard a project: required fields only (quality gate, north star)');

    // Fill the minimal required fields + onboard. (quality-gate defaults to npm test)
    await page.locator('[data-field="project-name"]').fill('Journey Demo Project');
    await page.locator('[data-field="north-star"]').fill('A scratch project onboarded by the e2e journey to prove UI onboarding.');
    await page.locator('[data-action="onboard-project"]').click();

    const projectJsonPath = join(FORGE_ROOT, 'projects', J4_PROJECT, '.forge', 'project.json');
    const projLanded = await waitForFile(projectJsonPath, 12000);
    check(projLanded, `J4: onboarding writes projects/${J4_PROJECT}/.forge/project.json`);

    // The hard contract fields are on disk.
    let projCfg = {};
    try { projCfg = JSON.parse(readFileSync(projectJsonPath, 'utf8')); } catch { /* */ }
    check(Array.isArray(projCfg.quality_gate_cmd) && projCfg.quality_gate_cmd.length > 0,
      'J4: project.json carries the C1 quality_gate_cmd');
    check(projCfg.demo && typeof projCfg.demo.shape === 'string',
      'J4: project.json carries the DEMO block (demo.shape)');
    check(typeof projCfg.northStar === 'string' && projCfg.northStar.length > 0,
      'J4: project.json carries the north star');
    // The project is auto-discovered from disk: its dir carries the
    // `.forge/project.json` contract file (B1 — no registry file).
    check(existsSync(projectJsonPath),
      'J4: the project is auto-discovered from disk (.forge/project.json present)');

    // Onboarding redirects to the editor — readiness renders + reflects the
    // onboarded fields. Navigate explicitly (don't rely solely on the redirect
    // race) and wait for the editor's [data-ready-count] to materialise before
    // reading it, so a slow first-compile doesn't read it as absent (-1).
    await page.waitForURL(new RegExp(`/projects/${J4_PROJECT}`), { timeout: 15000 }).catch(() => {});
    if (!/\/projects\/[^/]*journey-demo-project/.test(page.url())) {
      await page.goto(watch.uiUrl + `/projects/${J4_PROJECT}`, { waitUntil: 'domcontentloaded' });
    }
    await page.waitForFunction(
      () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 20000 },
    ).catch(() => {});
    await page.waitForSelector('[data-ready-count]', { timeout: 15000 }).catch(() => {});
    const readyCount = await page.evaluate(() => {
      const el = document.querySelector('[data-ready-count]');
      return el ? parseInt(el.getAttribute('data-ready-count') ?? '0', 10) : -1;
    });
    check(readyCount >= 3, `J4: onboarded project passes ≥3 contract-readiness checks (got ${readyCount})`);
    await frame(page, 'j4-1-project-readiness', 'J4 — onboarded project: contract readiness reflects the hard fields');

    // The project now appears in the library.
    await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    const projCount = await page.evaluate(() =>
      parseInt(document.querySelector('[data-section="projects"]')?.getAttribute('data-count') ?? '0', 10));
    const onboardedListed = await page.evaluate((id) =>
      document.querySelector(`[data-section="projects"] [data-card-type="project"][data-card-id="${id}"]`) !== null, J4_PROJECT);
    check(projCount === projCountBefore + 1 && onboardedListed,
      `J4: onboarding adds exactly one project to the library (${projCountBefore}→${projCount}, ${J4_PROJECT} listed=${onboardedListed})`);

    // lint stays green with the new project registered.
    let j4LintOk = false;
    try {
      execFileSync(process.execPath,
        ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
        { cwd: FORGE_ROOT, stdio: 'pipe' });
      j4LintOk = true;
    } catch (e) {
      console.error(`  [studio lint J4] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
    }
    check(j4LintOk, 'J4: `forge studio lint` stays green with the onboarded project (exit 0)');

    // ── J5: GIVE THE AUTHORED FLOW WORK (seeded run) ──────────────────────────
    // The user's authored flow (my-first-flow) is given work against the
    // onboarded project. Seeded (no real agents), this proves the monitor
    // surfaces a USER-AUTHORED flow's run — its plan→dev→review hexes progress
    // and the run parks at the verdict gate. (The full mdtoc idea→reflect
    // path is proven separately by the RUN act below.)
    console.log('\n[J5] Give the authored flow work (seeded run on my-first-flow)');
    cleanFirstFlowRun();
    // Seed a gated run: manifest (flow_id binds it to the authored flow) + events.
    mkdirSync(QDIR('ready-for-review'), { recursive: true });
    writeFileSync(join(QDIR('ready-for-review'), `${J5_INIT}.md`), [
      '---',
      `initiative_id: ${J5_INIT}`,
      `project: ${J4_PROJECT}`,
      `project_repo_path: ${join(FORGE_ROOT, 'projects', J4_PROJECT)}`,
      `created_at: '${new Date().toISOString()}'`,
      'iteration_budget: 3',
      'cost_budget_usd: 5',
      'phase: ready-for-review',
      'origin: human-directed',
      `cycle_id: ${J5_CYCLE_ID}`,
      `flow_id: ${J3_FLOW}`,
      '---',
      '',
      '# Give the authored flow work',
      '',
      'A seeded run proving the authored plan → dev → review flow renders in the monitor.',
      '',
    ].join('\n'));
    j5Event('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' });
    j5Event('plan', 'start', 'plan.start');
    j5Event('plan', 'end', 'plan.end', {}, { cost_usd: 0.12, duration_ms: 24000 });
    j5Event('dev', 'start', 'dev.start');
    j5Event('dev', 'log', 'gate.pass', {});
    j5Event('dev', 'end', 'dev.end', {}, { cost_usd: 0.28, duration_ms: 41000 });
    j5Event('review', 'start', 'review.start');

    await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 15000 },
    ).catch(() => {});
    // The run is discovered + associated with the authored flow (flow_id).
    const j5RunCount = await page.evaluate(() =>
      parseInt(document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '0', 10));
    check(j5RunCount >= 1, `J5: the authored flow shows the seeded run (run-count ${j5RunCount})`);
    // The monitor renders the authored flow's own nodes (plan/dev/review).
    for (const nodeId of ['plan', 'dev', 'review']) {
      await page.waitForSelector(`[data-mon-node][data-node-id="${nodeId}"]`, { timeout: 10000 }).catch(() => {});
      const present = await page.evaluate((n) => document.querySelector(`[data-mon-node][data-node-id="${n}"]`) !== null, nodeId);
      check(present, `J5: monitor renders the "${nodeId}" hex of the authored flow`);
    }
    // Phase statuses progressed (plan + dev complete) and the run parked at the gate.
    const planStatus = await page.evaluate(() =>
      document.querySelector('[data-mon-node][data-node-id="plan"]')?.getAttribute('data-status'));
    check(planStatus === 'complete', `J5: plan phase shows complete (got "${planStatus}")`);
    const reviewStatus = await page.evaluate(() =>
      document.querySelector('[data-mon-node][data-node-id="review"]')?.getAttribute('data-status'));
    check(reviewStatus === 'gated' || reviewStatus === 'active', `J5: review phase awaits the human verdict (got "${reviewStatus}")`);
    await expectPhaseCost(page, 'J5: the authored run shows accrued per-phase cost');
    await frame(page, 'j5-0-authored-run', 'J5 — the authored flow, given work, runs plan → dev → review to the verdict gate');
    // Clean the seeded run now so it does not bleed into the mdtoc RUN act.
    cleanFirstFlowRun();

    // ── A2: BUILD THE FORGE CYCLE FROM SCRATCH ────────────────────────────────
    // The headline new beat. We authored forge-cycle-scratch as a flow definition
    // (6 agents, 5 edges, 2 gates). Prove: (1) `forge studio lint` validates it,
    // (2) it is structurally identical to the production seed (subsumption), (3)
    // the flow builder renders it live, (4) the engine can run it (data-can-start).
    console.log('\n[A2] Build the forge cycle from scratch (flow-as-data)');

    // (1) `forge studio lint` validates the authored flow — the platform's own gate.
    let lintOk = false;
    try {
      execFileSync(process.execPath,
        ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
        { cwd: FORGE_ROOT, stdio: 'pipe' });
      lintOk = true;
    } catch (e) {
      console.error(`  [studio lint] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
    }
    check(lintOk, 'author-from-scratch: `forge studio lint` validates the authored forge-cycle-scratch flow (exit 0)');

    // (2) Structural parity with the production seed — the subsumption proof.
    const seedStruct = parseFlowStructure(readFileSync(SEED_FLOW_PATH, 'utf8'));
    const scratchStruct = parseFlowStructure(readFileSync(join(SCRATCH_FLOW_DIR, 'flow.yaml'), 'utf8'));
    check(JSON.stringify(scratchStruct.nodeIds) === JSON.stringify(seedStruct.nodeIds),
      `author-from-scratch: node set matches the seed (${scratchStruct.nodeIds.join(',')})`);
    check(scratchStruct.gates.architect === 'plan' && scratchStruct.gates.review === 'verdict',
      'author-from-scratch: gates land on architect=plan + review=verdict (matches the seed)');
    check(scratchStruct.edgeCount === seedStruct.edgeCount,
      `author-from-scratch: edge count matches the seed (${scratchStruct.edgeCount})`);

    // (3) The flow builder renders the authored flow live.
    await page.goto(watch.uiUrl + `/flows/${SCRATCH_FLOW}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'author-from-scratch: flow-monitor ready for the authored flow');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
      check(false, `author-from-scratch: flow-monitor ready (got "${pr}")`);
    }
    await caption(page, 'The forge cycle, rebuilt from scratch — six agents, five artifacts, two gates. The platform validates it and it is identical to the production seed.');
    await sleep(ACT);
    // (4) The engine can run it — start-run is enabled (no runs yet on this flow).
    const canStart = await page.evaluate(() =>
      document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start') ?? '(absent)');
    check(canStart === 'true', `author-from-scratch: engine can run the authored flow (data-can-start="true", got "${canStart}")`);
    await frame(page, 'a2-0-scratch-monitor', 'A2 — authored forge-cycle-scratch: lint green, parity with seed, runnable by the engine');

    // Open the BUILD tab to show the authored topology on the canvas.
    const buildTabBtn = page.locator('button.tab').filter({ hasText: 'BUILD' }).first();
    if ((await buildTabBtn.count()) > 0) {
      await buildTabBtn.click();
      try {
        await page.waitForFunction(
          () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
          null, { timeout: 8000 },
        );
        check(true, 'author-from-scratch: BUILD tab click flips data-active-tab="build"');
      } catch {
        const tabVal = await page.evaluate(() =>
          document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') ?? '(absent)');
        check(false, `author-from-scratch: data-active-tab="build" (got "${tabVal}")`);
      }
    } else {
      check(false, 'author-from-scratch: BUILD tab button present');
    }
    // ReactFlow hydrates after the tab switch — poll for the node count rather
    // than a fixed sleep (the canvas can render a tick late under load).
    await page.waitForFunction(
      () => parseInt(document.querySelector('[data-node-count]')?.getAttribute('data-node-count') ?? '0', 10) >= 6,
      null, { timeout: 15000 },
    ).catch(() => {});
    const nodeCount = await page.evaluate(() => {
      const el = document.querySelector('[data-node-count]');
      return el ? parseInt(el.getAttribute('data-node-count') ?? '0', 10) : -1;
    });
    check(nodeCount >= 6, `author-from-scratch: BUILD canvas renders ≥6 nodes for the authored flow (got ${nodeCount})`);
    await countAtLeast(page, '[data-flow-node]', 1, 'author-from-scratch: ≥1 [data-flow-node] rendered in BUILD canvas');
    const palettePresent = await page.evaluate(() => document.querySelector('[data-component="agent-palette"]') !== null);
    check(palettePresent, 'author-from-scratch: [data-component="agent-palette"] present (drag more agents in)');
    await countAtLeast(page, '[data-palette-chip]', 1, 'author-from-scratch: palette has ≥1 [data-palette-chip]');
    // Agent chips load async (the Agents section shows "Loading…" first while the
    // fixed Artifact chips render instantly) — wait for the agent chips before
    // asserting, else we race the fetch.
    await countAtLeast(page, '[data-palette-chip="agent"]', 3, 'author-from-scratch: palette agent chips loaded');
    // The new OOTB agent library (L1-A) is draggable from the palette (#10) — the
    // author can compose the freshly-seeded agents into a flow from scratch.
    const ootbChips = await page.evaluate(() => {
      const want = ['code-reviewer', 'security-auditor', 'web-scraper'];
      const present = new Set(
        Array.from(document.querySelectorAll('[data-palette-chip="agent"]')).map((el) =>
          el.getAttribute('data-chip-ref'),
        ),
      );
      return want.filter((w) => present.has(w));
    });
    check(
      ootbChips.length === 3,
      `author-from-scratch: new OOTB agents appear in the palette (${ootbChips.join(',') || 'none'})`,
    );
    const goalSetPresent = await page.evaluate(() => document.querySelector('[data-goal-set]') !== null);
    check(goalSetPresent, 'author-from-scratch: [data-goal-set] present in FlowHeader');
    await sleep(READ);
    await frame(page, 'a2-1-scratch-build', `A2 — BUILD canvas: the authored cycle (${nodeCount} nodes) on the ReactFlow canvas, palette + goal field`);

    // ── A3: Agent builder — an agent is data ──────────────────────────────────
    console.log('\n[A3] Agent builder — /agents/project-manager');
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
    await caption(page, 'An agent is data too — skills, tools, runtime SDK, budgets, brain access. Edit it without leaving the UI.');
    await sleep(ACT);
    if (agentPageReady) {
      await countAtLeast(page, '[data-id]', 1, 'agent-builder: catalog palette renders ≥1 chip');
      // Open the collapsed Advanced section (J2 progressive disclosure) so the
      // capabilities zones + runtime render for both the checks and the frame.
      await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
      await page.waitForFunction(
        () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
        null, { timeout: 5000 },
      ).catch(() => {});
      for (const kind of ['skill', 'tool', 'mcp', 'hook']) {
        check(
          await page.evaluate((k) => document.querySelector(`[data-accepts="${k}"]`) !== null, kind),
          `agent-builder: drop zone [data-accepts="${kind}"] present`,
        );
      }
      const agentId = await page.evaluate(() =>
        document.querySelector('[data-page="agents"]')?.getAttribute('data-agent-id') ??
        document.querySelector('[data-agent-id]')?.getAttribute('data-agent-id') ?? '');
      check(agentId.length > 0, `agent-builder: data-agent-id non-empty (got "${agentId}")`);
      const readyCount = await page.evaluate(() => {
        const el = document.querySelector('[data-ready-count]');
        return el ? el.getAttribute('data-ready-count') : null;
      });
      check(readyCount !== null, `agent-builder: [data-ready-count] attribute present (got ${readyCount})`);
      if (readyCount !== null) {
        check(parseInt(readyCount, 10) >= 4, `agent-builder: readiness ≥4 checks pass for project-manager (got ${readyCount})`);
      }
      const sdk = await page.evaluate(() => document.querySelector('[data-sdk]')?.getAttribute('data-sdk') ?? '');
      check(sdk.length > 0, `agent-builder: [data-sdk] attribute present (got "${sdk}")`);
      await frame(page, 'a3-0-agent-builder', 'A3 — agent builder: catalog, drop zones, runtime, readiness panel');
      // Dirty-flag: edit the purpose field; assert data-dirty flips; discard.
      const purposeInput = page.locator('#purpose-input');
      if ((await purposeInput.count()) > 0) {
        const originalPurpose = await purposeInput.inputValue();
        await purposeInput.click();
        await purposeInput.pressSequentially(' (e2e test edit)', { delay: 18 });
        await sleep(THINK);
        const dirtyVal = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
        check(dirtyVal === 'true', `agent-builder: data-dirty="true" after editing purpose field (got "${dirtyVal}")`);
        const discardBtn = page.locator('#btn-discard');
        if ((await discardBtn.count()) > 0) { await discardBtn.click(); await sleep(THINK); }
        else { await purposeInput.fill(originalPurpose); }
        await frame(page, 'a3-1-agent-dirty', 'A3 — data-dirty flips on edit (discarded, no save — seed SKILL.md immutable)');
      } else {
        check(false, 'agent-builder: #purpose-input present to test dirty flag');
      }
    } else {
      check(false, 'agent-builder: page did not become ready — agent-builder checks skipped');
    }

    // ── A4: Project builder — the managed project as data ─────────────────────
    console.log(`\n[A4] Project builder — /projects/${PROJECT}`);
    await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
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
    await caption(page, 'The mdtoc project — north star, the creds-free demo timeline (capture → verify → present), skills, KB, contract readiness.');
    await sleep(ACT);
    if (projectPageReady) {
      const projectId = await page.evaluate(() =>
        document.querySelector('[data-project-id]')?.getAttribute('data-project-id') ?? '');
      check(projectId === PROJECT, `project-builder: data-project-id="${PROJECT}" (got "${projectId}")`);
      check(
        await page.evaluate(() => document.querySelector('[data-component="north-star"]') !== null ||
          document.querySelectorAll('textarea').length > 0 ||
          document.querySelector('[placeholder*="north star" i]') !== null ||
          document.querySelector('[placeholder*="goal" i]') !== null ||
          document.querySelector('[placeholder*="outcome" i]') !== null),
        'project-builder: north star field present',
      );
      const stepCount = await page.evaluate(() => {
        const el = document.querySelector('[data-step-count]');
        return el ? el.getAttribute('data-step-count') : null;
      });
      check(stepCount !== null, `project-builder: [data-step-count] attribute present (got ${stepCount})`);
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
      await frame(page, 'a4-0-project-builder', 'A4 — project builder: north star, demo timeline, skills, contract readiness');
      // Add a demo step → data-step-count increments + dirty flips; discard.
      const presetBtn = page.locator('button').filter({ hasText: /^\+ Add step$/ }).first();
      if ((await presetBtn.count()) > 0) {
        const before = parseInt(stepCount ?? '0', 10);
        await presetBtn.click();
        await sleep(THINK);
        const after = await page.evaluate(() => {
          const el = document.querySelector('[data-step-count]');
          return el ? parseInt(el.getAttribute('data-step-count') ?? '0', 10) : 0;
        });
        check(after > before, `project-builder: data-step-count incremented after preset click (${before}→${after})`);
        const dirtyAfter = await page.evaluate(() => document.querySelector('[data-dirty]')?.getAttribute('data-dirty') ?? '');
        check(dirtyAfter === 'true', `project-builder: data-dirty="true" after adding demo step (got "${dirtyAfter}")`);
        await frame(page, 'a4-1-project-dirty', `A4 — data-step-count incremented (${before}→${after}), data-dirty="true" (no save)`);
      } else {
        check(false, 'project-builder: preset/add-step button present (soft — builder loaded)');
      }
    } else {
      check(false, 'project-builder: page did not become ready — project-builder checks skipped');
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACT 2 — RUN. The cycle as the proof case, on a real mdtoc roadmap feature.
    // ════════════════════════════════════════════════════════════════════════

    // ── R1.0: Operator drops the idea ─────────────────────────────────────────
    console.log('\n[R1.0] Operator drops the mdtoc idea');
    await page.goto(watch.uiUrl + '/architect/new', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('main[data-page="architect-new"][data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="new-idea"]', { timeout: 10000 });
    await caption(page, "One idea. One field. Type it like you'd tell a colleague.");
    await sleep(ACT);
    await page.locator('[data-section="new-idea"] [data-field="project"]').fill(PROJECT);
    await page.locator('[data-section="new-idea"] [data-field="idea"]').click();
    await page.locator('[data-section="new-idea"] [data-field="idea"]').pressSequentially(IDEA, { delay: 18 });
    await sleep(THINK);
    await frame(page, 'r1-0-idea-typed', 'R1 — operator types a real mdtoc feature idea');
    check(await page.locator('[data-section="new-idea"]').count() > 0, '[data-section="new-idea"] present on /architect/new');
    await page.locator('[data-action="start-architect"]').hover();
    await sleep(ACT);
    await page.locator('[data-action="start-architect"]').click();
    await page.waitForURL(/\/architect\/[^/]+\/interview/, { timeout: 15000 });
    const sid = decodeURIComponent(page.url().split('/architect/')[1].split('/')[0]);
    createdSid = sid;
    console.log(`[e2e] architect session: ${sid}`);
    check(!!sid, '[data-action="start-architect"] navigates to /architect/<sid>/interview');

    // ── R1.1: Architect grounds itself — P3 activity panel ────────────────────
    console.log('\n[R1.1] Architect grounds itself — P3 activity panel');
    writeStatus(sid, { phase: 'interviewing', round: 1, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=interviewing, round=1)');
    await page.waitForSelector('main[data-page="architect-interview"]', { timeout: 15000 });
    await page.waitForSelector('[data-component="architect-hex"]', { timeout: 15000 });
    await caption(page, 'Forge reads the CLI source and the brain before it asks anything — every tool call, every line of reasoning.');
    await sleep(ACT);
    const groundingTools = ['Read', 'Grep', 'Glob', 'Read', 'Bash', 'Read'];
    for (let i = 0; i < groundingTools.length; i++) {
      archEvent(sid, 'tool_use', `tool.${groundingTools[i]}`, { tool: groundingTools[i] });
      await sleep(THINK);
      if (i === 3) {
        await frame(page, 'r1-1-activity-midstream', 'R1 (mid-stream) — P3 activity panel filling while the architect reads the CLI source');
      }
    }
    archReasoning(sid, '--write needs a pure src/inject.ts (doc string + toc string → new doc string) that slices the <!-- toc --> / <!-- /toc --> region, then a thin CLI wire that reads the file, injects, and writes it back.');
    await sleep(THINK);
    archReasoning(sid, 'idempotency is the sharp edge — a second --write must be byte-identical. A unit test asserting diff === "" on a re-run plus the acceptance read-back against the built CLI will prove insert + idempotency.');
    await sleep(THINK);
    try {
      await page.waitForSelector('[data-section="architect-activity"]', { timeout: 8000 });
      check(true, 'P3: [data-section="architect-activity"] rendered');
    } catch { check(false, 'P3: [data-section="architect-activity"] rendered'); }
    try {
      await page.waitForFunction(
        () => parseInt(document.querySelector('[data-section="architect-activity"]')?.getAttribute('data-activity-count') ?? '0', 10) >= 1,
        null, { timeout: 8000 },
      );
      const count = await page.evaluate(() =>
        parseInt(document.querySelector('[data-section="architect-activity"]')?.getAttribute('data-activity-count') ?? '0', 10));
      check(count >= 1, `P3: activity panel data-activity-count ≥1 (got ${count})`);
    } catch { check(false, 'P3: activity panel data-activity-count ≥1 (timeout)'); }
    const hasReasoningRow = await page.evaluate(() => {
      const panel = document.querySelector('[data-section="architect-activity"]');
      if (!panel) return false;
      return panel.textContent?.includes('reason') || panel.querySelectorAll('[data-activity-kind]').length > 0;
    });
    check(hasReasoningRow, 'P3: at least one reasoning row rendered in the activity panel');
    await frame(page, 'r1-1-activity-settled', 'R1 (settled) — P3 activity panel: tool calls + reasoning rows persisted');

    // ── R1.2: Architect returns clarifying questions ──────────────────────────
    console.log('\n[R1.2] Architect returns questions');
    writeQuestions(sid);
    writeStatus(sid, { phase: 'awaiting-answers', round: 1, idea: IDEA });
    archEvent(sid, 'log', 'interview round 1 — 2 question(s) for the operator');
    await page.waitForSelector('[data-section="architect-interview"]', { timeout: 15000 });
    await caption(page, 'Forge asks only what it cannot resolve itself — schema default, acceptance-test fixture.');
    await page.locator('[data-question-index="1"]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'r1-2-questions', 'R1 — architect returns 2 clarifying questions (schema design + acc fixture)');
    check(await page.locator('[data-section="architect-interview"]').count() > 0,
      '[data-section="architect-interview"] rendered with questions');
    await countAtLeast(page, '[data-question-index]', 2, 'architect returned ≥2 questions');

    // ── R1.3: Operator answers — free-text override (P2) ──────────────────────
    console.log('\n[R1.3] Operator answers — P2 free-text override on Q2');
    await caption(page, "Answer with an option — or in your own words. You're in control.");
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check();
    await sleep(THINK);
    const freetextLocator = page.locator('[data-question-freetext="1"]');
    const freetextPresent = await freetextLocator.count() > 0;
    if (freetextPresent) {
      await freetextLocator.scrollIntoViewIfNeeded().catch(() => {});
      await freetextLocator.click();
      await freetextLocator.pressSequentially(
        'Reuse SharedReleaseFixture, but add a standalone subtest for the gate-task path so the gate-task fields are covered without a second queue.',
        { delay: 18 },
      );
      await sleep(THINK);
      await frame(page, 'r1-3-freetext', 'R1 — P2: operator types a free-text answer on Q2 (overriding the option list)');
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
      const anyRadioSelected = await page.evaluate(() => {
        const q2 = document.querySelector('[data-question-index="1"]');
        if (!q2) return false;
        return [...q2.querySelectorAll('[data-option-selected]')].some((el) => el.getAttribute('data-option-selected') === 'true');
      });
      check(!anyRadioSelected, 'P2: all Q2 radio options unselected — free-text overrides the radio');
    } else {
      check(false, 'P2: [data-question-freetext="1"] present (surface not found — soft fail)');
      await page.locator('[data-question-index="1"] input[type="radio"]').first().check().catch(() => {});
      await sleep(THINK);
      await frame(page, 'r1-3-answer-fallback', 'R1 — answered via radio (P2 freetext surface not found)');
    }
    await page.locator('[data-action="submit-answers"]').click();
    await sleep(ACT);
    writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=drafting) — rolling in answers');
    await page.waitForSelector('[data-section="architect-interview"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await burst(sid, ['Read', 'Edit']);
    await frame(page, 'r1-3b-drafting', 'R1 — planning: architect drafts with the answers folded in');

    // ── R1.4: Stall cameo — P1 StuckWarning ───────────────────────────────────
    console.log('\n[R1.4] Stall cameo — P1 StuckWarning');
    await caption(page, 'And if it ever stalls or crashes — you see it, with exactly where to look.');
    const staleTime = new Date(Date.now() - 200_000).toISOString();
    writeFileSync(join(archDir(sid), 'status.json'), JSON.stringify({
      session_id: sid, project: PROJECT, project_repo_path: projectRoot,
      phase: 'drafting', round: 2, idea: IDEA, updated_at: staleTime,
    }, null, 2));
    const hbPath = join(FORGE_ROOT, '_logs', `_architect-${sid}`, '.heartbeat');
    if (existsSync(hbPath)) { try { rmSync(hbPath); } catch { /* */ } }
    let staleRendered = false;
    try {
      await page.waitForSelector('[data-architect-stale="true"]', { timeout: 10000 });
      staleRendered = true;
      check(true, 'P1: [data-architect-stale="true"] rendered when session staleMs > 120s');
    } catch {
      check(false, 'P1: [data-architect-stale="true"] rendered when session staleMs > 120s (timeout — bridge may cache)');
    }
    if (staleRendered) {
      await frame(page, 'r1-4-stale-warning', 'R1 — P1: StuckWarning renders when the architect goes quiet for >2 min');
    }
    writeStatus(sid, { phase: 'drafting', round: 2, idea: IDEA });
    archEvent(sid, 'log', 'architect resumed');
    try {
      await page.waitForFunction(() => !document.querySelector('[data-architect-stale="true"]'), null, { timeout: 8000 });
      check(true, 'P1: [data-architect-stale] clears after session refresh');
    } catch {
      check(false, 'P1: [data-architect-stale] clears after session refresh (still stale after 8s)');
    }

    // ── R1.5: Architect drafts — P4 real cost greens the hex ──────────────────
    console.log('\n[R1.5] Architect drafts — P4 real cost');
    await caption(page, '$0.46, 95 seconds — metered from the first phase.');
    archEvent(sid, 'tool_use', 'tool.Write', { tool: 'Write' });
    await sleep(THINK);
    archEvent(sid, 'tool_use', 'tool.Edit', { tool: 'Edit' });
    await sleep(THINK);
    writePlan(sid, 1);
    archEvent(sid, 'log', 'plan-emitted (1 initiative(s), 0 escalation(s))');
    cycleEvent('architect', 'start', 'architect.start', { metadata: { origin: 'architect' } });
    {
      const manifestText = readFileSync(join(archDir(sid), 'manifests', `${INIT}.md`), 'utf8');
      const costMatch = /^architect_cost_usd:\s*([\d.]+)/m.exec(manifestText);
      const durMatch = /^architect_duration_ms:\s*(\d+)/m.exec(manifestText);
      const archCost = costMatch ? parseFloat(costMatch[1]) : EMULATED_ARCHITECT_COST_USD;
      const archDur = durMatch ? parseInt(durMatch[1], 10) : EMULATED_ARCHITECT_DURATION_MS;
      cycleEvent('architect', 'end', 'architect.end', { cost_usd: archCost, duration_ms: archDur });
    }
    await frame(page, 'r1-5-architect-cost', 'R1 — P4: architect hex greens with real cost pill ($0.46, 95s)');

    // ── R2.0: Rich PLAN.html presented ────────────────────────────────────────
    console.log('\n[R2.0] Rich PLAN.html (gate)');
    await page.goto(
      watch.uiUrl + `/artifact?run=_architect-${encodeURIComponent(sid)}&type=plan&mode=gate`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.waitForSelector('[data-page="flows"][data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-section="plan-gate"]', { timeout: 15000 });
    await caption(page, 'The plan is Given/When/Then — the PM uses it verbatim.');
    check(await page.locator('[data-plan-iframe]').count() > 0, 'plan gate renders the rich PLAN.html iframe');
    await page.locator('[data-plan-iframe]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'r2-0-plan-html', 'R2 — rich PLAN.html with Given/When/Then AC cards');

    // ── R2.1: Send-back + revised plan ────────────────────────────────────────
    console.log('\n[R2.1] Send-back + revised plan');
    await caption(page, 'You decide when the plan is right.');
    const rationale = 'Also cover the no-markers case (exit non-zero with a clear message) so --write never silently does nothing before merging.';
    const rationaleLocator = page.locator(
      '[data-component="plan-gate"] [data-field="rationale"], [data-section="plan-gate"] [data-field="rationale"]'
    ).first();
    if (await rationaleLocator.count() > 0) {
      await rationaleLocator.click();
      await rationaleLocator.pressSequentially(rationale, { delay: 18 });
    } else {
      rationaleLocator.fill(rationale).catch(() => {});
    }
    await sleep(THINK);
    await frame(page, 'r2-1-send-back', 'R2 — operator sends the plan back with feedback');
    await page.locator('[data-action="revise-plan"]').click();
    await sleep(ACT);
    writeStatus(sid, { phase: 'drafting', round: 3, idea: IDEA });
    archEvent(sid, 'start', 'architect turn (phase=drafting) — rerun with operator feedback');
    await page.waitForSelector('[data-section="plan-gate"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await burst(sid, ['Read', 'Read']);
    writePlan(sid, 2);
    archEvent(sid, 'log', 'plan-emitted (revised — gate-task path covered)');
    await page.waitForSelector('[data-section="plan-gate"][data-decisions-resolved="true"]', { timeout: 15000 });
    await sleep(READ);
    await frame(page, 'r2-1b-revised-plan', 'R2 — revised plan re-presented with (revised) badge');

    // ── R2.2: Approve → watch it build ────────────────────────────────────────
    console.log('\n[R2.2] Approve → watch it build');
    await caption(page, "You're done. The autonomous loop takes over.");
    await sleep(ACT);
    await frame(page, 'r2-2-approve', 'R2 — operator approves the plan (human decision #1 complete)');
    await page.locator('[data-action="approve-plan"]').click();
    await sleep(ACT);
    mkdirSync(QDIR('pending'), { recursive: true });
    execSync(`cp ${join(archDir(sid), 'manifests', `${INIT}.md`)} ${join(QDIR('pending'), `${INIT}.md`)}`);
    writeStatus(sid, { phase: 'committed', round: 3, idea: IDEA });
    cycleEvent('orchestrator', 'start', 'cycle.start', { metadata: { origin: 'architect' } });
    moveManifest('pending', 'in-flight');
    // 30s (not 15s): the button renders only after the seeded 'committed' status
    // + in-flight run propagate through the UI's ~3s poll; first-navigation
    // next-dev compile jitter can push this past 15s (observed flake).
    await page.waitForSelector('[data-action="watch-it-build"]', { timeout: 30000 });
    await sleep(ACT);
    await page.locator('[data-action="watch-it-build"]').click();
    await page.waitForFunction(
      () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
      null, { timeout: 20000 },
    ).catch(() => {});
    await sleep(ACT);
    await frame(page, 'r2-2b-monitor-landing', 'R2 — "Watch it build →" lands on the Studio flow monitor');
    await openStudioMonitor(page, watch);
    await frame(page, 'r2-2c-monitor-live', 'R2 — flow monitor shows the cycle live (run rail + topology)');
    await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 5, 'monitor: pipeline spine shows ≥5 phase hexes');
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

    // ── R3.0: PM decomposes ACs into work items ───────────────────────────────
    console.log('\n[R3.0] PM decomposes ACs into work items');
    await caption(page, 'Dependency-ordered work items — from G/W/T, not tasks. (Pure inject.ts, then the --write wiring + acceptance read-back.)');
    await paced([
      () => cycleEvent('project-manager', 'start', 'pm phase start'),
      () => cycleEvent('project-manager', 'tool_use', 'pm.brain-query', { metadata: { tool: 'brain-query' } }),
      () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-1' } }),
      () => cycleEvent('project-manager', 'log', 'pm.work-item-emitted', { metadata: { work_item_id: 'WI-2' } }),
    ], WORK);
    await frame(page, 'r3-0-pm-midpulse', 'R3 (mid-pulse) — PM hex active as it emits work items');
    cycleEvent('project-manager', 'end', 'pm.end', { cost_usd: 0.31, duration_ms: 28000, metadata: { work_item_count: 2 } });
    await sleep(WORK);
    await frame(page, 'r3-0b-pm-settled', 'R3 — PM decomposed ACs into 2 dependency-ordered work items');
    await openStudioMonitor(page, watch);
    await countAtLeast(page, '[data-mon-node][data-hex-kind="wi"]', 2, 'monitor: PM materialised ≥2 WI hexes');
    await expectHexOpensDrawer(page, '[data-mon-node][data-hex-kind="phase"]', 'phase', 'monitor phase drawer');
    await expectHexOpensDrawer(page, '[data-mon-node][data-hex-kind="wi"]', 'wi', 'monitor WI drawer');

    // ── R3.1: Dev-loop TDD red — gate.expected-fail ───────────────────────────
    console.log('\n[R3.1] Dev-loop TDD red — gate.expected-fail');
    await caption(page, 'The gate fails before a line is written — npm test red on the new inject suite.');
    await paced([
      () => cycleEvent('developer-loop', 'start', 'dev-loop start'),
      () => cycleEvent('developer-loop', 'log', 'gate.expected-fail', {
        metadata: { work_item_id: 'WI-1', stderr: 'FAIL injectToc_ReplacesMarkerRegion: Cannot find module ../dist/inject.js (src/inject.ts not implemented)' },
      }),
    ], WORK);
    await sleep(THINK);
    await frame(page, 'r3-1-gate-fail', 'R3 — TDD red: gate.expected-fail — the inject test fails before src/inject.ts exists');

    // ── R3.2: Dev-loop GRIND — fast-forwarded ─────────────────────────────────
    console.log('\n[R3.2] Dev-loop GRIND (fast-forward)');
    await caption(page, 'Autonomous — writing the pure src/inject.ts marker-slice. (4m compressed.)');
    await runningTimer(page, true, 0);
    const implTools = ['Edit', 'Edit', 'Bash', 'Edit', 'Bash', 'Edit', 'Bash', 'Read', 'Edit', 'Bash'];
    for (const t of implTools) {
      cycleEvent('developer-loop', 'tool_use', `tool.${t}`, { metadata: { work_item_id: 'WI-1', tool: t } });
      await pace('fastForward');
    }
    cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-1', input_tokens: 1800, output_tokens: 600 } });
    await sleep(WORK);
    cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-1', input_tokens: 2100, output_tokens: 900 } });
    await sleep(WORK);
    await frame(page, 'r3-2-grind', 'R3 (fast-forward) — dev-loop implementing WI-1; token/cost bar growing');

    // ── R3.3: Dependency gate + gate.pass ─────────────────────────────────────
    console.log('\n[R3.3] Gate.pass + WI-1 green → WI-2 starts');
    await runningTimer(page, false);
    await caption(page, 'Red four minutes ago — now green. WI-2 (the --write wiring + acceptance read-back) only started once WI-1 was done.');
    cycleEvent('developer-loop', 'log', 'gate.pass', { metadata: { work_item_id: 'WI-1' } });
    await sleep(THINK);
    cycleEvent('developer-loop', 'iteration', 'WI-1 iteration', {
      iteration: 1, tokens_in: 4200, tokens_out: 1600, cost_usd: 0.21, metadata: { work_item_id: 'WI-1' },
    });
    await sleep(THINK);
    cycleEvent('developer-loop', 'end', 'WI-1 complete', { metadata: { work_item_id: 'WI-1' } });
    await sleep(WORK);
    await frame(page, 'r3-3-wi1-green', 'R3 — gate.pass; WI-1 green; WI-2 (depends on WI-1) only now starts');
    cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
    await sleep(THINK);
    cycleEvent('developer-loop', 'log', 'usage_delta', { metadata: { work_item_id: 'WI-2', input_tokens: 1200, output_tokens: 400 } });
    await sleep(WORK);
    cycleEvent('developer-loop', 'iteration', 'WI-2 iteration', { iteration: 1, metadata: { work_item_id: 'WI-2' } });
    cycleEvent('developer-loop', 'end', 'WI-2 complete', { metadata: { work_item_id: 'WI-2' } });
    cycleEvent('developer-loop', 'end', 'ralph.end', { cost_usd: 0.92, duration_ms: 140000 });
    await sleep(WORK);
    await frame(page, 'r3-3b-devloop-green', 'R3 — dev-loop hex greens (both WIs done); unifier runs next on its own hex');

    // ── R3.4: Unifier on its OWN hex ──────────────────────────────────────────
    console.log('\n[R3.4] Unifier on its own hex');
    await caption(page, 'A separate phase reviews the branch and authors the demo — with captured CLI read-back evidence.');
    await paced([
      () => unifierEvent('start', 'unifier.start — reviewing the merged work-item output'),
      () => unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: npm test && npm run acceptance' } }),
    ], WORK);
    await frame(page, 'r3-4-unifier-midpulse', 'R3 (mid-pulse) — unifier hex active, running the gate + acceptance on the merged branch');
    unifierEvent('log', 'unifier.gate — initiative gate green; cleaning output');
    await sleep(WORK);
    unifierEvent('log', 'unifier.demo-skill — authoring demo.json (captured CLI read-back evidence)');
    await sleep(THINK);
    unifierEvent('tool_use', 'tool.Bash', { metadata: { tool: 'Bash: forge demo render' } });
    await sleep(THINK);
    writeDemoJson(1);
    unifierEvent('end', 'unifier.end — demo authored, branch clean', { cost_usd: 0.18, duration_ms: 46000 });
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
    await frame(page, 'r3-4b-unifier-green', 'R3 — unifier (own node) greens after authoring the demo');

    // ── R3.5: Cost rollup across the spine ────────────────────────────────────
    console.log('\n[R3.5] Cost rollup');
    cycleEvent('review-loop', 'start', 'review-loop start');
    cycleEvent('review-loop', 'log', 'reviewer.pr-opened');
    moveManifest('in-flight', 'ready-for-review');
    await caption(page, 'Every phase is costed: architect $0.46 / PM $0.31 / dev-loop $0.92 / unifier $0.18.');
    await openStudioMonitor(page, watch);
    await sleep(READ);
    await frame(page, 'r3-5-cost-rollup', 'R3 — cost rollup across the spine (Studio monitor)');
    await expectPhaseCost(page, 'monitor: cost rollup — a phase hex shows cost > 0');
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

    const REVIEW_URL = `${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=verdict&mode=gate`;
    const REFLECT_URL = `${watch.uiUrl}/artifact?run=${encodeURIComponent(CYCLE_ID)}&type=reflection&mode=view`;

    // S7: seed a live worktree so the comment-derived send-back genuinely
    // appends a UWI in place (ADR-026), not a 409.
    const REVIEW_WT = seedReviewWorktree();

    // ── R4.0: Review — the comment-on-page visual demo (DEC-5) ─────────────────
    console.log('\n[R4.0] Review — comment-on-page visual demo (PARTIAL)');
    await sleep(ACT);
    await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await page.waitForSelector('[data-component="demo-review-surface"]', { timeout: 15000 });
    await caption(page, 'The interactive review page: the rendered DEMO.md, a before/after slider, and per-region comments that ARE the verdict.');
    await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'r4-0-review-partial', 'R4 — review demo: AC-1 MET (CLI read-back), AC-2 PARTIAL (newline drift on re-write)');
    await countAtLeast(page, '[data-section="demo-evaluation"] [data-ac-verdict]', 2, 'review demo foregrounds per-AC evaluated output');
    check(
      await page.locator('[data-section="demo-evaluation"] [data-ac-verdict="partial"]').count() > 0,
      'an AC reads PARTIAL on round 1 — the gap the operator sends back on',
    );
    // DEC-5 surfaces: rendered DEMO.md iframe, per-region anchors, the before/after slider.
    check(await page.locator('[data-demo-markdown]').count() > 0, 'review page renders DEMO.md in a sandboxed iframe');
    await countAtLeast(page, '[data-demo-region]', 2, 'review page anchors per-demo-region comment targets');
    await page.locator('[data-evidence="before-after-slider"]').first().scrollIntoViewIfNeeded().catch(() => {});
    await sleep(THINK);
    await frame(page, 'r4-0b-slider', 'R4 — before/after image-comparison slider for the TOC region');
    check(await page.locator('[data-evidence="before-after-slider"]').count() > 0, 'review page shows a before/after img-comparison-slider');

    // ── R4.1: Send-back via an anchored blocking comment (DEC-5) ───────────────
    console.log('\n[R4.1] Send-back — operator anchors a blocking comment to AC-2');
    await caption(page, 'The operator comments directly on AC-2 — a blocking comment IS a send-back.');
    const ac2 = page.locator('[data-demo-region="ac-2"]');
    await ac2.scrollIntoViewIfNeeded().catch(() => {});
    await ac2.locator('[data-action="comment-region"]').click();
    await sleep(THINK);
    const commentBody = ac2.locator('[data-field="comment-body"]');
    await commentBody.click();
    await commentBody.pressSequentially(
      'A second --write on an already-current doc must be byte-identical (no trailing-newline drift) before this merges.',
      { delay: 16 },
    );
    await sleep(THINK);
    await frame(page, 'r4-1-comment', 'R4 — a blocking comment anchored to AC-2 (the send-back, on the page)');
    await ac2.locator('[data-action="add-comment"]').click();
    await page.waitForSelector('[data-demo-region="ac-2"] [data-comment-id]', { timeout: 8000 });
    check(await ac2.locator('[data-comment-id]').count() > 0, 'the anchored comment renders under its region');
    // The verdict is DERIVED — a blocking comment flips the bar to send-back.
    await page.waitForFunction(
      () => document.querySelector('[data-component="verdict-form"]')?.getAttribute('data-form-kind') === 'send-back',
      null, { timeout: 8000 },
    ).catch(() => {});
    check(
      await page.locator('[data-component="verdict-form"][data-form-kind="send-back"]').count() > 0,
      'the blocking comment derives a send-back verdict',
    );

    // Persistence: a reload must still show the anchored comment (sidecar-backed).
    await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 });
    await page.waitForSelector('[data-demo-region="ac-2"] [data-comment-id]', { timeout: 12000 });
    check(
      await page.locator('[data-demo-region="ac-2"] [data-comment-id]').count() > 0,
      'the anchored comment PERSISTS across a reload (review-comments sidecar)',
    );
    await frame(page, 'r4-1b-send-back', 'R4 — the comment persists; the derived verdict is "send back"');
    await page.locator('[data-component="verdict-form"] [data-action="send-back"]').click();
    await sleep(ACT);
    // ADR-026 in place: the send-back appended a UWI in the SAME cycle's worktree
    // (no requeue, no sibling cycle/_logs).
    check(
      existsSync(join(REVIEW_WT, '.forge', 'unifier-items')) &&
        readdirSync(join(REVIEW_WT, '.forge', 'unifier-items')).some((f) => f.startsWith('UWI-')),
      'send-back appended a UWI into the SAME cycle worktree (ADR-026 in place, no new cycle)',
    );

    // ── R4.2: Dev-loop reruns on feedback (fast-forward) ──────────────────────
    console.log('\n[R4.2] Dev-loop reruns on feedback (fast-forward)');
    await caption(page, 'The dev-loop re-ran on the new criterion.');
    moveManifest('ready-for-review', 'in-flight');
    await runningTimer(page, true, 0);
    cycleEvent('developer-loop', 'start', 'dev-loop rerun — addressing review feedback');
    for (let i = 0; i < 6; i++) {
      cycleEvent('developer-loop', 'tool_use', 'tool.Edit', { metadata: { work_item_id: 'WI-2', tool: 'Edit' } });
      await pace('fastForward');
    }
    unifierEvent('log', 'unifier.demo-skill — re-rendering demo.json (--write is byte-identical on every run)');
    await pace('fastForward');
    writeDemoJson(2);
    unifierEvent('end', 'unifier.end (round 2) — demo re-rendered', { cost_usd: 0.06 });
    cycleEvent('developer-loop', 'end', 'ralph.end (round 2)');
    moveManifest('in-flight', 'ready-for-review');
    await runningTimer(page, false);
    await sleep(WORK);
    await frame(page, 'r4-2-rerun', 'R4 (fast-forward) — dev-loop reran on the new criterion; back to "Review →"');

    // ── R4.3: Re-review — PARTIAL→MET (payoff) ────────────────────────────────
    console.log('\n[R4.3] Re-review — PARTIAL→MET');
    await sleep(ACT);
    await page.goto(REVIEW_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15000 });
    await caption(page, 'Partial → corrected → met. The loop closed on your criterion.');
    await page.locator('[data-section="demo-evaluation"]').scrollIntoViewIfNeeded().catch(() => {});
    await sleep(READ);
    await frame(page, 'r4-3-rereview-met', 'R4 — re-review: AC-2 now MET (PARTIAL→MET payoff)');
    const partialCount = await page.locator('[data-section="demo-evaluation"] [data-ac-verdict="partial"]').count();
    check(partialCount === 0, `re-review: partial AC count == 0 after dev-loop rerun (got ${partialCount})`);
    await countAtLeast(page, '[data-section="demo-evaluation"] [data-ac-verdict="met"]', 2, 're-review: all ACs show verdict "met"');

    // The blocking comment from R4.1 persists across the round — resolving it is
    // what flips the DERIVED verdict from send-back back to approve.
    const ac2b = page.locator('[data-demo-region="ac-2"]');
    await ac2b.scrollIntoViewIfNeeded().catch(() => {});
    await ac2b.locator('[data-action="resolve-comment"]').first().click().catch(() => {});
    await page.waitForFunction(
      () => document.querySelector('[data-component="verdict-form"]')?.getAttribute('data-form-kind') === 'approve',
      null, { timeout: 8000 },
    ).catch(() => {});
    check(
      await page.locator('[data-component="verdict-form"][data-form-kind="approve"]').count() > 0,
      'resolving the blocking comment flips the derived verdict to approve',
    );

    // ── R4.4: Approve & merge → completed spine ───────────────────────────────
    console.log('\n[R4.4] Approve & merge → completed spine');
    await caption(page, 'Comment resolved → the page derives "approve". Six phases, every one accountable.');
    await sleep(ACT);
    await frame(page, 'r4-4-approve', 'R4 — operator approves (human decision #2 complete)');
    await page.locator('[data-component="verdict-form"] [data-action="approve-and-merge"]').click();
    await page.waitForSelector('[data-component="verdict-form"][data-form-state="submitted"]', { timeout: 10000 }).catch(() => {});
    await paced([
      () => cycleEvent('review-loop', 'end', 'review-loop end — operator approved', { cost_usd: 0.21 }),
      () => cycleEvent('closure', 'start', 'closure.start'),
      () => cycleEvent('closure', 'log', 'closure.pr-merged'),
      () => cycleEvent('closure', 'end', 'closure.end'),
      () => cycleEvent('reflection', 'start', 'reflection.start'),
      () => cycleEvent('reflection', 'tool_use', 'reflection.brain-query', { metadata: { tool: 'brain-query' } }),
      () => cycleEvent('reflection', 'end', 'reflection.end'),
    ], WORK);
    moveManifest('ready-for-review', 'done');
    writeReflectionQuestions();
    await page.waitForSelector('[data-action="open-reflect"]', { timeout: 15000 }).catch(() => {});
    await sleep(ACT);
    await frame(page, 'r4-4b-reflect-link', 'R4 — merged; "Reflect on this cycle →" surfaces the final human moment');
    await openStudioMonitor(page, watch);
    await page.locator(`[data-run-id="${CYCLE_ID}"]`).first().click().catch(() => {});
    await page.waitForSelector(`[data-run-id="${CYCLE_ID}"][data-run-status="complete"]`, { timeout: 15000 }).catch(() => {});
    await sleep(READ);
    await frame(page, 'r4-4c-spine-complete', 'R4 — completed spine: every phase green with its cost pill');
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
    await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 5, 'completed cycle still shows ≥5 phase hexes');
    await expectPhaseCost(page, 'completed cycle shows accrued per-phase cost');
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

    // ── R5: Reflect — operator tunes the brain ────────────────────────────────
    console.log('\n[R5] Reflect');
    await caption(page, "Forge improves. You're the teacher — tune the brain.");
    await page.goto(REFLECT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('[data-page-ready="true"]', { timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-section="reflect-questions"]', { timeout: 15000 }).catch(() => {});
    await sleep(READ);
    await frame(page, 'r5-0-reflect-page', 'R5 — reflection screen: WI-sizing question + freeform observation');
    await page.locator('[data-question-index="0"] input[type="radio"]').first().check().catch(() => {});
    await sleep(THINK);
    const freeformLocator = page.locator('[data-field="freeform"]');
    if (await freeformLocator.count() > 0) {
      await freeformLocator.click();
      await freeformLocator.pressSequentially(
        'Dependency ordering held. The send-back (a second --write must be byte-identical) was exactly the right call — it caught a real trailing-newline drift.',
        { delay: 18 },
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
    await frame(page, 'r5-0b-reflected', 'R5 — feedback captured; reflector folds it into the brain');
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

    // ── R6: Per-project Roadmap tab (S6 DEC-3) ───────────────────────────────
    // The manifest is now in done/; seed a minimal work-items-snapshot so the
    // roadmap endpoint returns initiatives + WIs, then verify the tab renders them.
    console.log('\n[R6] Per-project Roadmap tab');
    const wiSnapshotDir = join(CYCLE_LOG, 'work-items-snapshot');
    const ROADMAP_SEEDED_WI = join(wiSnapshotDir, 'WI-1.md');
    let roadmapSeeded = false;
    try {
      mkdirSync(wiSnapshotDir, { recursive: true });
      writeFileSync(ROADMAP_SEEDED_WI, [
        '---',
        `work_item_id: WI-1`,
        `initiative_id: ${INIT}`,
        'status: complete',
        'depends_on: []',
        'acceptance_criteria: []',
        'files_in_scope: []',
        'estimated_iterations: 1',
        '---',
        '',
        '## Add --write mode',
        '',
        'Implement in-place TOC injection with idempotency.',
      ].join('\n'));
      roadmapSeeded = true;
    } catch {
      check(false, 'roadmap: seeded WI snapshot for roadmap assertion');
    }
    // S7 / DEC-3: seed a SECOND, decomposed-but-not-yet-developing initiative
    // (pending) so the roadmap shows the "start development" trigger. A real
    // develop run (dev→unifier→review) is the scheduler's job — exercised by the
    // operator-gated verify:cycle; here we prove the trigger flips the manifest
    // onto the forge-develop flow.
    const INIT_DEV = `INIT-${DATE}-e2e-develop-trigger`;
    const DEV_CYCLE_ID = `${STAMP}_${INIT_DEV}`;
    mkdirSync(QDIR('pending'), { recursive: true });
    writeFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), [
      '---', `initiative_id: ${INIT_DEV}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
      `created_at: '${new Date().toISOString()}'`, 'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: pending',
      'origin: architect', `cycle_id: ${DEV_CYCLE_ID}`,
      '---', '', '# mdtoc — `--check` mode (CI drift guard)', '',
      'Given a doc whose embedded TOC has drifted, when `mdtoc --check` runs, then it exits non-zero so CI can fail.',
    ].join('\n'));

    await page.goto(watch.uiUrl + `/projects/${PROJECT}`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="projects"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
    } catch { /* soft: continue to check tab */ }
    // Click the Roadmap tab.
    const roadmapTab = page.locator('button[data-tab="roadmap"]');
    if (await roadmapTab.count() > 0) {
      await roadmapTab.click();
      await sleep(1500); // allow bridge fetch to settle
      await caption(page, 'Per-project Roadmap — initiatives ordered by dependency level, with nested WI sub-graphs.');
      await frame(page, 'r6-0-roadmap-tab', 'R6 — per-project Roadmap tab: initiative spine + work items');
      const roadmapSection = await page.evaluate(() =>
        document.querySelector('[data-section="project-roadmap"]') !== null);
      check(roadmapSection, 'roadmap: [data-section="project-roadmap"] rendered');
      const initCount = await page.evaluate(() =>
        document.querySelectorAll('[data-initiative-id]').length);
      check(initCount >= 1, `roadmap: ≥1 [data-initiative-id] present (got ${initCount})`);
      if (roadmapSeeded) {
        const wiCount = await page.evaluate(() =>
          document.querySelectorAll('[data-work-item-id]').length);
        check(wiCount >= 1, `roadmap: ≥1 [data-work-item-id] present (got ${wiCount})`);
      }
    } else {
      check(false, 'roadmap: Roadmap tab button [data-tab="roadmap"] present on project page');
    }

    // ── R6.1: Start development — the trigger flips the manifest onto forge-develop ──
    console.log('\n[R6.1] Start development trigger (DEC-3)');
    const devCard = page.locator(`[data-initiative-id="${INIT_DEV}"]`);
    const startBtn = devCard.locator('[data-action="start-development"]');
    if (await startBtn.count() > 0) {
      check(
        await devCard.getAttribute('data-initiative-status') === 'pending',
        'roadmap: the decomposed initiative is pending (develop-able)',
      );
      await devCard.scrollIntoViewIfNeeded().catch(() => {});
      await caption(page, 'A decomposed initiative offers "Start development" — it runs the Forge Develop flow.');
      await frame(page, 'r6-1-start-development', 'R6 — the "start development" trigger on a pending initiative');
      await startBtn.click();
      await page.waitForSelector(`[data-initiative-id="${INIT_DEV}"][data-develop-state="started"]`, { timeout: 12000 }).catch(() => {});
      const devState = await devCard.getAttribute('data-develop-state');
      check(devState === 'started', `start-development enqueues the develop run (data-develop-state=${devState})`);
      await frame(page, 'r6-1b-development-started', 'R6 — development started: the unifier will open a PR for review');
      // The manifest is now claimable on the forge-develop flow, threading its cycle_id.
      const devManifest = readFileSync(join(QDIR('pending'), `${INIT_DEV}.md`), 'utf8');
      check(/^flow_id:\s*forge-develop\s*$/m.test(devManifest), 'start-development repoints the manifest at the forge-develop flow');
      check(devManifest.includes(DEV_CYCLE_ID), 'the develop run threads the architect-minted cycle_id (DEC-2)');
    } else {
      check(false, `roadmap: [data-action="start-development"] present on the pending initiative ${INIT_DEV}`);
    }

    // Clean up the seeded WI snapshot (the manifest in done/ is cleaned in the finally block).
    if (roadmapSeeded) {
      try { rmSync(ROADMAP_SEEDED_WI, { force: true }); } catch { /* */ }
    }
    try { rmSync(join(QDIR('pending'), `${INIT_DEV}.md`), { force: true }); } catch { /* */ }

    // ════════════════════════════════════════════════════════════════════════
    // ACT 3 — SWAP. The seams — the platform is modular, not hardcoded.
    // ════════════════════════════════════════════════════════════════════════

    // Seed a synthetic gated run (INIT2) so the flow-engine control beats have a
    // gated run to act on, plus a ceiling run (INIT3) and a failed run (INIT4).
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
    mkdirSync(QDIR('ready-for-review'), { recursive: true });
    writeFileSync(join(QDIR('ready-for-review'), `${INIT2}.md`), [
      '---', `initiative_id: ${INIT2}`, `project: ${PROJECT}`, `project_repo_path: ${projectRoot}`,
      `created_at: '${new Date().toISOString()}'`, `cycle_id: ${CYCLE_ID2}`,
      'iteration_budget: 4', 'cost_budget_usd: 6', 'phase: ready-for-review', 'origin: architect',
      '---', '', '# Studio demo — gated run for the flow-engine controls', '',
      'Add a --check mode to mdtoc that exits non-zero when the embedded TOC is stale.',
    ].join('\n'));
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
    const artifacts2 = join(CYCLE_LOG2, 'artifacts');
    mkdirSync(artifacts2, { recursive: true });
    writeFileSync(join(artifacts2, 'demo.json'), JSON.stringify({
      title: 'Studio demo — gated run', project: PROJECT, initiativeId: INIT2,
    }, null, 2));
    // F4: the single DEMO.md (DEMO.html is retired — the review page renders markdown).
    writeFileSync(join(artifacts2, 'DEMO.md'), '# Studio demo — gated run\n\n> A gated run for the flow-engine controls.\n');

    // ── S1.0: Flow monitor deep-dive (drawer / gate sub-checks / tail) ────────
    console.log('\n[S1.0] Flow monitor deep-dive — /flows/forge-cycle');
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
    await caption(page, 'The flow monitor — live topology of every agent phase, with phase logs and gate sub-checks. Pan + zoom the hex graph.');
    await sleep(ACT);
    await countAtLeast(page, '[data-run-id]', 1, 'monitor: run rail shows ≥1 [data-run-id]');
    await countAtLeast(page, '[data-mon-node]', 6, 'monitor: topology renders ≥6 [data-mon-node] hexes');
    await countAtLeast(page, '[data-mon-node][data-hex-kind="phase"]', 5, 'monitor: ≥5 deterministic per-phase hexes');
    await sleep(READ);
    await frame(page, 's1-0-monitor', 'S1 — flow monitor: run rail + topology (≥5 phase hexes + WI hexes)');
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
      const hasGateSection = await page.evaluate(() =>
        document.querySelector('#phase-drawer')?.textContent?.includes('Gate sub-checks') ?? false);
      check(hasGateSection, 'monitor: drawer shows Gate sub-checks section');
      const hasPhaseLog = await page.evaluate(() =>
        document.querySelector('#phase-drawer')?.textContent?.includes('Phase log') ?? false);
      check(hasPhaseLog, 'monitor: drawer shows Phase log section');
      await frame(page, 's1-0b-monitor-drawer', 'S1 — phase drawer open: gate sub-checks + phase log visible');
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
    const tailCount = await page.evaluate(() => {
      const el = document.querySelector('[data-tail-count]');
      return el ? el.getAttribute('data-tail-count') : null;
    });
    check(tailCount !== null, `monitor: [data-tail-count] attribute present (got ${tailCount})`);

    // ── S1.1: Engine control — start-run CTA (knowledge-ingest, no runs) ───────
    console.log('\n[S1.1] Engine — start-run CTA (knowledge-ingest, no runs)');
    await page.goto(watch.uiUrl + '/flows/knowledge-ingest', { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 20000 },
      );
      check(true, 'engine: flow-monitor ready for knowledge-ingest');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') ?? '(absent)');
      check(false, `engine: flow-monitor ready for knowledge-ingest (got "${pr}")`);
    }
    await caption(page, 'The engine runs any flow — Start Run launches a planned flow directly from the UI.');
    await sleep(ACT);
    const canStartKi = await page.evaluate(() =>
      document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start') ?? '(absent)');
    check(canStartKi === 'true', `engine: data-can-start="true" on flow-monitor (got "${canStartKi}")`);
    const startBtnEnabled = await page.evaluate(() => {
      const btn = document.querySelector('[data-action="start-run"]');
      return btn !== null && !btn.hasAttribute('disabled');
    });
    check(startBtnEnabled, 'engine: [data-action="start-run"] present and enabled (no real run started)');
    await frame(page, 's1-1-start-run', 'S1 — engine: Start Run CTA enabled on a flow with no runs');

    // ── S1.2: Engine control — gate + cost-ceiling on the gated run ───────────
    console.log('\n[S1.2] Engine — gate control + cost on the gated run');
    await openStudioMonitor(page, watch, 'forge-cycle', CYCLE_ID2);
    await caption(page, 'A gated run parks for you — "Open gate →" links straight to the verdict. Cost is metered against the flow ceiling.');
    await sleep(ACT);
    try {
      await page.waitForFunction(
        (id) => document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') === 'gated',
        CYCLE_ID2, { timeout: 12000 },
      );
      check(true, 'engine: the seeded run shows status gated on the run rail');
    } catch {
      const got = await page.evaluate((id) =>
        document.querySelector(`[data-run-id="${id}"]`)?.getAttribute('data-run-status') ?? '(absent)', CYCLE_ID2);
      check(false, `engine: seeded run gated (got "${got}")`);
    }
    await expectPhaseCost(page, 'engine: gated run shows accrued per-phase cost (metered vs ceiling)');

    // F2: monitor-artifacts pill row — at least one [data-artifact-pill] chip
    // (demo.json is seeded for CYCLE_ID2, so the demo chip must be present).
    const monArtifactCount = await page.evaluate(() =>
      document.querySelectorAll('[data-section="monitor-artifacts"] [data-artifact-pill]').length);
    check(monArtifactCount >= 1, `monitor: [data-section="monitor-artifacts"] has ≥1 chip (got ${monArtifactCount})`);
    await frame(page, 's1-2-gate-control', 'S1 — engine: gated run parked, cost metered against the flow ceiling');

    // ── S2: Runtime-adapter seam (ADR-029) — registry-driven SDK picker + range
    console.log('\n[S2] Runtime-adapter seam — /agents/project-manager');
    await page.goto(watch.uiUrl + '/agents/project-manager', { waitUntil: 'domcontentloaded' });
    let rangePageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 25000 },
      );
      rangePageReady = true;
      check(true, 'adapter-seam: [data-page="agents"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="agents"]')?.getAttribute('data-page-ready') ?? '(no data-page=agents)');
      check(false, `adapter-seam: agent builder page-ready (got "${pr}")`);
    }
    await caption(page, 'The runtime is a seam — the SDK picker is registry-driven. claude is live; gemini/aider/codex are disabled until their adapter ships (ADR-029).');
    await sleep(ACT);
    if (rangePageReady) {
      // The RuntimePicker now lives under the collapsed "Advanced" section (J2
      // progressive disclosure). Open it to drive the runtime-adapter seam.
      await page.locator('[data-action="toggle-advanced"]').first().click().catch(() => {});
      await page.waitForFunction(
        () => document.querySelector('[data-section="advanced"]')?.getAttribute('data-advanced-open') === 'true',
        null, { timeout: 5000 },
      ).catch(() => {});
      const claudeCardAvailable = await page.evaluate(() => {
        const card = document.querySelector('[data-sdk-id="claude"]');
        return card !== null && !card.classList.contains('disabled');
      });
      check(claudeCardAvailable, 'adapter-seam: [data-sdk-id="claude"] selectable (adapter registered)');
      const codexDisabled = await page.evaluate(() => {
        const card = document.querySelector('[data-sdk-id="codex"]');
        return card !== null && card.classList.contains('disabled');
      });
      check(codexDisabled, 'adapter-seam: [data-sdk-id="codex"] disabled (adapter not registered)');
      const geminiDisabled = await page.evaluate(() => {
        const card = document.querySelector('[data-sdk-id="gemini"]');
        return card !== null && card.classList.contains('disabled');
      });
      check(geminiDisabled, 'adapter-seam: [data-sdk-id="gemini"] disabled (adapter not registered)');
      await frame(page, 's2-0-sdk-picker', 'S2 — adapter seam: claude selectable; codex/gemini disabled (registry-driven)');

      const rangeBtn = page.locator('[data-component="runtime-picker"] [data-strategy="range"]');
      let rangeTogglePresent = false;
      if ((await rangeBtn.count()) > 0) {
        rangeTogglePresent = true;
        await rangeBtn.click();
        await sleep(THINK);
        try {
          await page.waitForFunction(
            () => document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') === 'range',
            null, { timeout: 5000 },
          );
          check(true, 'adapter-seam: range segment flips [data-component="runtime-picker"][data-strategy="range"]');
        } catch {
          const strat = await page.evaluate(() =>
            document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-strategy') ?? '(absent)');
          check(false, `adapter-seam: data-strategy flipped to range (got "${strat}")`);
        }
      } else {
        check(false, 'adapter-seam: [data-strategy="range"] toggle present in RuntimePicker');
      }
      if (rangeTogglePresent) {
        const captionEl = await page.evaluate(() => {
          const el = document.querySelector('#strategy-caption');
          return el ? el.textContent?.trim() : null;
        });
        check(captionEl !== null && captionEl.length > 5, `adapter-seam: range strategy caption rendered ("${captionEl ?? '(absent)'}")`);
        const modelChips = page.locator('[data-component="runtime-picker"] [data-model-id]');
        const chipCount = await modelChips.count();
        check(chipCount >= 1, `adapter-seam: ≥1 [data-model-id] chip rendered in range mode (got ${chipCount})`);
        let selectedCount = 0;
        if (chipCount >= 1) {
          await modelChips.first().click(); await sleep(THINK); selectedCount = 1;
          if (chipCount >= 2) { await modelChips.nth(1).click(); await sleep(THINK); selectedCount = 2; }
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
            check(count >= selectedCount, `adapter-seam: data-model-count ≥${selectedCount} after selecting ${selectedCount} chip(s) (got ${count})`);
          } catch {
            const gotCount = await page.evaluate(() =>
              document.querySelector('[data-component="runtime-picker"]')?.getAttribute('data-model-count') ?? '(absent)');
            check(false, `adapter-seam: data-model-count ≥${selectedCount} in range mode (got "${gotCount}")`);
          }
        }
        await frame(page, 's2-1-range-chips', `S2 — range mode: ${selectedCount} Claude tier chip(s) selected; routes to the cheapest capable tier first`);
      }
      const yamlPreviewText = await page.evaluate(() => {
        const preview = document.querySelector('[data-component="yaml-preview"]');
        if (preview) return preview.textContent ?? '';
        const pres = [...document.querySelectorAll('pre')];
        return pres.find((el) => el.textContent?.includes('strategy'))?.textContent ?? '';
      });
      check(yamlPreviewText.includes('strategy: range'),
        `adapter-seam: YAML preview contains "strategy: range" (got: "${yamlPreviewText.slice(0, 100).replace(/\n/g, '\\n')}")`);
      await frame(page, 's2-2-yaml-range', 'S2 — YAML preview shows strategy: range (authored in UI; no Save — seed SKILL.md immutable)');
    } else {
      check(false, 'adapter-seam: agent builder page did not become ready — adapter-seam checks skipped');
    }

    // ── S3: KB-backend seam (ADR-027 §4) — knowledge graph + pin guidance ─────
    const GUIDANCE_TEXT = '[e2e-journey] --write theme: idempotency is the sharp edge — a second --write must be byte-identical or a trailing newline drifts into a diff.';
    console.log('\n[S3.0] KB-backend seam — /knowledge?id=cycles (real brain)');
    await page.goto(`${watch.uiUrl}/knowledge?id=cycles`, { waitUntil: 'domcontentloaded' });
    let kbPageReady = false;
    try {
      await page.waitForFunction(
        () => document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') === 'true',
        null, { timeout: 30000 },
      );
      kbPageReady = true;
      check(true, 'kb-seam: [data-page="knowledge"][data-page-ready="true"]');
    } catch {
      const pr = await page.evaluate(() =>
        document.querySelector('[data-page="knowledge"]')?.getAttribute('data-page-ready') ?? '(no data-page=knowledge)');
      check(false, `kb-seam: knowledge page-ready (got "${pr}")`);
    }
    await caption(page, 'The brain is a seam too — FilesystemKbBackend by default, swappable to Zep via a descriptor. Browse the real force-graph.');
    await sleep(WORK);
    if (kbPageReady) {
      const kbId = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-kb-id') ?? '');
      check(kbId === 'cycles', `kb-seam: #kb-svg data-kb-id="cycles" (got "${kbId}")`);
      let nodeCountKb = 0;
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('#kb-svg');
          return el !== null && parseInt(el.getAttribute('data-node-count') ?? '0', 10) >= 10;
        }, null, { timeout: 15000 });
      } catch { /* report below */ }
      nodeCountKb = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '0', 10));
      check(nodeCountKb >= 10, `kb-seam: #kb-svg data-node-count ≥10 (got ${nodeCountKb})`);
      const edgeCountKb = await page.evaluate(() => parseInt(document.querySelector('#kb-svg')?.getAttribute('data-edge-count') ?? '0', 10));
      check(edgeCountKb > 0, `kb-seam: #kb-svg data-edge-count > 0 (got ${edgeCountKb})`);
      await countAtLeast(page, '[data-node-id]', 5, 'kb-seam: ≥5 [data-node-id] nodes rendered in graph');
      const hasTheme = await page.evaluate(() => document.querySelector('[data-layer="theme"]') !== null);
      check(hasTheme, 'kb-seam: [data-layer="theme"] node(s) present');
      const hasIndex = await page.evaluate(() => document.querySelector('[data-layer="index"]') !== null);
      check(hasIndex, 'kb-seam: [data-layer="index"] node(s) present');
      const healthPresent = await page.evaluate(() =>
        document.querySelector('[data-section="kb-health"]') !== null ||
        [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('KB HEALTH') || el.textContent?.includes('LAYER BALANCE')));
      check(healthPresent, 'kb-seam: KB HEALTH panel rendered');
      const selectorPresent = await page.evaluate(() =>
        document.querySelector('select') !== null || document.querySelector('[data-component="kb-selector"]') !== null);
      check(selectorPresent, 'kb-seam: KB selector present');
    }
    await frame(page, 's3-0-kb-graph', `S3 — /knowledge?id=cycles: force-graph rendered (${
      await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-node-count') ?? '?')
    } nodes, real cycles brain)`);

    if (kbPageReady) {
      const themeNode = page.locator('[data-layer="theme"]').first();
      if ((await themeNode.count()) > 0) {
        await themeNode.click({ force: true, timeout: 5000 }).catch(() => {});
        try {
          await page.waitForFunction(
            () => (document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '') !== '',
            null, { timeout: 8000 },
          );
          const selectedNode = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '');
          check(selectedNode !== '', `kb-seam: clicking a theme node sets data-selected-node (got "${selectedNode}")`);
        } catch {
          const sel = await page.evaluate(() => document.querySelector('#kb-svg')?.getAttribute('data-selected-node') ?? '(absent)');
          check(false, `kb-seam: clicking theme node sets data-selected-node (got "${sel}")`);
        }
      } else {
        check(false, 'kb-seam: [data-layer="theme"] node present to click');
      }
    }
    await sleep(ACT);
    await frame(page, 's3-0b-kb-node-article', 'S3 — theme node clicked: NODE ARTICLE panel visible');

    // ── S3.1: Pin-guidance → guidance node appears (writes _guidance/<ts>.md) ──
    console.log('\n[S3.1] KB-backend seam — pin-guidance');
    await caption(page, 'Human guidance — pin a note to the brain; it surfaces as a guidance node until the next ingest pass.');
    await sleep(ACT);
    if (kbPageReady) {
      const guidanceTextarea = page.locator('#guidance-text');
      if ((await guidanceTextarea.count()) > 0) {
        await guidanceTextarea.scrollIntoViewIfNeeded().catch(() => {});
        await guidanceTextarea.click();
        await guidanceTextarea.pressSequentially(GUIDANCE_TEXT, { delay: 14 });
        await sleep(THINK);
        await frame(page, 's3-1-guidance-typed', 'S3 — guidance text typed into the HUMAN GUIDANCE panel');
        const pinBtn = page.locator('#pin-guidance-btn');
        if ((await pinBtn.count()) > 0) {
          await pinBtn.click();
          await sleep(ACT);
          let guidancePinned = false;
          try {
            await page.waitForFunction(() => document.querySelector('[data-guidance-pinned="true"]') !== null, null, { timeout: 10000 });
            guidancePinned = true;
            check(true, 'kb-seam: data-guidance-pinned="true" — guidance POST succeeded');
          } catch {
            const successMsg = await page.evaluate(() =>
              [...document.querySelectorAll('div')].some((el) => el.textContent?.includes('Guidance pinned') ?? false));
            if (successMsg) { guidancePinned = true; check(true, 'kb-seam: "Guidance pinned" success message rendered'); }
            else {
              const pinVal = await page.evaluate(() =>
                document.querySelector('[data-guidance-pinned]')?.getAttribute('data-guidance-pinned') ?? '(absent)');
              check(false, `kb-seam: data-guidance-pinned="true" (got "${pinVal}")`);
            }
          }
          if (guidancePinned) {
            await sleep(WORK);
            const hasGuidanceNode = await page.evaluate(() => document.querySelector('[data-layer="guidance"]') !== null);
            check(hasGuidanceNode, 'kb-seam: [data-layer="guidance"] node appeared after pin (graph re-fetched)');
          }
        } else {
          check(false, 'kb-seam: #pin-guidance-btn present to click');
        }
      } else {
        check(false, 'kb-seam: #guidance-text textarea present');
      }
    } else {
      check(false, 'kb-seam: pin-guidance skipped (page did not reach ready)');
    }
    await frame(page, 's3-1b-guidance-pinned', 'S3 — guidance pinned: data-guidance-pinned="true", guidance node in graph');
    await sleep(READ);

    // ── End card ──────────────────────────────────────────────────────────────
    console.log('\n[end] End card');
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
            Forge Studio — the platform, not just the pipeline.
          </div>
          <div style="font:500 18px ui-sans-serif,system-ui;color:#e6edf3;margin-bottom:10px">
            Author a flow. Run it. Swap its engine.
          </div>
          <div style="margin-top:32px;font:12px ui-monospace,monospace;color:#6e7681">
            The forge cycle is one flow definition. Everything is data you can edit.
          </div>`;
        document.body.appendChild(card);
      }
    });
    await caption(page, 'Forge Studio — author a flow, run it, swap its engine. The forge cycle is just one flow definition.');
    await frame(page, 'end-card', 'End card — "Author a flow. Run it. Swap its engine."');
    await sleep(READ);

    console.log('\n[e2e] journey complete.');
  } finally {
    await ctx.close();
    await browser.close();
    try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
    cleanProjectDir();
    cleanSeededSession(createdSid);
    cleanScratchFlow();
    cleanStarterAgents();
    cleanFirstFlow();
    cleanFirstProject();
    cleanFirstFlowRun();
    rmSync(CYCLE_LOG, { recursive: true, force: true });
    // S7: the seeded review worktree + the develop-trigger initiative (INIT_DEV).
    try { rmSync(join(FORGE_ROOT, '_worktrees', INIT), { recursive: true, force: true }); } catch { /* */ }
    for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      try { rmSync(join(QDIR(q), `${INIT}.md`), { force: true }); } catch { /* */ }
      try { rmSync(join(QDIR(q), `${INIT}.verdict-response.md`), { force: true }); } catch { /* */ }
      try { rmSync(join(QDIR(q), `${INIT}-e2e-develop-trigger.md`), { force: true }); } catch { /* */ }
      try { rmSync(join(QDIR(q), `INIT-${DATE}-e2e-develop-trigger.md`), { force: true }); } catch { /* */ }
    }
    // ACT 3 studio cleanup (gated/ceiling/failed synthetic runs)
    try {
      const studioLogDirs = existsSync(join(FORGE_ROOT, '_logs'))
        ? readdirSync(join(FORGE_ROOT, '_logs')).filter((d) => d.includes('e2e-studio-demo'))
        : [];
      for (const d of studioLogDirs) rmSync(join(FORGE_ROOT, '_logs', d), { recursive: true, force: true });
      for (const q of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
        const entries = existsSync(QDIR(q))
          ? readdirSync(QDIR(q)).filter((f) => f.includes('e2e-studio-demo') || f.includes('e2e-flow-ceiling') || f.includes('e2e-flow-failed'))
          : [];
        for (const f of entries) rmSync(join(QDIR(q), f), { force: true });
      }
      const otherLogDirs = existsSync(join(FORGE_ROOT, '_logs'))
        ? readdirSync(join(FORGE_ROOT, '_logs')).filter((d) => d.includes('e2e-flow-ceiling') || d.includes('e2e-flow-failed'))
        : [];
      for (const d of otherLogDirs) rmSync(join(FORGE_ROOT, '_logs', d), { recursive: true, force: true });
    } catch { /* studio cleanup best-effort */ }
    if (createdSid) {
      try { rmSync(join(FORGE_ROOT, '_logs', `_architect-${createdSid}`), { recursive: true, force: true }); } catch { /* */ }
    }
    // KB-seam cleanup — remove any _guidance/*.md files written by the pin-guidance beat.
    try {
      const guidanceDir = join(FORGE_ROOT, 'brain', 'cycles', '_guidance');
      if (existsSync(guidanceDir)) {
        for (const f of readdirSync(guidanceDir)) rmSync(join(guidanceDir, f), { force: true });
        try { rmSync(guidanceDir, { recursive: true, force: true }); } catch { /* */ }
      }
    } catch { /* KB-seam cleanup best-effort */ }
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

main().catch((err) => { console.error(err); cleanProjectDir(); cleanScratchFlow(); cleanStarterAgents(); cleanFirstFlow(); cleanFirstProject(); cleanFirstFlowRun(); process.exit(1); });
