/**
 * `demoMeans.run` (forge-nk1y.42): the in-tree argv a checkpoint head becomes
 * (`gw plan` → `python3 -m gitweave.cli plan`), validated once for the parse and
 * the point of use. Plus the commands a tree installs itself (pyproject scripts):
 * a PATH binary of that name is some installed revision, not the tree.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHELL_METACHARACTERS } from '@forge/contracts';

export type RunPrefixes = Readonly<Record<string, string>>;
export type RunPrefixCheck = { ok: true; argv: string[] } | { ok: false; reason: string };

/** A bare command name: what a checkpoint command's head may be declared as. */
export const RUN_PREFIX_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Validate one `demoMeans.run` entry; the reason names `demoMeans.run.<head>`. */
export function validateRunPrefix(head: string, prefix: unknown): RunPrefixCheck {
  const at = `demoMeans.run.${head}`;
  if (!RUN_PREFIX_KEY.test(head)) return { ok: false, reason: `${at}: the key must be a bare command name` };
  if (typeof prefix !== 'string' || prefix.trim() === '') return { ok: false, reason: `${at}: must be a non-empty in-tree command prefix` };
  if (SHELL_METACHARACTERS.test(prefix)) return { ok: false, reason: `${at} \`${prefix}\` contains shell metacharacters — capture runs a bare argv with no shell` };
  const argv = prefix.trim().split(/\s+/);
  // `--opt=/abs` and `--opt=../x` are paths too: judge every `=`-separated part.
  for (const token of argv.flatMap((t) => t.split('='))) {
    if (token.startsWith('/')) return { ok: false, reason: `${at} \`${prefix}\` names an absolute path — a prefix runs inside the capture tree` };
    if (token.split('/').includes('..')) return { ok: false, reason: `${at} \`${prefix}\` climbs out of the capture tree with \`..\`` };
  }
  if (argv[0] === head) return { ok: false, reason: `${at} \`${prefix}\` runs \`${head}\` itself — the prefix must reach the tree (e.g. \`python3 -m <package>.cli\`, \`node ./bin/cli.js\`)` };
  return { ok: true, argv };
}

/** Script names under `[project.scripts]` / `[tool.poetry.scripts]`. */
function pyprojectScriptNames(text: string): string[] {
  let inScripts = false;
  return text.split('\n').flatMap((raw) => {
    const line = raw.trim();
    if (line.startsWith('[')) inScripts = line === '[project.scripts]' || line === '[tool.poetry.scripts]';
    const m = inScripts ? /^"?([A-Za-z0-9._-]+)"?\s*=/.exec(line) : null;
    return m ? [m[1]!] : [];
  });
}

/** Does the tree install `head` itself? Unreadable → UNKNOWN, never "no" (§6.15). */
export function treeDeclaresEntryPoint(worktreePath: string, head: string): { declared: false } | { declared: true; in: string } | { declared: 'unknown'; reason: string } {
  const pyproject = join(worktreePath, 'pyproject.toml');
  if (existsSync(pyproject)) {
    let text: string;
    try {
      text = readFileSync(pyproject, 'utf8');
    } catch (err) {
      return { declared: 'unknown', reason: `pyproject.toml is unreadable (${err instanceof Error ? err.message : String(err)})` };
    }
    if (pyprojectScriptNames(text).includes(head)) return { declared: true, in: 'pyproject.toml scripts' };
  }
  return { declared: false };
}
