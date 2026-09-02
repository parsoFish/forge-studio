/**
 * forge↔project contract preflight — the DEPS clause (forge-8vfn.5.21).
 *
 * THE BUG THIS CLOSES: `packages/flows/scheduler.ts`'s `linkProjectDeps()`
 * symlinks the GROUND repo's `node_modules` into each initiative worktree
 * (`git worktree add` checks out tracked files only; `node_modules/` is
 * gitignored). Its guard is `if (!existsSync(src)) continue` — a missing
 * source is a SILENT no-op: no event, no warning, no refusal. Measured live
 * (M2-B's first H2 run): a freshly cloned `projects/gitpulse` (no `npm ci`
 * run yet) produced no link, and the failure surfaced ~3 minutes and $1.61
 * later, mid dev-loop, as `dev-loop.baseline-red` — "Cannot find package
 * tsx". The diagnosis (deps never provisioned) was already knowable at
 * worktree-creation time; it was discovered mid-run instead.
 *
 * THE FIX IS THE STRONGER ONE THE BEAD NAMES: a C-clause — the project's
 * declared `testProcess.local.cmd` must be RUNNABLE AT HEAD IN THE GROUND —
 * refused at CLAIM time by preflight, not discovered mid-run.
 * `packages/flows/claim-validator.ts`'s `validateClaimable()` ALREADY calls
 * `runPreflight(projectDir, ...)` — `projectDir` there is `resolve(
 * projectRepoPath)`, the GROUND, never a worktree — and already refuses a
 * claim (non-terminal, stays in `pending/`) whenever any HARD clause fails,
 * so making this clause `hard: true` and adding it to `runPreflight`'s
 * `clauses` array WOULD be the one change that reaches claim time — no
 * `scheduler.ts`/`claim-validator.ts` edit needed to wire it in.
 *
 * NOT CURRENTLY WIRED INTO `runPreflight` — DELIBERATELY, reported rather
 * than forced through. `checkDeps` here is complete and its OWN tests
 * (`tests/integration/preflight-deps.test.ts`) are green, but adding the
 * `checkDeps(dir, cfg)` call to `preflight.ts`'s composer flips `report.ok`
 * on ~15 EXISTING tests across ~8 sibling preflight test files: every one
 * shares a `happyProject()`-style fixture (duplicated per-file, house style)
 * whose `testProcess.local.cmd` is `['vitest', 'run']` with no `node_modules`
 * anywhere in the fixture — a synthetic gate that was never meant to
 * EXECUTE (preflight never spawns anything; nothing before this clause ever
 * checked runnability). That is not evidence those tests wrongly assert a
 * shipped defect as correct — it is evidence the shared fixture predates any
 * clause that checks gate-runnability at all. Per this lane's standing rule,
 * an existing test needing to change to make a fix pass is reported, not
 * silently adjusted; updating 8 files' fixtures (or their declared cmd) is a
 * deliberate, scoped follow-up, not a call this file makes unilaterally.
 * `preflight.ts` carries the same pointer at its own `checkDeps` mention.
 *
 * WHY "node_modules PRESENT" ALONE IS THE WRONG CHECK — a real false
 * positive caught red-first against the three greenfield starters
 * (`studio/starters/projects/*`): every one declares a `typescript`
 * devDependency (needed for `npm run build`), but their FAST per-WI gate —
 * the actual `testProcess.local.cmd` this clause polices — is `npm test` →
 * `node --experimental-strip-types --test`, which needs NOTHING installed
 * (native Node type-stripping, zero devDependencies). A first pass that
 * hard-failed whenever package.json declared ANY dependency, regardless of
 * whether the DECLARED GATE actually needs them, broke three green,
 * genuinely-runnable `project-create.test.ts` fixtures — the tell that the
 * check was answering the wrong question ("does this package.json have
 * deps?" instead of "does the DECLARED GATE need node_modules to run?").
 *
 * THE REAL CHECK: resolve `testProcess.local.cmd` through an `npm test`/
 * `npm run <x>` indirection to the actual package.json script body (the
 * same resolution C1's package-manager-shape check already does), then look
 * at the EFFECTIVE command's leading token. `node <flags>` (this project's
 * own idiom) and a literal script path need nothing installed; everything
 * else — a bare devDependency-provided binary (`tsx`, `vitest`, `jest`,
 * `ts-node`, …) or an `npx`/`bunx` invocation of one — needs
 * `node_modules` resolved, and gitpulse's actual failure ("Cannot find
 * package tsx") is exactly that shape.
 *
 * SCOPE: mirrors `linkProjectDeps()`'s OWN current scope — Node projects
 * only ("Generalise here when forge picks up Python (.venv) or Rust
 * (target) projects", that function's own docstring). A project with no
 * `package.json` passes trivially. Pure: filesystem reads only, same as
 * every other preflight clause — it never spawns the declared command to
 * find out whether it resolves.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClauseResult } from '@forge/kernel';
import type { ProjectConfig } from './project-config.ts';
import { readQualityGateCmd, isPackageManagerShaped, resolveScriptName } from './preflight-gate.ts';

type PackageJsonScripts = { scripts?: Record<string, string> };

/**
 * Resolve `cmd` (the DECLARED gate, e.g. "npm test") to the command it
 * ACTUALLY runs, through one `npm`/`yarn`/`pnpm` script indirection when the
 * shape maps to one — mirrors C1's own resolution. Unresolvable shapes
 * (`npx …`, a raw non-pm command, or a script name package.json doesn't
 * carry) fall through UNCHANGED — the leading-token check below still
 * classifies those correctly (an `npx tsx` first token is `npx`, not
 * `node`, so it is treated as needing `node_modules`, the safe default).
 */
function resolveEffectiveCommand(cmd: string, pkg: PackageJsonScripts): string {
  if (!isPackageManagerShaped(cmd)) return cmd;
  const scriptName = resolveScriptName(cmd);
  const body = scriptName ? pkg.scripts?.[scriptName] : undefined;
  return body && body.trim() ? body : cmd;
}

/**
 * True iff `cmd`'s leading token is resolved through `node_modules` to run.
 * `node <anything>` (native execution — this project's own
 * `--experimental-strip-types` idiom, needing zero installed packages) and a
 * literal script path (`./x`, `/x`, invoked directly by the shell) are the
 * only "needs nothing" shapes; everything else — a bare devDependency
 * binary or an `npx`/`bunx` run of one — is the safe default: needs
 * `node_modules`.
 */
function leadingTokenNeedsNodeModules(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0] ?? '';
  if (first === '') return false; // nothing to run — not this clause's problem
  return first !== 'node' && !first.startsWith('./') && !first.startsWith('/');
}

export function checkDeps(dir: string, cfg: ProjectConfig | null): ClauseResult {
  const base = { clause: 'DEPS' as const, title: 'Declared local gate is runnable at HEAD in the ground (node_modules provisioned when needed)', hard: true };

  // C1 already reports "no deterministic test command" when nothing is
  // declared at all — this clause is about a DECLARED command that cannot
  // run, not about whether one is declared. Nothing to check ⇒ pass.
  const declared = readQualityGateCmd(dir, cfg);
  if (!declared) {
    return { ...base, pass: true, detail: 'no declared local gate to check — see C1' };
  }

  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return { ...base, pass: true, detail: 'no package.json — not a Node project this clause understands' };
  }

  let pkg: PackageJsonScripts;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonScripts;
  } catch {
    // A malformed package.json is C1's/the package-manager-shape check's
    // problem to report, not this clause's.
    return { ...base, pass: true, detail: 'package.json is not valid JSON — skipped (see C1)' };
  }

  const effective = resolveEffectiveCommand(declared.cmd, pkg);
  if (!leadingTokenNeedsNodeModules(effective)) {
    return { ...base, pass: true, detail: `${declared.source} resolves to "${effective}" — needs nothing installed` };
  }

  if (existsSync(join(dir, 'node_modules'))) {
    return { ...base, pass: true, detail: `${declared.source} resolves to "${effective}" — node_modules is provisioned` };
  }

  return {
    ...base,
    pass: false,
    detail:
      `${declared.source} ("${declared.cmd}") resolves to "${effective}", which needs a package from node_modules, ` +
      `but no node_modules/ exists in the ground (${dir}). linkProjectDeps() symlinks this into every worktree; an ` +
      'absent source is a silent no-op there, so an unprovisioned ground previously surfaced minutes into a dev-loop ' +
      'run as a baseline-red failure instead of being refused here. Run npm ci (or npm install) in the project\'s ' +
      'own checkout before retrying.',
  };
}
