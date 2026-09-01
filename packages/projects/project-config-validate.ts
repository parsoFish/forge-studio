/**
 * Per-project configuration — `validateProjectConfig`'s field parsers (every
 * `parse*` helper besides `parseRepo`). Split out of `project-config.ts` (the
 * barrel) when that file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`.
 * Siblings: `project-config-types.ts` (the `ProjectConfig` type family),
 * `project-config-sidecar.ts` (the `.forge/quality_gate_cmd` sidecar).
 *
 * `validateProjectConfig` itself (the dispatcher) and `parseRepo` stay in the
 * barrel rather than moving here with the rest of the field parsers.
 * `parseRepo` is the one parser with a cross-package import
 * (`REPO_RE` from `@forge/flows/trigger-payload.ts`) — the SAME already-
 * baselined edge `resolveProjectIdForRepo` needs
 * (`scripts/baselines/boundaries.json`,
 * `package-layer-order|packages/projects/project-config.ts|packages/flows/trigger-payload.ts`).
 * Moving `parseRepo` here would add a SECOND, unbaselined edge from this file
 * to the same target; moving `validateProjectConfig` here too (so it could
 * call a barrel-resident `parseRepo` without duplicating it) would instead
 * create a real barrel↔validate.ts import cycle (the barrel already needs
 * `validateProjectConfig` for `loadProjectConfig`). This worker was told not
 * to touch `scripts/baselines/` and not to create a cycle, so both stay
 * together in the barrel. See `project-config.ts`'s header and this split's
 * report for the full reasoning.
 */

import {
  DEMO_STEP_KINDS,
  RELEASE_STEP_KINDS,
  RELEASE_STEP_PHASES,
} from '@forge/contracts/studio/types.ts';
import type {
  BuildProcess,
  DemoStep,
  DemoStepKind,
  ReleaseConfig,
  ReleaseStep,
  ReleaseStepKind,
  ReleaseStepPhase,
} from '@forge/contracts/studio/types.ts';
import type {
  LoggingConfig,
  MetricsConfig,
  SweepConfig,
  TestProcess,
  TestProcessAcceptance,
  TestProcessCi,
  TestProcessLocal,
} from './project-config-types.ts';

/** Optional positive-integer millisecond timeout (R1-03-F1). */
function parseTimeoutMs(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`project-config: ${label} must be a positive integer of milliseconds`);
  }
  return value;
}

/**
 * Parse + validate the `testProcess` contract object (R1-03-F1). Fail-closed:
 * a missing/degenerate `local.cmd` throws (same guarantee the required flat
 * `quality_gate_cmd` gave; the loader may have filled it from the sidecar
 * before this runs).
 */
export function parseTestProcess(value: unknown): TestProcess {
  if (value === undefined || value === null) {
    throw new Error(
      'project-config: missing required `testProcess` — declare {local: {cmd: [...]}} (or provide the .forge/quality_gate_cmd sidecar)',
    );
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('project-config: `testProcess` must be an object');
  }
  const tp = value as Record<string, unknown>;

  const rawLocal = tp.local;
  if (rawLocal === undefined || rawLocal === null || typeof rawLocal !== 'object' || Array.isArray(rawLocal)) {
    throw new Error(
      'project-config: missing required `testProcess.local` (object with `cmd` argv; the .forge/quality_gate_cmd sidecar can supply cmd)',
    );
  }
  const localObj = rawLocal as Record<string, unknown>;
  const localCmd = optionalArgv(localObj.cmd, 'testProcess.local.cmd');
  if (!localCmd) {
    throw new Error('project-config: missing required `testProcess.local.cmd` (argv)');
  }
  const local: TestProcessLocal = {
    cmd: localCmd,
    ...(parseTimeoutMs(localObj.timeoutMs, 'testProcess.local.timeoutMs') !== undefined
      ? { timeoutMs: parseTimeoutMs(localObj.timeoutMs, 'testProcess.local.timeoutMs') }
      : {}),
  };

  let ci: TestProcessCi | undefined;
  if (tp.ci !== undefined && tp.ci !== null) {
    if (typeof tp.ci !== 'object' || Array.isArray(tp.ci)) {
      throw new Error('project-config: `testProcess.ci` must be an object');
    }
    const ciObj = tp.ci as Record<string, unknown>;
    const ciCmd = optionalArgv(ciObj.cmd, 'testProcess.ci.cmd');
    if (!ciCmd) {
      throw new Error('project-config: `testProcess.ci` requires a `cmd` argv');
    }
    const fixCmd = optionalArgv(ciObj.fixCmd, 'testProcess.ci.fixCmd');
    const unsetEnv = parseCiGateUnsetEnv(ciObj.unsetEnv);
    const ciTimeout = parseTimeoutMs(ciObj.timeoutMs, 'testProcess.ci.timeoutMs');
    ci = {
      cmd: ciCmd,
      ...(fixCmd ? { fixCmd } : {}),
      ...(unsetEnv ? { unsetEnv } : {}),
      ...(ciTimeout !== undefined ? { timeoutMs: ciTimeout } : {}),
    };
  }

  let acceptance: TestProcessAcceptance | undefined;
  if (tp.acceptance !== undefined && tp.acceptance !== null) {
    if (typeof tp.acceptance === 'object' && !Array.isArray(tp.acceptance)) {
      const a = tp.acceptance as Record<string, unknown>;
      if (typeof a.match !== 'string' || a.match.trim() === '') {
        throw new Error('project-config: `testProcess.acceptance.match` must be a non-empty string');
      }
      if (typeof a.required !== 'boolean') {
        throw new Error('project-config: `testProcess.acceptance.required` must be a boolean');
      }
      let requiresEnv: string[] | undefined;
      if (a.requiresEnv !== undefined) {
        if (
          !Array.isArray(a.requiresEnv) ||
          a.requiresEnv.some((e) => typeof e !== 'string' || e.trim() === '')
        ) {
          throw new Error(
            'project-config: `testProcess.acceptance.requiresEnv` must be an array of non-empty strings',
          );
        }
        requiresEnv = a.requiresEnv as string[];
      }
      const accTimeout = parseTimeoutMs(a.timeoutMs, 'testProcess.acceptance.timeoutMs');
      acceptance = {
        match: a.match,
        required: a.required,
        ...(requiresEnv !== undefined ? { requiresEnv } : {}),
        ...(accTimeout !== undefined ? { timeoutMs: accTimeout } : {}),
      };
    } else {
      throw new Error('project-config: `testProcess.acceptance` must be an object');
    }
  }

  return { local, ...(ci ? { ci } : {}), ...(acceptance ? { acceptance } : {}) };
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
export function parseArtifactRoot(v: unknown): string | undefined {
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
export function parseReleaseProcess(raw: unknown): ReleaseConfig | undefined {
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
 * R1-04-F3 — parse the optional typed `buildProcess`. Fail-closed, mirrors
 * `parseReleaseProcess`: absent/null ⇒ `undefined`; present-but-malformed
 * throws (surfaced by preflight / studio lint). `local` is an argv command;
 * `remote` is a clean worktree-relative CI-workflow path.
 */
export function parseBuildProcess(raw: unknown): BuildProcess | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('project-config: buildProcess must be an object when present');
  }
  const b = raw as Record<string, unknown>;
  const local = optionalArgv(b.local, 'buildProcess.local');
  const remote = parseReleasePath(b.remote, 'buildProcess.remote');
  return {
    // An empty `local` argv is not a declaration — treat it as absent (fail-closed).
    ...(local && local.length > 0 ? { local } : {}),
    ...(remote !== undefined ? { remote } : {}),
  };
}


export function parseLogging(raw: unknown): LoggingConfig | undefined {
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

export function parseMetrics(raw: unknown): MetricsConfig | undefined {
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

export function parseSweep(raw: unknown): SweepConfig | undefined {
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
export function parseNorthStar(v: unknown): string | undefined {
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

export function parseInstructions(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error('project-config: instructions must be a string when present');
  }
  return v;
}

export function parseDemoProcess(v: unknown): DemoStep[] | undefined {
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
    // Optional `element` names a demo-element kind from the library (composed demo).
    if (s.element !== undefined && typeof s.element !== 'string') {
      throw new Error(`project-config: demoProcess[${i}].element must be a string when present`);
    }
    return {
      kind: s.kind as DemoStepKind,
      text: s.text,
      ...(typeof s.element === 'string' && s.element ? { element: s.element } : {}),
    };
  });
}

export function parseSkills(v: unknown): string[] | undefined {
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

export function parseKb(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') {
    throw new Error('project-config: kb must be a string or null when present');
  }
  return v;
}

export function optionalArgv(v: unknown, label: string): string[] | undefined {
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

/**
 * Env var names `ci_gate_unset_env` must never strip. project.json is external
 * input at a trust boundary; declaring one of these would WEAKEN the gate
 * child rather than tighten it — PATH loss → wrong-binary resolution, HOME/
 * SHELL loss → broken tool/shell config. `ci_gate_unset_env` exists to drop
 * live-test TRIGGER vars (TF_ACC, RUN_INTEGRATION, …), never process
 * fundamentals. (Minimum blocklist per the R5-02 F4 decision — those three.)
 */
const CI_GATE_UNSET_ENV_BLOCKLIST: readonly string[] = ['PATH', 'HOME', 'SHELL'];

/**
 * Validate `ci_gate_unset_env` as an argv string[] (via optionalArgv) and
 * reject any blocklisted process-fundamental name — fail fast at the boundary.
 */
function parseCiGateUnsetEnv(v: unknown, label = 'testProcess.ci.unsetEnv'): string[] | undefined {
  const names = optionalArgv(v, label);
  if (names === undefined) return undefined;
  for (const name of names) {
    if (CI_GATE_UNSET_ENV_BLOCKLIST.includes(name)) {
      throw new Error(
        `project-config: ${label} must not include ${name} — unsetting it would weaken the gate child (e.g. PATH loss → wrong-binary resolution), not act as a live-test trigger. Use it only for live-test trigger vars like TF_ACC.`,
      );
    }
  }
  return names;
}

function optionalString(v: unknown, label: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`project-config: ${label} must be a string when present`);
  }
  return v;
}
