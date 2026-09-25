/**
 * reset-command-resolve.ts — DEFECT 1 fix (gitpulse, found running `forge
 * project reset --apply`): an `'add'` row must not declare an npm script the
 * project doesn't have.
 *
 * SCOPE (YAGNI, ROUND 2 cut): only `npm run <script>` / `npm <script>` in
 * `testProcess.local`/`.ci` (`cmd`/`fixCmd`) — the one shape every shipped
 * starter's testProcess carries — is checked, against `package.json`'s
 * `scripts`. A non-npm command, and `buildProcess`/`releaseProcess`, are
 * untouched today (no downgrade, no advisory) — no starter declares either
 * shape yet; extend here if one starts to.
 *
 * `ContractSection`/`DriftRow` are imported TYPE-ONLY so this file and
 * `reset.ts` (which imports `resolveCommandRow` back) never form a runtime
 * cycle — `import type` erases at strip/build time.
 */
import { guardedReadFile } from '@forge/kernel';

import type { ContractSection, DriftRow } from './reset.ts';

/** A template npm script this project doesn't have — named, never silently added or dropped. */
export type CommandAdvisory = { section: ContractSection; message: string };

/** `["npm","run","<script>"]` / `["npm","<script>"]` → `<script>`; else `undefined` (non-npm, out of scope). */
function npmScriptName(cmd: readonly string[]): string | undefined {
  return cmd[0] === 'npm' ? (cmd[1] === 'run' ? cmd[2] : cmd[1]) : undefined;
}

/** `package.json`'s `scripts`, or `null` when absent/unreadable/invalid — fails CLOSED. */
function readPackageScripts(projectDir: string): Record<string, unknown> | null {
  const raw = guardedReadFile(projectDir, ['package.json']);
  if (raw === null) return null;
  try {
    const scripts = (JSON.parse(raw) as { scripts?: unknown }).scripts;
    return scripts && typeof scripts === 'object' && !Array.isArray(scripts) ? (scripts as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The npm-shaped commands `testProcess.local`/`.ci` would write — a non-npm `cmd`/`fixCmd` is filtered out here, out of scope. */
function npmCommandsInSection(section: ContractSection, after: unknown): string[][] {
  if (after === null || typeof after !== 'object') return [];
  const candidates: unknown[] =
    section === 'testProcess.local'
      ? [(after as { cmd?: unknown }).cmd]
      : section === 'testProcess.ci'
        ? [(after as { cmd?: unknown }).cmd, (after as { fixCmd?: unknown }).fixCmd]
        : [];
  return candidates.filter((c): c is string[] => Array.isArray(c) && npmScriptName(c) !== undefined);
}

/**
 * DEFECT 1's own guard: an `'add'` row whose testProcess.local/.ci carries an
 * npm script this project's package.json doesn't declare downgrades to
 * `'unchanged'`, reported as a named `CommandAdvisory`.
 */
export function resolveCommandRow(row: DriftRow, projectDir: string): { row: DriftRow; advisory?: CommandAdvisory } {
  if (row.action !== 'add') return { row };
  for (const cmd of npmCommandsInSection(row.section, row.after)) {
    const scripts = readPackageScripts(projectDir);
    const script = npmScriptName(cmd)!;
    if (scripts !== null && Object.prototype.hasOwnProperty.call(scripts, script)) continue;
    const reason = scripts === null ? 'no package.json (or no readable "scripts") in the project' : `no "${script}" script in package.json`;
    return {
      row: { section: row.section, before: undefined, after: undefined, action: 'unchanged' },
      advisory: { section: row.section, message: `skipped: ${row.section} — "${cmd.join(' ')}" does not resolve (${reason})` },
    };
  }
  return { row };
}
