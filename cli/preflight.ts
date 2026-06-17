/**
 * forge↔project contract preflight (US-4.1 / ADR-017).
 *
 * Checks a project directory against the contract clauses derived empirically
 * from the trafficGame arc (brain theme `forge-project-onboarding-contract`;
 * retro §3 C1–C6) plus betterado-era additions (C7 conditional, C8 advisory).
 * A project either passes or forge declines, naming the failing clause.
 *
 * Pure: `runPreflight()` does filesystem reads + git inspection and returns a
 * structured report. No mutation, no network, no SDK. The CLI wrapper
 * (`orchestrator/cli.ts`) renders + sets exit code + writes the
 * `preflight.verdict` JSONL event.
 *
 * Hard clauses (C1/C2/C4) fail the preflight (non-zero exit). C3/C5/C6/C8 +
 * DEMO are advisory — surfaced as warnings, not blockers — because (C3) source
 * size is a heuristic, (C5) constraint-doc presence can't prove the harness
 * honours them, (C6) is structurally satisfied by forge post-Phase-6 (no
 * auto-merge; the operator merges the PR), (C8) absence of an agent-instruction
 * file is a gap but not a blocker, and (DEMO) a declared demo.shape can't prove
 * the before/after actually captures the delta (hand-verified at onboarding).
 * DEMO is the project half of the demo contract family; the forge half is
 * skills/demo/SKILL.md.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, relative } from 'node:path';

import { detectProjectLanguage, type ProjectLanguage } from '../orchestrator/gate-recipes.ts';
import {
  validateProjectConfig,
  DEMO_SHAPES,
} from '../orchestrator/project-config.ts';
import { readArtifactRoot } from '../orchestrator/brain-paths.ts';

export type ClauseId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C8' | 'BRAIN' | 'DEMO' | 'ARTIFACTS';

export type ClauseResult = {
  clause: ClauseId;
  title: string;
  /** Hard clauses fail the preflight; advisory clauses only warn. */
  hard: boolean;
  pass: boolean;
  detail: string;
};

export type PreflightReport = {
  projectDir: string;
  projectName: string;
  clauses: ClauseResult[];
  /** True iff every HARD clause passed. Drives the CLI exit code. */
  ok: boolean;
};

export type PreflightOptions = {
  /**
   * Forge root, used to locate the project's brain sub-wiki
   * (`brain/projects/<name>/profile.md`). Defaults to the parent of
   * `orchestrator/` (where this module lives).
   */
  forgeRoot?: string;
};

// --- documented heuristics (single source of truth) ---

// C1: a quality gate is "plausibly fast" if it is a single deterministic
// command. We cannot run it here (could be minutes / require deps), so the
// heuristic is structural: the declared command must be ONE command (no
// shell pipes/&&/; chaining) and must not invoke a known-slow umbrella
// (e2e/playwright/cypress as the *primary* test command — those are the
// 18k-LOC-suite smell that broke trafficGame's per-iteration gate).
const SLOW_GATE_MARKERS = ['playwright', 'cypress', 'e2e', 'integration'];

// C3: a source file is "egregiously oversized" past this many LOC. 800 is
// the same ceiling forge holds on its own tree (coverage-matrix SIMPL-LOC)
// and is a defensible default project size norm. Advisory unless a file is
// *extreme* (≥ 2× the ceiling — the Game.ts-at-1732 class of god-file that
// made work items collide), which is reported but still non-fatal: the
// operator may have a justified exception and the PM's coupling detector is
// the real runtime guard.
const C3_SOFT_LOC = 800;
const C3_EXTREME_LOC = C3_SOFT_LOC * 2;
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
const C3_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'vendor',
  '.forge', 'test-results', '__pycache__', '.venv', 'target',
]);

// C2: forge scratch the project repo MUST NOT track these paths (else every
// cycle commits orchestration state into the PR — the W4 reviewer-confusion
// bug). Checked via git-truth: a path violates C2 if it is tracked by git
// (`git ls-files --error-unmatch` succeeds) OR not ignored by git
// (`git check-ignore -q` fails), in either case relative to the project dir.
// NOTE: the scratch dir is `.forge/work-items/` (regenerated per cycle), NOT
// `.forge/` wholesale — `.forge/project.json` + `.forge/quality_gate_cmd` are
// tracked CONTRACT CONFIG every conformant project keeps, so flagging `.forge/`
// here false-failed them.
const SCRATCH_PATHS = ['.forge/work-items/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'];

// DEMO: DEMO_SHAPES and validateProjectConfig are imported from
// orchestrator/project-config.ts (single source of truth — CON-2).

// C8: the project must have a human-authored agent-instruction file at its
// root. Research shows ~4pp uplift from human-authored AGENTS.md/CLAUDE.md;
// auto-generated files hurt. Advisory: absence is a gap, not a hard block.
const AGENT_INSTRUCTION_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'] as const;

// ARTIFACTS (advisory): build outputs & generated files must be gitignored,
// else `git add -A` (the dev-loop autocommit safety-net + PR assembly) sweeps
// them into the PR — the betterado run committed a 35 MB renamed provider
// binary this way (#4). preflight cannot run a build, so the check is
// structural: for the detected language, does .gitignore mention ANY of the
// characteristic build-output patterns? Zero coverage ⇒ warn. Conservative:
// presence of any one hint clears it (we only flag the "no coverage at all" case).
const BUILD_ARTIFACT_HINTS: Record<ProjectLanguage, readonly string[]> = {
  typescript: ['dist', 'build', '.tsbuildinfo', 'coverage', 'out', '.next', 'lib/'],
  javascript: ['dist', 'build', 'coverage', 'out', '.next'],
  go: ['*.exe', '*.test', '*.out', 'bin/', '/bin', 'dist'], // Go binaries vary; any binary-ish ignore counts
  python: ['__pycache__', '.pyc', 'dist', 'build', '.egg-info', '.coverage', '.pytest_cache'],
  rust: ['target'],
  unknown: [],
};

export function runPreflight(
  projectDir: string,
  opts: PreflightOptions = {},
): PreflightReport {
  const dir = resolve(projectDir);
  const projectName = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;
  const forgeRoot = opts.forgeRoot ?? resolve(import.meta.dirname, '..');

  const clauses: ClauseResult[] = [
    checkC1(dir),
    checkC2(dir),
    checkC3(dir),
    checkC4(dir, projectName, forgeRoot),
    checkC5(dir),
    checkC6(dir),
    checkC8(dir),
    checkDemo(dir),
    checkBuildArtifacts(dir),
    checkBrainStaleness(dir, projectName, forgeRoot),
  ];

  const ok = clauses.filter((c) => c.hard).every((c) => c.pass);
  return { projectDir: dir, projectName, clauses, ok };
}

// --- C1: fast, trustworthy quality gate (HARD) ---

function checkC1(dir: string): ClauseResult {
  const base = { clause: 'C1' as const, title: 'Fast, trustworthy quality gate', hard: true };
  const declared = readQualityGateCmd(dir);
  if (!declared) {
    return {
      ...base,
      pass: false,
      detail:
        'no deterministic test command — need a package.json "test" script or a ' +
        'quality_gate_cmd in the project (none found)',
    };
  }
  const { source, cmd } = declared;
  const lowered = cmd.toLowerCase();
  // Heuristic: a single command, no shell chaining.
  const chained = /(\|\||&&|;|\|)/.test(cmd);
  const slowMarker = SLOW_GATE_MARKERS.find((m) => lowered.includes(m));
  if (chained) {
    return {
      ...base,
      pass: false,
      detail: `${source} chains multiple commands ("${cmd}") — the gate must be ONE deterministic command`,
    };
  }
  if (slowMarker) {
    return {
      ...base,
      pass: false,
      detail:
        `${source} ("${cmd}") looks slow/non-deterministic (contains "${slowMarker}"). ` +
        'The per-iteration gate must be ~≤10s — split a fast unit suite out as the test command.',
    };
  }
  return { ...base, pass: true, detail: `${source}: "${cmd}" (single command, no slow-suite marker)` };
}

// --- C2: scratch hygiene (HARD) ---

/**
 * Git-truth scratch hygiene check.
 *
 * A `.gitignore` text-scan is insufficient: git ignores are no-ops on
 * already-tracked files, so a project can have the right `.gitignore` entries
 * yet still commit forge scratch (e.g. betterado's AGENT.md was committed and
 * C2 false-passed). We test git-truth instead:
 *
 * A scratch path is a VIOLATION if EITHER:
 *   (a) `git ls-files --error-unmatch <path>` exits 0  → file is tracked, OR
 *   (b) `git check-ignore -q <path>` exits non-zero    → file is not ignored.
 *
 * Both commands run with cwd = project dir. If the directory is not a git
 * repo, we fall back to the `.gitignore` text-scan (best-effort).
 */
function checkC2(dir: string): ClauseResult {
  const base = { clause: 'C2' as const, title: 'Scratch hygiene (forge scratch untracked + ignored)', hard: true };

  // Determine whether this is a git repo at all.
  const isRepo = spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
    stdio: 'ignore',
  }).status === 0;

  if (!isRepo) {
    // No git repo — fall back to .gitignore text-scan (best-effort).
    const giPath = join(dir, '.gitignore');
    if (!existsSync(giPath)) {
      return {
        ...base,
        pass: false,
        detail:
          'not a git repo and no .gitignore — forge scratch (.forge/, AGENT.md, PROMPT.md, fix_plan.md) would be committed into the PR',
      };
    }
    const lines = readFileSync(giPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    // A scratch path is covered if .gitignore lists it OR an ancestor dir of it
    // (e.g. `.forge/` covers `.forge/work-items/`).
    const isCovered = (p: string): boolean => {
      const stripped = p.replace(/^\//, '').replace(/\/$/, '');
      return lines.some((l) => {
        const ln = l.replace(/^\//, '').replace(/\/$/, '');
        return ln === stripped || stripped.startsWith(`${ln}/`);
      });
    };
    const missing = SCRATCH_PATHS.filter((p) => !isCovered(p));
    if (missing.length > 0) {
      return {
        ...base,
        pass: false,
        detail: `not a git repo; .gitignore does not exclude: ${missing.join(', ')}`,
      };
    }
    return {
      ...base,
      pass: true,
      detail: `not a git repo; .gitignore covers all forge scratch (${SCRATCH_PATHS.join(', ')})`,
    };
  }

  // Git-truth check: a scratch path violates C2 if tracked OR not ignored.
  const violations: string[] = [];
  for (const p of SCRATCH_PATHS) {
    // Strip trailing slash for git commands (git ls-files doesn't match dirs with /).
    const pathArg = p.replace(/\/$/, '');

    const isTracked =
      spawnSync('git', ['-C', dir, 'ls-files', '--error-unmatch', pathArg], {
        stdio: 'ignore',
      }).status === 0;

    if (isTracked) {
      violations.push(`${p} (tracked by git)`);
      continue;
    }

    const isIgnored =
      spawnSync('git', ['-C', dir, 'check-ignore', '-q', pathArg], {
        stdio: 'ignore',
      }).status === 0;

    if (!isIgnored) {
      violations.push(`${p} (not ignored by git)`);
    }
  }

  if (violations.length > 0) {
    return {
      ...base,
      pass: false,
      detail:
        `forge scratch violates git-truth hygiene: ${violations.join('; ')}. ` +
        'Add these to .gitignore AND ensure they are not already tracked ' +
        '(`git rm --cached <path>` if needed).',
    };
  }
  return {
    ...base,
    pass: true,
    detail: `git-truth: all forge scratch paths (${SCRATCH_PATHS.join(', ')}) are untracked + ignored`,
  };
}

// --- C3: decomposed source under the project's size norm (ADVISORY) ---

function checkC3(dir: string): ClauseResult {
  const base = { clause: 'C3' as const, title: 'Decomposed source (no god-files)', hard: false };
  const offenders: string[] = [];
  let extreme = false;
  for (const file of walkSource(dir)) {
    const loc = readFileSync(file, 'utf8').split('\n').length;
    if (loc > C3_SOFT_LOC) {
      offenders.push(`${relative(dir, file)}:${loc}`);
      if (loc >= C3_EXTREME_LOC) extreme = true;
    }
  }
  if (offenders.length === 0) {
    return { ...base, pass: true, detail: `no source file > ${C3_SOFT_LOC} LOC` };
  }
  const shown = offenders.slice(0, 5).join(', ');
  return {
    ...base,
    pass: false,
    detail:
      `${offenders.length} file(s) > ${C3_SOFT_LOC} LOC (${shown}${offenders.length > 5 ? ', …' : ''})` +
      (extreme
        ? ` — at least one is ≥ ${C3_EXTREME_LOC} LOC (god-file class; work items will collide). Advisory, but strongly recommend extracting before unattended runs.`
        : ' — advisory; the PM coupling detector is the runtime guard.'),
  };
}

// --- C4: machine-consumable architecture context (HARD) ---

function checkC4(dir: string, projectName: string, _forgeRoot: string): ClauseResult {
  const base = { clause: 'C4' as const, title: 'Machine-readable architecture context', hard: true };
  const roadmap = join(dir, 'roadmap.md');
  // Brain 3 lives inside the project repo (three-brain restructure 2026-05-26),
  // under the project's committed-artifact root (project.json `artifactRoot`,
  // default "." = legacy brain/profile.md at the project root).
  const artifactRoot = readArtifactRoot(dir);
  const brainRel = artifactRoot === '.' ? 'brain/profile.md' : `${artifactRoot}/brain/profile.md`;
  const brainProfile = join(dir, brainRel);
  const hasRoadmap = existsSync(roadmap);
  const hasBrain = existsSync(brainProfile);
  if (hasRoadmap && hasBrain) {
    return { ...base, pass: true, detail: `roadmap.md + brain sub-wiki present (${projectName}/${brainRel})` };
  }
  const missing: string[] = [];
  if (!hasRoadmap) missing.push('roadmap.md (in project root)');
  if (!hasBrain) missing.push(`${brainRel} (project brain — three-brain model, Brain 3)`);
  return {
    ...base,
    pass: false,
    detail: `missing ${missing.join(' and ')} — the architect/PM have no queryable structure and will hallucinate paths`,
  };
}

// --- C5: locked-core mandates the harness honours (ADVISORY) ---

function checkC5(dir: string): ClauseResult {
  const base = { clause: 'C5' as const, title: 'Locked-core constraints declared', hard: false };
  const candidates = ['CLAUDE.md', 'AGENTS.md', '.forge/constraints.md', 'CONSTRAINTS.md'];
  const found = candidates.find((c) => existsSync(join(dir, c)));
  if (found) {
    return {
      ...base,
      pass: true,
      detail: `${found} present (operator declared constraints; forge honours git-ownership / no-test-tampering per the doc)`,
    };
  }
  return {
    ...base,
    pass: false,
    detail:
      `no constraints doc (${candidates.join(' / ')}). Advisory: forge cannot honour locked-core ` +
      'mandates it was never told about — strongly recommend a CLAUDE.md.',
  };
}

// --- C6: a satisfiable merge model (ADVISORY — forge-side-satisfied) ---

function checkC6(dir: string): ClauseResult {
  const base = { clause: 'C6' as const, title: 'Satisfiable merge model', hard: false };
  // Post-Phase-6 this clause is structurally satisfied by FORGE: the review
  // phase produces a demo-embedded PR and STOPS; the operator merges in
  // GitHub (no auto-merge). The only project-side requirement is a GitHub
  // remote so there is a PR surface to merge.
  const remote = gitRemoteUrl(dir);
  if (remote && /github\.com/i.test(remote)) {
    return {
      ...base,
      pass: true,
      detail: `forge-side-satisfied (Phase-6: no auto-merge, operator merges the PR). Project has a GitHub remote: ${remote}`,
    };
  }
  return {
    ...base,
    pass: false,
    detail:
      'forge-side-satisfied for the merge model, BUT no GitHub remote found — there is no PR surface ' +
      'for the operator to merge. Add a GitHub `origin` remote. (Advisory.)',
  };
}

// --- C8: agent-instruction file (ADVISORY) ---

/**
 * Advisory: the project must expose a human-authored AGENTS.md or CLAUDE.md
 * at its root. Research shows ~4pp uplift from human-authored agent-instruction
 * files; auto-generated files hurt. This clause requires *presence*, never
 * auto-generation. Advisory (never blocks).
 */
function checkC8(dir: string): ClauseResult {
  const base = { clause: 'C8' as const, title: 'Agent-instruction file (AGENTS.md or CLAUDE.md)', hard: false };
  const found = AGENT_INSTRUCTION_CANDIDATES.find((f) => existsSync(join(dir, f)));
  if (found) {
    return {
      ...base,
      pass: true,
      detail: `${found} present — build/test/lint commands and locked-core mandates available to the agent`,
    };
  }
  return {
    ...base,
    pass: false,
    detail:
      `no AGENTS.md or CLAUDE.md at project root. Advisory: human-authored agent-instruction files ` +
      `give ~4pp task-completion uplift; auto-generated ones hurt. Create one with build/test/lint ` +
      `commands at the top and any locked-core mandates (e.g. "never edit tests to pass").`,
  };
}

// --- DEMO: the project declares how its change is demonstrated (ADVISORY) ---

/**
 * Delegates validation to `validateProjectConfig` from orchestrator/project-config.ts
 * (single source of truth). On a structural violation the throw is caught and
 * downgraded to an advisory WARN — DEMO is never a hard blocker.
 */
function checkDemo(dir: string): ClauseResult {
  const base = {
    clause: 'DEMO' as const,
    title: 'Demonstrable change (.forge/project.json demo.shape)',
    hard: false,
  };
  const cfgPath = join(dir, '.forge', 'project.json');
  if (!existsSync(cfgPath)) {
    return {
      ...base,
      pass: false,
      detail:
        'no .forge/project.json — the demo shape is undeclared, so forge cannot ' +
        'tell how this project shows a change. The unifier falls back to a ' +
        'notes-only demo and the operator may approve blind. Declare a demo.shape ' +
        `(${[...DEMO_SHAPES].join(' | ')}). Advisory.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(cfgPath, 'utf8'));
  } catch {
    return {
      ...base,
      pass: false,
      detail: '.forge/project.json is not valid JSON — cannot read the demo shape. Advisory.',
    };
  }
  // Use the canonical validator from project-config.ts. Catch its throw and
  // downgrade to advisory WARN so a missing quality_gate_cmd or bad sweep block
  // does not block a project that has a valid demo shape.
  let cfg: ReturnType<typeof validateProjectConfig>;
  try {
    cfg = validateProjectConfig(parsed);
  } catch (err) {
    return {
      ...base,
      pass: false,
      detail:
        `.forge/project.json failed validation: ${err instanceof Error ? err.message : String(err)}. Advisory.`,
    };
  }
  const { shape } = cfg.demo;
  const hasCommand = Array.isArray(cfg.demo.command) && cfg.demo.command.length > 0;
  const hasPreview = Array.isArray(cfg.demo.preview_command) && cfg.demo.preview_command.length > 0;
  // These are already enforced by validateProjectConfig, but we re-check
  // defensively and surface them as advisory here (the throw path above already
  // catches hard violations).
  if (shape !== 'none' && !hasCommand) {
    return {
      ...base,
      pass: false,
      detail: `demo.shape "${shape}" needs a demo.command (how forge produces the before/after) — none declared. Advisory.`,
    };
  }
  if (shape === 'browser' && !hasPreview) {
    return {
      ...base,
      pass: false,
      detail:
        'demo.shape "browser" needs a demo.preview_command (the dev/preview server forge serves the built worktree on) — none declared. Advisory.',
    };
  }
  return {
    ...base,
    pass: true,
    detail:
      `demo.shape "${shape}" declared` +
      (shape !== 'none' ? ' + command' : '') +
      (shape === 'browser' ? ' + preview_command' : '') +
      ' (forge can produce a demo; the before/after fidelity is hand-verified at onboarding)',
  };
}

// --- ARTIFACTS: build-output ignore coverage (ADVISORY, betterado #4a) ---

function checkBuildArtifacts(dir: string): ClauseResult {
  const base = {
    clause: 'ARTIFACTS' as const,
    title: 'Build artifacts gitignored (no stray outputs in the PR)',
    hard: false,
  };
  const lang = detectProjectLanguage(dir);
  const hints = BUILD_ARTIFACT_HINTS[lang];
  if (lang === 'unknown' || hints.length === 0) {
    return { ...base, pass: true, detail: 'no language-specific build-output check (unknown project shape)' };
  }
  const giPath = join(dir, '.gitignore');
  if (!existsSync(giPath)) {
    // C2 already hard-fails on a missing .gitignore; don't double-report.
    return { ...base, pass: true, detail: 'no .gitignore (already flagged by C2)' };
  }
  const gi = readFileSync(giPath, 'utf8').toLowerCase();
  const covered = hints.some((h) => gi.includes(h.toLowerCase()));
  if (covered) {
    return { ...base, pass: true, detail: `.gitignore covers ${lang} build outputs` };
  }
  return {
    ...base,
    pass: false,
    detail:
      `.gitignore has NONE of the characteristic ${lang} build-output patterns (${hints.join(', ')}). ` +
      `A compiled binary / dist / coverage left un-ignored will be swept into the PR by \`git add -A\` ` +
      `(betterado committed a 35 MB binary this way). Advisory — add the build-output ignores for this project.`,
  };
}

// --- helpers ---

function readQualityGateCmd(dir: string): { source: string; cmd: string } | null {
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const t = pkg.scripts?.test;
      if (t && t.trim() && !/no test specified/i.test(t)) {
        return { source: 'package.json "test"', cmd: t.trim() };
      }
    } catch {
      /* malformed package.json — fall through to other signals */
    }
  }
  // A project may declare a quality_gate_cmd in a forge sidecar instead of
  // (or in addition to) package.json — mirror the manifest's field name.
  const sidecar = join(dir, '.forge', 'quality_gate_cmd');
  if (existsSync(sidecar)) {
    const cmd = readFileSync(sidecar, 'utf8').trim();
    if (cmd) return { source: '.forge/quality_gate_cmd', cmd };
  }
  return null;
}

/**
 * Advisory (never blocks): scan the project's brain themes for cited
 * `src/…` / `tests/…` source paths that no longer exist in the project
 * repo. A theme citing deleted/renamed files is the failure mode that
 * silently thrashed the PM (2026-05-18): the PM reads the brain first,
 * ingests a model that contradicts the actual tree, and burns its whole
 * budget unable to reconcile. This surfaces the contradiction BEFORE a
 * cycle, so the operator can reconcile the theme (the reflection phase
 * normally does this, but by-hand project changes skip it).
 *
 * WARN only — themes legitimately reference history; the operator judges.
 */
function checkBrainStaleness(
  dir: string,
  _projectName: string,
  _forgeRoot: string,
): ClauseResult {
  const base = {
    clause: 'BRAIN' as const,
    title: 'Brain freshness (themes cite live source paths)',
    hard: false,
  };
  // Brain 3 lives inside the project repo, under the committed-artifact root
  // (project.json `artifactRoot`, default "." = legacy brain/themes/).
  const themesDir = join(dir, readArtifactRoot(dir), 'brain', 'themes');
  if (!existsSync(themesDir)) {
    return { ...base, pass: true, detail: 'no project brain themes to check' };
  }
  // Match worktree-relative source tokens in markdown links or inline code,
  // including the `…/projects/<name>/src/…` link form themes use — we only
  // flag the high-signal `src/` and `tests/` code paths with a file ext.
  const pathRe = /(?:^|[("`\s/])((?:src|tests)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/g;
  const missing = new Map<string, string>(); // citedPath -> first theme file
  let themeFiles: string[] = [];
  try {
    themeFiles = readdirSync(themesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return { ...base, pass: true, detail: 'project themes unreadable — skipped' };
  }
  for (const f of themeFiles) {
    let content: string;
    try {
      content = readFileSync(join(themesDir, f), 'utf8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(pathRe)) {
      const cited = m[1];
      if (missing.has(cited)) continue;
      if (!existsSync(join(dir, cited))) missing.set(cited, f);
    }
  }
  if (missing.size === 0) {
    return {
      ...base,
      pass: true,
      detail: `all src/tests paths cited by ${themeFiles.length} theme(s) exist in the project`,
    };
  }
  const sample = [...missing.entries()]
    .slice(0, 6)
    .map(([p, f]) => `${p} (${f})`)
    .join('; ');
  return {
    ...base,
    pass: false,
    detail:
      `${missing.size} brain-cited source path(s) no longer exist — theme(s) may be stale and ` +
      `will mislead the planner (PM/architect read the brain first). Reconcile against the code ` +
      `(or run a reflection pass). Sample: ${sample}`,
  };
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (C3_SKIP_DIRS.has(e)) continue;
      const p = join(cur, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (SOURCE_EXTS.some((x) => e.endsWith(x)) && !e.endsWith('.d.ts')) out.push(p);
    }
  }
  return out;
}

function gitRemoteUrl(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Structured event emitted by `orchestrator/cli.ts` cmdPreflight after every
 * run (CON-5). The CLI owns the write so preflight.ts stays pure (no IO side
 * effects). Export the type + builder here so the CLI can import them.
 */
export type PreflightVerdictEvent = {
  event_type: 'preflight.verdict';
  project_dir: string;
  project_name: string;
  ok: boolean;
  failing_clause_ids: ClauseId[];
  warning_clause_ids: ClauseId[];
  timestamp: string;
};

/** Build a `PreflightVerdictEvent` from a completed report. */
export function buildVerdictEvent(r: PreflightReport): PreflightVerdictEvent {
  return {
    event_type: 'preflight.verdict',
    project_dir: r.projectDir,
    project_name: r.projectName,
    ok: r.ok,
    failing_clause_ids: r.clauses
      .filter((c) => c.hard && !c.pass)
      .map((c) => c.clause),
    warning_clause_ids: r.clauses
      .filter((c) => !c.hard && !c.pass)
      .map((c) => c.clause),
    timestamp: new Date().toISOString(),
  };
}

/** Render a human-facing per-clause report. Returned, not printed (the CLI prints). */
export function formatPreflightReport(r: PreflightReport): string {
  const lines: string[] = [];
  lines.push(`forge preflight — ${r.projectName}  (${r.projectDir})`);
  lines.push('');
  for (const c of r.clauses) {
    const mark = c.pass ? 'PASS' : c.hard ? 'FAIL' : 'WARN';
    lines.push(`  ${mark}  ${c.clause} ${c.title}`);
    lines.push(`        ${c.detail}`);
  }
  lines.push('');
  if (r.ok) {
    const warns = r.clauses.filter((c) => !c.pass && !c.hard).length;
    lines.push(
      warns > 0
        ? `CONTRACT MET (hard clauses pass; ${warns} advisory warning(s) — review before unattended runs).`
        : 'CONTRACT MET — forge can progress this project unattended.',
    );
  } else {
    const failed = r.clauses.filter((c) => c.hard && !c.pass).map((c) => c.clause);
    lines.push(`CONTRACT NOT MET — forge declines. Failing hard clause(s): ${failed.join(', ')}.`);
  }
  return lines.join('\n');
}
