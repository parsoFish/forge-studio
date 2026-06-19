/**
 * Per-project configuration loader. Implements CONTRACTS.md C1 + C2 + C26 +
 * C27 + C28: each managed project declares its demo shape, quality gate,
 * optional holistic metrics, and optional parameter-sweep plug-in points in
 * `<project-root>/.forge/project.json`.
 *
 * The loader is **fail-closed** per council 04 F8 + plan 04 Open Q4: any
 * malformed file (missing required block, bad shape value, malformed JSON)
 * throws so the scheduler refuses to schedule the initiative. The only
 * non-throwing outcome on parse failure is "file does not exist" — in which
 * case the loader returns `null` and the caller decides whether the absence
 * is acceptable (S4 caller in the live cycle refuses; the bench tests
 * exercise both branches).
 *
 * The schema lives in `docs/schemas/project-config.schema.json`. The loader's
 * hand-rolled validator below is the source of truth for *behavioural*
 * checks (shape enum, preview_command required when browser, etc.); the
 * JSON-schema file is the operator-facing reference.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_STEP_KINDS, RELEASE_STEP_KINDS, RELEASE_STEP_PHASES } from './studio/types.ts';
import type {
  DemoStep,
  DemoStepKind,
  ReleaseConfig,
  ReleaseStep,
  ReleaseStepKind,
  ReleaseStepPhase,
} from './studio/types.ts';

export type { DemoStep, DemoStepKind } from './studio/types.ts';
export { DEMO_STEP_KINDS } from './studio/types.ts';
export type { ReleaseStep, ReleaseConfig } from './studio/types.ts';

export const PROJECT_CONFIG_REL_PATH = '.forge/project.json';

export type DemoShape = 'browser' | 'harness' | 'cli-diff' | 'artifact' | 'none';

export const DEMO_SHAPES: ReadonlySet<DemoShape> = new Set<DemoShape>([
  'browser',
  'harness',
  'cli-diff',
  'artifact',
  'none',
]);

export type DemoConfig = {
  shape: DemoShape;
  /** Argv-style demo command. Required when shape != 'none'. */
  command?: string[];
  /** Output directory relative to worktree root. Default: `demo/<initiative-id>/`. */
  output?: string;
  /** Git ref / branch the unifier diffs against for before/after captures. Default `main`. */
  baseline?: string;
  /** Required for shape: 'browser' — the dev/preview server command. */
  preview_command?: string[];
};

export type MetricsConfig = {
  /** Argv-style command emitting one or more scalar metrics on stdout. */
  command: string[];
  /** Directory holding locked baseline markdown files. */
  baselines_dir: string;
  /** Allowable percentage drift before flagging regression. */
  tolerance_pct: number;
};

export type SweepConfig = {
  /** Argv-style command that brings the testbed up. */
  start_command: string[];
  /** Path (worktree-relative) to a module exporting a sample-draw function. */
  draw_function: string;
  /** Path (worktree-relative) to a module that parses `metrics.command` output. */
  measurement_extractor: string;
};

/**
 * S7 / C13 — optional logging block. Currently surfaces
 * `heartbeat_seconds` so a project can tune the agent_heartbeat cadence
 * (default 15s) without touching forge code. Future logging knobs slot
 * in here.
 */
export type LoggingConfig = {
  heartbeat_seconds?: number;
};

/**
 * Live-acceptance enforcement (contract C7, 2026-06-06). For an
 * external-resource project (whose behaviour can only be proven against a
 * live system), the merge decision must be backed by a real acceptance test.
 * Rather than run a slow live suite at cycle end, forge requires the PM
 * decomposition to INCLUDE a live-acceptance WI: ≥1 work item whose
 * `quality_gate_cmd` targets the live acceptance suite. `match` is the
 * substring (any argv token contains it) that identifies such a gate; when
 * `required` is true the PM phase hard-fails the cycle if no emitted WI
 * carries a matching gate. The live test then runs as that WI's own per-WI
 * gate during the dev-loop (with TF_ACC + creds from the serve env).
 */
export type AcceptanceGateConfig = {
  /** Substring identifying a live-acceptance gate in a WI quality_gate_cmd. */
  match: string;
  /** When true, every initiative must include ≥1 WI whose gate contains `match`. */
  required: boolean;
  /**
   * Env vars that MUST be set for a matching (live-acceptance) gate to actually
   * run against the live system — e.g. `["TF_ACC"]`. When a WI's gate matches
   * `match` but one of these is unset, the dev-loop ERRORS the gate instead of
   * letting a skipped runner (`ok pkg 0.00s`) false-pass. Optional.
   */
  requires_env?: string[];
};

export type ProjectConfig = {
  demo: DemoConfig;
  quality_gate_cmd: string[];
  /**
   * The project's FULL CI verification — the operator-configured gate that
   * mirrors the project's CI workflow (e.g. `make test && golangci-lint run
   * ./... && make terrafmt-check`). Run DIRECTLY (operator-trusted) as the
   * final delivery gate before a PR is opened, so a cycle can't ship a PR
   * while the project's whole-module CI is red. Distinct from the per-WI
   * `quality_gate_cmd` (which is scoped + pipe-banned): `ci_gate` is allowed
   * to be a `["bash","-c","…&&…"]` shell chain because the operator authored
   * it. Optional — absent ⇒ no final CI gate.
   */
  ci_gate?: string[];
  /**
   * The project's auto-formatters (e.g. `make fmt && make terrafmt`), applied
   * best-effort BEFORE `ci_gate` runs so a PR is fmt-clean. Optional — absent
   * ⇒ the CI gate runs without an auto-format pass.
   */
  ci_fix_cmd?: string[];
  /**
   * Env-var names to STRIP from the environment when running `ci_gate` /
   * `ci_fix_cmd` (2026-06-06, contract A3). The final CI delivery gate must
   * mirror the project's GitHub CI, which runs in a clean env. A live-test
   * trigger left in the cycle env (e.g. Terraform's `TF_ACC=1`, set so per-WI
   * live-acceptance gates run) would otherwise leak into `make test` and run
   * the whole live suite — env-dependent failures GitHub never sees. Listing
   * the trigger here makes the CI gate hermetic regardless of cycle env.
   * Optional — absent ⇒ the gate inherits `process.env` unchanged.
   */
  ci_gate_unset_env?: string[];
  /**
   * Verbatim acceptance-criterion statements forge appends to EVERY work item
   * the PM emits, as a "## Standing acceptance criteria (project contract)"
   * body section (2026-06-06, contract A2). Encodes project-wide test
   * invariants (e.g. "proven by a live TF_ACC test", "must not redden CI") as
   * static standing ACs, removing the per-WI PM judgment that kept varying.
   * Optional — absent ⇒ no section appended.
   */
  standing_work_item_acs?: string[];
  /** Live-acceptance-WI requirement (contract C7). Optional. */
  acceptance_gate?: AcceptanceGateConfig;
  metrics?: MetricsConfig;
  sweep?: SweepConfig;
  logging?: LoggingConfig;
  /**
   * M2 Studio fields — all optional so existing project.json files without
   * these fields remain valid. These flow into PM (instructions) and the
   * unifier (demoProcess + skills).
   */
  /** One-liner mission statement (≤140 chars). */
  northStar?: string;
  /** Free-text standing instructions injected into every PM prompt. */
  instructions?: string;
  /** Typed demo steps: capture | verify | present. */
  demoProcess?: DemoStep[];
  /** Skill slugs bound to this project. */
  skills?: string[];
  /** KB id bound to this project, or null to explicitly leave unbound. */
  kb?: string | null;
  /**
   * Project-root-relative subdirectory under which a project's COMMITTED forge
   * artifacts live: its Brain 3 (`<artifactRoot>/brain/`) and its development
   * history (`<artifactRoot>/history/<initiative-id>/`). Default `"."` keeps the
   * legacy layout (`brain/` directly at the project root) so existing managed
   * projects are unaffected; a project that wants a single visible home for its
   * forge artifacts sets e.g. `"forge"`. Only affects committed artifacts —
   * runtime/session scratch (`_architect/`, worktree `demo/<id>/`, `.forge/`)
   * is unchanged. Validated as a clean relative path (no leading `/`, no `..`).
   */
  artifactRoot?: string;
  /**
   * Optional release-process declaration: the repo-side prep a cycle performs
   * before merge (refresh docs, write a changelog entry, bump a version file).
   * Mirrors `demoProcess` — typed, optional, fail-closed when malformed.
   * Tagging + publishing are CI's job, NOT forge step kinds. Absent ⇒ no
   * release steps.
   */
  releaseProcess?: ReleaseConfig;
};

/**
 * Load and validate `<projectRoot>/.forge/project.json`. Returns `null` if
 * the file doesn't exist; throws on any structural / semantic violation
 * (callers depend on the throw to enforce fail-closed scheduling).
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig | null {
  const path = join(projectRoot, PROJECT_CONFIG_REL_PATH);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `project-config: cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `project-config: ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateProjectConfig(parsed);
}

/**
 * Validate a parsed object as a `ProjectConfig`. Throws on any violation.
 * Exported for use in tests and operator tooling that may consume the
 * config from sources other than the filesystem.
 */
export function validateProjectConfig(raw: unknown): ProjectConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('project-config: root must be an object');
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.demo !== 'object' || obj.demo === null) {
    throw new Error('project-config: missing required `demo` block');
  }
  const demoIn = obj.demo as Record<string, unknown>;
  const shape = demoIn.shape;
  if (typeof shape !== 'string' || !DEMO_SHAPES.has(shape as DemoShape)) {
    throw new Error(
      `project-config: demo.shape must be one of ${[...DEMO_SHAPES].join(' | ')} (got ${JSON.stringify(shape)})`,
    );
  }
  const command = optionalArgv(demoIn.command, 'demo.command');
  if (shape !== 'none' && !command) {
    throw new Error(`project-config: demo.command is required when demo.shape != "none"`);
  }
  const preview_command = optionalArgv(demoIn.preview_command, 'demo.preview_command');
  if (shape === 'browser' && !preview_command) {
    throw new Error(
      'project-config: demo.preview_command is required when demo.shape = "browser"',
    );
  }
  const output = optionalString(demoIn.output, 'demo.output');
  const baseline = optionalString(demoIn.baseline, 'demo.baseline');

  const demo: DemoConfig = {
    shape: shape as DemoShape,
    ...(command ? { command } : {}),
    ...(output ? { output } : {}),
    ...(baseline ? { baseline } : {}),
    ...(preview_command ? { preview_command } : {}),
  };

  const quality_gate_cmd = optionalArgv(obj.quality_gate_cmd, 'quality_gate_cmd');
  if (!quality_gate_cmd) {
    throw new Error('project-config: missing required `quality_gate_cmd` (argv)');
  }

  // Optional final-delivery CI gate + its auto-formatters. Both are
  // operator-authored argv vectors; a `["bash","-c","…&&…"]` shell chain is
  // permitted here (unlike the pipe-banned per-WI gate) because the orchestrator
  // runs them DIRECTLY rather than through the per-WI gate runner.
  const ci_gate = optionalArgv(obj.ci_gate, 'ci_gate');
  const ci_fix_cmd = optionalArgv(obj.ci_fix_cmd, 'ci_fix_cmd');
  const ci_gate_unset_env = optionalArgv(obj.ci_gate_unset_env, 'ci_gate_unset_env');
  const standing_work_item_acs = optionalArgv(
    obj.standing_work_item_acs,
    'standing_work_item_acs',
  );
  const acceptance_gate = parseAcceptanceGate(obj.acceptance_gate);

  const metrics = parseMetrics(obj.metrics);
  const sweep = parseSweep(obj.sweep);
  const logging = parseLogging(obj.logging);

  // M2 optional fields
  const northStar = parseNorthStar(obj.northStar);
  const instructions = parseInstructions(obj.instructions);
  const demoProcess = parseDemoProcess(obj.demoProcess);
  const skills = parseSkills(obj.skills);
  const kb = parseKb(obj.kb);
  const artifactRoot = parseArtifactRoot(obj.artifactRoot);
  const releaseProcess = parseReleaseProcess(obj.releaseProcess);

  return {
    demo,
    quality_gate_cmd,
    ...(ci_gate ? { ci_gate } : {}),
    ...(ci_fix_cmd ? { ci_fix_cmd } : {}),
    ...(ci_gate_unset_env ? { ci_gate_unset_env } : {}),
    ...(standing_work_item_acs ? { standing_work_item_acs } : {}),
    ...(acceptance_gate ? { acceptance_gate } : {}),
    ...(metrics ? { metrics } : {}),
    ...(sweep ? { sweep } : {}),
    ...(logging ? { logging } : {}),
    ...(northStar !== undefined ? { northStar } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(demoProcess !== undefined ? { demoProcess } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(kb !== undefined ? { kb } : {}),
    ...(artifactRoot !== undefined ? { artifactRoot } : {}),
    ...(releaseProcess !== undefined ? { releaseProcess } : {}),
  };
}

/**
 * Assert `value` is a clean project/worktree-relative path: no leading `/`, no
 * leading or embedded backslash, no `..` segment — so it can never escape the
 * root it's resolved against. Throws (mentioning `label`) on any violation.
 * Shared by `parseArtifactRoot` and `parseReleaseProcess`.
 */
function assertCleanRelativePath(value: string, label: string): void {
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    throw new Error(
      `project-config: ${label} must be a clean project-relative path (no leading slash, no "..") — got ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Parse + validate the optional `artifactRoot`. Must be a clean relative path
 * (no leading `/`, no `..` segment, no backslashes) so it can never escape the
 * project root. Returns `undefined` when absent (callers default to `"."`).
 */
function parseArtifactRoot(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error('project-config: artifactRoot must be a string when present');
  }
  const trimmed = v.trim();
  if (trimmed === '' || trimmed === '.') return undefined;
  assertCleanRelativePath(trimmed, 'artifactRoot');
  return trimmed;
}

/**
 * Parse + validate the optional `releaseProcess` block. Mirrors
 * `parseDemoProcess`: fail-closed — absent ⇒ `undefined`; present-but-malformed
 * throws (`project-config: releaseProcess...`). Each step's `kind` must be in
 * RELEASE_STEP_KINDS, `phase` in RELEASE_STEP_PHASES, `text` a string, and the
 * optional `command` an argv string[]. The optional `versionFile` /
 * `changelogPath` / `docsDir` are clean worktree-relative paths.
 */
function parseReleaseProcess(raw: unknown): ReleaseConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('project-config: releaseProcess must be an object when present');
  }
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.steps)) {
    throw new Error('project-config: releaseProcess.steps must be an array');
  }
  const steps: ReleaseStep[] = r.steps.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`project-config: releaseProcess.steps[${i}] must be an object`);
    }
    const s = item as Record<string, unknown>;
    if (typeof s.kind !== 'string' || !RELEASE_STEP_KINDS.includes(s.kind as ReleaseStepKind)) {
      throw new Error(
        `project-config: releaseProcess.steps[${i}].kind must be one of ${RELEASE_STEP_KINDS.join('|')} (got ${JSON.stringify(s.kind)})`,
      );
    }
    if (
      typeof s.phase !== 'string' ||
      !RELEASE_STEP_PHASES.includes(s.phase as ReleaseStepPhase)
    ) {
      throw new Error(
        `project-config: releaseProcess.steps[${i}].phase must be one of ${RELEASE_STEP_PHASES.join('|')} (got ${JSON.stringify(s.phase)})`,
      );
    }
    if (typeof s.text !== 'string') {
      throw new Error(`project-config: releaseProcess.steps[${i}].text must be a string`);
    }
    const command = optionalArgv(s.command, `releaseProcess.steps[${i}].command`);
    return {
      kind: s.kind as ReleaseStepKind,
      phase: s.phase as ReleaseStepPhase,
      text: s.text,
      ...(command ? { command } : {}),
    };
  });

  const versionFile = parseReleasePath(r.versionFile, 'releaseProcess.versionFile');
  const changelogPath = parseReleasePath(r.changelogPath, 'releaseProcess.changelogPath');
  const docsDir = parseReleasePath(r.docsDir, 'releaseProcess.docsDir');

  return {
    steps,
    ...(versionFile !== undefined ? { versionFile } : {}),
    ...(changelogPath !== undefined ? { changelogPath } : {}),
    ...(docsDir !== undefined ? { docsDir } : {}),
  };
}

/**
 * Parse one optional clean worktree-relative path field of `releaseProcess`.
 * Absent ⇒ `undefined`; present must be a string + a clean relative path.
 */
function parseReleasePath(v: unknown, label: string): string | undefined {
  const s = optionalString(v, label);
  if (s === undefined) return undefined;
  assertCleanRelativePath(s, label);
  return s;
}

/**
 * Parse + validate the optional `acceptance_gate` block. Throws on a present
 * but malformed block (fail-closed, matching the other parsers). Returns
 * `undefined` when absent.
 */
function parseAcceptanceGate(raw: unknown): AcceptanceGateConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new Error('project-config: acceptance_gate must be an object when present');
  }
  const a = raw as Record<string, unknown>;
  const match = optionalString(a.match, 'acceptance_gate.match');
  if (!match) {
    throw new Error('project-config: acceptance_gate.match is required (non-empty string) when the block is present');
  }
  if (typeof a.required !== 'boolean') {
    throw new Error('project-config: acceptance_gate.required must be a boolean when the block is present');
  }
  const requires_env = optionalArgv(a.requires_env, 'acceptance_gate.requires_env');
  return {
    match,
    required: a.required,
    ...(requires_env ? { requires_env } : {}),
  };
}

function parseLogging(raw: unknown): LoggingConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new Error('project-config: logging must be an object when present');
  }
  const l = raw as Record<string, unknown>;
  const hb = l.heartbeat_seconds;
  let heartbeat_seconds: number | undefined;
  if (hb !== undefined && hb !== null) {
    if (typeof hb !== 'number' || !Number.isFinite(hb) || hb <= 0) {
      throw new Error(
        'project-config: logging.heartbeat_seconds must be a positive finite number when present',
      );
    }
    heartbeat_seconds = hb;
  }
  if (heartbeat_seconds === undefined) return undefined;
  return { heartbeat_seconds };
}

function parseMetrics(raw: unknown): MetricsConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new Error('project-config: metrics must be an object when present');
  }
  const m = raw as Record<string, unknown>;
  const command = optionalArgv(m.command, 'metrics.command');
  if (!command) {
    throw new Error('project-config: metrics.command is required when metrics block is present');
  }
  const baselines_dir = optionalString(m.baselines_dir, 'metrics.baselines_dir');
  if (!baselines_dir) {
    throw new Error('project-config: metrics.baselines_dir is required when metrics block is present');
  }
  const tolerance_pct =
    typeof m.tolerance_pct === 'number' ? m.tolerance_pct : Number.NaN;
  if (!Number.isFinite(tolerance_pct)) {
    throw new Error('project-config: metrics.tolerance_pct must be a finite number');
  }
  return { command, baselines_dir, tolerance_pct };
}

function parseSweep(raw: unknown): SweepConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') {
    throw new Error('project-config: sweep must be an object when present');
  }
  const s = raw as Record<string, unknown>;
  const start_command = optionalArgv(s.start_command, 'sweep.start_command');
  if (!start_command) {
    throw new Error('project-config: sweep.start_command is required when sweep block is present');
  }
  const draw_function = optionalString(s.draw_function, 'sweep.draw_function');
  if (!draw_function) {
    throw new Error('project-config: sweep.draw_function is required when sweep block is present');
  }
  const measurement_extractor = optionalString(
    s.measurement_extractor,
    'sweep.measurement_extractor',
  );
  if (!measurement_extractor) {
    throw new Error(
      'project-config: sweep.measurement_extractor is required when sweep block is present',
    );
  }
  return { start_command, draw_function, measurement_extractor };
}

// empty string is allowed here; the business-level emptiness check lives in validateProject.
function parseNorthStar(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error('project-config: northStar must be a string when present');
  }
  if (v.length > 140) {
    throw new Error(
      `project-config: northStar must be ≤ 140 characters (got ${v.length})`,
    );
  }
  return v;
}

function parseInstructions(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error('project-config: instructions must be a string when present');
  }
  return v;
}

function parseDemoProcess(v: unknown): DemoStep[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    throw new Error('project-config: demoProcess must be an array when present');
  }
  return v.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`project-config: demoProcess[${i}] must be an object`);
    }
    const s = item as Record<string, unknown>;
    if (typeof s.kind !== 'string' || !DEMO_STEP_KINDS.includes(s.kind as DemoStepKind)) {
      throw new Error(
        `project-config: demoProcess[${i}].kind must be one of capture|verify|present (got ${JSON.stringify(s.kind)})`,
      );
    }
    if (typeof s.text !== 'string') {
      throw new Error(`project-config: demoProcess[${i}].text must be a string`);
    }
    return { kind: s.kind as DemoStepKind, text: s.text };
  });
}

function parseSkills(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    throw new Error('project-config: skills must be an array when present');
  }
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') {
      throw new Error(`project-config: skills[${i}] must be a string`);
    }
  }
  return v as string[];
}

function parseKb(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') {
    throw new Error('project-config: kb must be a string or null when present');
  }
  return v;
}

function optionalArgv(v: unknown, label: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    throw new Error(`project-config: ${label} must be an argv string[] when present`);
  }
  for (const tok of v) {
    if (typeof tok !== 'string') {
      throw new Error(`project-config: ${label} entries must all be strings`);
    }
  }
  return v as string[];
}

function optionalString(v: unknown, label: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`project-config: ${label} must be a string when present`);
  }
  return v;
}
