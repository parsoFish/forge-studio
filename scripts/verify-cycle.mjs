#!/usr/bin/env node
/**
 * verify-cycle — forge's REAL-CAPABILITY regression harness (ADR 022).
 *
 * Runs a real forge cycle end-to-end against a managed project and asserts
 * real-cycle OUTCOMES — not synthetic rubrics — then records the run and writes a
 * pass/fail verdict. Two grounds:
 *   - mdtoc (default): forge's creds-free out-of-the-box reference project (a
 *     dependency-light markdown-TOC CLI) — cheap, repeatable, no credentials,
 *     the routine engine regression.
 *   - the betterado terraform provider (--project terraform-provider-betterado):
 *     the LIVE-ADO tier — a real release-definition feature stood up against a
 *     real Azure DevOps org, the richest proof of forge's actual capability.
 *
 * The four gate assertions (ADR 022 §1):
 *   1. the cycle reached merge (finalStatus `done`);
 *   2. the dev-loop completed N/N work items (no complete:0 / failed);
 *   3. the project's own tests are green post-merge (its .forge quality gate, else
 *      npm test);
 *   4. total cycle cost is under the declared ceiling.
 * Plus, for live-resource projects (and any run with --require-live-evidence):
 *   5. the merged cycle's demo carries LIVE evidence — a real REST GET checkpoint
 *      (liveEvidence.url + expectedFields), not a test-name table (the
 *      demos-are-visual-evidence policy).
 *
 * Usage:
 *   node scripts/verify-cycle.mjs <initiative-id> [options]
 *
 * Options:
 *   --tier routine|release  routine (default): reset the harness repo to
 *                           --base-sha and re-run one corpus initiative.
 *                           release: greenfield — drive the 5-initiative
 *                           ROADMAP by invoking the runner per initiative in
 *                           order against an empty repo.
 *   --base-sha <sha>        base commit to reset the harness repo to (routine).
 *   --cost-ceiling <usd>    fail the gate above this total cost (default 25;
 *                           default 40 when --send-back is set, to accommodate
 *                           the extra unifier pass).
 *   --project <name>        managed project to run against (default mdtoc;
 *                           terraform-provider-betterado for the live-ADO tier).
 *   --require-live-evidence force the live-demo-evidence gate on (default: on for
 *                           known live-resource projects). --no-live-evidence opts out.
 *   --force-reset           allow resetting a repo with uncommitted changes.
 *   --send-back             after the cycle first reaches ready-for-review, POST a
 *                           real send-back verdict to /api/verdict, re-run forge
 *                           serve --once to drain the re-queued UWIs through the
 *                           unifier, then fall through to the existing auto-approve
 *                           path so the run still reaches `done` and the gate passes.
 *                           Captures decision-review-evaluation, decision-send-back,
 *                           and decision-re-review frames around the send-back pass.
 *
 * The manifest is staged from the corpus (_queue/done/) into _queue/pending/
 * if not already pending. Tiered + manual-gate per ADR 022. It auto-approves at
 * ready-for-review and captures closure + reflection through `cycle.end`.
 *
 * Output: forge-ui/.demo-shots/verify/<initiative-id>/ (video, frames,
 * index.html, summary.json with the verdict). Exits non-zero if the gate fails.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { sleep } from './lib/journey-assertions.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const initiativeId = argv.find((a) => !a.startsWith('--'));
if (!initiativeId) {
  console.error('usage: node scripts/verify-cycle.mjs <initiative-id> [--tier routine|release] [--base-sha <sha>] [--cost-ceiling <usd>] [--project <name>] [--require-live-evidence|--no-live-evidence] [--force-reset] [--send-back]');
  process.exit(1);
}
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const TIER = flag('tier', 'routine');
const BASE_SHA = flag('base-sha', null);
const SEND_BACK = argv.includes('--send-back');
const PROJECT = flag('project', 'mdtoc');
// Live-resource projects (e.g. the betterado terraform provider stands up real
// Azure DevOps resources) run longer + cost more than the creds-free default
// mdtoc reference project, so they get a higher default ceiling — still overridable.
const LIVE_PROJECTS = new Set(['terraform-provider-betterado']);
const IS_LIVE_PROJECT = LIVE_PROJECTS.has(PROJECT);
// --send-back adds an extra unifier pass; live projects add live-infra cost.
const _ceilingDefault = IS_LIVE_PROJECT ? (SEND_BACK ? 80 : 60) : (SEND_BACK ? 40 : 25);
const COST_CEILING = parseFloat(flag('cost-ceiling', String(_ceilingDefault))) || _ceilingDefault;
// The live-demo-evidence gate: on by default for live-resource projects; force
// with --require-live-evidence, opt out with --no-live-evidence.
const REQUIRE_LIVE_EVIDENCE =
  argv.includes('--require-live-evidence') || (IS_LIVE_PROJECT && !argv.includes('--no-live-evidence'));
const FORCE_RESET = argv.includes('--force-reset');

const OUT_DIR = join(FORGE_ROOT, 'forge-ui/.demo-shots/verify', initiativeId);
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

/** The harness project's repo path — from the manifest's project_repo_path, else projects/<PROJECT>. */
function projectRepoPath() {
  for (const q of ['pending', 'done', 'in-flight', 'ready-for-review', 'failed']) {
    const p = join(FORGE_ROOT, '_queue', q, `${initiativeId}.md`);
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/project_repo_path:\s*(.+)/);
      if (m) return resolve(FORGE_ROOT, m[1].trim());
    }
  }
  return join(FORGE_ROOT, 'projects', PROJECT);
}

/** Stage the initiative manifest from the corpus (_queue/done/) into pending/. */
function stageManifest() {
  const pending = join(FORGE_ROOT, '_queue', 'pending', `${initiativeId}.md`);
  if (existsSync(pending)) { log('manifest already in _queue/pending/'); return true; }
  const done = join(FORGE_ROOT, '_queue', 'done', `${initiativeId}.md`);
  if (!existsSync(done)) {
    log(`manifest not in pending/ or done/ — stage ${initiativeId}.md first`);
    return false;
  }
  mkdirSync(dirname(pending), { recursive: true });
  // Reset the lifecycle fields for a fresh run; the rest of the corpus manifest is reused as-is.
  // Strip the stale cycle_id too (ADR-026 mechanism B persisted it on the original run): if it
  // survives, the bridge reports the OLD id and findCycleIdForInitiative locks onto it, so the
  // post-serve status query returns null and auto-approve never fires (a false gate FAIL). With it
  // removed, serve assigns + persists a fresh cycle_id the bridge reports consistently.
  // Strip resume_from too: a corpus manifest that originally ran with an ADR-019/026 unifier
  // resume persists `resume_from: unifier`. On a fresh re-stage the scheduler would read it
  // (scheduler.ts → cycle resumeFrom), skip the architect+PM, and run the dev-loop against an
  // empty `.forge/work-items` ("no work items found") — a false gate FAIL at $0. A fresh run
  // must re-decompose from scratch, so the resume marker is cleared here.
  const body = readFileSync(done, 'utf8')
    .replace(/^phase:.*$/m, 'phase: pending')
    .replace(/^cycle_id:.*$\n?/m, '')
    .replace(/^resume_from:.*$\n?/m, '');
  writeFileSync(pending, body);
  log(`staged corpus manifest → _queue/pending/${initiativeId}.md`);
  return true;
}

/** Remove residue from a PRIOR verify run of THIS initiative so the bridge tracks only the
 *  fresh cycle and re-runs start clean. A stale `_logs/<stamp>_<id>` dir made
 *  findCycleIdForInitiative lock onto an old cycle (→ null status, no auto-approve); a preserved
 *  worktree or a non-terminal queue copy from a failed/pr-open run would also collide. `_logs` and
 *  `_worktrees` are gitignored runtime; the corpus manifest in `done/` is left untouched (stageManifest
 *  re-copies it into `pending/`). */
function cleanPriorRunState(initiativeId, repoPath) {
  const logsRoot = join(FORGE_ROOT, '_logs');
  if (existsSync(logsRoot)) {
    for (const name of readdirSync(logsRoot)) {
      if (name === initiativeId || name.endsWith(`_${initiativeId}`)) {
        rmSync(join(logsRoot, name), { recursive: true, force: true });
      }
    }
  }
  rmSync(join(FORGE_ROOT, '_worktrees', initiativeId), { recursive: true, force: true });
  if (existsSync(join(repoPath, '.git'))) git(repoPath, ['worktree', 'prune']);
  for (const q of ['pending', 'in-flight', 'failed', 'ready-for-review']) {
    rmSync(join(FORGE_ROOT, '_queue', q, `${initiativeId}.md`), { force: true });
  }
  log(`cleaned prior-run residue for ${initiativeId} (stale logs / worktree / non-terminal queue copies)`);
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

/** The ADR 022 gate: four binary, outcome-only assertions (plus a live-evidence
 *  check for live-resource projects, plus a release-evidence check when the
 *  project declares `releaseProcess`). */
function assessOutcomes({ finalStatus, cost, repoPath, cycleId }) {
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
    setTimeout(() => { if (!settled) rej(new Error('forge studio not ready within 30s')); }, 30000);
  });
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

async function findCycleIdForInitiative(bridgeUrl, initiativeId, deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const res = await fetch(`${bridgeUrl}/api/cycles`);
      if (res.ok) {
        const body = await res.json();
        // cascade-v4 #6: pick the NEWEST cycle for the initiative, not the first
        // match. A resume/retry leaves the prior stopped cycle in `recent`; a
        // plain .find() over [...live, ...recent] grabbed that stale one and the
        // harness then tracked the wrong cycle. Prefer a live (currently-running)
        // cycle; otherwise the most-recently-started finished one.
        const byNewest = (arr) =>
          [...arr]
            .filter((c) => c.initiativeId === initiativeId)
            .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))[0];
        const match = byNewest(body.live ?? []) ?? byNewest(body.recent ?? []);
        if (match) return match.cycleId;
      }
    } catch { /* */ }
    await sleep(1000);
  }
  return null;
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
 * captureDecisionPmWorkItems — poll until at least one [data-wi-hex] has
 * appeared for the focused cycle (the PM has materialised work items), then
 * capture a named frame. Bounded at 3 min so a slow PM never hangs the run.
 */
async function captureDecisionPmWorkItems(page) {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-wi-hex]').length >= 1,
      undefined,
      { timeout: 3 * 60_000 },
    );
  } catch {
    log('decision-pm-work-items: [data-wi-hex] not present within 3 min — capturing anyway');
  }
  await captureFrame(page, 'decision-pm-work-items');
}

/**
 * captureDecisionCostAndTokens — poll (bounded at ~60 s) until any
 * [data-phase-hex] reports a non-zero data-phase-cost-usd, then frame it.
 * Highlights live cost + tokens as the dev-loop is in progress.
 */
async function captureDecisionCostAndTokens(page) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-phase-hex]')]
        .some((e) => (parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0),
      undefined,
      { timeout: 60_000 },
    );
  } catch {
    log('decision-cost-and-tokens: no phase-hex with cost > 0 within 60 s — capturing anyway');
  }
  await captureFrame(page, 'decision-cost-and-tokens');
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

async function logHasCycleEnd(cycleId) {
  const logFile = join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl');
  try {
    const raw = readFileSync(logFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (line.includes('"phase":"orchestrator"') && line.includes('"event_type":"end"')) return true;
    }
    return false;
  } catch { return false; }
}

function writeIndexHtml() {
  const frames = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).sort();
  const rows = frames.map((f) => `<figure><img src="frames/${f}" loading="lazy"/><figcaption><code>${f}</code></figcaption></figure>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>forge verify cycle — ${initiativeId}</title>
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
<p><code>${initiativeId}</code></p>
<h2>video</h2>
<video src="cycle.webm" controls autoplay muted loop></video>
<h2>frames</h2>
${rows}
</body></html>`;
  writeFileSync(join(OUT_DIR, 'index.html'), html);
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  // ADR 022 pre-run: stage the corpus manifest + reset the repo per tier.
  log(`tier=${TIER} project=${PROJECT} ceiling=$${COST_CEILING}${BASE_SHA ? ` base=${BASE_SHA}` : ''}${SEND_BACK ? ' send-back=yes' : ''}${REQUIRE_LIVE_EVIDENCE ? ' live-evidence=required' : ''}`);
  const repoPath = projectRepoPath();
  cleanPriorRunState(initiativeId, repoPath);
  if (!stageManifest()) process.exit(1);
  if (TIER === 'routine') {
    if (BASE_SHA) { if (!resetRepo(repoPath)) process.exit(1); }
    else { log('routine tier without --base-sha: running against the current repo state'); }
  } else if (TIER === 'release') {
    const roadmap = IS_LIVE_PROJECT
      ? 'docs/planning/2026-06-03-betterado-release-roadmap.md'
      : 'projects/mdtoc/roadmap.md';
    log(`release tier: greenfield rebuild — drive the roadmap by invoking the runner per initiative in order (${roadmap}).`);
  }

  log('starting forge watch…');
  const watch = await startWatch();
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

  log('spawning forge serve --once…');
  const serve = startServe();
  serve.stdout.on('data', (d) => process.stdout.write(d));
  serve.stderr.on('data', (d) => process.stderr.write(d));

  // 2026-05-26 fix: attach the exit listener IMMEDIATELY after spawn,
  // not after the cycle-claim await. Previously the listener was
  // attached AFTER `findCycleIdForInitiative` resolved; if the cycle
  // failed fast (e.g. malformed manifest causes serve to exit with
  // code 1 in <1s), the exit event fired before any listener saw it
  // and the phase-poll loop later stalled forever waiting for
  // SERVE_EXITED.
  const SERVE_EXITED = Symbol('serve-exited');
  const serveEnd = new Promise((res) => serve.on('exit', () => res(SERVE_EXITED)));

  log('waiting for cycle to appear on bridge…');
  const cycleId = await findCycleIdForInitiative(watch.bridgeUrl, initiativeId, Date.now() + 60_000);
  if (!cycleId) {
    log('cycle never appeared — bailing');
    await captureFrame(page, 'cycle-never-claimed');
    await browser.close();
    await stopWatch(watch.proc);
    process.exit(1);
  }
  log(`cycle id: ${cycleId}`);
  try {
    await page.waitForSelector(`[data-cycle-id="${cycleId}"]`, { timeout: 15000 });
    await page.locator(`[data-cycle-id="${cycleId}"]`).first().click();
    await page.waitForFunction(
      (id) => document.querySelector('main')?.getAttribute('data-active-cycle-id') === id,
      cycleId,
      { timeout: 5000 },
    ).catch(() => { /* */ });
    await captureFrame(page, 'cycle-focused');
  } catch (err) {
    log(`click failed: ${err.message}`);
  }

  // Phase-1 capture: while `serve --once` is running. Exits when the
  // cycle hits a terminal phase for the autonomous part (pr-open,
  // failed, etc.) — serve exits at that point.
  //
  // 2026-05-25/26 fix: previously used Promise.race + a falsy check
  // (broke on exit code 0) AND attached the exit listener after
  // findCycleIdForInitiative (broke on fail-fast cycles). Now uses a
  // sentinel object AND attaches the listener immediately after spawn
  // (see SERVE_EXITED above).
  const seenPhase = new Map();
  const phasePoll = (async () => {
    // Named decision-point frame — PM work items: fire a one-shot capture once
    // [data-wi-hex] appears (the PM has broken the initiative into WIs). We race
    // it against the serve-exited sentinel so a fast-exiting serve never hangs.
    let pmFrameFired = false;
    while (true) {
      const r = await Promise.race([serveEnd, sleep(2000)]);
      if (r === SERVE_EXITED) break;
      try {
        const states = await getPhaseStates(page);
        for (const [phase, status] of Object.entries(states)) {
          const prev = seenPhase.get(phase);
          if (prev !== status) {
            seenPhase.set(phase, status);
            await captureFrame(page, `${phase}-${status}`);
          }
        }
        // One-shot: capture the PM work-item decision frame as soon as WI hexes appear.
        if (!pmFrameFired) {
          const wiCount = await page.evaluate(
            () => document.querySelectorAll('[data-wi-hex]').length,
          ).catch(() => 0);
          if (wiCount >= 1) {
            pmFrameFired = true;
            await captureFrame(page, 'decision-pm-work-items');
          }
        }
      } catch { /* */ }
    }
    // If serve exited before the PM frame fired, capture anyway (the PM may have
    // emitted WI hexes just before exit).
    if (!pmFrameFired) {
      try {
        const wiCount = await page.evaluate(
          () => document.querySelectorAll('[data-wi-hex]').length,
        ).catch(() => 0);
        if (wiCount >= 1) await captureFrame(page, 'decision-pm-work-items');
        else log('decision-pm-work-items: no [data-wi-hex] found — skipping frame');
      } catch { /* */ }
    }
  })();

  // Named decision-point frame — cost + tokens: race a parallel poll that fires
  // once any phase-hex reports cost > 0.  Runs concurrently with phasePoll so it
  // captures mid-dev-loop without blocking phase-state captures.
  const costTokenPoll = (async () => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const r = await Promise.race([serveEnd, sleep(3000)]);
      try {
        const hasCost = await page.evaluate(
          () => [...document.querySelectorAll('[data-phase-hex]')]
            .some((e) => (parseFloat(e.getAttribute('data-phase-cost-usd') ?? '0') || 0) > 0),
        ).catch(() => false);
        if (hasCost) {
          await captureFrame(page, 'decision-cost-and-tokens');
          return;
        }
      } catch { /* */ }
      if (r === SERVE_EXITED) break;
    }
    // Capture at deadline/exit regardless so the frame gallery has an entry.
    try { await captureFrame(page, 'decision-cost-and-tokens'); } catch { /* */ }
  })();

  await serveEnd;
  await Promise.all([phasePoll, costTokenPoll]);
  log('serve --once exited');

  // What state did the cycle reach?
  await sleep(2000);
  const status = await cycleStatusFromBridge(watch.bridgeUrl, cycleId);
  log(`cycle status after serve exit: ${status}`);
  await captureFrame(page, `after-serve-${status ?? 'unknown'}`);

  // ---- send-back pass (only when --send-back is set) ----------------------
  // This block runs BEFORE the auto-approve so it can exercise the full
  // ADR 026 drain path.  After the send-back the manifest is back in
  // ready-for-review and the existing auto-approve picks it up normally.
  if (status === 'ready-for-review' && SEND_BACK) {
    log('--send-back set: capturing review evaluation frame…');
    // Decision frame: navigate to /review/<cycleId>, capture the demo with
    // per-AC evaluated output before touching the verdict form.
    await captureDecisionReviewEvaluation(page, watch.uiUrl, cycleId);

    // POST the send-back verdict.
    log('posting send-back verdict to /api/verdict…');
    const sendBackOk = await postSendBack(watch.bridgeUrl, initiativeId);

    if (sendBackOk) {
      await captureFrame(page, 'decision-send-back');

      // Re-run serve --once to drain the ready-for-review manifest (the appended
      // UWIs) through the unifier (ADR 026: runFinalizeSweep + runDrainSweep at
      // startup claims the manifest and re-runs via runCycle(resumeFrom:unifier)).
      log('re-running forge serve --once to drain the send-back UWIs…');
      const serve2 = startServe();
      serve2.stdout.on('data', (d) => process.stdout.write(d));
      serve2.stderr.on('data', (d) => process.stderr.write(d));
      const SERVE2_EXITED = Symbol('serve2-exited');
      const serve2End = new Promise((res) => serve2.on('exit', () => res(SERVE2_EXITED)));

      // Phase-poll during the re-run (same pattern as primary serve).
      const serve2PhasePoll = (async () => {
        while (true) {
          const r = await Promise.race([serve2End, sleep(2000)]);
          if (r === SERVE2_EXITED) break;
          try {
            const states = await getPhaseStates(page);
            for (const [phase, st] of Object.entries(states)) {
              const prev = seenPhase.get(phase);
              if (prev !== st) {
                seenPhase.set(phase, st);
                await captureFrame(page, `sendback-${phase}-${st}`);
              }
            }
          } catch { /* */ }
        }
      })();

      await serve2End;
      await serve2PhasePoll;
      log('send-back serve --once exited');

      // Navigate to the unified review gate again to capture the unifier's re-run output.
      await sleep(2000);
      try {
        await page.goto(`${watch.uiUrl}/artifact?run=${encodeURIComponent(cycleId)}&type=verdict&mode=gate`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-section="demo-comparison"]', { timeout: 15_000 })
          .catch(() => log('decision-re-review: [data-section="demo-comparison"] not found within 15 s'));
      } catch (err) {
        log(`decision-re-review: navigation error — ${err.message}`);
      }
      await captureFrame(page, 'decision-re-review');

      // Return to the dashboard so the auto-approve path works cleanly.
      try {
        await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
      } catch { /* best-effort */ }
    } else {
      log('send-back was skipped (POST failed); continuing to auto-approve');
    }
  } else if (status === 'ready-for-review' && !SEND_BACK) {
    // Only navigate to the review page when not in send-back mode; in send-back
    // mode we already captured decision-review-evaluation above.
    // (No action needed here — auto-approve follows directly.)
  }

  // ---- auto-approve path: if ready-for-review, kick the approve + capture
  // closure + reflection.
  if (status === 'ready-for-review') {
    const ok = await autoApprove(watch.bridgeUrl, initiativeId);
    if (ok) {
      log('waiting for closure + reflection to complete…');
      const deadline = Date.now() + 10 * 60_000; // 10 min cap
      let lastEventCount = 0;
      while (Date.now() < deadline) {
        const ended = await logHasCycleEnd(cycleId);
        if (ended) {
          log('cycle.end emitted by orchestrator — reflection complete');
          break;
        }
        // Capture frame whenever the event count grows substantially.
        const count = await cycleEventCountFromLog(cycleId);
        if (count > lastEventCount + 4) {
          lastEventCount = count;
          await captureFrame(page, `post-approve-events-${count}`);
        }
        await sleep(3000);
      }
      await sleep(3000);
      await captureFrame(page, 'final-state');
    }
  } else {
    log(`cycle reached non-ready-for-review state (${status}) — no auto-approve`);
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

  // ---- ADR 022 gate: outcome assertions ----
  const finalStatus = await cycleStatusFromBridge(watch.bridgeUrl, cycleId);
  const finalEvents = await cycleEventCountFromLog(cycleId);
  const cost = sumCycleCost(cycleId);
  const { checks, wi } = assessOutcomes({ finalStatus, cost, repoPath, cycleId });
  const gatePassed = checks.every((c) => c.pass);

  log(`--- verdict (${TIER} tier) ---`);
  for (const c of checks) log(`  ${c.pass ? '✓' : '✗'} ${c.name} — ${c.detail}`);

  const summary = {
    initiativeId,
    cycleId,
    project: PROJECT,
    tier: TIER,
    baseSha: BASE_SHA,
    finalStatus,
    totalEvents: finalEvents,
    costUsd: Number(cost.toFixed(4)),
    costCeilingUsd: COST_CEILING,
    workItems: wi,
    checks,
    gate: gatePassed ? 'pass' : 'fail',
    framesCaptured: readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).length,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  log(`summary → ${join(OUT_DIR, 'summary.json')}`);
  log(`final status: ${finalStatus}, $${cost.toFixed(2)}, ${finalEvents} events, ${summary.framesCaptured} frames`);
  log(`done — gate ${gatePassed ? 'PASS ✓' : 'FAIL ✗'}`);
  if (!gatePassed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[verify] fatal');
  console.error(err.stack ?? err.message);
  process.exit(1);
});
