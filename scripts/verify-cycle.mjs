#!/usr/bin/env node
/**
 * verify-cycle — forge's REAL-CAPABILITY regression harness (ADR 022, S9 spine).
 *
 * Drives the REAL 3-stage SDLC spine end-to-end via the bridge API and asserts
 * real-cycle OUTCOMES — not synthetic rubrics — then records the run and writes a
 * pass/fail verdict. S9/DEC-3 retired the collapsed single-run flows
 * (release-refine / forge-cycle); this harness now exercises the spine the way an
 * operator does, through the bridge, threading ONE cycle_id across all three
 * stages (DEC-2):
 *
 *   1. forge-architect — POST /api/architect/start with the initiative idea, then
 *      auto-answer each interview round (/api/architect/answer) until the plan is
 *      drafted, then approve the PLAN GATE (/api/plan-verdict). The architect
 *      promotes a manifest (flow_id: forge-architect, cycle_id minted) to
 *      _queue/pending. `forge serve --once` then runs the architect flow (pm
 *      decomposes the initiative into work items).
 *   2. forge-develop — POST /api/develop/start hands the initiative off to the
 *      develop flow (same cycle_id; reuses the architect worktree + its work
 *      items). `forge serve --once` runs dev → unifier → review, parking at
 *      ready-for-review (the VERDICT GATE). Approve via /api/verdict; the bridge
 *      merges the PR and fires finalize.
 *   3. forge-reflect — finalize (in the bridge process) runs the reflector, which
 *      writes the central project brain. The harness WAITS for `reflector.end`
 *      before teardown (the prior harness killed the bridge mid-reflect).
 *
 * The gate assertions (ADR 022 §1 + S9):
 *   1. the cycle reached merge (finalStatus `done` / manifest in _queue/done/);
 *   2. the dev-loop completed N/N work items (no complete:0 / failed);
 *   3. the project's own tests are green post-merge (its .forge quality gate, else
 *      npm test);
 *   4. total cycle cost is under the declared ceiling;
 *   5. reflect wrote a central project-brain theme this run
 *      (brain/projects/<project>/themes/, mtime within the run).
 * Plus, for live-resource projects (and any run with --require-live-evidence):
 *   6. the merged cycle's demo carries LIVE evidence — a real REST GET checkpoint.
 *
 * Usage:
 *   node scripts/verify-cycle.mjs <run-handle> --project <name> [--idea-file <path>] [options]
 *
 * The <run-handle> names the recording output dir. The REAL initiativeId is minted
 * by the architect and discovered after the plan gate. The idea comes from
 * --idea-file, else the body of the corpus manifest at _queue/done/<run-handle>.md.
 *
 * Options:
 *   --project <name>        managed project to run against (default mdtoc; NEVER
 *                           run against mdtoc when it is committed inside forge —
 *                           use gitpulse, an independent repo). betterado is the
 *                           live-ADO tier.
 *   --idea-file <path>      the initiative idea fed to the architect (forge-root
 *                           relative). Falls back to the corpus manifest body.
 *   --base-sha <sha>        base commit to reset the harness repo to (routine).
 *   --cost-ceiling <usd>    fail the gate above this total cost (default scales
 *                           with project + send-back; the 3-stage spine costs more
 *                           than a single collapsed run, so the default is higher).
 *   --require-live-evidence force the live-demo-evidence gate on (default: on for
 *                           known live-resource projects). --no-live-evidence opts out.
 *   --force-reset           allow resetting a repo with uncommitted changes.
 *   --send-back             after develop first reaches ready-for-review, POST a
 *                           real send-back verdict, re-serve to drain the re-queued
 *                           UWIs, then fall through to auto-approve.
 *
 * Output: forge-ui/.demo-shots/verify/<run-handle>/ (video, frames, index.html,
 * summary.json with the verdict). Exits non-zero if the gate fails.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { sleep } from './lib/journey-assertions.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
// The positional arg is the RUN HANDLE — it names the recording output dir and is
// the default idea source (the corpus manifest body). The REAL initiativeId is
// minted by the architect and discovered after the plan gate.
const RUN_HANDLE = argv.find((a) => !a.startsWith('--'));
if (!RUN_HANDLE) {
  console.error('usage: node scripts/verify-cycle.mjs <run-handle> --project <name> [--idea-file <path>] [--base-sha <sha>] [--cost-ceiling <usd>] [--require-live-evidence|--no-live-evidence] [--force-reset] [--send-back]');
  process.exit(1);
}
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const BASE_SHA = flag('base-sha', null);
const SEND_BACK = argv.includes('--send-back');
const PROJECT = flag('project', 'mdtoc');
const IDEA_FILE = flag('idea-file', null);
// Live-resource projects (e.g. the betterado terraform provider stands up real
// Azure DevOps resources) run longer + cost more than the creds-free default
// mdtoc/gitpulse reference projects, so they get a higher default ceiling.
const LIVE_PROJECTS = new Set(['terraform-provider-betterado']);
const IS_LIVE_PROJECT = LIVE_PROJECTS.has(PROJECT);
// The 3-stage spine (real architect interview + draft, pm, dev fan-out, unifier,
// review, reflect) costs more than the old single collapsed run — bump the
// defaults. --send-back adds an extra unifier pass; live projects add infra cost.
const _ceilingDefault = IS_LIVE_PROJECT ? (SEND_BACK ? 90 : 70) : (SEND_BACK ? 50 : 35);
const COST_CEILING = parseFloat(flag('cost-ceiling', String(_ceilingDefault))) || _ceilingDefault;
// The live-demo-evidence gate: on by default for live-resource projects; force
// with --require-live-evidence, opt out with --no-live-evidence.
const REQUIRE_LIVE_EVIDENCE =
  argv.includes('--require-live-evidence') || (IS_LIVE_PROJECT && !argv.includes('--no-live-evidence'));
const FORCE_RESET = argv.includes('--force-reset');

const OUT_DIR = join(FORGE_ROOT, 'forge-ui/.demo-shots/verify', RUN_HANDLE);
const VIDEO_DIR = join(OUT_DIR, 'video');
const FRAMES_DIR = join(OUT_DIR, 'frames');

function log(msg) { console.log(`[verify ${new Date().toISOString().slice(11, 19)}] ${msg}`); }

/**
 * Spawn env for forge subprocesses, with the headroom compression proxy stripped.
 * headroom (a global ~/.bashrc wrap of `claude`) exports
 * ANTHROPIC_BASE_URL=http://127.0.0.1:8787 + an X-Headroom custom header into the
 * shell, which forge then inherits. The proxy buffers the SDK's streaming SSE, so
 * forge's stream-deadline watchdog fires ("SDK stream produced no message for
 * 360s") and the dev-loop crashes at iterations:0 (observed: betterado WI-1,
 * 2026-06-16). forge must stream directly from Anthropic. Detected narrowly by the
 * headroom header or the :8787 base url so unrelated proxies are left untouched.
 */
function forgeSpawnEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const base = env.ANTHROPIC_BASE_URL ?? '';
  const headers = env.ANTHROPIC_CUSTOM_HEADERS ?? '';
  const isHeadroom = /headroom/i.test(headers) || /\/\/(127\.0\.0\.1|localhost):8787\b/.test(base);
  if (isHeadroom) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_CUSTOM_HEADERS;
    log('headroom proxy detected on ANTHROPIC_BASE_URL — stripped it so forge streams direct (proxy buffering breaks the dev-loop stream-deadline)');
  }
  return env;
}

// ---- ADR 022 runner: corpus staging, repo reset, outcome assertions --------

function git(repoPath, args) {
  const r = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

/** The harness project's repo path — projects/<PROJECT> (an independent repo for
 *  gitpulse; the betterado provider lives under the same projects/ root). */
function projectRepoPath() {
  return join(FORGE_ROOT, 'projects', PROJECT);
}

/** Read one frontmatter scalar field from a manifest's raw text. */
function manifestField(raw, key) {
  const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

/** Strip YAML frontmatter and return the manifest body (the initiative idea). */
function manifestBody(raw) {
  const parts = raw.split(/^---\s*$/m);
  return parts.length >= 3 ? parts.slice(2).join('---').trim() : raw.trim();
}

/** Resolve the idea text the architect interviews on: --idea-file, else the body
 *  of the corpus manifest at _queue/done/<run-handle>.md. */
function resolveIdea() {
  if (IDEA_FILE) {
    const p = resolve(FORGE_ROOT, IDEA_FILE);
    if (!existsSync(p)) { log(`--idea-file not found: ${p}`); return null; }
    return readFileSync(p, 'utf8').trim();
  }
  const done = join(FORGE_ROOT, '_queue', 'done', `${RUN_HANDLE}.md`);
  if (existsSync(done)) return manifestBody(readFileSync(done, 'utf8'));
  log(`no --idea-file and no corpus manifest at _queue/done/${RUN_HANDLE}.md — provide an idea`);
  return null;
}

/** Clean prior run state for a project so a fresh spine run starts clean: remove
 *  the project's non-terminal queue manifests + their preserved worktrees + stale
 *  `_logs` dirs + stale architect sessions. The corpus `done/` archive is left
 *  intact. Scoped to PROJECT (the verify ground has no other in-flight work), so a
 *  stale architect worktree can't be reused by the S9 hand-off logic. */
function cleanProjectRunState(project, repoPath) {
  const ids = new Set();
  for (const q of ['pending', 'in-flight', 'failed', 'ready-for-review']) {
    const dir = join(FORGE_ROOT, '_queue', q);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const raw = readFileSync(join(dir, f), 'utf8');
      if (manifestField(raw, 'project') === project) {
        ids.add(f.replace(/\.md$/, ''));
        rmSync(join(dir, f), { force: true });
      }
    }
  }
  const logsRoot = join(FORGE_ROOT, '_logs');
  for (const id of ids) {
    rmSync(join(FORGE_ROOT, '_worktrees', id), { recursive: true, force: true });
    if (existsSync(logsRoot)) {
      for (const name of readdirSync(logsRoot)) {
        if (name === id || name.endsWith(`_${id}`)) rmSync(join(logsRoot, name), { recursive: true, force: true });
      }
    }
  }
  // Drop stale architect sessions so the fresh interview starts clean.
  const archRoot = join(repoPath, '_architect');
  rmSync(archRoot, { recursive: true, force: true });
  if (existsSync(join(repoPath, '.git'))) git(repoPath, ['worktree', 'prune']);
  log(`cleaned prior run state for project ${project} (${ids.size} non-terminal manifest(s) + worktrees + stale logs + architect sessions)`);
}

/** Routine tier: hard-reset the harness repo to BASE_SHA (guarded against a dirty tree). */
function resetRepo(repoPath) {
  if (!existsSync(join(repoPath, '.git'))) { log(`reset skipped — ${repoPath} is not a git repo`); return true; }
  const dirty = git(repoPath, ['status', '--porcelain']).stdout;
  if (dirty && !FORCE_RESET) {
    log(`refusing to reset ${repoPath}: uncommitted changes (pass --force-reset to override)`);
    return false;
  }
  log(`resetting ${repoPath} → ${BASE_SHA} (reset --hard + clean -fd)`);
  if (!git(repoPath, ['reset', '--hard', BASE_SHA]).ok) { log('reset failed'); return false; }
  git(repoPath, ['clean', '-fd']);
  return true;
}

/** Sum cost_usd across the cycle's event log. */
function sumCycleCost(cycleId) {
  try {
    let total = 0;
    for (const line of readFileSync(join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (typeof e.cost_usd === 'number') total += e.cost_usd; } catch { /* */ }
    }
    return total;
  } catch { return 0; }
}

/** Work-item completion from the event log: { total, complete, failed }. */
function wiOutcomes(cycleId) {
  const emitted = new Set();
  const ended = new Map(); // wiId -> failed?
  try {
    for (const line of readFileSync(join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const wi = e.metadata?.work_item_id;
      if (typeof wi !== 'string') continue;
      if (e.event_type === 'log' && /work-item-emitted/.test(e.message ?? '')) emitted.add(wi);
      if (e.phase === 'developer-loop' && e.event_type === 'end') ended.set(wi, e.metadata?.status === 'failed');
    }
  } catch { /* */ }
  const total = Math.max(emitted.size, ended.size);
  const complete = [...ended.values()].filter((f) => !f).length;
  const failed = [...ended.values()].filter((f) => f).length;
  return { total, complete, failed };
}

/** Run the project's own test suite post-merge. Prefer the project's declared
 *  quality gate (.forge/project.json quality_gate_cmd) so the gate mirrors what
 *  forge's own dev-loop runs (Go, etc.); fall back to `npm test`. */
function runProjectTests(repoPath) {
  const cfgPath = join(repoPath, '.forge', 'project.json');
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      const cmd = cfg.quality_gate_cmd;
      if (Array.isArray(cmd) && cmd.length > 0) {
        const label = cmd.join(' ').length > 60 ? `${cmd.slice(0, 4).join(' ')}…` : cmd.join(' ');
        log(`running project quality gate in ${repoPath} (${label})…`);
        const r = spawnSync(cmd[0], cmd.slice(1), { cwd: repoPath, encoding: 'utf8', timeout: 15 * 60_000 });
        return { ran: true, ok: r.status === 0, label };
      }
    } catch (e) { log(`.forge/project.json quality_gate_cmd unreadable: ${e.message}`); }
  }
  if (existsSync(join(repoPath, 'package.json'))) {
    log(`running project tests in ${repoPath} (npm test)…`);
    const r = spawnSync('npm', ['test'], { cwd: repoPath, encoding: 'utf8', timeout: 5 * 60_000 });
    return { ran: true, ok: r.status === 0, label: 'npm test' };
  }
  return { ran: false, ok: true, label: '' };
}

/** Live demo evidence (the demos-are-visual-evidence policy): the merged cycle's
 *  demo.json must carry a checkpoint with a real REST GET (liveEvidence.url +
 *  expectedFields) — not just a test-name table. The unifier writes demo.json into
 *  the cycle log artifacts. */
function liveEvidenceFromDemo(cycleId) {
  const demoPath = join(FORGE_ROOT, '_logs', cycleId, 'artifacts', 'demo.json');
  if (!existsSync(demoPath)) return { present: false, reason: 'no demo.json in cycle artifacts' };
  try {
    const demo = JSON.parse(readFileSync(demoPath, 'utf8'));
    const cps = Array.isArray(demo.checkpoints) ? demo.checkpoints : [];
    const live = cps.find((c) => c && c.liveEvidence && c.liveEvidence.url);
    if (live) {
      const m = live.liveEvidence.method ?? 'GET';
      return { present: true, reason: `live_api checkpoint → ${m} ${String(live.liveEvidence.url).slice(0, 64)}…` };
    }
    return { present: false, reason: 'demo.json has no checkpoint with liveEvidence.url' };
  } catch (e) { return { present: false, reason: `demo.json unreadable: ${e.message}` }; }
}

/** Read the project's declared `releaseProcess` from `.forge/project.json`, or
 *  null when the project did not opt into the release flow. */
function releaseProcessFromConfig(repoPath) {
  const cfgPath = join(repoPath, '.forge', 'project.json');
  if (!existsSync(cfgPath)) return null;
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    return cfg.releaseProcess ?? null;
  } catch { return null; }
}

/** WS-A gate (release-bearing cycles only): assert the full release loop fired —
 *  a DRAFT changelog reached the PR, the finalised (versioned) entry was committed
 *  on the branch, and the terminal `release.json` record exists. Mirrors
 *  liveEvidenceFromDemo's shape (present + reason). */
function releaseEvidence(repoPath, cycleId, releaseProcess) {
  const changelogPath = releaseProcess.changelogPath ?? 'CHANGELOG.md';
  const changelogAbs = join(repoPath, changelogPath);
  if (!existsSync(changelogAbs)) {
    return { present: false, reason: `changelog ${changelogPath} absent on merged tree` };
  }
  const changelog = readFileSync(changelogAbs, 'utf8');
  // The unifier seeds a DRAFT under `## [Unreleased]`; the finaliser promotes it
  // to a versioned `## [X.Y.Z] - <date>` heading. A finalised release-bearing
  // cycle shows the versioned heading on the merged tree.
  const hasVersioned = /^##\s*\[\d+\.\d+\.\d+[^\]]*\]/m.test(changelog);
  if (!hasVersioned) {
    return { present: false, reason: `no finalised (versioned) changelog heading in ${changelogPath}` };
  }
  // The terminal record the release-finalize phase writes.
  const releaseJson = join(FORGE_ROOT, '_logs', cycleId, 'artifacts', 'release.json');
  if (!existsSync(releaseJson)) {
    return { present: false, reason: 'no release.json terminal record in cycle artifacts' };
  }
  let version = null;
  try { version = JSON.parse(readFileSync(releaseJson, 'utf8')).version ?? null; } catch { /* */ }
  return { present: true, reason: `finalised changelog + release.json (version ${version ?? 'n/a'})` };
}

/** Reflect-writes-central-brain gate (S8/F3/ADR-035): the reflector writes the
 *  project brain to brain/projects/<project>/themes/. A merged spine run must touch
 *  (create or update) at least one theme there during this run (mtime ≥ runStartMs).
 *  This is the property the old harness left unproven — it killed the bridge before
 *  reflector.end. */
function reflectWroteBrainTheme(project, runStartMs) {
  const dir = join(FORGE_ROOT, 'brain', 'projects', project, 'themes');
  if (!existsSync(dir)) return { present: false, reason: `no central themes dir ${dir}` };
  const touched = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .filter((x) => x.mtime >= runStartMs)
    .sort((a, b) => b.mtime - a.mtime);
  if (touched.length) return { present: true, reason: `${touched.length} theme(s) written this run (e.g. ${touched[0].f})` };
  return { present: false, reason: `no theme in ${dir} written/updated since run start` };
}

/** The ADR 022 + S9 gate: outcome-only assertions (merge / dev-loop / tests / cost
 *  / reflect-writes-brain), plus a live-evidence check for live-resource projects
 *  and a release-evidence check when the project declares `releaseProcess`. */
function assessOutcomes({ finalStatus, cost, repoPath, cycleId, initiativeId, project, runStartMs }) {
  const wi = wiOutcomes(cycleId);
  const tests = runProjectTests(repoPath);
  const checks = [
    // The manifest landing in _queue/done/ is the AUTHORITATIVE merge signal — the bridge's
    // /api/cycles status read is unreliable once the cycle has completed + moved terminal (it
    // returned null even on cleanly-merged cycles). Accept either signal.
    { name: 'cycle reached merge (done)', pass: finalStatus === 'done' || existsSync(join(FORGE_ROOT, '_queue', 'done', `${initiativeId}.md`)), detail: finalStatus === 'done' ? 'finalStatus=done' : (existsSync(join(FORGE_ROOT, '_queue', 'done', `${initiativeId}.md`)) ? 'manifest in _queue/done/ (merged; bridge status unread post-merge)' : `finalStatus=${finalStatus}, manifest not in done/`) },
    { name: 'dev-loop completed N/N work items', pass: wi.total > 0 && wi.complete === wi.total && wi.failed === 0, detail: `${wi.complete}/${wi.total} complete, ${wi.failed} failed` },
    { name: 'project tests green post-merge', pass: tests.ok, detail: tests.ran ? (tests.ok ? `${tests.label} passed` : `${tests.label} FAILED`) : 'no test command — skipped' },
    { name: `cost under ceiling ($${COST_CEILING})`, pass: cost <= COST_CEILING, detail: `$${cost.toFixed(2)} / $${COST_CEILING}` },
  ];
  // S9: the reflect stage (3rd spine flow) must write the central project brain.
  const rb = reflectWroteBrainTheme(project, runStartMs);
  checks.push({ name: 'reflect wrote central project brain', pass: rb.present, detail: rb.reason });
  // Live-resource projects: assert the demo carries real REST evidence, so a
  // green-unit-gate-but-no-live-proof cycle fails the gate (demos-are-visual-evidence).
  if (REQUIRE_LIVE_EVIDENCE) {
    const le = liveEvidenceFromDemo(cycleId);
    checks.push({ name: 'live demo evidence present (REST GET)', pass: le.present, detail: le.reason });
  }
  // WS-A: release-bearing projects must prove the full release loop fired
  // (draft → finalised changelog committed → release.json record). Gated on
  // the project actually declaring `releaseProcess` — a non-release project is
  // unaffected (the check is not added).
  const releaseProcess = releaseProcessFromConfig(repoPath);
  if (releaseProcess) {
    const re = releaseEvidence(repoPath, cycleId, releaseProcess);
    checks.push({ name: 'release finalised (changelog + release.json)', pass: re.present, detail: re.reason });
  }
  return { checks, wi };
}

async function startWatch() {
  // Reuse existing forge watch on 4124/4123 if up; else spawn.
  const probe = async (url) => {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 500);
      const res = await fetch(url, { signal: c.signal });
      clearTimeout(t);
      return res.ok;
    } catch { return false; }
  };
  // Reuse-existing-watch optimization (PRESERVED, M7-7): probe the bridge
  // health endpoint + the UI homepage; only spawn fresh if either is absent.
  if ((await probe('http://127.0.0.1:4123/api/health')) && (await probe('http://localhost:4124/'))) {
    log('reusing existing forge studio on 4124/4123');
    return { proc: null, uiUrl: 'http://localhost:4124', bridgeUrl: 'http://127.0.0.1:4123' };
  }
  // M7-7: spawn the canonical `forge studio` launcher; detect readiness via its
  // deterministic 'forge-studio-ready {json}' stdout line (no log-scraping).
  return new Promise((res, rej) => {
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open'],
      { cwd: FORGE_ROOT, env: forgeSpawnEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    // Track from SPAWN, not from ready: a boot-timeout rejection must still
    // let the fatal handler kill what was spawned (the half-booted studio
    // already holds ports 4123/4124).
    activeWatchProc = proc;
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
          if (bridgeUrl && uiUrl) {
            settled = true;
            // Keep streaming the watch's output into the run log — a watch
            // that dies mid-run otherwise takes its dying words with it
            // (2026-07-11: bridge vanished between hand-off and approve with
            // zero diagnostic trail).
            const tee = (chunk) => {
              for (const l of chunk.toString().split('\n')) {
                if (l.trim()) log(`[watch] ${l}`);
              }
            };
            proc.stdout.off('data', onData); proc.stderr.off('data', onData);
            proc.stdout.on('data', tee); proc.stderr.on('data', tee);
            proc.on('exit', (code, signal) => log(`[watch] EXITED code=${code} signal=${signal}`));
            res({ proc, uiUrl, bridgeUrl });
            return;
          }
        } catch { /* not the signal line */ }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rej);
    // 120s: a cold `next dev` recompile after UI changes can far exceed 30s.
    // On timeout, kill what we spawned — the half-booted studio HOLDS the
    // port, and rejecting without killing it strands a zombie that blocks
    // every subsequent run (2026-07-11 R3).
    setTimeout(() => {
      if (settled) return;
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch { /* */ } }
      rej(new Error(`forge studio not ready within 120s; spawned watch killed. Last output:\n${buf.slice(-2000)}`));
    }, 120000);
  });
}

/** Health-probe the watch bridge; restart it if it died mid-run. The bridge
 *  is stateless over disk, so a restart is safe — but it must be LOUD, since
 *  a silently-vanishing watch is how approve/finalize/reflect get lost. */
async function ensureWatch(watch) {
  try {
    const r = await fetch(`${watch.bridgeUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (r.ok) return watch;
  } catch { /* dead — fall through to restart */ }
  log('!! watch bridge is DOWN mid-run — restarting it (state is disk-backed, safe)…');
  try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* already gone */ }
  const fresh = await startWatch();
  activeWatchProc = fresh.proc;
  return fresh;
}

function stopWatch(proc) {
  if (!proc) return Promise.resolve();
  return new Promise((res) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; res(); };
    proc.on('exit', done);
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* */ }
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* */ } done(); }, 3000);
  });
}

function startServe() {
  // FORGE_SKIP_CONTRACT_CHECK=1: bypass the preflight hard-clause check in
  // validateClaimable for the routine-tier harness, where the corpus repo is
  // reset to a frozen SHA that deliberately fails C2 scratch-hygiene. This
  // harness tests ENGINE EXECUTION, not project onboarding — the contract gate
  // is orthogonal here. Flow-validity + zero-gate structural checks are never
  // skipped (they fire before the env is consulted in claim-validator.ts).
  log('contract-readiness claim check skipped (routine-tier execution test)');
  return spawn(
    process.execPath,
    ['--experimental-strip-types', 'orchestrator/cli.ts', 'serve', '--once'],
    {
      cwd: FORGE_ROOT,
      env: forgeSpawnEnv({ FORGE_SKIP_CONTRACT_CHECK: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
}

async function captureFrame(page, name) {
  const seq = String((captureFrame._n = (captureFrame._n ?? 0) + 1)).padStart(2, '0');
  const path = join(FRAMES_DIR, `${seq}-${name}.png`);
  try {
    await page.screenshot({ path, fullPage: true });
    log(`✓ frame ${seq}-${name}`);
  } catch (err) {
    log(`✗ frame ${seq}-${name}: ${err.message}`);
  }
}

async function getPhaseStates(page) {
  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-phase][data-phase-status]'));
    const states = {};
    for (const r of rows) {
      const phase = r.getAttribute('data-phase');
      const status = r.getAttribute('data-phase-status');
      if (phase && status && !(phase in states)) states[phase] = status;
    }
    return states;
  });
}

async function cycleStatusFromBridge(bridgeUrl, cycleId) {
  try {
    const res = await fetch(`${bridgeUrl}/api/cycles`);
    if (!res.ok) return null;
    const body = await res.json();
    const all = [...(body.live ?? []), ...(body.recent ?? [])];
    const match = all.find((c) => c.cycleId === cycleId);
    return match?.status ?? null;
  } catch { return null; }
}

/**
 * autoApprove — the harness's deliberate, explicit approve. POSTs an
 * 'approve' verdict to the bridge's /api/verdict (the SAME surface the
 * operator clicks in the Studio UI). M7-5 (ADR-031): replaces the old
 * `forge review --approve` CLI shell-out — the bridge is the operator API
 * now, and its approve path (mergePullRequest + finalizeMergedReadyForReview)
 * is a strict superset of the deleted cmdReviewApprove (ADR-021/023).
 *
 * NO-AUTO-APPROVE INVARIANT (ADR-023) intact: approval is still NOT automatic
 * — it requires either an operator UI click or this explicit harness call.
 * Only the transport changed (CLI → bridge POST); the outcome is identical.
 *
 * POST shape: bridge base url + 'content-type' + the required 'x-forge-csrf'
 * anti-CSRF header (the bridge rejects any non-GET lacking it with a 403 —
 * see ui-bridge.ts). This call carried the header from the start; M7-5 also
 * corrected postSendBack, which had been omitting it (and thus 403-ing).
 */
async function autoApprove(bridgeUrl, initiativeId) {
  log(`auto-approving cycle (POST ${bridgeUrl}/api/verdict approve)…`);
  const payload = {
    initiativeId,
    kind: 'approve',
    rationale:
      'auto-approved by scripts/verify-cycle.mjs (verification cycle — see initiative manifest)',
  };
  try {
    const res = await fetch(`${bridgeUrl}/api/verdict`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forge-csrf': '1',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    if (res.ok) {
      log(`auto-approve verdict accepted (${res.status}): ${text.slice(0, 120)}`);
      return true;
    }
    log(`auto-approve verdict rejected (${res.status}): ${text.slice(0, 200)}`);
    return false;
  } catch (err) {
    log(`auto-approve POST failed: ${err.message}`);
    return false;
  }
}

/**
 * captureDecisionReviewEvaluation — navigate to the unified review gate
 * (/artifact?run=<cycleId>&type=verdict&mode=gate, M7-3/ADR-031), wait for the
 * demo-comparison and demo-evaluation sections, then frame.
 * Returns to the dashboard URL after the frame so subsequent navigation
 * isn't broken. Defensive: if the selectors don't appear, captures anyway
 * and logs — never throws.
 */
async function captureDecisionReviewEvaluation(page, uiUrl, cycleId) {
  try {
    await page.goto(`${uiUrl}/artifact?run=${encodeURIComponent(cycleId)}&type=verdict&mode=gate`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15_000 })
      .catch(() => log('decision-review-evaluation: [data-section="demo-comparison"] not found within 15 s'));
    await page.waitForSelector('[data-section="demo-evaluation"]', { timeout: 5_000 })
      .catch(() => log('decision-review-evaluation: [data-section="demo-evaluation"] not found within 5 s'));
  } catch (err) {
    log(`decision-review-evaluation: navigation error — ${err.message}`);
  }
  await captureFrame(page, 'decision-review-evaluation');
}

/**
 * postSendBack — POST a send-back verdict to /api/verdict.
 * Returns true on HTTP 2xx, false (+ logs) on any error.
 * The payload conforms exactly to the /api/verdict handler:
 *   { initiativeId, kind: 'send-back', rationale, acceptanceCriteria: [{given,when,then}] }
 * Carries the required 'x-forge-csrf' header (same as autoApprove) — without
 * it the bridge's CSRF guard 403s every non-GET request (ui-bridge.ts).
 */
async function postSendBack(bridgeUrl, initiativeId) {
  const payload = {
    initiativeId,
    kind: 'send-back',
    rationale: 'Automated send-back by scripts/verify-cycle.mjs --send-back: verifying the unifier re-run path (ADR 026). Please re-examine the implementation for any issues raised in acceptance criteria and address them.',
    acceptanceCriteria: [
      {
        given: 'the send-back cycle completes a second unifier pass',
        when: 'the re-run unifier reviews the branch output',
        then: 'it produces an updated demo and the cycle reaches ready-for-review again',
      },
    ],
  };
  try {
    const res = await fetch(`${bridgeUrl}/api/verdict`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forge-csrf': '1',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => '');
    if (res.ok) {
      log(`send-back verdict accepted (${res.status}): ${text.slice(0, 120)}`);
      return true;
    }
    log(`send-back verdict rejected (${res.status}): ${text.slice(0, 200)} — skipping send-back`);
    return false;
  } catch (err) {
    log(`send-back POST failed: ${err.message} — skipping send-back`);
    return false;
  }
}

async function cycleEventCountFromLog(cycleId) {
  const logFile = join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl');
  try {
    const raw = readFileSync(logFile, 'utf8');
    return raw.split('\n').filter((l) => l.length > 0).length;
  } catch { return 0; }
}

function writeIndexHtml() {
  const frames = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).sort();
  const rows = frames.map((f) => `<figure><img src="frames/${f}" loading="lazy"/><figcaption><code>${f}</code></figcaption></figure>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>forge verify cycle — ${RUN_HANDLE}</title>
<style>
  body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui,sans-serif;margin:32px auto;max-width:1640px;padding:0 24px}
  h1,h2{letter-spacing:.4px}
  video{width:100%;max-width:1400px;border:1px solid #30363d;border-radius:8px;background:#000}
  figure{margin:24px 0;padding:0}
  figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
  figure figcaption{color:#8b949e;font-family:ui-monospace,Menlo,monospace;padding-top:6px;font-size:12px}
  code{color:#d2a8ff}
</style></head><body>
<h1>forge — verification cycle recording</h1>
<p><code>${RUN_HANDLE}</code></p>
<h2>video</h2>
<video src="cycle.webm" controls autoplay muted loop></video>
<h2>frames</h2>
${rows}
</body></html>`;
  writeFileSync(join(OUT_DIR, 'index.html'), html);
}

// ---- S9 spine drive: architect → develop → reflect via the bridge ----------

/** POST JSON to the bridge with the anti-CSRF header; returns { ok, status, body }. */
async function bridgePost(bridgeUrl, path, payload) {
  try {
    const res = await fetch(`${bridgeUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.message } };
  }
}

function readJsonFileSafe(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch { return null; }
}

/** Discover the architect-promoted initiative for a project: the newest manifest
 *  in _queue/pending with flow_id: forge-architect. Returns { initiativeId, cycleId }. */
function discoverPromotedInitiatives(project) {
  // The live scheduler can claim a promoted manifest (pending → in-flight)
  // faster than our post-commit poll runs, so scan both states. Returns ALL
  // of the session's promoted initiatives (a roadmap-shaped plan promotes
  // several dependent manifests at once), oldest-first.
  return ['pending', 'in-flight'].flatMap((state) => {
    const dir = join(FORGE_ROOT, '_queue', state);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ id: f.replace(/\.md$/, ''), raw: readFileSync(join(dir, f), 'utf8') }))
      .filter((x) => manifestField(x.raw, 'project') === project && manifestField(x.raw, 'flow_id') === 'forge-architect')
      .map((x) => ({ initiativeId: x.id, cycleId: manifestField(x.raw, 'cycle_id'), createdAt: manifestField(x.raw, 'created_at') ?? '' }));
  }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

/**
 * Stage 1 — drive the REAL interactive architect through the bridge: start the
 * session with the initiative idea, auto-answer each interview round, then approve
 * the PLAN GATE. Returns the discovered { initiativeId, sessionId, cycleId }.
 */
async function driveArchitect(page, watch, { project, idea, repoPath }) {
  log('stage 1/3 — architect: POST /api/architect/start…');
  const start = await bridgePost(watch.bridgeUrl, '/api/architect/start', {
    project,
    idea,
    projectRepoPath: repoPath,
  });
  if (!start.ok || !start.body?.sessionId) {
    throw new Error(`architect start failed (${start.status}): ${JSON.stringify(start.body)}`);
  }
  const sessionId = start.body.sessionId;
  const sessionDir = join(repoPath, '_architect', sessionId);
  log(`architect session ${sessionId}`);

  // Best-effort: focus the dedicated architect screen for the frame gallery.
  try {
    await page.goto(`${watch.uiUrl}/architect/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' });
  } catch { /* */ }

  const deadline = Date.now() + 25 * 60_000; // generous — the architect runs the real SDK
  let answeredRounds = new Set();
  let sawInterview = false;
  while (Date.now() < deadline) {
    const status = readJsonFileSafe(join(sessionDir, 'status.json'));
    const phase = status?.phase;
    if (phase === 'awaiting-verdict') { log('architect drafted a PLAN — at the plan gate'); break; }
    if (phase === 'rejected') throw new Error('architect session was rejected');
    if (phase === 'awaiting-answers' && !answeredRounds.has(status.round)) {
      const qs = readJsonFileSafe(join(sessionDir, 'questions.json')) ?? [];
      const answers = (Array.isArray(qs) ? qs : []).map((q) => ({
        question: q.question,
        // Pick the first offered option, else a converge-fast freeform answer.
        answer: q.options?.[0]?.label ?? 'Use your best judgment; proceed with the simplest robust approach that satisfies the constraints.',
      }));
      log(`architect interview round ${status.round}: answering ${answers.length} question(s)`);
      const ans = await bridgePost(watch.bridgeUrl, '/api/architect/answer', { project, sessionId, answers });
      if (!ans.ok) log(`architect answer rejected (${ans.status}): ${JSON.stringify(ans.body)}`);
      answeredRounds.add(status.round);
      if (!sawInterview) { sawInterview = true; await captureFrame(page, 'architect-interview'); }
    }
    await sleep(4000);
  }
  await captureFrame(page, 'architect-awaiting-verdict');

  // Approve the PLAN GATE.
  log('approving the plan gate (POST /api/plan-verdict approve)…');
  const verdict = await bridgePost(watch.bridgeUrl, '/api/plan-verdict', {
    project,
    sessionId,
    kind: 'approve',
    rationale: 'auto-approved by scripts/verify-cycle.mjs (spine verification — plan gate)',
  });
  if (!verdict.ok) throw new Error(`plan-verdict approve failed (${verdict.status}): ${JSON.stringify(verdict.body)}`);

  // The approve spawns a finalize turn (async) that promotes manifests → committed.
  // The completeness critic (ADR 037 era, REFINEMENT-PLAN §6.3) may block the
  // first finalize with findings and re-gate the session at awaiting-verdict;
  // the harness plays the operator's acknowledge role: log the findings and
  // re-approve exactly once (the critic is one-shot per session).
  let committed = false;
  let criticAcknowledged = false;
  const finalizeDeadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < finalizeDeadline) {
    const status = readJsonFileSafe(join(sessionDir, 'status.json'));
    if (status?.phase === 'committed') { committed = true; break; }
    if (status?.phase === 'rejected') throw new Error('architect session rejected during finalize');
    const findings = status?.completenessCritic?.findings ?? [];
    if (status?.phase === 'awaiting-verdict' && findings.length > 0 && !criticAcknowledged) {
      criticAcknowledged = true;
      log(`completeness critic blocked finalize with ${findings.length} finding(s):`);
      for (const f of findings) log(`  - [${f.severity}] ${f.gap}`);
      log('re-approving to acknowledge (one-shot critic semantics)…');
      const ack = await bridgePost(watch.bridgeUrl, '/api/plan-verdict', {
        project,
        sessionId,
        kind: 'approve',
        rationale: 'auto-acknowledge of completeness-critic findings by scripts/verify-cycle.mjs (spine verification)',
      });
      if (!ack.ok) throw new Error(`critic-acknowledge re-approve failed (${ack.status}): ${JSON.stringify(ack.body)}`);
    }
    await sleep(3000);
  }
  if (!committed) throw new Error('architect never reached committed after plan approval');

  // Plan-everything-before-kickoff: one architect session may promote N
  // dependent initiatives; the spine must drive ALL of them, not cands[0].
  const inits = discoverPromotedInitiatives(project);
  if (inits.length === 0) throw new Error(`no architect-promoted manifest found in _queue for ${project}`);
  for (const init of inits) {
    if (!init.cycleId) throw new Error(`promoted manifest ${init.initiativeId} has no cycle_id (DEC-2 threading broken)`);
    log(`architect promoted ${init.initiativeId} (cycle_id ${init.cycleId})`);
  }
  await captureFrame(page, 'plan-approved');
  return { initiatives: inits, sessionId };
}

/** Stage 2 hand-off — POST /api/develop/start to repoint the initiative onto
 *  forge-develop (same cycle_id, reusing the architect worktree + work items).
 *  plan-everything-before-kickoff: the endpoint is now batch-shaped
 *  ({initiativeIds: string[]} -> {ok, results}); this caller sends a single-
 *  id batch and unwraps the one result. */
async function handoffToDevelop(bridgeUrl, initiativeIds) {
  log(`hand-off — POST /api/develop/start [${initiativeIds.join(', ')}]…`);
  const r = await bridgePost(bridgeUrl, '/api/develop/start', { initiativeIds });
  if (!r.ok) throw new Error(`develop start failed (${r.status}): ${JSON.stringify(r.body)}`);
  const results = r.body?.results ?? [];
  for (const result of results) {
    if (!result.ok) throw new Error(`develop start failed for ${result.initiativeId}: ${JSON.stringify(result)}`);
    log(`develop run enqueued: ${result.initiativeId} (cycle_id ${result.cycleId ?? '?'})`);
  }
  return results;
}

/** Spawn `forge serve --once` for one spine stage, capturing phase-transition
 *  frames while it runs, and resolve when it exits. */
async function runServeStage(page, label) {
  log(`spawning forge serve --once (${label})…`);
  const serve = startServe();
  serve.stdout.on('data', (d) => process.stdout.write(d));
  serve.stderr.on('data', (d) => process.stderr.write(d));
  const EXITED = Symbol('serve-exited');
  const end = new Promise((res) => serve.on('exit', () => res(EXITED)));
  const seen = new Map();
  const poll = (async () => {
    while (true) {
      const r = await Promise.race([end, sleep(2000)]);
      if (r === EXITED) break;
      try {
        const states = await getPhaseStates(page);
        for (const [phase, status] of Object.entries(states)) {
          if (seen.get(phase) !== status) {
            seen.set(phase, status);
            await captureFrame(page, `${label}-${phase}-${status}`);
          }
        }
      } catch { /* */ }
    }
  })();
  await end;
  await poll;
  log(`serve --once (${label}) exited`);
}

/** Wait for the reflector to FINISH (reflector.end in the cycle log). The bridge
 *  fires finalize→reflect detached after the verdict approve; the old harness tore
 *  the bridge down ~3s later, killing reflect mid-start. Bounded; returns true on
 *  reflector.end seen. */
async function waitForReflectorEnd(cycleId, deadlineMs) {
  const logFile = join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl');
  let sawStart = false;
  while (Date.now() < deadlineMs) {
    try {
      for (const line of readFileSync(logFile, 'utf8').split('\n')) {
        if (!line.includes('"skill":"reflector"')) continue;
        if (!sawStart && line.includes('"event_type":"start"')) { sawStart = true; log('reflector.start seen — waiting for reflector.end…'); }
        if (line.includes('"event_type":"end"')) { log('reflector.end seen — reflection complete'); return true; }
      }
    } catch { /* log not yet present */ }
    await sleep(3000);
  }
  log('reflector.end not seen before deadline');
  return false;
}

let activeWatchProc = null;

async function main() {
  const runStartMs = Date.now();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  // Pre-run: resolve the idea, clean prior state, reset the repo (routine).
  log(`spine drive · project=${PROJECT} handle=${RUN_HANDLE} ceiling=$${COST_CEILING}${BASE_SHA ? ` base=${BASE_SHA}` : ''}${SEND_BACK ? ' send-back=yes' : ''}${REQUIRE_LIVE_EVIDENCE ? ' live-evidence=required' : ''}`);
  const repoPath = projectRepoPath();
  const idea = resolveIdea();
  if (!idea) process.exit(1);
  cleanProjectRunState(PROJECT, repoPath);
  if (BASE_SHA) {
    if (!resetRepo(repoPath)) process.exit(1);
  } else {
    // Greenfield tier: a prior --base-sha run leaves local main frozen weeks
    // behind origin — branching from it makes every PR unmergeable on GitHub
    // (2026-07-11 R5: fresh feature, conflict anyway). Sync main first.
    const clean = git(repoPath, ['status', '--porcelain']).stdout === '';
    if (clean) {
      git(repoPath, ['fetch', 'origin']);
      git(repoPath, ['checkout', 'main']);
      const ff = git(repoPath, ['merge', '--ff-only', 'origin/main']);
      log(ff.ok ? 'no --base-sha: synced local main to origin/main (greenfield tier)' : `WARNING: local main could not fast-forward to origin/main — ${ff.stderr.slice(0, 200)}`);
    } else {
      log('WARNING: project repo dirty — skipping main sync (pass --force-reset with --base-sha to reset)');
    }
  }

  log('starting forge watch…');
  let watch = await startWatch();
  activeWatchProc = watch.proc;
  log(`watch ready: ui=${watch.uiUrl} bridge=${watch.bridgeUrl}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1400 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1400, height: 1400 } },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

  await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('main')?.getAttribute('data-page-ready') === 'true',
    undefined,
    { timeout: 15000 },
  ).catch(() => log('page-ready timed out'));
  await captureFrame(page, 'initial-load');

  // ===== STAGE 1: architect (interview + plan gate) → forge-architect serve =====
  // Plan-everything-before-kickoff: the session may promote N dependent
  // initiatives; ONE serve pass decomposes them all (the dependency gate is
  // flow_id-aware — decompose flows never wait on prerequisite merges).
  const { initiatives } = await driveArchitect(page, watch, { project: PROJECT, idea, repoPath });
  await runServeStage(page, 'architect');
  // Focus the first threaded cycle in the dashboard for the frame gallery.
  try {
    await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`[data-cycle-id="${initiatives[0].cycleId}"]`, { timeout: 10000 });
    await page.locator(`[data-cycle-id="${initiatives[0].cycleId}"]`).first().click();
    await captureFrame(page, 'decision-pm-work-items');
  } catch (err) { log(`cycle focus failed: ${err.message}`); }

  // ===== STAGE 2+3: batch hand-off → serve/approve loop until all initiatives land =====
  // All initiatives enqueue for develop at once; the scheduler's merge-gate
  // holds dependents until their prerequisite reaches done/. Each serve pass
  // builds whatever is eligible; each ready-for-review cycle gets the verdict
  // approve; the loop repeats until every initiative merged (or passes run out).
  await handoffToDevelop(watch.bridgeUrl, initiatives.map((i) => i.initiativeId));
  const remaining = new Map(initiatives.map((i) => [i.initiativeId, i]));
  const approveFailures = new Map();
  let sendBackDone = !SEND_BACK;
  const maxPasses = initiatives.length + 2;
  for (let pass = 1; remaining.size > 0 && pass <= maxPasses; pass++) {
    await runServeStage(page, `develop-pass-${pass}`);
    await sleep(2000);
    watch = await ensureWatch(watch);
    for (const init of [...remaining.values()]) {
      let status = await cycleStatusFromBridge(watch.bridgeUrl, init.cycleId);
      log(`develop status for ${init.initiativeId} after pass ${pass}: ${status}`);
      if (status === 'done') { remaining.delete(init.initiativeId); continue; }
      if (status !== 'ready-for-review') continue;
      await captureFrame(page, `after-develop-${init.initiativeId}`);

      // Optional send-back pass (ADR-026 in-place drain) — first initiative only.
      if (!sendBackDone) {
        sendBackDone = true;
        await captureDecisionReviewEvaluation(page, watch.uiUrl, init.cycleId);
        log('posting send-back verdict to /api/verdict…');
        const sendBackOk = await postSendBack(watch.bridgeUrl, init.initiativeId);
        if (sendBackOk) {
          await captureFrame(page, 'decision-send-back');
          await runServeStage(page, 'sendback-drain');
          await sleep(2000);
          try {
            await page.goto(`${watch.uiUrl}/artifact?run=${encodeURIComponent(init.cycleId)}&type=verdict&mode=gate`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15_000 })
              .catch(() => log('decision-re-review: [data-section="demo-comparison"] not found within 15 s'));
          } catch (err) { log(`decision-re-review: navigation error — ${err.message}`); }
          await captureFrame(page, 'decision-re-review');
          try { await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' }); } catch { /* */ }
          status = await cycleStatusFromBridge(watch.bridgeUrl, init.cycleId);
          if (status !== 'ready-for-review') continue;
        } else {
          log('send-back was skipped (POST failed); continuing to auto-approve');
        }
      }

      const ok = await autoApprove(watch.bridgeUrl, init.initiativeId);
      if (!ok) {
        // A rejected verdict (e.g. gh merge conflict) will not fix itself by
        // re-running serve passes — retry once (transient bridge blips), then
        // abort loudly instead of burning passes against a 409.
        approveFailures.set(init.initiativeId, (approveFailures.get(init.initiativeId) ?? 0) + 1);
        if ((approveFailures.get(init.initiativeId) ?? 0) >= 2) {
          throw new Error(`verdict approve failed twice for ${init.initiativeId} — aborting (see [watch] mergePullRequest output above)`);
        }
        continue;
      }
      // The bridge merges + runs finalize/reflect detached — wait for
      // reflector.end before counting this initiative as landed (S9).
      log(`verdict approved for ${init.initiativeId} — waiting for finalize + reflector.end…`);
      await waitForReflectorEnd(init.cycleId, Date.now() + 12 * 60_000);
      await sleep(2000);
      await captureFrame(page, `final-state-${init.initiativeId}`);
      remaining.delete(init.initiativeId);
    }
  }
  if (remaining.size > 0) {
    log(`unfinished initiatives after ${maxPasses} serve passes: ${[...remaining.keys()].join(', ')}`);
  }

  // Collect gate inputs BEFORE tearing the bridge down — cycleStatusFromBridge
  // against a stopped watch reads null and fails the merge gate spuriously.
  const perInit = [];
  for (const init of initiatives) {
    const finalStatus = await cycleStatusFromBridge(watch.bridgeUrl, init.cycleId);
    const finalEvents = await cycleEventCountFromLog(init.cycleId);
    const cost = sumCycleCost(init.cycleId);
    const { checks, wi } = assessOutcomes({
      finalStatus, cost, repoPath,
      cycleId: init.cycleId, initiativeId: init.initiativeId,
      project: PROJECT, runStartMs,
    });
    perInit.push({ init, finalStatus, finalEvents, cost, checks, wi });
  }

  // Capture the video path BEFORE closing.
  let videoSrc = null;
  try { videoSrc = await page.video()?.path(); } catch { /* */ }

  await browser.close();
  await stopWatch(watch.proc);

  if (videoSrc && existsSync(videoSrc)) {
    const dest = join(OUT_DIR, 'cycle.webm');
    try {
      renameSync(videoSrc, dest);
      log(`video → ${dest}`);
    } catch (err) {
      log(`failed to move video: ${err.message}`);
    }
  } else {
    log('no video file produced');
  }

  writeIndexHtml();
  log(`index → ${join(OUT_DIR, 'index.html')}`);

  // ---- gate: outcome assertions (ADR 022 + S9 reflect-writes-brain) ----
  // Per-initiative assertions (collected pre-teardown above) plus an
  // aggregate cost-ceiling check (the ceiling is per RUN; a multi-initiative
  // plan shares one budget).
  const totalCost = perInit.reduce((acc, r) => acc + r.cost, 0);
  const checks = perInit.flatMap((r) =>
    r.checks.map((c) => ({ ...c, name: perInit.length > 1 ? `${r.init.initiativeId}: ${c.name}` : c.name })));
  checks.push({
    name: 'aggregate cost under ceiling',
    pass: totalCost <= COST_CEILING,
    detail: `$${totalCost.toFixed(2)} across ${perInit.length} initiative(s) ≤ $${COST_CEILING}`,
  });
  const gatePassed = checks.every((c) => c.pass);

  log('--- verdict (3-stage spine) ---');
  for (const c of checks) log(`  ${c.pass ? '✓' : '✗'} ${c.name} — ${c.detail}`);

  const summary = {
    runHandle: RUN_HANDLE,
    initiatives: perInit.map((r) => ({
      initiativeId: r.init.initiativeId,
      cycleId: r.init.cycleId,
      finalStatus: r.finalStatus,
      totalEvents: r.finalEvents,
      costUsd: Number(r.cost.toFixed(4)),
      workItems: r.wi,
    })),
    project: PROJECT,
    baseSha: BASE_SHA,
    costUsd: Number(totalCost.toFixed(4)),
    costCeilingUsd: COST_CEILING,
    checks,
    gate: gatePassed ? 'pass' : 'fail',
    framesCaptured: readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).length,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  log(`summary → ${join(OUT_DIR, 'summary.json')}`);
  log(`final: ${perInit.map((r) => `${r.init.initiativeId}=${r.finalStatus}`).join(', ')}, $${totalCost.toFixed(2)}, ${summary.framesCaptured} frames`);
  log(`done — gate ${gatePassed ? 'PASS ✓' : 'FAIL ✗'}`);
  if (!gatePassed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[verify] fatal');
  console.error(err.stack ?? err.message);
  // Never leave the spawned watch behind: an orphaned scheduler from a dead
  // harness keeps claiming _queue work with STALE loaded modules (2026-07-11
  // incident — a pre-merge `forge serve` orphan ran the PM on hours-old code).
  if (activeWatchProc && !activeWatchProc.killed) {
    try { activeWatchProc.kill('SIGTERM'); } catch { /* best effort */ }
  }
  process.exit(1);
});
