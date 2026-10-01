/**
 * `forge create` — the CLI door into greenfield project creation, split out of
 * cli.ts so the verb and its decision core sit together. `runCreate` is the
 * hermetic core (tests drive it with an injected forgeRoot); `cmdCreate` maps
 * its result onto console output and exit codes.
 */
import { resolve } from 'node:path';
import { scaffoldGreenfieldProject, listProjectStarters, type ScaffoldResult } from '@forge/projects';
import { defaultConfigPath, loadConfig, describeProjectStarters } from '@forge/kernel';
import { seedProjectBrain, checkProjectBrainSeedContainment, isUntouchedBrainSeedStub } from '@forge/knowledge';
import { flagValueStrict } from './cli-flags.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * `forge create` (R4-03) — decision core, extracted from `cmdCreate` below
 * (forge-qb5) so it can be driven hermetically: parse flags → build a typed
 * manifest → scaffold a greenfield project from its framework template + seed
 * the central brain, then preflight — all returned as data. Pure-ish (its
 * only side effects are the ones `forge create` exists to have — writing the
 * scaffolded project + brain stub via `scaffoldGreenfieldProject`): it never
 * calls `process.exit` and never writes to stdout/stderr for control flow, so
 * a test can assert on the returned result instead of process exit codes.
 * `forgeRoot` is an injected parameter (defaulting to the module's
 * `FORGE_ROOT`), so a test can point it at a throwaway temp directory instead
 * of the real install root.
 */
export type CreateResult =
  | { ok: true; kind: 'list'; appTypes: string[] }
  | { ok: true; kind: 'scaffolded'; exitCode: 0 | 1; out: ScaffoldResult }
  | { ok: false; kind: 'invalid-args'; exitCode: 2; appTypes: string[] }
  | { ok: false; kind: 'error'; exitCode: 1; message: string };

export function runCreate(rest: string[], opts: { forgeRoot?: string } = {}): CreateResult {
  const forgeRoot = opts.forgeRoot ?? FORGE_ROOT;
  if (rest[0] === 'list' || rest.includes('--list')) {
    return { ok: true, kind: 'list', appTypes: listProjectStarters(forgeRoot) };
  }
  const flag = (name: string): string | undefined => flagValueStrict(rest, name);
  const name = flag('name');
  const appType = flag('app-type');
  const northStar = flag('north-star');
  if (!name || !appType || !northStar) {
    return { ok: false, kind: 'invalid-args', exitCode: 2, appTypes: listProjectStarters(forgeRoot) };
  }
  try {
    const explicitLanguage = flag('language');
    const starter = explicitLanguage ? undefined : describeProjectStarters(forgeRoot).find((s) => s.id === appType); // 6.11.33: the starter's own declared language (6.11.4); explicit input wins
    if (starter && starter.language === null) throw new Error(`starter "${appType}" declares no language — add one to starters.json before creating from it`);
    const out = scaffoldGreenfieldProject({
      manifest: {
        name,
        appType,
        language: explicitLanguage || starter?.language || 'typescript',
        northStar,
        ...(flag('architecture') ? { architecture: flag('architecture') as string } : {}),
      },
      forgeRoot,
      // Ruling 323 — the SAME switch the bridge route reads, so both doors into
      // creation agree; a CLI that minted while the UI did not would make the
      // config a lie about half the product. Default OFF.
      ...(loadConfig(defaultConfigPath(forgeRoot)).projects?.remote?.create === true
        ? { remote: { create: true } }
        : {}),
      // `projects` (rank 2) may not import `@forge/knowledge` (same rank) —
      // this assembly point may import both, so the real seeding pair is
      // supplied here, same as the bridge route's `OnboardDeps` wiring.
      brainSeeder: { seed: seedProjectBrain, checkContainment: checkProjectBrainSeedContainment, isUntouchedStub: isUntouchedBrainSeedStub },
    });
    return { ok: true, kind: 'scaffolded', exitCode: out.hardGreen ? 0 : 1, out };
  } catch (err) {
    return { ok: false, kind: 'error', exitCode: 1, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `forge create --name <name> --app-type <type> [--language ts] --north-star
 * <text> [--architecture <notes>]` (R4-03) — the creation interview as CLI
 * flags → a typed manifest → scaffold a greenfield project from its framework
 * template + seed the central brain, then preflight. Exits 0 iff contract-green
 * (ready for the first architect run). Thin CLI edge over `runCreate`: maps
 * its result onto the exact same console output + exit codes this command
 * always produced (forge-qb5 — behaviour-preserving extraction).
 */
export function cmdCreate(rest: string[]): void {
  const result = runCreate(rest, { forgeRoot: FORGE_ROOT });
  switch (result.kind) {
    case 'list':
      console.log(`available app types: ${result.appTypes.join(', ') || '(none)'}`);
      return;
    case 'invalid-args':
      console.error('forge create: requires --name <name> --app-type <type> --north-star <text> [--language ts] [--architecture <notes>]');
      console.error(`  app types: ${result.appTypes.join(', ') || '(none)'}  (or: forge create list)`);
      process.exit(result.exitCode);
      return;
    case 'scaffolded': {
      const out = result.out;
      console.log(`create: scaffolded "${out.id}" (${out.appType}) at ${out.projectDir} — ${out.filesWritten.length} file(s)`);
      if (out.hardGreen) {
        console.log('create: contract-green — ready for the first architect run.');
      } else {
        console.log(`create: NOT contract-green — failing hard clauses: ${out.failingClauses.map((c) => c.clause).join(', ')}`);
      }
      process.exit(result.exitCode);
      return;
    }
    case 'error':
      console.error(`forge create: ${result.message}`);
      process.exit(result.exitCode);
      return;
  }
}
