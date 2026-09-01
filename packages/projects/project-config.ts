/**
 * Per-project configuration loader. Implements CONTRACTS.md C1 + C2 + C26 +
 * C27 + C28: each managed project declares its quality gate, optional holistic
 * metrics, and optional parameter-sweep plug-in points in
 * `<project-root>/.forge/project.json`.
 *
 * The loader is **fail-closed** per council 04 F8 + plan 04 Open Q4: any
 * malformed file (malformed JSON, missing required fields) throws so the
 * scheduler refuses to schedule the initiative. The only non-throwing outcome
 * on parse failure is "file does not exist" — in which case the loader returns
 * `null` and the caller decides whether the absence is acceptable (S4 caller
 * in the live cycle refuses; the bench tests exercise both branches).
 *
 * The schema lives in `docs/schemas/project-config.schema.json`. The loader's
 * hand-rolled validator below is the source of truth for *behavioural* checks;
 * the JSON-schema file is the operator-facing reference.
 *
 * This file is the BARREL of a concern split (it grew past the 800-line
 * baseline cap): `loadProjectConfig`, `readAgentInstructionsFile` and
 * `resolveProjectIdForRepo` stay here (moving `resolveProjectIdForRepo` would
 * create a literal circular import with `loadProjectConfig`, which it calls in
 * a loop). `validateProjectConfig` and its one cross-package field parser,
 * `parseRepo`, ALSO stay here rather than moving to `project-config-validate.ts`
 * with the rest of the field parsers: `parseRepo` needs `REPO_RE` from
 * `@forge/flows/trigger-payload.ts`, the SAME already-baselined edge
 * `resolveProjectIdForRepo` needs (`scripts/baselines/boundaries.json`,
 * `package-layer-order|packages/projects/project-config.ts|packages/flows/trigger-payload.ts`).
 * Moving `parseRepo` out would add a second, unbaselined edge to the same
 * target; moving `validateProjectConfig` out too (so it could call a
 * validate.ts-resident `parseRepo`) would instead create a real barrel↔
 * validate.ts import cycle (the barrel already needs `validateProjectConfig`
 * for `loadProjectConfig`). This worker was told not to touch
 * `scripts/baselines/` and not to create a cycle, so both stay here. Every
 * symbol this file exported before the split is still exported (directly or
 * re-exported) from this same path. Siblings: `project-config-types.ts` (the
 * `ProjectConfig` type family), `project-config-validate.ts` (the other field
 * parsers), `project-config-sidecar.ts` (the `.forge/quality_gate_cmd`
 * sidecar).
 */

import { join, resolve } from 'node:path';
import { guardedReadFile } from '@forge/kernel';
import { REPO_RE } from '@forge/flows/trigger-payload.ts';
import { discoverProjects } from '../../orchestrator/studio/registry.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';

export type { DemoStep, DemoStepKind } from '@forge/contracts/studio/types.ts';
export { DEMO_STEP_KINDS } from '@forge/contracts/studio/types.ts';
export type { ReleaseStep, ReleaseConfig, BuildProcess } from '@forge/contracts/studio/types.ts';

export type {
  MetricsConfig,
  SweepConfig,
  LoggingConfig,
  AcceptanceGateConfig,
  TestProcessLocal,
  TestProcessCi,
  TestProcessAcceptance,
  TestProcess,
  ProjectConfig,
} from './project-config-types.ts';
import type { AcceptanceGateConfig, ProjectConfig } from './project-config-types.ts';

export { readQualityGateSidecar, injectSidecarIntoTestProcess } from './project-config-sidecar.ts';
import { readQualityGateSidecar, injectSidecarIntoTestProcess } from './project-config-sidecar.ts';

import {
  parseArtifactRoot,
  parseBuildProcess,
  parseDemoProcess,
  parseInstructions,
  parseKb,
  parseLogging,
  parseMetrics,
  parseNorthStar,
  parseReleaseProcess,
  parseSkills,
  parseSweep,
  parseTestProcess,
  optionalArgv,
} from './project-config-validate.ts';

export const PROJECT_CONFIG_REL_PATH = '.forge/project.json';

/**
 * The project's agent-instruction file candidates, in precedence order. AGENTS.md
 * is the canonical single source (Stage A); CLAUDE.md is accepted for legacy
 * projects. When one exists, its content IS the project's `instructions` — the
 * Studio `instructions` surface, `forge preflight` C8, and the instructions-creator
 * all bind to this one file rather than a separate stored string.
 */
export const AGENT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * Load and validate `<projectRoot>/.forge/project.json`. Returns `null` if
 * the file doesn't exist; throws on any structural / semantic violation
 * (callers depend on the throw to enforce fail-closed scheduling).
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig | null {
  // SEC-04 leaf (residual #1, WIRE-REACHABLE via POST /api/verdict send-back →
  // loadProjectConfig(manifest.project_repo_path)): route the WHOLE
  // `<projectRoot>/.forge/project.json` path — LEAF INCLUDED — through the guard.
  // `projectRoot` is the TRUSTED root: the verdict send-back validates it with
  // isContainedProjectRepoPath BEFORE this call; contract-stages realpath-contains
  // it; resolveProjectIdForRepo passes only discovered project dirs. `.forge` +
  // `project.json` ride as their OWN segments (split from the REL_PATH constant,
  // never a second hardcoded literal). A symlinked `.forge/project.json` leaf — or
  // a symlinked `.forge` dir — inside the blessed projectRoot fails the guard's
  // per-segment identity walk → guardedReadFile returns null → treated as absent
  // (config null, fail-closed), NEVER read out of root. Was a raw
  // existsSync+join+readFileSync that FOLLOWED such a symlink — the exact
  // guard-the-dir/read-the-leaf-raw hole SEC-04 closes.
  const raw = guardedReadFile(projectRoot, PROJECT_CONFIG_REL_PATH.split('/'));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `project-config: ${join(projectRoot, PROJECT_CONFIG_REL_PATH)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Single-source the local gate from the `.forge/quality_gate_cmd` sidecar
  // when project.json omits it (the JSON wins when both are present). Same
  // single-source rule as ever (R1-03-F1), re-rooted onto the typed object:
  // the sidecar fills `testProcess.local.cmd`. Shared with the bridge's PUT
  // validation copy via `injectSidecarIntoTestProcess` so the two can never
  // diverge (review finding).
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const sidecar = readQualityGateSidecar(projectRoot);
    if (sidecar) injectSidecarIntoTestProcess(parsed as Record<string, unknown>, sidecar);
  }
  const config = validateProjectConfig(parsed);
  // AGENTS.md single-source binding (Stage A): a managed project's instructions
  // live in ONE place — its agent-instruction file (AGENTS.md, or legacy
  // CLAUDE.md). When that file exists it IS the instructions; the optional
  // `instructions` field in project.json is a legacy fallback used only when no
  // such file is present. This keeps the Studio `instructions` surface bound to
  // the same file `forge preflight` C8 checks and the instructions-creator writes.
  const agentFile = readAgentInstructionsFile(projectRoot);
  if (agentFile) {
    return { ...config, instructions: agentFile.content };
  }
  return config;
}

/**
 * Read the project's canonical agent-instruction file (AGENTS.md preferred, else
 * legacy CLAUDE.md). Returns `{ file, content }` with the trimmed content, or
 * `null` when neither exists or the content is empty. Best-effort — an unreadable
 * file is treated as absent.
 */
export function readAgentInstructionsFile(
  projectRoot: string,
): { file: string; content: string } | null {
  for (const file of AGENT_INSTRUCTION_FILES) {
    // SEC-04 leaf: route the WHOLE `<projectRoot>/<file>` path (leaf included)
    // through the guard — `projectRoot` is the TRUSTED root, the instruction
    // filename its own segment. A symlinked/hardlinked AGENTS.md/CLAUDE.md is
    // refused (null, same as absent/unreadable), never disclosed as the
    // project's `instructions`. Was a raw `join`+`readFileSync` — the exact
    // guard-the-config-but-read-the-instructions-leaf-raw hole SEC-04 closes.
    const raw = guardedReadFile(projectRoot, [file]);
    if (raw === null) continue;
    const content = raw.trim();
    if (content) return { file, content };
  }
  return null;
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

  // R1-03-F1: the flat gate keys moved into `testProcess` — one declared
  // object, one JSON source. Rejected fail-closed with the full mapping so an
  // un-migrated config is a one-edit fix, never a silent dual-source. (The
  // never-do rule forbids a permanent both-shapes fallback; only this error
  // message may know the old names.)
  const FLAT_GATE_KEY_MAPPING: Record<string, string> = {
    quality_gate_cmd: 'testProcess.local.cmd',
    ci_gate: 'testProcess.ci.cmd',
    ci_fix_cmd: 'testProcess.ci.fixCmd',
    ci_gate_unset_env: 'testProcess.ci.unsetEnv',
    acceptance_gate: 'testProcess.acceptance ({match, required, requiresEnv})',
  };
  const flatPresent = Object.keys(FLAT_GATE_KEY_MAPPING).filter((k) => obj[k] !== undefined);
  if (flatPresent.length > 0) {
    const mapping = flatPresent.map((k) => `${k} → ${FLAT_GATE_KEY_MAPPING[k]}`).join('; ');
    throw new Error(
      obj.testProcess !== undefined
        ? `project-config: conflicting flat gate key(s) alongside testProcess — remove: ${mapping}`
        : `project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: ${mapping}. The .forge/quality_gate_cmd sidecar still single-sources testProcess.local.cmd when the JSON omits it.`,
    );
  }

  const testProcess = parseTestProcess(obj.testProcess);

  // Derived flat accessors — consumers read on unchanged (see the type doc).
  const quality_gate_cmd = testProcess.local.cmd;
  const ci_gate = testProcess.ci?.cmd;
  const ci_fix_cmd = testProcess.ci?.fixCmd;
  const ci_gate_unset_env = testProcess.ci?.unsetEnv;
  const acceptance_gate: AcceptanceGateConfig | undefined = testProcess.acceptance
    ? {
        match: testProcess.acceptance.match,
        required: testProcess.acceptance.required,
        ...(testProcess.acceptance.requiresEnv !== undefined
          ? { requires_env: testProcess.acceptance.requiresEnv }
          : {}),
      }
    : undefined;

  const standing_work_item_acs = optionalArgv(
    obj.standing_work_item_acs,
    'standing_work_item_acs',
  );

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
  const buildProcess = parseBuildProcess(obj.buildProcess);
  const repo = parseRepo(obj.repo);

  return {
    testProcess,
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
    ...(buildProcess !== undefined ? { buildProcess } : {}),
    ...(repo !== undefined ? { repo } : {}),
  };
}

/**
 * Parse + validate the optional `repo` field ("owner/name"). Fail-closed:
 * present-but-malformed throws (mirrors every other project.json field —
 * silently ignoring or coercing a bad value would let a project THINK it is
 * wired to a repo it never validly declared). Validated by the SAME `REPO_RE`
 * `orchestrator/trigger-payload.ts` exports and payload extraction already
 * uses — never a second, hand-copied regex (R2-08-F3 anti-duplication rule).
 */
function parseRepo(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !REPO_RE.test(v)) {
    throw new Error(
      `project-config: repo must be a valid "owner/name" string matching ${REPO_RE} when present (got ${JSON.stringify(v)})`,
    );
  }
  return v;
}

/**
 * R2-08-F3 (the crux) — resolve a webhook payload's `owner/repo` string to a
 * REAL project id from the enumeration (`discoverProjects` /
 * `normalizeProjectId`, `orchestrator/studio/registry.ts`) — NEVER the raw
 * payload string, never a raw/un-normalized directory name.
 *
 * Resolution is a pure IDENTITY match against each discovered project's
 * declared `repo:` (this module's own `loadProjectConfig`, so the SAME
 * `REPO_RE` validation `parseRepo` above already applied backs every
 * candidate). No auto-discover arm, no directory-name/tail fallback: an
 * undeclared `repo` can never match. Ambiguity — two projects declaring the
 * SAME repo — fails closed too (`null`), never an arbitrary
 * first/last-wins pick.
 *
 * CONTAINMENT: `repo` is compared, never propagated into a path. A malformed
 * `repo` (fails `REPO_RE`) is rejected BEFORE any directory scan even starts
 * — the untrusted string never reaches the filesystem in any form. The scan
 * itself only ever touches the REAL, already-enumerated project directories
 * `discoverProjects` returns (fixed, trusted roots); `repo` never becomes a
 * path segment anywhere in this function.
 *
 * Best-effort per project: a project whose `.forge/project.json` fails to
 * load (malformed, unrelated to `repo`) is skipped rather than crashing
 * resolution for an event about a DIFFERENT project — mirrors
 * `cli/bridge-hooks.ts`'s `findWebhookTrigger` per-flow try/catch precedent.
 */
export function resolveProjectIdForRepo(forgeRoot: string, repo: string): string | null {
  if (!REPO_RE.test(repo)) return null;
  const root = resolve(forgeRoot);
  const projectsDir = resolveProjectsDir(root, loadConfig(defaultConfigPath(root)));
  const discovered = discoverProjects(projectsDir, root);

  let matchedId: string | null = null;
  let matchCount = 0;
  for (const proj of discovered) {
    if (!proj.hasConfig) continue;
    let cfg: ProjectConfig | null;
    try {
      cfg = loadProjectConfig(proj.absPath);
    } catch {
      continue; // a malformed sibling project must not break resolution for THIS event
    }
    if (cfg?.repo === repo) {
      matchCount++;
      matchedId = proj.id;
    }
  }
  return matchCount === 1 ? matchedId : null;
}
