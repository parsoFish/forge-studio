/**
 * `forge project migrate <id>` — one-shot config migration for a project's
 * `.forge/project.json` (W7-B6, projects-01 / crosscut-12).
 *
 * R1-03 moved the flat gate keys into the typed `testProcess` object and the
 * validator rejects un-migrated configs fail-closed with the full mapping —
 * a correct refusal that still left the operator hand-editing JSON (gitpulse,
 * the canonical verify-cycle ground, 409'd on contract-stages for weeks).
 * This applies that exact mapping mechanically:
 *
 *   quality_gate_cmd   → testProcess.local.cmd
 *   ci_gate            → testProcess.ci.cmd
 *   ci_fix_cmd         → testProcess.ci.fixCmd
 *   ci_gate_unset_env  → testProcess.ci.unsetEnv
 *   acceptance_gate    → testProcess.acceptance ({match, required,
 *                        requires_env → requiresEnv})
 *
 * Every OTHER key (unknown keys, `$…comment` keys, demo blocks) is preserved
 * byte-for-value; a present flat key whose value the mapping cannot carry
 * over EXACTLY (a non-array gate cmd, extra acceptance_gate subkeys) REFUSES
 * (`unmappable`) rather than deleting it (W7-B6 review F3); the migrated
 * object is re-validated with
 * `validateProjectConfig` (sidecar injected for validation only, mirroring
 * the loader) BEFORE anything is written, so this can never write a config
 * the loader would then refuse. The bridge's contract-stages 409 names this
 * command as the remedy.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  validateProjectConfig,
  readQualityGateSidecar,
  injectSidecarIntoTestProcess,
} from './project-config.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';

/** The flat→typed key mapping (mirror of the validator's own error text). */
const FLAT_KEYS = ['quality_gate_cmd', 'ci_gate', 'ci_fix_cmd', 'ci_gate_unset_env', 'acceptance_gate'] as const;

export type MigrateOutcome =
  | { ok: true; path: string; moved: string[] }
  | { ok: false; reason: 'not-found' | 'invalid-json' | 'nothing-to-migrate' | 'conflict' | 'unmappable' | 'validation-failed'; message: string };

/** The acceptance_gate subkeys the typed mapping can carry over — anything
 *  else present must REFUSE, never be silently dropped (W7-B6 review F3). */
const ACCEPTANCE_GATE_MAPPABLE_KEYS = new Set(['match', 'required', 'requires_env']);

/**
 * W7-B6 review F3 — mappability check, run BEFORE any mapping/delete. The
 * original mapping loops only handled the expected shapes (Array flat keys,
 * object acceptance_gate) while the FLAT_KEYS delete loop removed every
 * present flat key unconditionally: a string `ci_gate` (a plausible
 * hand-edit) was deleted, validation still passed without a `ci` block, and
 * an `ok:true` write silently lost the operator's CI gate — in a tool whose
 * contract is preserve-byte-for-value + validate-before-write. Any present
 * flat key whose value the mapping cannot carry over EXACTLY refuses with
 * the offending key(s) named.
 */
function unmappableFlatKeyReasons(obj: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  for (const k of ['quality_gate_cmd', 'ci_gate', 'ci_fix_cmd', 'ci_gate_unset_env'] as const) {
    if (obj[k] !== undefined && !Array.isArray(obj[k])) {
      reasons.push(`${k} must be an array of strings (got ${JSON.stringify(obj[k])?.slice(0, 80)})`);
    }
  }
  const gate = obj['acceptance_gate'];
  if (gate !== undefined) {
    if (gate === null || typeof gate !== 'object' || Array.isArray(gate)) {
      reasons.push(`acceptance_gate must be an object (got ${JSON.stringify(gate)?.slice(0, 80)})`);
    } else {
      const extras = Object.keys(gate as Record<string, unknown>).filter((k) => !ACCEPTANCE_GATE_MAPPABLE_KEYS.has(k));
      if (extras.length > 0) {
        reasons.push(`acceptance_gate carries key(s) the typed mapping cannot carry over: ${extras.join(', ')} (only match, required, requires_env map)`);
      }
    }
  }
  return reasons;
}

/**
 * Migrate `<projectRoot>/.forge/project.json` from the flat gate keys to the
 * typed `testProcess` object, in place. Pure decision + one write; returns a
 * typed outcome (never throws for the expected failure shapes).
 */
export function migrateProjectConfig(projectRoot: string): MigrateOutcome {
  const path = join(projectRoot, '.forge', 'project.json');
  if (!existsSync(path)) {
    return { ok: false, reason: 'not-found', message: `no project config at ${path}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { ok: false, reason: 'invalid-json', message: `${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid-json', message: `${path} must contain a JSON object` };
  }
  const obj = parsed as Record<string, unknown>;

  const present = FLAT_KEYS.filter((k) => obj[k] !== undefined);
  if (present.length === 0) {
    return { ok: false, reason: 'nothing-to-migrate', message: `${path} carries no flat gate keys — nothing to migrate` };
  }
  if (obj['testProcess'] !== undefined) {
    // The validator's "conflicting flat gate key(s) alongside testProcess"
    // shape — an automatic merge would have to guess which source wins, so
    // this stays a human decision.
    return {
      ok: false,
      reason: 'conflict',
      message: `${path} declares BOTH testProcess AND flat gate key(s) (${present.join(', ')}) — remove the flat keys yourself (testProcess is the source of truth)`,
    };
  }

  // W7-B6 review F3: refuse BEFORE mapping when any present flat key cannot
  // be carried over exactly — the delete loop below removes every present
  // flat key, so an unmapped-but-deleted value would be silent data loss.
  const unmappable = unmappableFlatKeyReasons(obj);
  if (unmappable.length > 0) {
    return {
      ok: false,
      reason: 'unmappable',
      message: `${path} carries flat gate key(s) this migration cannot map — fix them by hand: ${unmappable.join('; ')}`,
    };
  }

  const moved: string[] = [];
  const testProcess: Record<string, unknown> = {};

  if (Array.isArray(obj['quality_gate_cmd'])) {
    testProcess['local'] = { cmd: obj['quality_gate_cmd'] };
    moved.push('quality_gate_cmd → testProcess.local.cmd');
  }
  if (Array.isArray(obj['ci_gate']) || Array.isArray(obj['ci_fix_cmd']) || Array.isArray(obj['ci_gate_unset_env'])) {
    const ci: Record<string, unknown> = {};
    if (Array.isArray(obj['ci_gate'])) { ci['cmd'] = obj['ci_gate']; moved.push('ci_gate → testProcess.ci.cmd'); }
    if (Array.isArray(obj['ci_fix_cmd'])) { ci['fixCmd'] = obj['ci_fix_cmd']; moved.push('ci_fix_cmd → testProcess.ci.fixCmd'); }
    if (Array.isArray(obj['ci_gate_unset_env'])) { ci['unsetEnv'] = obj['ci_gate_unset_env']; moved.push('ci_gate_unset_env → testProcess.ci.unsetEnv'); }
    testProcess['ci'] = ci;
  }
  const gate = obj['acceptance_gate'];
  if (gate !== null && typeof gate === 'object' && !Array.isArray(gate)) {
    const g = gate as Record<string, unknown>;
    testProcess['acceptance'] = {
      match: g['match'],
      required: g['required'],
      ...(g['requires_env'] !== undefined ? { requiresEnv: g['requires_env'] } : {}),
    };
    moved.push('acceptance_gate → testProcess.acceptance (requires_env → requiresEnv)');
  }

  const migrated: Record<string, unknown> = { ...obj, testProcess };
  for (const k of FLAT_KEYS) delete migrated[k];

  // Validate BEFORE writing — sidecar injected into a validation COPY only
  // (the loader's own single-source rule; the sidecar is never mirrored into
  // the JSON). A config this would break is refused with the validator's text.
  const forValidation: Record<string, unknown> = structuredClone(migrated);
  const sidecar = readQualityGateSidecar(projectRoot);
  if (sidecar) injectSidecarIntoTestProcess(forValidation, sidecar);
  try {
    validateProjectConfig(forValidation);
  } catch (err) {
    return { ok: false, reason: 'validation-failed', message: `migration would produce an invalid config — ${err instanceof Error ? err.message : String(err)}` };
  }

  writeFileSync(path, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
  return { ok: true, path, moved };
}

/** `forge project migrate <id>` CLI handler. Resolves the project dir under
 *  the configured projects root and prints what moved. */
export function cmdProjectMigrate(args: string[]): number {
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('usage: forge project migrate <project-id>');
    return 2;
  }
  const forgeRoot = resolve('.');
  const projectsDir = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
  const projectRoot = join(projectsDir, id);
  if (!existsSync(projectRoot)) {
    console.error(`forge project migrate: no project directory at ${projectRoot}`);
    return 1;
  }
  const out = migrateProjectConfig(projectRoot);
  if (!out.ok) {
    console.error(`forge project migrate: ${out.message}`);
    return out.reason === 'nothing-to-migrate' ? 0 : 1;
  }
  console.log(`migrated ${out.path}:`);
  for (const m of out.moved) console.log(`  ${m}`);
  return 0;
}
