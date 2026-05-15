/**
 * Before/after comparison demo generator (F-44).
 *
 * Given a project repo and two refs (baseline + changed), materialise both
 * trees, build each, run ONE agent-authored Playwright spec against both,
 * and compose a self-contained `comparison.html` plus a `before/` + `after/`
 * artefact bundle.
 *
 * Decoupled from the review phase by design: it takes (baseRef, changedRef)
 * and produces the bundle. The review phase will call it later; for now it
 * is invocable standalone via `forge demo`.
 *
 * Testable helpers (materialiseWorktree / cleanupWorktreeAt /
 * pairCheckpoints / buildComparisonModel) are exported and unit-tested.
 * `generateComparisonDemo` is the heavy orchestrator (spawns the SDK agent,
 * runs Playwright, starts servers) and is exercised via the live
 * trafficGame validation run, not unit tests — same split as cycle.ts.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import {
  renderComparisonHtml,
  type DemoCheckpoint,
  type DemoComparisonModel,
  type DemoBuildStatus,
} from './demo-html.ts';
import {
  DEMO_SCRIPT_ALLOWED_TOOLS,
  DEMO_SCRIPT_DISALLOWED_TOOLS,
  DEMO_SCRIPT_MODEL,
  buildDemoScriptSystemPrompt,
  renderDemoScriptUserPrompt,
  tallyToolUse,
  type DemoScriptToolUseSummary,
} from './demo-script.ts';

export type WorktreeAtRef = { path: string; repo: string };

/**
 * `git worktree add --detach <path> <ref>` — materialise a tree at any ref
 * (branch, tag, sha). Detached so we never mutate or need a scratch branch.
 * Throws if the ref is unknown or the path is occupied (caller decides).
 */
export function materialiseWorktree(repo: string, ref: string, path: string): WorktreeAtRef {
  if (!existsSync(resolve(repo, '.git'))) {
    throw new Error(`materialiseWorktree: ${repo} is not a git repository`);
  }
  mkdirSync(resolve(path, '..'), { recursive: true });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', path, ref], {
    stdio: 'pipe',
  });
  return { path, repo };
}

/**
 * Tear down a detached demo worktree. Idempotent and best-effort — a
 * missing worktree is fine. No branch to delete (detached).
 */
export function cleanupWorktreeAt(handle: WorktreeAtRef): void {
  try {
    execFileSync('git', ['-C', handle.repo, 'worktree', 'remove', '--force', handle.path], {
      stdio: 'pipe',
    });
  } catch {
    /* already gone */
  }
  try {
    execFileSync('git', ['-C', handle.repo, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }
  // Belt-and-braces: if `worktree remove` left the dir (e.g. it was never a
  // registered worktree), drop it so a re-run doesn't hit "path occupied".
  if (existsSync(handle.path)) {
    try {
      rmSync(handle.path, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  }
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function imageMime(file: string): string {
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/**
 * Per-screenshot inline cap. Self-contained HTML embeds every screenshot as
 * a base64 data URI; an oversized capture (a runaway agent, a huge retina
 * full-page shot) would balloon the HTML + Node heap. Above the cap we drop
 * the inline (renderer shows a "no capture" placeholder) rather than emit a
 * tens-of-MB file.
 */
const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;

/** Read an image file into a base64 data URI; null if unreadable or > cap. */
export function imageToDataUri(file: string): string | null {
  try {
    const b = readFileSync(file);
    if (b.length > MAX_INLINE_IMAGE_BYTES) {
      process.stderr.write(
        `[demo] ${file} is ${(b.length / 1048576).toFixed(1)} MB (> ${
          MAX_INLINE_IMAGE_BYTES / 1048576
        } MB cap) — omitting from the self-contained report\n`,
      );
      return null;
    }
    return `data:${imageMime(file)};base64,${b.toString('base64')}`;
  } catch {
    return null;
  }
}

export type CheckpointSpec = {
  /** Stable label; the spec names screenshots `<label>.png`. */
  label: string;
  caption: string;
  beforeNote?: string;
  afterNote?: string;
};

/**
 * Pair screenshots captured under `beforeDir` and `afterDir` by filename.
 * `specs` provides agent-authored captions/notes and, crucially, the
 * canonical order + the full set of expected checkpoints (so a checkpoint
 * captured in only one run still renders, with a "no capture" placeholder
 * on the missing side).
 *
 * A screenshot file `foo.png` pairs to the checkpoint whose label is `foo`.
 * Unknown screenshots (no matching spec) are appended in filename order with
 * the filename as the caption, so nothing is silently dropped.
 */
export function pairCheckpoints(
  beforeDir: string,
  afterDir: string,
  specs: CheckpointSpec[],
): DemoCheckpoint[] {
  const listImages = (dir: string): Map<string, string> => {
    const m = new Map<string, string>();
    if (!existsSync(dir)) return m;
    for (const f of readdirSync(dir).sort()) {
      const lower = f.toLowerCase();
      const dot = lower.lastIndexOf('.');
      if (dot < 0 || !IMAGE_EXTS.has(lower.slice(dot))) continue;
      m.set(f.slice(0, dot), join(dir, f));
    }
    return m;
  };
  const before = listImages(beforeDir);
  const after = listImages(afterDir);

  const out: DemoCheckpoint[] = [];
  const consumed = new Set<string>();
  for (const s of specs) {
    consumed.add(s.label);
    out.push({
      label: s.label,
      caption: s.caption,
      beforeImage: before.has(s.label) ? imageToDataUri(before.get(s.label)!) : null,
      afterImage: after.has(s.label) ? imageToDataUri(after.get(s.label)!) : null,
      beforeNote: s.beforeNote,
      afterNote: s.afterNote,
    });
  }
  // Any captured screenshot with no spec entry — surface it rather than drop.
  const extras = new Set<string>([...before.keys(), ...after.keys()].filter((k) => !consumed.has(k)));
  for (const label of [...extras].sort()) {
    out.push({
      label,
      caption: label,
      beforeImage: before.has(label) ? imageToDataUri(before.get(label)!) : null,
      afterImage: after.has(label) ? imageToDataUri(after.get(label)!) : null,
    });
  }
  return out;
}

export type DemoManifest = {
  /** One-line essence of the initiative's behavioural change. */
  essence: string;
  /** Headline title for the report. */
  title: string;
  checkpoints: CheckpointSpec[];
  acceptanceCriteria?: string[];
};

/**
 * Read the agent-authored `demo-manifest.json` from the demo working dir.
 * Falls back to a minimal manifest if absent/malformed so the orchestrator
 * never hard-fails on a sloppy agent — the HTML still renders whatever
 * screenshots exist.
 */
export function loadDemoManifest(demoWorkDir: string, fallbackTitle: string): DemoManifest {
  const p = join(demoWorkDir, 'demo-manifest.json');
  if (existsSync(p)) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<DemoManifest>;
      if (parsed && typeof parsed.essence === 'string' && Array.isArray(parsed.checkpoints)) {
        return {
          essence: parsed.essence,
          title: parsed.title ?? fallbackTitle,
          checkpoints: parsed.checkpoints,
          acceptanceCriteria: parsed.acceptanceCriteria,
        };
      }
    } catch {
      /* fall through to fallback */
    }
  }
  return {
    essence:
      'Automated before/after capture. The agent did not supply a demo manifest, so checkpoints are derived from captured screenshots.',
    title: fallbackTitle,
    checkpoints: [],
  };
}

export type BuildComparisonModelInput = {
  manifest: DemoManifest;
  project: string;
  initiativeId?: string;
  baseRef: string;
  changedRef: string;
  beforeDir: string;
  afterDir: string;
  baselineBuild: DemoBuildStatus;
  changedBuild: DemoBuildStatus;
  beforeVideo?: string | null;
  afterVideo?: string | null;
  diffStat?: string;
  generatedAt?: string;
};

/** Pure assembly of the renderer model from collected artefacts. */
export function buildComparisonModel(input: BuildComparisonModelInput): DemoComparisonModel {
  return {
    title: input.manifest.title,
    initiativeId: input.initiativeId,
    project: input.project,
    baseRef: input.baseRef,
    changedRef: input.changedRef,
    essence: input.manifest.essence,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baselineBuild: input.baselineBuild,
    changedBuild: input.changedBuild,
    checkpoints: pairCheckpoints(input.beforeDir, input.afterDir, input.manifest.checkpoints),
    beforeVideo: input.beforeVideo ?? null,
    afterVideo: input.afterVideo ?? null,
    diffStat: input.diffStat,
    acceptanceCriteria: input.manifest.acceptanceCriteria,
  };
}

/** `git diff --stat baseRef..changedRef`, capped, best-effort. */
export function computeDiffStat(repo: string, baseRef: string, changedRef: string): string {
  try {
    const out = execFileSync('git', ['-C', repo, 'diff', '--stat', `${baseRef}..${changedRef}`], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return out.length > 6000 ? `${out.slice(0, 6000)}\n... (truncated)` : out;
  } catch {
    return '';
  }
}

/**
 * Write the final bundle: comparison.html (self-contained) at the bundle
 * root, alongside the already-populated before/ + after/ dirs. Returns the
 * html path.
 */
export function writeComparisonBundle(bundleDir: string, model: DemoComparisonModel): string {
  mkdirSync(bundleDir, { recursive: true });
  const htmlPath = join(bundleDir, 'comparison.html');
  writeFileSync(htmlPath, renderComparisonHtml(model));
  // A short README so the bundle is self-describing in a file listing.
  writeFileSync(
    join(bundleDir, 'README.md'),
    [
      `# Before/after demo — ${model.title}`,
      '',
      `Project: ${model.project}`,
      model.initiativeId ? `Initiative: ${model.initiativeId}` : '',
      `Before: ${model.baseRef}  →  After: ${model.changedRef}`,
      '',
      'Open `comparison.html` in a browser. Screenshots are inlined; videos',
      '(if any) are sibling files under `before/` and `after/`.',
      '',
      model.essence,
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return htmlPath;
}

// ---------------------------------------------------------------------------
// Heavy orchestrator (live-validated, not unit-tested — same split as cycle.ts)
// ---------------------------------------------------------------------------

/**
 * Injectable demo-author agent runner. Default wraps the Claude Agent SDK;
 * tests/bench can pass a stub. Returns telemetry only — the agent's real
 * output is the two files it Writes into `cwd`'s demo working dir.
 */
export type DemoAgentRunner = (params: {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
}) => Promise<{ toolUse: DemoScriptToolUseSummary; costUsd: number }>;

const defaultDemoAgentRunner: DemoAgentRunner = async ({ systemPrompt, userPrompt, cwd }) => {
  const options: Record<string, unknown> = {
    cwd,
    systemPrompt,
    model: DEMO_SCRIPT_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: [...DEMO_SCRIPT_ALLOWED_TOOLS],
    disallowedTools: [...DEMO_SCRIPT_DISALLOWED_TOOLS],
    maxTurns: 40,
    maxBudgetUsd: 1.5,
  };
  const toolUse: DemoScriptToolUseSummary = { brainReads: 0, reads: 0, writes: 0, bashCalls: 0 };
  let costUsd = 0;
  for await (const msg of sdkQuery({ prompt: userPrompt, options }) as AsyncIterable<unknown>) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as {
      type?: string;
      message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
      total_cost_usd?: number;
    };
    if (m.type === 'assistant') {
      tallyToolUse(m.message, toolUse);
      continue;
    }
    if (m.type !== 'result') continue;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    break;
  }
  return { toolUse, costUsd };
};

function sh(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): { ok: boolean; tail: string } {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: timeoutMs,
      env: process.env,
    });
    return { ok: true, tail: out.slice(-800) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const tail = (e.stderr || e.stdout || e.message || 'unknown error').toString().slice(-800);
    return { ok: false, tail };
  }
}

/**
 * Install deps then optionally build. The goal is "make the app runnable",
 * not perfect dependency hygiene — many real projects (e.g. trafficGame's
 * eslint-plugin-import vs eslint@9 peer conflict) fail a strict `npm ci` but
 * run fine with `--legacy-peer-deps`. Fallback chain:
 *   1. npm ci                       (fast, exact, when lockfile is in sync)
 *   2. npm ci --legacy-peer-deps    (peer-dep conflicts only)
 *   3. npm install --legacy-peer-deps (lockfile drift / no lockfile)
 */
function installDeps(treePath: string): { ok: boolean; how: string; tail: string } {
  const hasLock = existsSync(join(treePath, 'package-lock.json'));
  const attempts: Array<{ how: string; args: string[] }> = hasLock
    ? [
        { how: 'npm ci', args: ['ci', '--no-audit', '--no-fund'] },
        { how: 'npm ci --legacy-peer-deps', args: ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'] },
        { how: 'npm install --legacy-peer-deps', args: ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'] },
      ]
    : [
        { how: 'npm install', args: ['install', '--no-audit', '--no-fund'] },
        { how: 'npm install --legacy-peer-deps', args: ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'] },
      ];
  let lastTail = '';
  for (const a of attempts) {
    const r = sh('npm', a.args, treePath, 600_000);
    if (r.ok) return { ok: true, how: a.how, tail: r.tail };
    lastTail = r.tail;
  }
  return { ok: false, how: attempts[attempts.length - 1].how, tail: lastTail };
}

/** Install deps + optional build. Returns a build status. */
function buildTree(treePath: string, runBuild: boolean): DemoBuildStatus {
  const install = installDeps(treePath);
  if (!install.ok) return { ok: false, detail: `dependency install failed (last: ${install.how}): ${install.tail}` };
  if (runBuild) {
    const pkg = readPackageJson(treePath);
    if (pkg?.scripts?.build) {
      const b = sh('npm', ['run', 'build'], treePath, 600_000);
      if (!b.ok) return { ok: false, detail: `npm run build failed: ${b.tail}` };
      return { ok: true, detail: `${install.how} + build ok` };
    }
  }
  return { ok: true, detail: `${install.how} ok` };
}

type PkgJson = { scripts?: Record<string, string> };
function readPackageJson(treePath: string): PkgJson | null {
  try {
    return JSON.parse(readFileSync(join(treePath, 'package.json'), 'utf8')) as PkgJson;
  } catch {
    return null;
  }
}

const CANDIDATE_URLS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:5174',
];

async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/** Candidate ports already answering BEFORE we spawn our server. */
async function ambientUrls(): Promise<Set<string>> {
  const live = await Promise.all(
    CANDIDATE_URLS.map(async (u) => ((await probe(u, 500)) ? u : null)),
  );
  return new Set(live.filter((u): u is string => u !== null));
}

/**
 * Poll for OUR server. `exclude` is the set of ports that were already
 * occupied by unrelated servers before we spawned ours — never latch onto
 * those (HIGH-2: a stray `npm run dev` from another project on :3000 would
 * otherwise capture screenshots of the wrong app silently).
 */
async function waitForServer(timeoutMs: number, exclude: Set<string>): Promise<string | null> {
  const start = Date.now();
  const targets = CANDIDATE_URLS.filter((u) => !exclude.has(u));
  while (Date.now() - start < timeoutMs) {
    for (const url of targets) {
      if (await probe(url, 2000)) return url;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

type ServerHandle = { url: string; stop: () => Promise<void> };

/**
 * Start the project's server (prefer `dev`, else `preview`) detached, poll
 * for it to answer (excluding ambient pre-existing servers), return its URL
 * + an async stop() that signals the process group and waits a short drain
 * so the next sequential run can rebind the same port (HIGH-1).
 */
async function startServer(treePath: string): Promise<ServerHandle | null> {
  const pkg = readPackageJson(treePath);
  const script = pkg?.scripts?.dev ? 'dev' : pkg?.scripts?.preview ? 'preview' : null;
  if (!script) return null;
  const exclude = await ambientUrls();
  const child = spawn('npm', ['run', script], {
    cwd: treePath,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, BROWSER: 'none' },
  });
  // HIGH-3: an unstartable child (npm not on PATH, bad script) emits
  // 'error'; with no listener + unref(), Node throws an uncaught error and
  // bypasses the orchestrator's cleanup finally. Swallow it — stop() and
  // waitForServer already handle the "never came up" path.
  child.on('error', () => {});
  child.unref();
  const stop = async (): Promise<void> => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already dead */
      }
    }
    // Drain: let the OS release the listening socket before the next
    // sequential server tries to bind the same port.
    await new Promise((r) => setTimeout(r, 2500));
  };
  const url = await waitForServer(60_000, exclude);
  if (!url) {
    await stop();
    return null;
  }
  return { url, stop };
}

/**
 * A dedicated Playwright config so the agent's spec runs regardless of the
 * project's own playwright.config.ts (which typically pins `testDir` /
 * custom `projects` / a `webServer` block — all of which would either
 * exclude our spec or fight the orchestrator-managed server). `pwDir` is an
 * IN-TREE directory (`<tree>/.pw-demo`) so the spec's and config's
 * `import '@playwright/test'` resolve against the tree's node_modules —
 * module resolution is relative to the importing file, NOT the npx cwd, so
 * the spec cannot live in the out-of-tree `_work/` dir.
 */
function demoPlaywrightConfig(pwDir: string): string {
  return `import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: ${JSON.stringify(pwDir)},
  testMatch: 'demo.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 60000,
  outputDir: ${JSON.stringify(join(pwDir, '_pw-output'))},
  use: {
    baseURL: process.env.DEMO_BASE_URL,
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`;
}

/**
 * Run the agent-authored spec against a running server, capturing
 * screenshots into `screenshotDir`. The spec + config are copied into an
 * in-tree `.pw-demo/` dir (see demoPlaywrightConfig) so their imports
 * resolve; the dir is removed afterwards. Returns the playwright exit
 * status + a log tail (the orchestrator surfaces this — a green build with
 * a red capture is otherwise invisible).
 */
function runSpec(
  treePath: string,
  demoWorkDir: string,
  baseUrl: string,
  screenshotDir: string,
): { ok: boolean; tail: string } {
  mkdirSync(screenshotDir, { recursive: true });
  const specSrc = join(demoWorkDir, 'demo.spec.ts');
  if (!existsSync(specSrc)) return { ok: false, tail: 'demo.spec.ts missing' };
  const pwDir = join(treePath, '.pw-demo');
  rmSync(pwDir, { recursive: true, force: true });
  mkdirSync(pwDir, { recursive: true });
  writeFileSync(join(pwDir, 'demo.spec.ts'), readFileSync(specSrc, 'utf8'));
  const configPath = join(pwDir, 'playwright.demo.config.ts');
  writeFileSync(configPath, demoPlaywrightConfig(pwDir));
  // Ensure a browser is present (idempotent, cached after first install).
  sh('npx', ['--yes', 'playwright', 'install', 'chromium'], treePath, 300_000);
  try {
    const out = execFileSync(
      'npx',
      ['--yes', 'playwright', 'test', '--config', configPath, '--reporter=line'],
      {
        cwd: treePath,
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 300_000,
        env: {
          ...process.env,
          DEMO_BASE_URL: baseUrl,
          DEMO_SCREENSHOT_DIR: screenshotDir,
          PW_TEST_HTML_REPORT_OPEN: 'never',
        },
      },
    );
    return { ok: true, tail: out.slice(-800) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, tail: ((e.stderr || e.stdout || '') as string).slice(-800) };
  } finally {
    // Never leave the scratch dir in the project tree.
    rmSync(pwDir, { recursive: true, force: true });
  }
}

function firstExisting(treePath: string, rels: string[]): string | null {
  for (const r of rels) if (existsSync(join(treePath, r))) return r;
  return null;
}

function findExampleSpec(treePath: string): string | null {
  // Shallow scan of common test dirs for a *.spec.ts the agent can mirror.
  for (const dir of ['tests', 'e2e', 'test', 'playwright']) {
    const abs = join(treePath, dir);
    if (!existsSync(abs)) continue;
    const hit = walkForSpec(abs, treePath, 3);
    if (hit) return hit;
  }
  return null;
}
function walkForSpec(dir: string, root: string, depth: number): string | null {
  if (depth < 0) return null;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  for (const e of entries.sort()) {
    const abs = join(dir, e);
    if (e.endsWith('.spec.ts') || e.endsWith('.spec.tsx')) {
      return abs.slice(root.length + 1);
    }
  }
  for (const e of entries.sort()) {
    const abs = join(dir, e);
    let isDir = false;
    try {
      // lstat (not readdirSync probe) so a circular symlink
      // (e.g. tests/fixtures -> tests) is NOT followed into infinite
      // recursion within the depth budget.
      isDir = lstatSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) {
      const hit = walkForSpec(abs, root, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

export type GenerateComparisonDemoInput = {
  projectRepoPath: string;
  project: string;
  baseRef: string;
  changedRef: string;
  /** Where the bundle (comparison.html + before/ + after/) is written. */
  outDir: string;
  initiativeId?: string;
  /** Manifest body + acceptance criteria text the agent reads as "intent". */
  brief?: string;
  /** Build before serving (slower, production-ish) vs dev-server only. */
  build?: boolean;
  agentRunner?: DemoAgentRunner;
};

export type GenerateComparisonDemoResult = {
  htmlPath: string;
  bundleDir: string;
  baselineBuild: DemoBuildStatus;
  changedBuild: DemoBuildStatus;
  agentCostUsd: number;
};

/**
 * End-to-end: materialise both trees, have the agent author one spec,
 * run it against each tree, compose the self-contained before/after report.
 * Heavy + side-effecting — validated via the live trafficGame run.
 */
export async function generateComparisonDemo(
  input: GenerateComparisonDemoInput,
): Promise<GenerateComparisonDemoResult> {
  const runner = input.agentRunner ?? defaultDemoAgentRunner;
  const bundleDir = resolve(input.outDir);
  const beforeDir = join(bundleDir, 'before');
  const afterDir = join(bundleDir, 'after');
  const demoWorkDir = join(bundleDir, '_work');
  for (const d of [bundleDir, beforeDir, afterDir, demoWorkDir]) mkdirSync(d, { recursive: true });

  const wtRoot = join(bundleDir, '_trees');
  const baselineWt = { path: join(wtRoot, 'before'), repo: input.projectRepoPath };
  const changedWt = { path: join(wtRoot, 'after'), repo: input.projectRepoPath };
  cleanupWorktreeAt(baselineWt);
  cleanupWorktreeAt(changedWt);

  let baselineBuild: DemoBuildStatus = { ok: false, detail: 'not built' };
  let changedBuild: DemoBuildStatus = { ok: false, detail: 'not built' };
  let agentCostUsd = 0;

  try {
    materialiseWorktree(input.projectRepoPath, input.changedRef, changedWt.path);
    materialiseWorktree(input.projectRepoPath, input.baseRef, baselineWt.path);

    // Brief + diff inputs for the agent.
    const briefPath = join(demoWorkDir, 'brief.md');
    writeFileSync(briefPath, input.brief ?? '(no manifest brief supplied)\n');
    const diffPath = join(demoWorkDir, 'changes.diff');
    writeFileSync(
      diffPath,
      (() => {
        try {
          return execFileSync(
            'git',
            ['-C', input.projectRepoPath, 'diff', `${input.baseRef}..${input.changedRef}`],
            { stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
          );
        } catch {
          return '(diff unavailable)\n';
        }
      })(),
    );

    const exampleSpec = findExampleSpec(changedWt.path);
    const pwConfig = firstExisting(changedWt.path, [
      'playwright.config.ts',
      'playwright.config.js',
    ]);

    // Author the spec.
    const sys = buildDemoScriptSystemPrompt();
    const user = renderDemoScriptUserPrompt({
      project: input.project,
      initiativeId: input.initiativeId,
      demoWorkDir,
      changedTreePath: changedWt.path,
      baseRef: input.baseRef,
      changedRef: input.changedRef,
      briefPath,
      diffPath,
      exampleSpecRelPath: exampleSpec,
      playwrightConfigRelPath: pwConfig,
      serveHint: 'It runs `npm run dev` (falling back to `preview`) and waits for the port.',
    });
    const agentOut = await runner({ systemPrompt: sys, userPrompt: user, cwd: demoWorkDir });
    agentCostUsd = agentOut.costUsd;

    const specPath = join(demoWorkDir, 'demo.spec.ts');
    if (!existsSync(specPath)) {
      throw new Error('demo-author did not produce demo.spec.ts');
    }

    // Run baseline then changed (sequential — frees the port between runs).
    for (const [wt, capDir, which] of [
      [baselineWt, beforeDir, 'baseline'],
      [changedWt, afterDir, 'changed'],
    ] as const) {
      const status = buildTree(wt.path, input.build ?? false);
      if (which === 'baseline') baselineBuild = status;
      else changedBuild = status;
      if (!status.ok) continue; // renderer shows the build banner + no captures
      const server = await startServer(wt.path);
      if (!server) {
        const msg = 'server did not start';
        if (which === 'baseline') baselineBuild = { ok: false, detail: msg };
        else changedBuild = { ok: false, detail: msg };
        continue;
      }
      try {
        const cap = runSpec(wt.path, demoWorkDir, server.url, capDir);
        const shots = existsSync(capDir)
          ? readdirSync(capDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length
          : 0;
        const note =
          shots > 0
            ? `${status.detail}; captured ${shots} screenshot(s)`
            : `${status.detail}; demo spec produced NO screenshots (playwright ${
                cap.ok ? 'exited 0' : 'failed'
              }: ${cap.tail.replace(/\s+/g, ' ').slice(-240)})`;
        if (which === 'baseline') baselineBuild = { ok: status.ok, detail: note };
        else changedBuild = { ok: status.ok, detail: note };
      } finally {
        await server.stop();
      }
    }

    const fallbackTitle = `${input.project} — ${input.baseRef} → ${input.changedRef}`;
    const manifest = loadDemoManifest(demoWorkDir, fallbackTitle);
    const model = buildComparisonModel({
      manifest,
      project: input.project,
      initiativeId: input.initiativeId,
      baseRef: input.baseRef,
      changedRef: input.changedRef,
      beforeDir,
      afterDir,
      baselineBuild,
      changedBuild,
      diffStat: computeDiffStat(input.projectRepoPath, input.baseRef, input.changedRef),
    });
    const htmlPath = writeComparisonBundle(bundleDir, model);
    return { htmlPath, bundleDir, baselineBuild, changedBuild, agentCostUsd };
  } finally {
    cleanupWorktreeAt(baselineWt);
    cleanupWorktreeAt(changedWt);
  }
}

// Re-export the renderer's types so callers depend on one module surface.
export type { DemoComparisonModel, DemoCheckpoint, DemoBuildStatus } from './demo-html.ts';
