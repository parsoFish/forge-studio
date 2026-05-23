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

import { execFileSync } from 'node:child_process';
import {
  existsSync,
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
  type HarnessMetricRow,
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
import {
  buildTree,
  findExampleSpec,
  firstExisting,
  runSpec,
  startServer,
} from './demo-runtime.ts';

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
  /** Stable label; the spec names screenshots `<label>.png`, videos `<label>.webm`. */
  label: string;
  /**
   * `screenshot` (default) — static UI state. `video` — dynamic/temporal
   * behaviour (a running simulation, an animation): a single still of a
   * moving system cannot demonstrate parity, so these are clips. `harness`
   * — behaviour only measurable at the Node/test layer; the orchestrator
   * reruns the manifest's `harness` command in each tree and renders the
   * scraped metrics as a before/after table + parity verdict.
   */
  kind?: 'screenshot' | 'video' | 'harness';
  caption: string;
  beforeNote?: string;
  afterNote?: string;
};

/**
 * Declares how to produce measured before/after metrics by *reusing the
 * project's own measurement test* (e.g. a headless flow/simulation test)
 * rather than re-deriving it. The orchestrator runs `command` in each
 * worktree (cwd = worktree root) and scrapes stdout+stderr with each
 * `metrics[].pattern` (one capture group). It stays project-agnostic: the
 * demo-author — which already reads the project — supplies the command and
 * the regexes by reading that test's emitted output.
 */
export type DemoMetricSpec = {
  label: string;
  /** Regex (string form) with ONE capture group, applied to stdout+stderr. */
  pattern: string;
  /** `float` (default) | `int` | `string`. Drives Δ% + parity computation. */
  kind?: 'float' | 'int' | 'string';
  unit?: string;
  /** Numeric parity tolerance (|Δ%| ≤ this ⇒ within). Default 5. Ignored for strings. */
  deltaTolerancePct?: number;
};

export type DemoHarnessSpec = {
  /** Shell command run in each worktree root (e.g. an un-skipped flow test). */
  command: string;
  /** Extra env merged over process.env (e.g. a flag that un-skips the test). */
  env?: Record<string, string>;
  /** Hard timeout per tree. Default 600_000 ms (flow sims are long-running). */
  timeoutMs?: number;
  metrics: DemoMetricSpec[];
};

const DEFAULT_HARNESS_TIMEOUT_MS = 600_000;

/**
 * Run the harness command in one worktree and scrape its metrics. Tolerant:
 * a non-zero exit or an unmatched pattern yields `null` for that metric, never
 * throws — a harness checkpoint must degrade to an "incomplete" row, not
 * fail the whole demo. Returns raw scraped strings keyed by metric label.
 */
export function runHarness(
  worktreePath: string,
  spec: DemoHarnessSpec,
): Record<string, string | null> {
  let out = '';
  try {
    out = execFileSync('bash', ['-lc', spec.command], {
      cwd: worktreePath,
      env: { ...process.env, ...(spec.env ?? {}) },
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: spec.timeoutMs ?? DEFAULT_HARNESS_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // Capture partial output even on non-zero exit / timeout — the metric
    // lines are often printed before a late assertion fails.
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string };
    out = `${err.stdout ?? ''}\n${err.stderr ?? ''}`;
  }
  const result: Record<string, string | null> = {};
  for (const m of spec.metrics) {
    try {
      const match = new RegExp(m.pattern).exec(out);
      result[m.label] = match && match[1] !== undefined ? match[1].trim() : null;
    } catch {
      result[m.label] = null; // a bad author regex degrades that row only
    }
  }
  return result;
}

/** Pair scraped before/after metric maps into rendered rows (pure). */
export function pairHarnessMetrics(
  specMetrics: DemoMetricSpec[],
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): HarnessMetricRow[] {
  return specMetrics.map((m) => {
    const b = before[m.label] ?? null;
    const a = after[m.label] ?? null;
    const kind = m.kind ?? 'float';
    if (b === null || a === null) {
      return { label: m.label, unit: m.unit, before: b, after: a, deltaPct: null, parity: 'incomplete' };
    }
    if (kind === 'string') {
      return {
        label: m.label,
        unit: m.unit,
        before: b,
        after: a,
        deltaPct: null,
        parity: b === a ? 'match' : 'diverged',
      };
    }
    const bn = Number(b);
    const an = Number(a);
    if (!Number.isFinite(bn) || !Number.isFinite(an)) {
      return {
        label: m.label,
        unit: m.unit,
        before: b,
        after: a,
        deltaPct: null,
        parity: b === a ? 'match' : 'diverged',
      };
    }
    if (bn === an) {
      return { label: m.label, unit: m.unit, before: b, after: a, deltaPct: 0, parity: 'match' };
    }
    const deltaPct = bn === 0 ? (an === 0 ? 0 : 100) : ((an - bn) / Math.abs(bn)) * 100;
    const tol = m.deltaTolerancePct ?? 5;
    return {
      label: m.label,
      unit: m.unit,
      before: b,
      after: a,
      deltaPct,
      parity: Math.abs(deltaPct) <= tol ? 'within' : 'diverged',
    };
  });
}

const VIDEO_EXTS = new Set(['.webm', '.mp4']);

/**
 * Pair captures under `beforeDir` / `afterDir` by filename stem. Screenshots
 * (`<label>.png`) inline as data URIs (self-contained); videos
 * (`<label>.webm`) reference the sibling file relatively (too large to
 * inline). `specs` provides the canonical order, captions, and per-checkpoint
 * `kind`; a checkpoint captured on only one side still renders with a
 * "no capture" placeholder on the missing side. Captures with no matching
 * spec entry are appended (filename as caption) so nothing is silently
 * dropped.
 */
/** Read a `<dir>/<label>.metrics.json` map written by runHarness; {} if absent. */
function readMetricsJson(dir: string, label: string): Record<string, string | null> {
  const p = join(dir, `${label}.metrics.json`);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function pairCheckpoints(
  beforeDir: string,
  afterDir: string,
  specs: CheckpointSpec[],
  harness?: DemoHarnessSpec,
): DemoCheckpoint[] {
  const listBy = (dir: string, exts: Set<string>): Map<string, string> => {
    const m = new Map<string, string>();
    if (!existsSync(dir)) return m;
    for (const f of readdirSync(dir).sort()) {
      const lower = f.toLowerCase();
      const dot = lower.lastIndexOf('.');
      if (dot < 0 || !exts.has(lower.slice(dot))) continue;
      m.set(f.slice(0, dot), f);
    }
    return m;
  };
  const beforeImg = listBy(beforeDir, IMAGE_EXTS);
  const afterImg = listBy(afterDir, IMAGE_EXTS);
  const beforeVid = listBy(beforeDir, VIDEO_EXTS);
  const afterVid = listBy(afterDir, VIDEO_EXTS);

  const mk = (label: string, kind: 'screenshot' | 'video'): DemoCheckpoint => {
    if (kind === 'video') {
      return {
        label,
        kind: 'video',
        caption: label,
        beforeImage: null,
        afterImage: null,
        beforeVideoSrc: beforeVid.has(label) ? `before/${beforeVid.get(label)!}` : null,
        afterVideoSrc: afterVid.has(label) ? `after/${afterVid.get(label)!}` : null,
      };
    }
    return {
      label,
      kind: 'screenshot',
      caption: label,
      beforeImage: beforeImg.has(label) ? imageToDataUri(join(beforeDir, beforeImg.get(label)!)) : null,
      afterImage: afterImg.has(label) ? imageToDataUri(join(afterDir, afterImg.get(label)!)) : null,
    };
  };

  const out: DemoCheckpoint[] = [];
  const consumed = new Set<string>();
  for (const s of specs) {
    consumed.add(s.label);
    const kind = s.kind ?? 'screenshot';
    if (kind === 'harness') {
      const rows = harness
        ? pairHarnessMetrics(
            harness.metrics,
            readMetricsJson(beforeDir, s.label),
            readMetricsJson(afterDir, s.label),
          )
        : [];
      out.push({
        label: s.label,
        kind: 'harness',
        caption: s.caption,
        beforeImage: null,
        afterImage: null,
        metrics: rows,
        beforeNote: s.beforeNote,
        afterNote: s.afterNote,
      });
      continue;
    }
    out.push({ ...mk(s.label, kind), caption: s.caption, beforeNote: s.beforeNote, afterNote: s.afterNote });
  }
  // Captures with no spec entry — surface rather than drop. Infer kind from
  // which capture set the label appears in (video wins if a clip exists).
  const allLabels = new Set<string>([
    ...beforeImg.keys(), ...afterImg.keys(), ...beforeVid.keys(), ...afterVid.keys(),
  ]);
  for (const label of [...allLabels].filter((l) => !consumed.has(l)).sort()) {
    const isVideo = beforeVid.has(label) || afterVid.has(label);
    out.push(mk(label, isVideo ? 'video' : 'screenshot'));
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
  /** Present iff any checkpoint is `kind: 'harness'`. */
  harness?: DemoHarnessSpec;
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
        const harness =
          parsed.harness &&
          typeof parsed.harness.command === 'string' &&
          Array.isArray(parsed.harness.metrics)
            ? parsed.harness
            : undefined;
        return {
          essence: parsed.essence,
          title: parsed.title ?? fallbackTitle,
          checkpoints: parsed.checkpoints,
          acceptanceCriteria: parsed.acceptanceCriteria,
          harness,
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
    checkpoints: pairCheckpoints(
      input.beforeDir,
      input.afterDir,
      input.manifest.checkpoints,
      input.manifest.harness,
    ),
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

    // Load the manifest up front so we know which checkpoints are video
    // (their clips must be harvested from Playwright's outputDir before the
    // scratch dir is cleaned). Reused for the model after the runs.
    const fallbackTitle = `${input.project} — ${input.baseRef} → ${input.changedRef}`;
    const manifest = loadDemoManifest(demoWorkDir, fallbackTitle);
    const videoLabels = manifest.checkpoints
      .filter((c) => c.kind === 'video')
      .map((c) => c.label);
    const harnessLabels = manifest.checkpoints
      .filter((c) => c.kind === 'harness')
      .map((c) => c.label);
    const hasMediaCheckpoints = manifest.checkpoints.some(
      (c) => (c.kind ?? 'screenshot') !== 'harness',
    );

    // Run baseline then changed (sequential — frees the port between runs).
    for (const [wt, capDir, which] of [
      [baselineWt, beforeDir, 'baseline'],
      [changedWt, afterDir, 'changed'],
    ] as const) {
      const status = buildTree(wt.path, input.build ?? false);
      if (which === 'baseline') baselineBuild = status;
      else changedBuild = status;
      if (!status.ok) continue; // renderer shows the build banner + no captures

      const noteParts: string[] = [status.detail ?? 'ok'];

      // Harness: rerun the project's own measurement test in this tree and
      // persist the scraped metrics per harness checkpoint. Independent of
      // the dev server (it's a test command). Tolerant by construction.
      if (manifest.harness && harnessLabels.length > 0) {
        const scraped = runHarness(wt.path, manifest.harness);
        for (const label of harnessLabels) {
          writeFileSync(join(capDir, `${label}.metrics.json`), JSON.stringify(scraped, null, 2));
        }
        const got = Object.values(scraped).filter((v) => v !== null).length;
        noteParts.push(`harness scraped ${got}/${manifest.harness.metrics.length} metric(s)`);
      }

      // Media checkpoints need the dev server + Playwright spec. A
      // harness-only manifest skips this entirely.
      if (hasMediaCheckpoints) {
        const server = await startServer(wt.path);
        if (!server) {
          const msg = 'server did not start';
          if (which === 'baseline') baselineBuild = { ok: false, detail: msg };
          else changedBuild = { ok: false, detail: msg };
          continue;
        }
        try {
          const cap = runSpec(wt.path, demoWorkDir, server.url, capDir, videoLabels);
          const shots = existsSync(capDir)
            ? readdirSync(capDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length
            : 0;
          noteParts.push(
            shots + cap.videos > 0
              ? `captured ${shots} screenshot(s) + ${cap.videos} video(s)`
              : `demo spec produced NO captures (playwright ${
                  cap.ok ? 'exited 0' : 'failed'
                }: ${cap.tail.replace(/\s+/g, ' ').slice(-240)})`,
          );
        } finally {
          await server.stop();
        }
      }

      const note = noteParts.join('; ');
      if (which === 'baseline') baselineBuild = { ok: status.ok, detail: note };
      else changedBuild = { ok: status.ok, detail: note };
    }

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
export type {
  DemoComparisonModel,
  DemoCheckpoint,
  DemoBuildStatus,
  HarnessMetricRow,
} from './demo-html.ts';
