/**
 * Per-project configuration — the `ProjectConfig` type family (pure type
 * declarations, no runtime code). Split out of `project-config.ts` (the
 * barrel) when that file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`. A pure
 * leaf: no dependency on any sibling file, so it can never be part of an
 * import cycle. Siblings: `project-config-validate.ts` (`validateProjectConfig`'s
 * field parsers), `project-config-sidecar.ts` (the `.forge/quality_gate_cmd`
 * sidecar read + injection).
 */

import type { DemoStep, ReleaseConfig, BuildProcess } from '@forge/contracts/studio/types.ts';

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

/**
 * R1-03-F1 — the typed test process (contract object). Gathers the previously
 * scattered flat gate fields into one declared object in `.forge/project.json`:
 *
 *   testProcess.local      — the fast per-WI gate (was `quality_gate_cmd`, C1)
 *   testProcess.ci         — the full CI delivery net (was `ci_gate` +
 *                            `ci_fix_cmd` + `ci_gate_unset_env`, C1b)
 *   testProcess.acceptance — the live-acceptance tier (was `acceptance_gate`, C7)
 *
 * The JSON on disk declares ONLY `testProcess` (flat keys are rejected with a
 * migration message — no permanent back-compat shim); the loaded
 * `ProjectConfig`'s flat accessors below are DERIVED from it so the ~20
 * consumers (gate runners, PM acceptance enforcement, preflight, bridge/UI)
 * read on unchanged. Each process takes an optional `timeoutMs` inheriting
 * ADR-036's semantics: the FORGE_*_TIMEOUT_MS env vars (per-run operator
 * override) still win over a declared timeout, which wins over the default.
 */
export type TestProcessLocal = {
  /**
   * Fast per-WI gate argv. Omittable in the JSON when the
   * `.forge/quality_gate_cmd` sidecar declares it (the loader single-sources
   * from the sidecar; JSON wins when both are present — same rule as ever,
   * re-rooted onto the typed object).
   */
  cmd: string[];
  /** Overrides the 30-min default; `FORGE_GATE_TIMEOUT_MS` still wins. */
  timeoutMs?: number;
};
export type TestProcessCi = {
  /**
   * The project's FULL CI verification — mirrors the project's CI workflow.
   * Run DIRECTLY (operator-trusted) as the final delivery gate before a PR
   * opens, so a cycle can't ship while whole-module CI is red. Unlike the
   * pipe-banned per-WI gate, a `["bash","-c","…&&…"]` chain is permitted —
   * the operator authored it.
   */
  cmd: string[];
  /** Auto-formatters applied best-effort BEFORE `cmd` so the PR is fmt-clean. */
  fixCmd?: string[];
  /**
   * Env-var names STRIPPED when running `cmd`/`fixCmd` (contract A3) so the
   * delivery gate is hermetic — a live-test trigger in the cycle env (e.g.
   * `TF_ACC=1`) must not leak into the CI mirror. `PATH`/`HOME`/`SHELL` are
   * blocklisted.
   */
  unsetEnv?: string[];
  /** Overrides the 20-min CI default; `FORGE_CI_GATE_TIMEOUT_MS` still wins. */
  timeoutMs?: number;
};
export type TestProcessAcceptance = {
  /** Substring identifying a live-acceptance gate in a WI quality_gate_cmd. */
  match: string;
  /** When true, every initiative must include ≥1 WI whose gate contains `match`. */
  required: boolean;
  /** Env vars that MUST be set for a matching gate to run live (else the gate ERRORS, never false-passes). */
  requiresEnv?: string[];
  /** Reserved: acceptance gates run as per-WI gates, so `FORGE_GATE_TIMEOUT_MS` semantics apply. */
  timeoutMs?: number;
};
export type TestProcess = {
  /** Required after load (JSON or sidecar — a config with neither fails closed). */
  local: TestProcessLocal;
  ci?: TestProcessCi;
  acceptance?: TestProcessAcceptance;
};

export type ProjectConfig = {
  /** The declared test process — the single JSON source of the gate fields below. */
  testProcess: TestProcess;
  /** @deprecated derived from `testProcess.local.cmd` at load — never written to JSON. */
  quality_gate_cmd: string[];
  /** @deprecated derived from `testProcess.ci.cmd` at load — never written to JSON. */
  ci_gate?: string[];
  /** @deprecated derived from `testProcess.ci.fixCmd` at load — never written to JSON. */
  ci_fix_cmd?: string[];
  /** @deprecated derived from `testProcess.ci.unsetEnv` at load — never written to JSON. */
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
  /** @deprecated derived from `testProcess.acceptance` at load — never written to JSON. */
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
   * Project-root-relative subdirectory under which a project's in-repo forge
   * MACHINERY lives (e.g. `"forge"` → `forge/skills/`). Since ADR 035, Brain 3,
   * development history, and the contract are **forge-owned and central** (in the
   * forge repo, not here) — `artifactRoot` no longer governs them. It now only
   * scopes the in-repo demo the unifier authors into the PR (`projectDemoRelDir`
   * → `<artifactRoot>/history/<id>/demo`) and where the project keeps committed
   * demo machinery. Default `"."` keeps the legacy in-root demo layout. Runtime
   * scratch (`_architect/`, worktree `demo/<id>/`, `.forge/`) is unchanged.
   * Validated as a clean relative path (no leading `/`, no `..`).
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
  /**
   * R1-04-F3 — optional build process, declared separately from `testProcess`:
   * `local` (compile/package command) + `remote` (CI-workflow path). A project
   * can gate on tests while its build breaks; this makes the build a first-class,
   * checkable obligation. Fail-closed when malformed. Absent ⇒ no build clause.
   */
  buildProcess?: BuildProcess;
  /**
   * R2-08-F3 — the project's `owner/name` GitHub full name, the repo→project
   * mapping declaration `resolveProjectIdForRepo` reads for the `pr-merged` /
   * `issue-raised` project-event trigger kinds. Optional — absent means this
   * project can never match a project-event trigger (fail-closed; no
   * auto-discover / directory-name fallback anywhere). Validated by the SAME
   * `REPO_RE` `orchestrator/trigger-payload.ts` uses to extract a payload's
   * repo — never a second, hand-copied regex.
   */
  repo?: string;
};
