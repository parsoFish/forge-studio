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
 * invocation, `git -C <dir>`, `--git-dir=`/`--work-tree=`, `GIT_DIR=`/
 * `GIT_WORK_TREE=`, OR a route that reaches a DIFFERENT worktree of the SAME
 * repository. Writing the profile file stays allowed; this function never
 * sees a `Write` call at all, only `Bash`.
 *
 * WHY REPO IDENTITY, NOT A PATH PREFIX (T1 review of the first cut, row
 * 208). "Outside forgeRoot" is a LEXICAL question; "the same repository as
 * forgeRoot" is not — a git repo's refs are owned by its `.git` COMMON dir,
 * and every worktree of that repo (the main checkout, every sibling
 * `forge-m7-e-*` linked worktree this install's own worktree-per-session
 * model creates) shares exactly one. `cd /home/parso/forge && git
 * update-ref refs/heads/main <sha>` — the operator's own main checkout, with
 * `forgeRoot=/home/parso/forge-m7-e-docs` — is OUTSIDE forgeRoot by every
 * lexical measure and STILL moves the exact ref this ruling exists to
 * protect. So this function is never handed `forgeRoot` alone: it is handed
 * `forgeRepoId` (forgeRoot's repo identity, precomputed once) and `repoOf`
 * (a resolver from any directory to ITS repo identity), and the question it
 * actually asks per mutating invocation is "does the effective target
 * belong to the SAME repository as forgeRoot" — never "is it lexically
 * under it". The project's own nested repo has its OWN `.git`, hence its
 * OWN identity, and is allowed by this rule with no separate carve-out.
 *
 * WHY THE RESOLVER IS INJECTED, NOT CALLED HERE. This function stays
 * filesystem-free (directly unit-testable with a fake `repoOf` table, no
 * temp repos, no `git worktree add`). The REAL resolver
 * (`packages/agents/studio/repo-identity.ts`, `resolveRepoCommonDir`) walks
 * `.git` files and is exercised against real on-disk repos in that module's
 * own test file. `forgeRepoId` is resolved and CACHED once per spawn by the
 * agents-side glue (`hook-dispatch.ts`) rather than re-derived here, since
 * it cannot change mid-run and a Bash-heavy run can fire this callback
 * dozens of times.
 *
 * UNRESOLVABLE IS NEVER "SAFE". `forgeRepoId === null` (forge's own identity
 * could not be resolved) or `repoOf(effectiveDir) === null` (the target
 * isn't inside any repo this function can identify, or the walk failed) both
 * DENY a mutating verb — an unprovable "not the forge repo" is not the same
 * fact as a proven one, and the direction of a doubt-shaped gap is always
 * deny, never allow.
 *
 * WHY A DENYLIST OF VERBS, NOT AN ALLOWLIST OF SAFE ONES (unlike
 * `tool-fence.ts` next door, which argues the opposite for TOOL NAMES). The
 * ruling names an exhaustive, closed set of REF-MOVING git verbs — that is
 * the actual shape of the harm ("commit to or move a ref") — and `git add`,
 * `git config`, `git init`, `git submodule` etc. do not move a ref even when
 * run at the forge root, so denying them too would refuse operations the
 * ruling never asked to stop (and would have wrongly denied seq 46's own
 * legitimate `git add` had this fence applied to the project's repo instead
 * of the forge repo). Every verb NOT in the set passes with no identity
 * check at all — this function has nothing to say about it.
 *
 * WRAPPED, SUBSHELL AND INDIRECT FORMS (T1 review, row 208 follow-up). The
 * per-segment `cd`/`git` tracking below only reasons about a SIMPLE command
 * at the head of its segment. `(cd <forge> && git commit -m x)` splits (on
 * the top-level `&&`, which this file's splitter does not treat `(`/`)` as
 * special for) into `(cd <forge>` and `git commit -m x)` — the leading `(`
 * glues onto `cd`, so the `cd` is never recognised and the second segment's
 * `git commit` is judged against the UNCHANGED starting cwd. The identical
 * blindness hides a `git` invocation inside `sh -c '…'`, `bash -c "…"`,
 * `eval`, `env NAME=value git …`, `xargs git …`, `command`/`exec`/`nice`/
 * `timeout … git …` — in every one of these, `git` is a WORD somewhere in
 * the command that is not the head of a per-segment simple command this
 * tokenizer resolves a cwd for. Rather than special-case each wrapper (a
 * denylist of wrapper NAMES has the identical "can only miss one nobody
 * thought of" defect `tool-fence.ts` argues against for tool names), a
 * single BLANKET pre-check denies the whole command outright whenever a
 * `git` token exists somewhere other than at the head of a parsed simple
 * command, OR the command contains any `(`/`)`/`{`/`}` grouping character —
 * AND a mutating verb WORD appears anywhere in the command. Deny-on-doubt:
 * this never tries to prove the wrapped form is dangerous, only that it
 * cannot be shown safe.
 *
 * WHAT THIS IS NOT. A general Bash-write inspector — that is
 * `packages/sessions/bash-fence.ts`, which already denies EVERY git mutating
 * subcommand unconditionally (it has no concept of "the project's own
 * nested repo" to carve an exception for, since its callers are
 * interactive-session write-root fences, not a project-bound agent run).
 * This module is deliberately narrower and deliberately more permissive in
 * exactly one way `bash-fence.ts` is not: a mutating git verb run inside a
 * genuinely different repository (identity, not lexical workdir) is fine.
 * Kernel cannot import `packages/sessions` (layering — sessions depends on
 * kernel, never the reverse) and the two fences answer different questions,
 * so this is a second, small, purpose-built tokenizer rather than a shared
 * one — see `splitTopLevelSegments`'s own doc for how much narrower it is
 * than that file's.
 */
import { isAbsolute, resolve as resolvePath } from 'node:path';

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
  /** This forge install's root — used only for the DENY message's wording;
   *  the actual decision runs on `forgeRepoId`, below. */
  forgeRoot: string;
  /**
   * `forgeRoot`'s repo identity (its git COMMON dir), precomputed ONCE per
   * spawn by the caller — see the module header. `null` ⇒ it could not be
   * resolved, which denies every mutating verb unconditionally.
   */
  forgeRepoId: string | null;
  /**
   * Resolves any directory's repo identity, or `null` if it is not inside a
   * repo this function can identify. See the module header's "why injected"
   * note. Called once per mutating git invocation found, on that
   * invocation's EFFECTIVE target directory (after `cd`/`-C`/
   * `--git-dir=`/`GIT_DIR=` tracking).
   */
  repoOf: (dir: string) => string | null;
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

/** Same vocabulary as `MUTATING_GIT_VERBS`, as a word-boundary alternation —
 *  the blanket wrapped-form check (module header) asks "does a mutating verb
 *  WORD appear anywhere", not "is this invocation's own verb mutating", so it
 *  cannot reuse `isActuallyMutating`'s per-invocation refinement. */
const MUTATING_VERB_WORD_RE = new RegExp(`\\b(?:${[...MUTATING_GIT_VERBS].join('|')})\\b`);

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
 * Deliberately does NOT treat `(`/`)`/`{`/`}` as boundaries either — the
 * module header's "wrapped forms" section covers both consequences of that.
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

/** One word from `splitWords`: its unquoted text, plus whether ANY part of
 *  it came from inside a quote. The distinction matters exactly once (see
 *  `gitAppearsOutsideHead`): a bare argument word happening to CONTAIN "git"
 *  as a hyphen-delimited substring of a path (`/home/x/my-git-tool`) must
 *  never read as a nested `git` invocation the way an actually-quoted nested
 *  command string (`sh -c 'cd X && git commit'`) legitimately does. */
type Word = { text: string; quoted: boolean };

/** Word-split one segment, quote-aware: a quoted span is one word with its
 *  quote marks stripped (minimal backslash handling inside double quotes
 *  only — single-quoted text is fully literal, as in a real shell). */
function splitWords(segment: string): Word[] {
  const words: Word[] = [];
  let cur = '';
  let has = false;
  let quoted = false;
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
    if (c === "'") { inSingle = true; has = true; quoted = true; continue; }
    if (c === '"') { inDouble = true; has = true; quoted = true; continue; }
    if (/\s/.test(c)) { if (has) { words.push({ text: cur, quoted }); cur = ''; has = false; quoted = false; } continue; }
    cur += c;
    has = true;
  }
  if (has) words.push({ text: cur, quoted });
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

/** Leading `NAME=value` env-assignment words before the real command word —
 *  returns them keyed by name, plus the index of the first non-assignment
 *  word. `GIT_DIR=`/`GIT_WORK_TREE=` are read out of this set below; no
 *  other assignment is interpreted. A QUOTED word is never an assignment —
 *  real shells only recognise the unquoted `NAME=` shape. */
function stripLeadingAssignments(words: readonly Word[]): { env: Map<string, string>; rest: readonly Word[] } {
  const env = new Map<string, string>();
  let i = 0;
  while (i < words.length) {
    const w = words[i]!;
    if (w.quoted) break;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(w.text);
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
 *  `MUTATING_GIT_VERBS`, so a verb genuinely hidden behind an unmodelled
 *  global option is NOT silently passed — it simply is not reasoned about
 *  either way, same as this file's other doubt-shaped gaps. */
function resolveGitTarget(args: readonly Word[], startCwd: string | null, env: Map<string, string>): {
  effectiveDir: string | null;
  subcommandIndex: number;
} {
  let base = startCwd;
  let workTreeOverride: string | undefined;
  let gitDirOverride: string | undefined;
  let i = 0;
  while (i < args.length && args[i]!.text.startsWith('-')) {
    const a = args[i]!.text;
    if (a === '-C') { base = resolveAgainst(base, args[i + 1]?.text ?? ''); i += 2; continue; }
    if (a === '-c') { i += 2; continue; }
    if (a === '--no-pager' || a === '-p' || a === '--paginate') { i += 1; continue; }
    if (a.startsWith('--work-tree=')) { workTreeOverride = a.slice('--work-tree='.length); i += 1; continue; }
    if (a.startsWith('--git-dir=')) { gitDirOverride = a.slice('--git-dir='.length); i += 1; continue; }
    if (a === '--work-tree') { workTreeOverride = args[i + 1]?.text; i += 2; continue; }
    if (a === '--git-dir') { gitDirOverride = args[i + 1]?.text; i += 2; continue; }
    break;
  }
  const workTree = workTreeOverride ?? env.get('GIT_WORK_TREE');
  const gitDir = gitDirOverride ?? env.get('GIT_DIR');
  const override = workTree !== undefined ? resolveAgainst(base, workTree) : gitDir !== undefined ? resolveAgainst(base, gitDir) : null;
  return { effectiveDir: override ?? base, subcommandIndex: i };
}

/** Outside-quotes scan for `(`, `)`, `{`, `}` — see the module header's
 *  "wrapped forms" section on why their mere PRESENCE, with no attempt to
 *  parse what they group, is the conservative signal this fence acts on. */
function hasGroupingChars(command: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (inSingle) { if (c === "'") inSingle = false; continue; }
    if (inDouble) {
      if (c === '\\' && i + 1 < command.length) { i += 1; continue; }
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") { inSingle = true; continue; }
    if (c === '"') { inDouble = true; continue; }
    if (c === '(' || c === ')' || c === '{' || c === '}') return true;
  }
  return false;
}

/** Does a `git` WORD appear anywhere other than the head of one of
 *  `command`'s top-level simple commands (after leading assignments)? An
 *  UNQUOTED non-head word must be the EXACT literal `git` (`env FOO=bar git
 *  commit`, `xargs git commit`, `timeout 5 git commit`, …) — never a
 *  word-boundary substring match, which would misfire on an ordinary
 *  argument like a path containing `-git-` (`cd /home/x/my-git-tool`) that
 *  has nothing to do with a nested invocation. A QUOTED word, by contrast,
 *  IS checked with a word-boundary regex against its content, because that
 *  is exactly the shape of a nested command string this fence must still
 *  catch — `sh -c 'cd X && git commit'`'s whole quoted span is one word to
 *  `splitWords`, containing `git` as its OWN token inside a real nested
 *  shell command, not as a fragment of some unrelated identifier. */
function gitAppearsOutsideHead(command: string): boolean {
  for (const segment of splitTopLevelSegments(command)) {
    const { rest } = stripLeadingAssignments(splitWords(segment));
    for (let i = 1; i < rest.length; i += 1) {
      const w = rest[i]!;
      if (w.quoted ? /\bgit\b/.test(w.text) : w.text === 'git') return true;
    }
  }
  return false;
}

/**
 * The decision. `cwd`/`forgeRoot` are expected already-absolute (every
 * production caller derives them from the spawn's own `options.cwd` /
 * `FORGE_ROOT`, both asserted absolute upstream — `resolve()` below is
 * defensive, not a declaration that a relative value here is meaningful).
 */
export function decideForgeRepoGit(input: ForgeRepoGitFenceInput): ForgeRepoGitDecision {
  const forgeRoot = resolvePath(input.forgeRoot);

  // Command/process substitution can run an arbitrary pipeline this
  // segment-level scan never looks inside (`$(cd <forge> && git commit …)`
  // is, to the splitter below, just a WORD inside some other command). Any
  // occurrence anywhere in the command, alongside the literal token `git`,
  // is denied outright — `bash-fence.ts` makes the identical call for the
  // identical reason: "not reasoned about" is not the same fact as "safe".
  const mentionsGit = /\bgit\b/.test(input.command);
  if (mentionsGit && /\$\(|`|<\(|>\(/.test(input.command)) {
    return { allow: false, reason: 'command/process substitution alongside a `git` invocation is not reasoned about — denied conservatively' };
  }

  // Wrapped/subshell/indirect forms (module header) — a blanket pre-check,
  // never a per-wrapper-name denylist. Gated on `mentionsGit` for the same
  // reason the substitution check above is: a grouped command with no `git`
  // anywhere is not this fence's concern at all.
  if (mentionsGit && MUTATING_VERB_WORD_RE.test(input.command) && (hasGroupingChars(input.command) || gitAppearsOutsideHead(input.command))) {
    return {
      allow: false,
      reason:
        'a wrapped, grouped or indirect git invocation ((), {}, sh -c, bash -c, eval, env, xargs, command, exec, nice, ' +
        'timeout, …) alongside a mutating verb is not reasoned about — denied conservatively (ruling 208, forge-8vfn.8.5.44).',
    };
  }

  let cwd: string | null = resolvePath(input.cwd);
  for (const segment of splitTopLevelSegments(input.command)) {
    const words = splitWords(segment);
    const { env, rest } = stripLeadingAssignments(words);
    const head = rest[0];
    if (head === undefined) continue;

    if (head.text === 'cd') {
      const target = rest[1];
      cwd = rest.length === 2 && target !== undefined && !target.text.startsWith('-') ? resolveAgainst(cwd, target.text) : null;
      continue;
    }

    if (head.text !== 'git') continue;
    const gitArgs = rest.slice(1);
    const { effectiveDir, subcommandIndex } = resolveGitTarget(gitArgs, cwd, env);
    const verb = gitArgs[subcommandIndex]?.text;
    if (verb === undefined || !MUTATING_GIT_VERBS.has(verb)) continue;
    if (!isActuallyMutating(verb, gitArgs.slice(subcommandIndex + 1).map((w) => w.text))) continue;

    if (effectiveDir === null) {
      return {
        allow: false,
        reason: `git ${verb} runs with an unresolvable target directory (an expansion, an unknown prior `
          + `\`cd\`, or a GIT_DIR/--git-dir override this fence cannot statically follow) — denied conservatively; `
          + `it cannot be shown to belong to a different repository than the forge repo at "${forgeRoot}" `
          + '(ruling 208, forge-8vfn.8.5.44).',
      };
    }

    // THE identity check (module header's "why repo identity" section): a
    // mutating verb is allowed ONLY when its target is PROVABLY a different
    // repository from forgeRoot's — never merely "lexically elsewhere".
    const targetRepoId = input.repoOf(effectiveDir);
    const provablyDifferentRepo = input.forgeRepoId !== null && targetRepoId !== null && targetRepoId !== input.forgeRepoId;
    if (provablyDifferentRepo) continue;

    return {
      allow: false,
      reason:
        `git ${verb} runs against "${effectiveDir}", which cannot be shown to belong to a DIFFERENT repository than ` +
        `the forge repo at "${forgeRoot}" (same repo id, or one side's identity could not be resolved) — no agent ` +
        'kind may commit to or move a ref of the forge repo (ruling 208, forge-8vfn.8.5.44).',
    };
  }
  return { allow: true };
}
