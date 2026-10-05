/**
 * The ONE resolver for a demo checkpoint command's head (bead forge-8vfn.30.9),
 * used by BOTH the pre-claim producibility check (`@forge/flows`'s
 * `checkCommandProducible`) and the capture spawn (`@forge/factory`'s
 * `captureCommandOutput`), so a command judged producible is the command
 * capture actually runs.
 *
 * Order: (1) a head with a path separator is the caller's path-bearing rule —
 * returned unchanged; (2) a bare head on PATH runs as itself; (3) a bare head
 * NOT on PATH that the worktree's package.json `bin` declares resolves to the
 * declared target, which must stay inside the worktree (lexical rule in
 * `@forge/contracts`'s `resolveDeclaredBin`, plus a realpath re-check here when
 * the target exists); (4) anything else is refused, naming the lookups tried.
 * The target need not exist yet — the tree is built before capture.
 */
import { accessSync, constants, existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';

import { resolveDeclaredBin } from '@forge/contracts';

export type CheckpointHeadResolution =
  | { ok: true; via: 'as-given' | 'path' | 'bin'; file: string; args: string[] }
  | { ok: false; reason: string };

/** Is `bin` an executable file in a PATH directory? */
function isExecutableOnPath(bin: string, pathEnv: string = process.env.PATH ?? ''): boolean {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      /* try the next PATH entry */
    }
  }
  return false;
}

const SCRIPT_TARGET = /\.(?:[cm]?js)$/;

function escapes(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel);
}

/** Resolve `argv[0]` of a checkpoint command against PATH, then the worktree's
 *  package.json `bin`. Never throws; a refusal carries the named reason. */
export function resolveCheckpointHead(argv: readonly string[], worktreePath: string): CheckpointHeadResolution {
  const head = argv[0] ?? '';
  const rest = argv.slice(1);
  if (head.includes('/')) return { ok: true, via: 'as-given', file: head, args: [...rest] };
  if (isExecutableOnPath(head)) return { ok: true, via: 'path', file: head, args: [...rest] };

  const lookups = `looked up on PATH and in the worktree package.json "bin"`;
  const pkgPath = join(worktreePath, 'package.json');
  let pkg: unknown;
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      return {
        ok: false,
        reason: `\`${head}\` not found on PATH, and the worktree package.json is unreadable or malformed (${err instanceof Error ? err.message : String(err)}) so its "bin" could not be checked`,
      };
    }
  }
  const declared = resolveDeclaredBin(pkg, head);
  if (declared.kind === 'undeclared') {
    return { ok: false, reason: `\`${head}\` not found (${lookups}) — the capture run would record "[command did not run]" as evidence` };
  }
  if (declared.kind === 'rejected') {
    return { ok: false, reason: `\`${head}\` is not on PATH and its package.json bin is refused: ${declared.reason}` };
  }
  const abs = resolve(worktreePath, declared.target);
  try {
    if (existsSync(abs)) {
      const realRoot = realpathSync(worktreePath);
      if (escapes(realRoot, realpathSync(abs))) {
        return { ok: false, reason: `\`${head}\` is not on PATH and its package.json bin target \`${declared.target}\` resolves (via symlink) outside the worktree` };
      }
    }
  } catch (err) {
    return { ok: false, reason: `\`${head}\` bin target \`${declared.target}\` could not be checked for containment: ${err instanceof Error ? err.message : String(err)}` };
  }
  return SCRIPT_TARGET.test(abs)
    ? { ok: true, via: 'bin', file: process.execPath, args: [abs, ...rest] }
    : { ok: true, via: 'bin', file: abs, args: [...rest] };
}
