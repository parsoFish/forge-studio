/**
 * `forge brain lint` — its flag parsing and its report, moved out of `cli.ts`.
 *
 * The move pays for the `forge gate docs` verb this PR adds: `cli.ts` sits at
 * its baselined 999-line exemption, and an exemption is a ceiling rather than a
 * licence, so a new verb has to bring its own room. This handler was the
 * cleanest 61 lines to take — one call site (`cmdBrain`'s `lint` subcommand),
 * no shared state, and its whole body is argument parsing plus printing.
 *
 * It also leaves headroom for the verbs spec §5 items 4 to 6 still owe.
 */

import { resolve } from 'node:path';

import { runBrainLint, type Scope as BrainLintScope } from '@forge/knowledge/brain-lint.ts';

/** The repo root, derived the same way `cli.ts` derives it — this module is its sibling. */
const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');


export function cmdBrainLint(rest: string[]): void {
  // Parse flags. Mirror the standalone brain-lint.ts CLI but wire through the
  // forge CLI so the operator types `forge brain lint ...`.
  let scope: BrainLintScope = 'full';
  let project: string | undefined;
  let file: string | undefined;
  let cycle: string | undefined;
  let fix = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--scope') {
      const v = rest[++i];
      const allowed: BrainLintScope[] = [
        'full',
        'forge-only',
        'project-only',
        'single-file',
        'cycle-touched-themes',
        'cleanup-dry-run',
      ];
      if (!allowed.includes(v as BrainLintScope)) {
        console.error(`forge brain lint: unknown --scope: ${v}`);
        process.exit(2);
      }
      scope = v as BrainLintScope;
    } else if (a === '--project') {
      project = rest[++i];
    } else if (a === '--file') {
      file = rest[++i];
    } else if (a === '--cycle') {
      cycle = rest[++i];
    } else if (a === '--fix') {
      fix = true;
    }
  }
  const result = runBrainLint({ cwd: FORGE_ROOT, scope, project, file, cycle, fix });

  const errors = result.findings.filter((f) => f.category === 'error');
  const flags = result.findings.filter((f) => f.category === 'flag');
  const fixes = result.findings.filter((f) => f.category === 'auto-fix');
  for (const [label, group] of [
    ['ERRORS', errors],
    ['FLAGS', flags],
    ['AUTO-FIXES', fixes],
  ] as const) {
    if (group.length === 0) continue;
    console.log(`## ${label} (${group.length})`);
    for (const f of group) {
      const relPath = f.file.startsWith(FORGE_ROOT)
        ? f.file.slice(FORGE_ROOT.length + 1)
        : f.file;
      console.log(`- [${f.check ?? 'check'}] ${relPath}: ${f.message}`);
    }
    console.log('');
  }
  console.log(
    `Summary: ${errors.length} error(s), ${flags.length} flag(s), ${fixes.length} auto-fix(es).`,
  );
  process.exit(result.exitCode);
}
