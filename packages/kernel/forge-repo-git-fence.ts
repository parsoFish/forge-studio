/**
 * forge-repo-git-fence.ts — the pure decision behind "no agent kind may
 * commit to or move a ref of the forge repo" (bead `forge-8vfn.8.5.44`, row
 * 208, 2026-10-03 incident).
 *
 * THE INCIDENT. Forge's onboarding agent runs with `permissionMode:
 * 'acceptEdits'` and `Bash` in `allowedTools`, cwd'd at the project's OWN
 * nested repo (`<forgeRoot>/projects/<name>`). The forge root was a git
 * WORKTREE of the operator's main checkout, so branch refs are SHARED. The
 * agent correctly wrote `brain/projects/<name>/profile.md` straight into the
 * forge repo (ADR 035 — Brain 3 is forge-owned and central, BY DESIGN) and
 * then, imitating the `git add && git commit` shape that is completely
 * correct in the PROJECT's own repo one Bash call earlier, ran it again
 * against the FORGE repo: `cd <forgeRoot> && git add brain/… && git commit`,
 * then `git branch` / `git checkout` / `git merge --ff-only` / `git
 * update-ref refs/heads/main <sha>` — the last of which moved the
 * OPERATOR's own `main`.
 *
 * THE RULE this function enforces (verbatim from the ruling): no agent may
 * commit to or move a ref of the forge repo — `commit`, `update-ref`,
 * `branch` create/delete/move, `checkout`/`switch`, `merge`, `rebase`,
 * `reset`, `cherry-pick`, `revert`, `am`, `tag`, `stash`, `push`,
 * fetch-into-refs, `worktree add`/`remove` — via any route: a plain cwd'd
 * invocation, `git -C <dir>`, `--git-dir=`/`--work-tree=`, or `GIT_DIR=`/
 * `GIT_WORK_TREE=`. Writing the profile file stays allowed; this function
 * never sees a `Write` call at all, only `Bash`.
 *
 * WHY A DENYLIST OF VERBS, NOT AN ALLOWLIST OF SAFE ONES (unlike
 * `tool-fence.ts` next door, which argues the opposite for TOOL NAMES). The
 * ruling names an exhaustive, closed set of REF-MOVING git verbs — that is
 * the actual shape of the harm ("commit to or move a ref"), and `git add`,
 * `git config`, `git init`, `git submodule` etc. do not move a ref even when
 * run at the forge root, so denying them too would refuse operations the
 * ruling never asked to stop (and would have wrongly denied seq 46's own
 * legitimate `git add` had this fence applied to the project's repo instead
 * of the forge repo). Every verb NOT in the set passes with no location
 * check at all — this function has nothing to say about it.
 *
 * WHY CONSERVATIVE ON THE TARGET, NOT THE VERB. A verb in the set is denied
 * UNLESS its effective target can be shown to be (a) outside the forge repo
 * entirely, or (b) inside the project's own nested repo (`workdir`) with no
 * `..`/`-C`/`--git-dir`/`GIT_DIR=` escape. Anything this function cannot
 * resolve lexically — a `cd` to a shell expansion, a `-C`/`GIT_DIR=` value
 * containing `$`/`~`, command/process substitution anywhere in the command —
 * is treated as "not shown to be outside", i.e. DENIED. Pure lexical
 * resolution (`node:path`'s `resolve`), never `realpathSync`: this function
 * takes no filesystem dependency, so it is directly testable against paths
 * that do not exist on the host running the test, and a symlink cannot move
 * its verdict either way (the escape this closes is "which directory did the
 * command NAME", not "what does that name really point at" — the forge repo
 * and the project's nested repo are both real, ordinary directories here).
 *
 * WHAT THIS IS NOT. A general Bash-write inspector — that is
 * `packages/sessions/bash-fence.ts`, which already denies EVERY git mutating
 * subcommand unconditionally (it has no concept of "the project's own
 * nested repo" to carve an exception for, since its callers are
 * interactive-session write-root fences, not a project-bound agent run).
 * This module is deliberately narrower and deliberately more permissive in
 * exactly one way `bash-fence.ts` is not: a mutating git verb run inside
 * `workdir` is fine. Kernel cannot import `packages/sessions` (layering —
 * sessions depends on kernel, never the reverse) and the two fences answer
 * different questions, so this is a second, small, purpose-built tokenizer
 * rather than a shared one — see `splitTopLevelSegments`'s own doc for how
 * much narrower it is than that file's.
 */
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';

export type ForgeRepoGitFenceInput = {
  /** The raw Bash command string a tool call is about to run. */
  command: string;
  /**
   * The shell's cwd THIS command starts from. Not a live-tracked shell cwd
   * across separate Bash tool calls — the Claude Agent SDK gives a
   * `PreToolUse` hook only the one command string, never the persistent
   * shell state a prior call's own `cd` may have left behind. Every
   * production caller passes the SAME value already handed to the SDK's own
   * `options.cwd` for this spawn, so a command with no `cd` of its own is
   * judged against the spawn's real starting directory — the only directory
   * this function can know for certain without re-deriving shell semantics
   * forge does not control.
   */
  cwd: string;
  /** This forge install's root — the repo whose refs must not move. */
  forgeRoot: string;
  /** The bound project's own nested repo — committing HERE is fine. */
  workdir: string;
};

export type ForgeRepoGitDecision = { allow: true } | { allow: false; reason: string };

/** Ref-moving git subcommands the ruling names. `remote`, `add`, `config`,
 *  `init`, `clone`, `submodule`, … are deliberately absent — see the module
 *  header's "why a denylist" note. `branch`/`tag`/`worktree` get their own
 *  refinement below (a pure listing is not a mutation). */
const MUTATING_GIT_VERBS = new Set([
  'commit', 'update-ref', 'branch', 'checkout', 'switch', 'merge', 'rebase',
  'reset', 'cherry-pick', 'revert', 'am', 'tag', 'stash', 'push', 'fetch',
  'pull', 'worktree',
]);

const BRANCH_LIST_ONLY_ARGS = new Set(['--list', '-l', '-a', '-r', '--all', '-v', '-vv', '--show-current']);
const TAG_LIST_ONLY_ARGS = new Set(['--list', '-l']);

/** Is this invocation of a verb in `MUTATING_GIT_VERBS` actually a mutation,
 *  given its args? `branch`/`tag` with no args (or only listing flags) list
 *  rather than write; `worktree` only moves anything on `add`/`remove` (the
 *  ruling's own phrase — `list`/`prune`/`lock` are left alone); `stash`
 *  `list`/`show` read. Every other verb in the set mutates unconditionally —
 *  deny-on-doubt, not a model of every one of their read-ish edge cases. */
function isActuallyMutating(verb: string, args: readonly string[]): boolean {
  if (verb === 'branch') return !(args.length === 0 || args.every((a) => BRANCH_LIST_ONLY_ARGS.has(a)));
  if (verb === 'tag') return !(args.length === 0 || args.every((a) => TAG_LIST_ONLY_ARGS.has(a)));
  if (verb === 'worktree') return args[0] === 'add' || args[0] === 'remove';
  if (verb === 'stash') return args[0] !== 'list' && args[0] !== 'show';
  return true;
}

/** A word that could not be resolved without running a shell: unquoted `$`,
 *  backtick, or a leading `~`. Never asserts about QUOTED text — a quoted
 *  commit message containing a literal `$` is not a path this function ever
 *  resolves, so it is not this check's concern. */
function hasUnresolvableExpansion(word: string): boolean {
  return /\$|`/.test(word) || word.startsWith('~');
}

/**
 * Split `command` on top-level (unquoted) `&&`, `||`, `;`, `|`, `&`, newline
 * — deliberately NOT `packages/sessions/bash-fence.ts`'s tokenizer (see the
 * module header). Quote tracking only goes as far as "don't split inside a
 * quote" and "strip the quote marks from the word"; it does not model
 * heredocs, redirection, fd numbers, or any of the shapes that file reasons
 * about, because this fence only ever looks at `cd` and `git` invocations.
 */
function splitTopLevelSegments(command: string): string[] {
  const segments: string[] = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (inSingle) {
      buf += c;
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '\\' && i + 1 < command.length) { buf += c + command[i + 1]; i += 1; continue; }
      buf += c;
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") { inSingle = true; buf += c; continue; }
    if (c === '"') { inDouble = true; buf += c; continue; }
    if (c === '&' && command[i + 1] === '&') { segments.push(buf); buf = ''; i += 1; continue; }
    if (c === '|' && command[i + 1] === '|') { segments.push(buf); buf = ''; i += 1; continue; }
    if (c === '|' || c === ';' || c === '&' || c === '\n') { segments.push(buf); buf = ''; continue; }
    buf += c;
  }
  segments.push(buf);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Word-split one segment, quote-aware: a quoted span is one word with its
 *  quote marks stripped (minimal backslash handling inside double quotes
 *  only — single-quoted text is fully literal, as in a real shell). */
function splitWords(segment: string): string[] {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i];
    if (inSingle) { if (c === "'") inSingle = false; else cur += c; has = true; continue; }
    if (inDouble) {
      if (c === '\\' && i + 1 < segment.length) { cur += segment[i + 1]; i += 1; has = true; continue; }
      if (c === '"') inDouble = false; else { cur += c; has = true; }
      continue;
    }
    if (c === "'") { inSingle = true; has = true; continue; }
    if (c === '"') { inDouble = true; has = true; continue; }
    if (/\s/.test(c)) { if (has) { words.push(cur); cur = ''; has = false; } continue; }
    cur += c;
    has = true;
  }
  if (has) words.push(cur);
  return words;
}

/** `resolve(base, value)`, lexical only (no filesystem access — see the
 *  module header on why never `realpathSync`). `null` when `value` carries
 *  an expansion this function cannot follow, or when `base` is itself
 *  already unknown (`null`) and `value` is not absolute. */
function resolveAgainst(base: string | null, value: string): string | null {
  if (hasUnresolvableExpansion(value)) return null;
  if (isAbsolute(value)) return resolvePath(value);
  if (base === null) return null;
  return resolvePath(base, value);
}

function isUnderOrEqual(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/** Leading `NAME=value` env-assignment words before the real command word —
 *  returns them keyed by name, plus the index of the first non-assignment
 *  word. `GIT_DIR=`/`GIT_WORK_TREE=` are read out of this set below; no
 *  other assignment is interpreted. */
function stripLeadingAssignments(words: readonly string[]): { env: Map<string, string>; rest: readonly string[] } {
  const env = new Map<string, string>();
  let i = 0;
  while (i < words.length) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(words[i]!);
    if (!m) break;
    env.set(m[1]!, m[2]!);
    i += 1;
  }
  return { env, rest: words.slice(i) };
}

/** `git`'s own global options this function follows: repeatable `-C <dir>`
 *  (each relative to the PRIOR one, exactly as git itself resolves it),
 *  `--git-dir=`/`--work-tree=` (and their `-c key` form, skipped — it never
 *  names a directory). Any other leading `-` option this function does not
 *  recognise stops the scan: the "subcommand" it reports from there on is
 *  that unrecognised flag itself, which matches no entry in
 *  `MUTATING_GIT_VERBS` OR any read-only shortcut, so a verb genuinely
 *  hidden behind an unmodelled global option is NOT silently passed — it
 *  simply is not reasoned about either way, same as this file's other
 *  doubt-shaped gaps (`$()`, a `cd` to an expansion). */
function resolveGitTarget(args: readonly string[], startCwd: string | null, env: Map<string, string>): {
  effectiveDir: string | null;
  subcommandIndex: number;
} {
  let base = startCwd;
  let workTreeOverride: string | undefined;
  let gitDirOverride: string | undefined;
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) {
    const a = args[i]!;
    if (a === '-C') { base = resolveAgainst(base, args[i + 1] ?? ''); i += 2; continue; }
    if (a === '-c') { i += 2; continue; }
    if (a === '--no-pager' || a === '-p' || a === '--paginate') { i += 1; continue; }
    if (a.startsWith('--work-tree=')) { workTreeOverride = a.slice('--work-tree='.length); i += 1; continue; }
    if (a.startsWith('--git-dir=')) { gitDirOverride = a.slice('--git-dir='.length); i += 1; continue; }
    if (a === '--work-tree') { workTreeOverride = args[i + 1]; i += 2; continue; }
    if (a === '--git-dir') { gitDirOverride = args[i + 1]; i += 2; continue; }
    break;
  }
  const workTree = workTreeOverride ?? env.get('GIT_WORK_TREE');
  const gitDir = gitDirOverride ?? env.get('GIT_DIR');
  const override = workTree !== undefined ? resolveAgainst(base, workTree) : gitDir !== undefined ? resolveAgainst(base, gitDir) : null;
  return { effectiveDir: override ?? base, subcommandIndex: i };
}

/**
 * The decision. `cwd`/`forgeRoot`/`workdir` are expected already-absolute
 * (every production caller derives them from the spawn's own `options.cwd`
 * / `FORGE_ROOT` / `ctx.workdir`, all of which are asserted absolute
 * upstream — `resolve()` below is defensive, not a declaration that a
 * relative value here is meaningful).
 */
export function decideForgeRepoGit(input: ForgeRepoGitFenceInput): ForgeRepoGitDecision {
  const forgeRoot = resolvePath(input.forgeRoot);
  const workdir = resolvePath(input.workdir);

  // Command/process substitution can run an arbitrary pipeline this
  // segment-level scan never looks inside (`$(cd <forge> && git commit …)`
  // is, to the splitter below, just a WORD inside some other command). Any
  // occurrence anywhere in the command, alongside the literal token `git`,
  // is denied outright — `bash-fence.ts` makes the identical call for the
  // identical reason: "not reasoned about" is not the same fact as "safe".
  if (/\$\(|`|<\(|>\(/.test(input.command) && /\bgit\b/.test(input.command)) {
    return { allow: false, reason: 'command/process substitution alongside a `git` invocation is not reasoned about — denied conservatively' };
  }

  let cwd: string | null = resolvePath(input.cwd);
  for (const segment of splitTopLevelSegments(input.command)) {
    const words = splitWords(segment);
    const { env, rest } = stripLeadingAssignments(words);
    const head = rest[0];
    if (head === undefined) continue;

    if (head === 'cd') {
      const target = rest[1];
      cwd = rest.length === 2 && target !== undefined && !target.startsWith('-') ? resolveAgainst(cwd, target) : null;
      continue;
    }

    if (head !== 'git') continue;
    const gitArgs = rest.slice(1);
    const { effectiveDir, subcommandIndex } = resolveGitTarget(gitArgs, cwd, env);
    const verb = gitArgs[subcommandIndex];
    if (verb === undefined || !MUTATING_GIT_VERBS.has(verb)) continue;
    if (!isActuallyMutating(verb, gitArgs.slice(subcommandIndex + 1))) continue;

    const outsideForge = effectiveDir !== null && !isUnderOrEqual(effectiveDir, forgeRoot);
    const insideWorkdir = effectiveDir !== null && isUnderOrEqual(effectiveDir, workdir);
    if (outsideForge || insideWorkdir) continue;

    const where = effectiveDir === null ? 'an unresolvable target directory' : `"${effectiveDir}"`;
    return {
      allow: false,
      reason:
        `git ${verb} runs against ${where}, which cannot be shown to be outside the forge repo ("${forgeRoot}") or ` +
        `inside the project's own nested repo ("${workdir}") — no agent kind may commit to or move a ref of the ` +
        'forge repo (ruling 208, forge-8vfn.8.5.44).',
    };
  }
  return { allow: true };
}
