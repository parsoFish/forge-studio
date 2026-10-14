/**
 * The ONE resolver for a checkpoint command's head (forge-8vfn.30.9), shared by
 * the producibility preflight and the capture spawn. It runs the TREE under
 * capture (forge-nk1y.42; a PATH copy made gitweave I3a 11/11 identical):
 * (1) a path-bearing head inside the worktree; (2) a declared run prefix, its
 * argv resolved by these rules; (3) a contained package.json `bin`; (4) a head
 * the tree installs itself (pyproject scripts) found only on PATH is REFUSED BY
 * NAME; (5) any other PATH head is a system tool; (6) else refused.
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';

import { resolveDeclaredBin } from '@forge/contracts';

import { treeDeclaresEntryPoint, validateRunPrefix, type RunPrefixes } from './run-prefix.ts';

export type CheckpointHeadResolution =
  | { ok: true; via: 'as-given' | 'path' | 'bin' | 'prefix'; file: string; args: string[] }
  | { ok: false; reason: string };

/** `runPrefixes`: the project's `demoMeans.run` (bare head → in-tree argv prefix). */
export type CheckpointHeadOptions = { runPrefixes?: RunPrefixes };

/** The first executable `bin` in a PATH directory, or null. */
function findOnPath(bin: string, pathEnv: string = process.env.PATH ?? ''): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return join(dir, bin);
    } catch {
      /* try the next PATH entry */
    }
  }
  return null;
}

const SCRIPT_TARGET = /\.(?:[cm]?js)$/;

function escapes(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel);
}

/** Never throws; a refusal carries the named reason. */
export function resolveCheckpointHead(
  argv: readonly string[],
  worktreePath: string,
  opts: CheckpointHeadOptions = {},
): CheckpointHeadResolution {
  const head = argv[0] ?? '';
  const rest = argv.slice(1);
  if (head.includes('/')) {
    if (escapes(resolve(worktreePath), resolve(worktreePath, head))) {
      return { ok: false, reason: `\`${head}\` resolves outside the capture tree — a checkpoint command runs the tree it is evidence for` };
    }
    try {
      const abs = resolve(worktreePath, head);
      if (existsSync(abs) && escapes(realpathSync(worktreePath), realpathSync(abs))) {
        return { ok: false, reason: `\`${head}\` resolves (via symlink) outside the capture tree` };
      }
    } catch (err) {
      return { ok: false, reason: `\`${head}\` could not be checked for containment: ${err instanceof Error ? err.message : String(err)}` };
    }
    return { ok: true, via: 'as-given', file: head, args: [...rest] };
  }

  const prefixes = opts.runPrefixes ?? {};
  if (Object.prototype.hasOwnProperty.call(prefixes, head)) {
    const checked = validateRunPrefix(head, prefixes[head]);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    // No prefixes inside: a prefix cannot chain, nor launder a PATH copy.
    const inner = resolveCheckpointHead([...checked.argv, ...rest], worktreePath);
    if (!inner.ok) return { ok: false, reason: `demoMeans.run.${head}: ${inner.reason}` };
    return { ...inner, via: 'prefix' };
  }

  const pkgPath = join(worktreePath, 'package.json');
  let pkg: unknown;
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      return {
        ok: false,
        reason: `the worktree package.json is unreadable or malformed (${err instanceof Error ? err.message : String(err)}) so its "bin" for \`${head}\` could not be checked`,
      };
    }
  }
  const declared = resolveDeclaredBin(pkg, head);
  if (declared.kind === 'rejected') {
    return { ok: false, reason: `\`${head}\` package.json bin is refused: ${declared.reason}` };
  }
  if (declared.kind === 'contained') {
    const abs = resolve(worktreePath, declared.target);
    try {
      if (existsSync(abs)) {
        const realRoot = realpathSync(worktreePath);
        if (escapes(realRoot, realpathSync(abs))) {
          return { ok: false, reason: `\`${head}\` package.json bin target \`${declared.target}\` resolves (via symlink) outside the worktree` };
        }
      }
    } catch (err) {
      return { ok: false, reason: `\`${head}\` bin target \`${declared.target}\` could not be checked for containment: ${err instanceof Error ? err.message : String(err)}` };
    }
    return SCRIPT_TARGET.test(abs)
      ? { ok: true, via: 'bin', file: process.execPath, args: [abs, ...rest] }
      : { ok: true, via: 'bin', file: abs, args: [...rest] };
  }

  const onPath = findOnPath(head);
  const own = treeDeclaresEntryPoint(worktreePath, head);
  if (own.declared === 'unknown') {
    return { ok: false, reason: `\`${head}\` could not be checked against the tree's own commands: ${own.reason}` };
  }
  if (own.declared) {
    const where = onPath ? `resolves to ${onPath}` : 'is not built in the tree and not on PATH';
    return {
      ok: false,
      reason: `\`${head}\` ${where} outside the capture tree (the tree declares it in ${own.in}) — declare an in-tree run prefix in demoMeans.run, e.g. "${head}": "python3 -m <package>.cli"`,
    };
  }
  if (onPath) return { ok: true, via: 'path', file: head, args: [...rest] };
  return { ok: false, reason: `\`${head}\` not found (looked up in the worktree package.json "bin" and on PATH) — the capture run would record "[command did not run]" as evidence` };
}
