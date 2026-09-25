/**
 * reset-command-resolve.ts — DEFECT 1 fix (found running `forge project
 * reset --apply` against a real project, gitpulse): a template-supplied
 * COMMAND must only be ADDED to `.forge/project.json` when it actually
 * resolves in THIS project — otherwise reset declares a contract obligation
 * nothing can ever satisfy (the shipped repro: `testProcess.ci.cmd:
 * ["npm","run","ci"]` onto a package.json with no `"ci"` script).
 *
 * Split out of `reset.ts` (already at the 800-line file cap — `reset-cli.ts`'s
 * own header names the same precedent) rather than grown in place.
 * `ContractSection`/`DriftRow` are imported TYPE-ONLY, so this file and
 * `reset.ts` (which imports `resolveCommandRow` back) do not form a runtime
 * import cycle — `import type` erases entirely at strip/build time, the same
 * erasure `reset-cli.ts`'s own `type DriftReport` import already relies on.
 *
 * SCOPE: only the sections whose `after` value carries a literal argv the
 * runtime would exec — `testProcess.local`/`testProcess.ci` (`cmd`/`fixCmd`),
 * `buildProcess.local`, and each `releaseProcess` step's optional `command`.
 * `demoProcess` is deliberately excluded: its `text` is operator PROSE (e.g.
 * "Build the CLI (npm run build) and note the before state."), not a single
 * argv this module could mechanically resolve — parsing free text into a
 * shell command is a fragile heuristic this fix does not attempt.
 */
import { accessSync, constants as fsConstants } from 'node:fs';
import { delimiter, join } from 'node:path';

import { guardedFile, guardedReadFile } from '@forge/kernel';

import type { ContractSection, DriftRow } from './reset.ts';

/** One command the matched starter would add that this project cannot run —
 *  named, never silently added and never silently dropped (mirrors
 *  `GitignoreDrift.otherSourceViolations`'s own "name it" rule). */
export type CommandAdvisory = {
  section: ContractSection;
  message: string;
};

/** `["npm","run","<script>"]` / `["npm","<script>"]` → `<script>`; any other
 *  shape (a non-npm command) → `undefined`. */
function npmScriptName(cmd: readonly string[]): string | undefined {
  if (cmd[0] !== 'npm') return undefined;
  return cmd[1] === 'run' ? cmd[2] : cmd[1];
}

/** `package.json`'s `scripts` map, or `null` when the file is absent,
 *  unreadable, or not valid JSON — fails CLOSED: an unreadable manifest
 *  resolves no script, so the caller reports the command unresolvable rather
 *  than silently adding it. */
function readPackageScripts(projectDir: string): Record<string, unknown> | null {
  const raw = guardedReadFile(projectDir, ['package.json']);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { scripts?: unknown };
    return parsed.scripts && typeof parsed.scripts === 'object' && !Array.isArray(parsed.scripts)
      ? (parsed.scripts as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Is `name` an executable file on `PATH`? Walked directory-by-directory with
 *  `accessSync`/`X_OK` — not one of the six sinks `check-raw-fs-guarded`
 *  polices, and never a project/request-derived path: this reads the
 *  SERVER's own `PATH` env var, joined with a starter-declared (never
 *  request-supplied) command name. */
function isOnPathEnv(name: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), fsConstants.X_OK);
      return true;
    } catch {
      // Not in this PATH dir — keep looking.
    }
  }
  return false;
}

/** Does `cmd` resolve in `projectDir`? `npm run <script>` / `npm <script>`
 *  resolves iff `package.json` declares that script. Any other command
 *  resolves iff its first token is a file inside the project (containment-
 *  checked via `guardedFile` — never a raw join) or an executable on `PATH`.
 *  Returns the failure reason for the advisory message, or `null` when it
 *  resolves. */
function unresolvedCommandReason(cmd: readonly string[], projectDir: string): string | null {
  if (cmd.length === 0) return 'the command is empty';
  const script = npmScriptName(cmd);
  if (script !== undefined) {
    const scripts = readPackageScripts(projectDir);
    if (scripts === null) return 'no package.json (or no readable "scripts") in the project';
    return Object.prototype.hasOwnProperty.call(scripts, script) ? null : `no "${script}" script in package.json`;
  }
  const first = cmd[0]!;
  const segments = first.split('/').filter((s) => s.length > 0 && s !== '.');
  const inProject = segments.length > 0 && guardedFile(projectDir, segments, 'read') !== null;
  return inProject || isOnPathEnv(first) ? null : `"${first}" is not a file in the project or on PATH`;
}

/** Every literal argv command a section's `after` value would write. */
function commandsInSection(section: ContractSection, after: unknown): string[][] {
  if (after === null || typeof after !== 'object') return [];
  switch (section) {
    case 'testProcess.local': {
      const cmd = (after as { cmd?: unknown }).cmd;
      return Array.isArray(cmd) ? [cmd as string[]] : [];
    }
    case 'testProcess.ci': {
      const v = after as { cmd?: unknown; fixCmd?: unknown };
      return [v.cmd, v.fixCmd].filter((c): c is string[] => Array.isArray(c));
    }
    case 'buildProcess': {
      const local = (after as { local?: unknown }).local;
      return Array.isArray(local) ? [local as string[]] : [];
    }
    case 'releaseProcess': {
      const steps = (after as { steps?: unknown }).steps;
      if (!Array.isArray(steps)) return [];
      return steps
        .map((s) => (s && typeof s === 'object' ? (s as { command?: unknown }).command : undefined))
        .filter((c): c is string[] => Array.isArray(c));
    }
    default:
      return [];
  }
}

/**
 * DEFECT 1's own guard: an `'add'` row whose section carries a literal
 * command downgrades to `'unchanged'` (nothing on disk, nothing written)
 * when ANY of its commands does not resolve in `projectDir` — reported as a
 * named `CommandAdvisory`, never silently added and never silently dropped.
 */
export function resolveCommandRow(row: DriftRow, projectDir: string): { row: DriftRow; advisory?: CommandAdvisory } {
  if (row.action !== 'add') return { row };
  for (const cmd of commandsInSection(row.section, row.after)) {
    const reason = unresolvedCommandReason(cmd, projectDir);
    if (reason !== null) {
      return {
        row: { section: row.section, before: undefined, after: undefined, action: 'unchanged' },
        advisory: { section: row.section, message: `skipped: ${row.section} — "${cmd.join(' ')}" does not resolve (${reason})` },
      };
    }
  }
  return { row };
}
