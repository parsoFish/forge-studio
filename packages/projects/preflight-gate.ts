/**
 * forge↔project contract preflight — the "test" clause family (US-4.1 / ADR-017).
 *
 * C1 (fast, trustworthy quality gate, HARD), C1b (CI merge-boundary net,
 * advisory-when-absent), and C7 (live-acceptance tier, advisory visibility).
 * Split out of `preflight.ts` (which stays the barrel — `runPreflight` plus
 * the re-exports) when that file grew past the 800-line baseline cap; see
 * `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`. Siblings:
 * `preflight-instructions.ts` (C5/C8), `preflight-demo.ts` (DEMO family),
 * `preflight-release.ts` (C10), `preflight-build.ts` (BUILD/ARTIFACTS),
 * `preflight-repo.ts` (C2/C6).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectConfig } from './project-config.ts';
import type { ClauseResult } from '@forge/kernel';

// --- documented heuristics (single source of truth) ---

// C1: a quality gate is "plausibly fast" if it is a single deterministic
// command. We cannot run it here (could be minutes / require deps), so the
// heuristic is structural: the declared command must be ONE command (no
// shell pipes/&&/; chaining) and must not invoke a known-slow umbrella
// (e2e/playwright/cypress as the *primary* test command — those are the
// 18k-LOC-suite smell that broke trafficGame's per-iteration gate).
const SLOW_GATE_MARKERS = ['playwright', 'cypress', 'e2e', 'integration'];

// --- C1: fast, trustworthy quality gate (HARD) ---

function checkC1(dir: string, cfg: ProjectConfig | null, cfgError: string | null): ClauseResult {
  const base = { clause: 'C1' as const, title: 'Fast, trustworthy quality gate', hard: true };
  if (cfgError !== null) {
    return {
      ...base,
      pass: false,
      detail: `project config failed to load — ${cfgError}`,
    };
  }
  const declared = readQualityGateCmd(dir, cfg);
  if (!declared) {
    return {
      ...base,
      pass: false,
      detail:
        'no deterministic test command — need testProcess.local.cmd in .forge/project.json, ' +
        'the .forge/quality_gate_cmd sidecar, or a package.json "test" script (none found)',
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
  // w8-a1: a package-manager-shaped gate (npm/yarn/pnpm/npx/bun/bunx …) must
  // be RESOLVABLE from the project dir itself, with no upward walk. A
  // syntactically-fine `npm test` in a project dir with no package.json was
  // false-passing here, then npm's own ancestor-package.json walk resolved
  // the command against FORGE's ROOT package.json at runtime — the dev-loop
  // silently ran (and "passed") forge's ~2000-test suite instead of the
  // project's. This check never executes the command — pure fs + JSON read.
  if (isPackageManagerShaped(cmd)) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) {
      return {
        ...base,
        pass: false,
        detail:
          `${source} ("${cmd}") is npm/yarn/pnpm-shaped, but ${dir} has no package.json. ` +
          'Without one there, the package manager resolves the command against an ANCESTOR ' +
          "package.json outside the project dir (e.g. forge's own root) — a false green on the wrong repo. " +
          `Add a package.json at ${pkgPath}, or declare a gate that does not shell out to a package manager.`,
      };
    }
    let pkgRaw: string;
    try {
      pkgRaw = readFileSync(pkgPath, 'utf8');
    } catch (err) {
      return {
        ...base,
        pass: false,
        detail: `${pkgPath} exists but could not be read — ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    let pkg: { scripts?: Record<string, unknown> };
    try {
      pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, unknown> };
    } catch (err) {
      return {
        ...base,
        pass: false,
        detail: `${pkgPath} is not valid JSON, cannot verify the declared gate resolves — ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const scriptName = resolveScriptName(cmd);
    if (scriptName !== null) {
      const scripts = pkg && typeof pkg === 'object' && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      const script = (scripts as Record<string, unknown>)[scriptName];
      if (typeof script !== 'string' || script.trim() === '') {
        return {
          ...base,
          pass: false,
          detail:
            `${source} ("${cmd}") declares package.json script "${scriptName}", but ${pkgPath}'s ` +
            `"scripts" has no such entry — the gate would fail (or resolve elsewhere) the moment it actually ran.`,
        };
      }
    }
  }
  return { ...base, pass: true, detail: `${source}: "${cmd}" (single command, no slow-suite marker)` };
}

/** Package-manager binaries whose commands resolve relative to a package.json (npm's/yarn's/pnpm's own upward-walk semantics). */
const PACKAGE_MANAGER_TOKENS = new Set(['npm', 'yarn', 'pnpm', 'npx', 'bun', 'bunx']);

/** True iff `cmd`'s first token invokes a package manager (case-insensitive). */
function isPackageManagerShaped(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0] ?? '';
  return PACKAGE_MANAGER_TOKENS.has(first.toLowerCase());
}

// pm-native verbs that a bare `yarn <token>` / `pnpm <token>` must NOT be
// mistaken for a project script name — yarn/pnpm proxy any UNRECOGNIZED verb
// to a package.json script, so this set only needs the manager's own real
// subcommands (an actual script named e.g. "build" or "start" still resolves
// as a script, matching real yarn/pnpm behaviour).
const PM_NATIVE_SUBCOMMANDS = new Set([
  'run', 'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'upgrade', 'up',
  'exec', 'dlx', 'init', 'publish', 'link', 'unlink', 'list', 'ls', 'outdated', 'audit', 'why',
  'info', 'view', 'config', 'cache', 'prune', 'pack', 'create', 'dedupe', 'patch', 'patch-commit',
  'patch-remove', 'deploy', 'rebuild', 'store', 'server', 'root', 'licenses', 'doctor', 'setup',
  'tag', 'team', 'owner', 'policies', 'import', 'global', 'node', 'env', 'workspace', 'workspaces',
  'login', 'logout', 'whoami', 'version', 'versions', 'help', '-v', '--version', '-h', '--help',
]);

/**
 * Resolves the package.json `scripts` key a declared gate would invoke, or
 * `null` when the shape can't be mapped to one — callers must then do the
 * package.json-EXISTENCE check only, never invent a script-name guess.
 * Mapped shapes: bare `npm test` / `yarn test` / `pnpm test` → "test";
 * `npm run <name>` / `yarn run <name>` / `pnpm run <name>` → "<name>";
 * `yarn <name>` / `pnpm <name>` (name not a known pm subcommand) → "<name>".
 * `npx`/`bunx`/`bun` and anything else → null (not script-backed).
 */
function resolveScriptName(cmd: string): string | null {
  const toks = cmd.trim().split(/\s+/).filter(Boolean);
  const runner = (toks[0] ?? '').toLowerCase();
  if (runner !== 'npm' && runner !== 'yarn' && runner !== 'pnpm') return null;
  const first = (toks[1] ?? '').toLowerCase();
  if (!first) return null;
  if (first === 'test') return 'test';
  if (first === 'run') return toks[2] ?? null;
  if (runner !== 'npm' && !PM_NATIVE_SUBCOMMANDS.has(first)) return toks[1]!;
  return null;
}

// --- helpers ---

// Already exported below (`export { checkC1, checkC1b, checkC7,
// readQualityGateCmd }`) — reused by preflight-deps.ts (forge-8vfn.5.21):
// the DEPS clause shares this SAME single-sourced "what is the declared
// local gate command" fact C1 already computes, rather than re-deriving it
// (JSON testProcess.local.cmd → package.json "test" → .forge/quality_gate_cmd
// sidecar, in that order).
function readQualityGateCmd(dir: string, cfg: ProjectConfig | null): { source: string; cmd: string } | null {
  // R1-03-F1: the typed contract object is the primary source (the loader
  // already single-sourced the sidecar into it, so a loaded config always
  // carries local.cmd). The sidecar/package.json probes below remain for
  // projects with NO project.json at all (pre-onboarding preflights).
  if (cfg) {
    return { source: 'testProcess.local.cmd', cmd: cfg.testProcess.local.cmd.join(' ') };
  }
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
  // A project may declare the gate in the forge sidecar without a project.json.
  const sidecar = join(dir, '.forge', 'quality_gate_cmd');
  if (existsSync(sidecar)) {
    const cmd = readFileSync(sidecar, 'utf8').trim();
    if (cmd) return { source: '.forge/quality_gate_cmd', cmd };
  }
  return null;
}

// --- C1b: CI merge-boundary net (advisory when absent; HARD shape when declared) ---

/**
 * R1-03-F1: surfaces the `testProcess.ci` delivery net. Absent ⇒ advisory
 * gap (the merge decision rests on the per-WI gate alone — the brain's
 * "per-WI gate ≠ project CI" antipattern class); declared ⇒ the shape was
 * already validated fail-closed by the loader, so a loaded config passes
 * HARD. A load failure reports advisory here (C1 carries the hard fail).
 */
function checkC1b(cfg: ProjectConfig | null, cfgError: string | null): ClauseResult {
  const title = 'CI merge-boundary net (testProcess.ci)';
  if (cfgError !== null) {
    return { clause: 'C1b', title, hard: false, pass: false, detail: `project config failed to load — see C1` };
  }
  if (!cfg || !cfg.testProcess.ci) {
    return {
      clause: 'C1b',
      title,
      hard: false,
      pass: false,
      detail:
        'no testProcess.ci declared — the merge decision rests on the per-WI gate alone; ' +
        'declare the full CI mirror (cmd/fixCmd/unsetEnv) so a red whole-module baseline can never ship (advisory)',
    };
  }
  const ci = cfg.testProcess.ci;
  return {
    clause: 'C1b',
    title,
    hard: true,
    pass: true,
    detail: `testProcess.ci declared ("${ci.cmd.join(' ')}"${ci.unsetEnv ? `; hermetic: unset ${ci.unsetEnv.join(',')}` : ''})`,
  };
}

// --- C7: live-acceptance tier (advisory visibility; hard enforcement lives in PM + dev-loop) ---

function checkC7(cfg: ProjectConfig | null): ClauseResult {
  const title = 'Live-acceptance tier (testProcess.acceptance)';
  const acc = cfg?.testProcess.acceptance;
  if (!acc) {
    return {
      clause: 'C7',
      title,
      hard: false,
      pass: true,
      detail:
        'no acceptance tier declared (n/a — external-resource projects declare testProcess.acceptance; ' +
        'hard enforcement lives in the PM phase + dev-loop requires-env guard)',
    };
  }
  const env = acc.requiresEnv ?? [];
  return {
    clause: 'C7',
    title,
    hard: false,
    pass: true,
    detail:
      `acceptance tier declared (match "${acc.match}", required: ${acc.required}, ` +
      `${env.length === 0 ? 'creds-free' : `requiresEnv: ${env.join(',')}`}) — enforced by the PM phase + dev-loop`,
  };
}

// isPackageManagerShaped/resolveScriptName also reused by preflight-deps.ts
// (forge-8vfn.5.21): the DEPS clause resolves `npm test` → its package.json
// script BODY the same way C1's own package-manager-shape check does, rather
// than re-deriving that resolution.
export { checkC1, checkC1b, checkC7, readQualityGateCmd, isPackageManagerShaped, resolveScriptName };
