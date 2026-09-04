/**
 * Per-project configuration — the `.forge/quality_gate_cmd` sidecar concern:
 * reading it, and injecting it into a parsed `testProcess.local.cmd` when the
 * JSON omits `cmd`. Split out of `project-config.ts` (the barrel) when that
 * file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`.
 * Siblings: `project-config-types.ts` (the `ProjectConfig` type family),
 * `project-config-validate.ts` (`validateProjectConfig`'s field parsers).
 */

import { guardedReadFile } from '@forge/kernel';

/**
 * The `quality_gate_cmd` sidecar — `.forge/quality_gate_cmd`, a single
 * whitespace-separated command line. Preflight already reads it
 * (`packages/projects/preflight.ts`); `loadProjectConfig` reads it too so a project can
 * declare the gate in ONE place. When `project.json` omits `quality_gate_cmd`,
 * the sidecar is the source of truth; when both are present, the JSON wins
 * (explicit override). The two were kept in lockstep by hand before — now the
 * sidecar can stand alone.
 */
const QUALITY_GATE_SIDECAR_REL_PATH = '.forge/quality_gate_cmd';

/**
 * Read + tokenise the `.forge/quality_gate_cmd` sidecar (a single
 * whitespace-separated command line) into an argv array. Returns `null` when the
 * file is absent, unreadable, or empty — the caller falls back to the JSON field
 * (or throws if neither is present). Whitespace-splitting mirrors how preflight
 * already consumes the sidecar (`packages/projects/preflight.ts readQualityGateCmd`).
 */
export function readQualityGateSidecar(projectRoot: string): string[] | null {
  // SEC-04 leaf: route the WHOLE `.forge/quality_gate_cmd` path (leaf included)
  // through the guard — `projectRoot` is the TRUSTED root, `.forge` +
  // `quality_gate_cmd` its own segments (split from the REL_PATH constant, never
  // a second hardcoded literal). A symlinked sidecar is refused (null), so an
  // out-of-root file's cmd tokens can NEVER fold into testProcess.local.cmd when
  // project.json omits `cmd`. Was a raw `join`+`readFileSync`.
  const raw = guardedReadFile(projectRoot, QUALITY_GATE_SIDECAR_REL_PATH.split('/'));
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const argv = trimmed.split(/\s+/).filter((t) => t.length > 0);
  return argv.length > 0 ? argv : null;
}

/**
 * The ONE sidecar-injection rule (R1-03-F1), shared by the loader and the
 * bridge's PUT-validation copy: when the raw config's `testProcess.local.cmd`
 * is missing (testProcess absent, local absent/null, or a local object with
 * no `cmd`), fill `cmd` from the sidecar — MERGING into any existing local
 * object (a sidecar-sourced project may still declare `local.timeoutMs`).
 * A present-but-malformed `testProcess` (string/array) is deliberately left
 * untouched so `parseTestProcess` fail-closes on it instead of the injection
 * masking the breakage (review finding).
 */
export function injectSidecarIntoTestProcess(
  obj: Record<string, unknown>,
  sidecarCmd: string[],
): void {
  const rawTp = obj.testProcess;
  if (rawTp !== undefined && (rawTp === null || typeof rawTp !== 'object' || Array.isArray(rawTp))) {
    return; // malformed — let the validator throw on the declared shape
  }
  const tp = (rawTp as Record<string, unknown> | undefined) ?? {};
  const rawLocal = tp.local;
  const localIsObject = rawLocal !== null && typeof rawLocal === 'object' && !Array.isArray(rawLocal);
  const cmdMissing =
    rawLocal === undefined ||
    rawLocal === null ||
    (localIsObject && (rawLocal as Record<string, unknown>).cmd === undefined);
  if (!cmdMissing) return;
  const local = localIsObject ? { ...(rawLocal as Record<string, unknown>) } : {};
  local.cmd = sidecarCmd;
  tp.local = local;
  obj.testProcess = tp;
}
