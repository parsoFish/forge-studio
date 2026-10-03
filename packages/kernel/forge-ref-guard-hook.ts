/**
 * Row 211 (bead `forge-8vfn.8.5.47`) — git's OWN mechanism refuses an agent
 * spawn that commits to or moves a ref of the FORGE repo, replacing row 208's
 * PreToolUse Bash-command analysis (removed by the same change).
 *
 * THE INCIDENT THAT RETIRED ROW 208. A real run (S2 run 7) had the fence deny
 * a developer agent's
 *   git commit -m "$(cat <<'EOF'
 *   feat: add filterExcludedAuthors to author-filter with unit tests
 *   EOF
 *   )"
 * — a perfectly ordinary commit, made in the agent's OWN work-item worktree of
 * the PROJECT's repo, that the fence's shell-command parser misread as a
 * forge-repo commit. Parsing an agent-authored shell command to decide "is
 * this dangerous" is the wrong layer: heredocs, subshells, `xargs`, quoting —
 * there is no end to the shapes a parser must special-case, and every one it
 * gets wrong is either a false refusal of safe work (this incident) or a false
 * allow of the thing row 208 existed to stop. Shell parsing is abandoned.
 *
 * THE REPLACEMENT ASKS A DIFFERENT QUESTION, OF A DIFFERENT PARTY. Instead of
 * "does this shell command look like it moves a ref of the forge repo",
 * installed as a hook INSIDE git itself: "is ANY ref of THIS repo about to
 * move, and if so, did the process asking say it is a forge agent spawn". Git
 * answers the first half with total fidelity — it is git's own ref-moving
 * machinery, not a reimplementation of it — and the second half is a single
 * env-var check, which cannot misparse a heredoc because it never looks at one.
 * A PROJECT repo has its own, separate `.git` and never runs this hook at all,
 * so the run-7 commit — made in a project worktree — is untouched BY
 * CONSTRUCTION: this file is never consulted for it, not merely "configured
 * to allow" it.
 *
 * WHY `reference-transaction`, AND WHY INSTALLED RATHER THAN SHIPPED IN
 * `forgeRoot`'s OWN `.git/hooks/`. git's hook sample directory
 * (`.git/hooks/*.sample`) is never version-controlled — a fresh clone of forge
 * has no hooks at all — so the hook must be INSTALLED by forge's own code at a
 * point every operator path reaches (`installForgeRefGuardHook`, called at
 * bridge start and at `forge serve` start). `reference-transaction` is the one
 * git hook that fires for every ref update made through a repository
 * (`commit`, `branch`, `update-ref`, `merge`, a rebase's internal updates, …)
 * REGARDLESS of which of the repo's worktrees the update was made from —
 * unlike `pre-commit`/`pre-receive`, which only cover one verb each, and
 * unlike a client-side `pre-push`, which never sees a local branch move at
 * all. `git rev-parse --git-path hooks`, run with `cwd: forgeRoot`, is what
 * resolves it correctly in every configuration this product supports: it
 * honours `core.hooksPath` when the operator has set one, and — the property
 * this whole design leans on — run from a LINKED WORKTREE it resolves to the
 * repository's COMMON hooks dir (the one true install location shared by
 * every worktree), never a per-worktree copy that a second worktree could
 * lack. Measured directly (2026-10-03): a plain checkout prints the relative
 * `.git/hooks`; a linked worktree of it prints the common repo's absolute
 * `<main>/.git/hooks`; an explicit `core.hooksPath` prints that absolute path
 * unchanged. `resolve(forgeRoot, output)` is therefore correct for all three —
 * `resolve` returns an already-absolute second argument untouched.
 *
 * WHAT THE HOOK ITSELF REFUSES, AND HOW. POSIX `sh`, no bashisms (git invokes
 * hooks with `/bin/sh`, not the operator's interactive shell). Git invokes it
 * once per transaction STATE — `prepared` (before the refs actually move,
 * the only state a non-zero exit can still abort), then `committed` or
 * `aborted` — passed as `$1`, with the full list of `<old> <new> <ref>` lines
 * on stdin for every state. The hook drains stdin UNCONDITIONALLY, before
 * looking at `$1`, so git never sees a broken pipe regardless of the verdict:
 * a hook that exits before reading its own stdin is exactly the kind of
 * "works until the one time it doesn't" bug a reference-transaction hook must
 * not be. It then asks exactly one question, only in the `prepared` state:
 * does this process carry `FORGE_AGENT_SPAWN=1` (set unconditionally on every
 * production spawn by `pinned-sdk-query.ts`, marked run or not) or a non-empty
 * `FORGE_AGENT_RUN_MARKER` (the per-run token `spawn-marker.ts` already
 * threads through `runAgent`'s spawns). Either one aborts the transaction with
 * a one-line reason on stderr; git itself then reports "ref updates aborted by
 * hook" and leaves every ref exactly where it was — verified directly against
 * real git 2.43 (commit, `update-ref`, and `branch`, from a linked worktree,
 * both env shapes) before this file existed.
 *
 * THE OWNERSHIP MARKER, AND WHY THE INSTALLER NEVER OVERWRITES A FOREIGN FILE.
 * `FORGE_REF_GUARD_MARKER` is a plain comment line inside the script body —
 * cheap to check, and it costs the hook nothing at runtime (`sh` does not
 * execute comments). It lets `installForgeRefGuardHook` tell "this is OUR
 * hook, safe to rewrite if the script text changed" from "an operator (or
 * some other tool) put a `reference-transaction` hook here for a reason of
 * their own" — the second case is a REFUSAL the caller must see and act on,
 * never a silent overwrite, because this repo's own hooks dir is not a
 * resource forge is the only writer to.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { EventLogger } from './logging.ts';

/** The one git hook event this whole design is built on — see the module doc. */
export const FORGE_REF_GUARD_HOOK_NAME = 'reference-transaction';

/**
 * The prefix every version of this hook's script carries, so a future bump
 * (`v2`, …) is still recognised as OURS by an older installer reading a
 * newer file, or vice versa — `installForgeRefGuardHook` checks this prefix
 * for OWNERSHIP and the full script body for "needs no rewrite".
 */
export const FORGE_REF_GUARD_MARKER_PREFIX = '# forge-agent-ref-guard';

/** The current version's exact marker line, embedded verbatim in the script. */
export const FORGE_REF_GUARD_MARKER = `${FORGE_REF_GUARD_MARKER_PREFIX} v1`;

/**
 * The two env vars that abort a `prepared` ref transaction — see the module
 * doc for why both exist and what spawns each of them.
 */
export const FORGE_AGENT_SPAWN_ENV = 'FORGE_AGENT_SPAWN';
export const FORGE_AGENT_RUN_MARKER_ENV = 'FORGE_AGENT_RUN_MARKER';

/**
 * The hook script's exact text. A pure function (not a template read off
 * disk) so the installer can compare "what should be on disk" against "what
 * is" with a plain string equality, and so a version bump is a one-line diff
 * here rather than a second file to keep in sync.
 */
export function forgeRefGuardHookScript(): string {
  return `#!/bin/sh
${FORGE_REF_GUARD_MARKER}
#
# Installed by forge (packages/kernel/forge-ref-guard-hook.ts) — DO NOT EDIT
# BY HAND; re-running forge's installer will overwrite hand edits the next
# time the script text changes. See that module's header for the full design
# (bead forge-8vfn.8.5.47, row 211).
#
# git invokes this hook for EVERY ref update made through this repository,
# from any of its worktrees, with the transaction state ($1: prepared |
# committed | aborted) and the ref list on stdin. Only "prepared" can still
# abort the transaction, and we drain stdin UNCONDITIONALLY first so git never
# sees a broken pipe regardless of the verdict below.
cat >/dev/null

if [ "\$1" = "prepared" ]; then
  if [ -n "\$${FORGE_AGENT_RUN_MARKER_ENV}" ] || [ "\$${FORGE_AGENT_SPAWN_ENV}" = "1" ]; then
    echo "forge-agent-ref-guard: refusing to move a ref of the forge repo from an agent spawn (forge-8vfn.8.5.47, row 211) — forge's own orchestrator owns this repo's refs, never an agent child" >&2
    exit 1
  fi
fi

exit 0
`;
}

/**
 * The five outcomes `installForgeRefGuardHook` reports, one per call, never
 * zero and never more than one — see the module doc's "ownership marker"
 * section for the decision each name corresponds to.
 */
export type RefGuardInstallOutcome =
  | 'installed'
  | 'already-present'
  | 'updated'
  | 'refused-foreign'
  | 'skipped-not-a-repo';

/**
 * Resolve `forgeRoot`'s hooks directory the way git itself would — honouring
 * `core.hooksPath` and, from a linked worktree, resolving to the COMMON hooks
 * dir (see the module doc's measured examples). Returns `null` when
 * `forgeRoot` is not inside a git repository at all, which is the one case
 * `installForgeRefGuardHook` reports as `skipped-not-a-repo` rather than
 * throwing: an operator running forge from a plain directory (no git) is a
 * legitimate, if unusual, install shape, not an error this seam should raise.
 */
function resolveHooksDir(forgeRoot: string): string | null {
  let raw: string;
  try {
    raw = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: forgeRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
  if (raw === '') return null;
  return resolve(forgeRoot, raw);
}

/**
 * Install (or recognise, or refuse to clobber) the `reference-transaction`
 * ref guard in `forgeRoot`'s git hooks dir. Idempotent and safe to call on
 * every bridge/`forge serve` start — see the module doc for the full design.
 *
 * Every outcome emits EXACTLY ONE structured JSONL event through `logger`,
 * named `forge-ref-guard.<outcome>`, so an operator (or a story's own
 * evidence trail) can see which of the five branches a given start took
 * without re-deriving it from file timestamps. `refused-foreign` is logged as
 * an `error` — the one outcome that means "forge's own fence is NOT
 * installed, and nobody told the caller a safer way" — every other outcome is
 * a `log` entry: expected, unremarkable, and exactly what a healthy start
 * looks like on every call after the first.
 */
export function installForgeRefGuardHook(forgeRoot: string, logger: EventLogger): RefGuardInstallOutcome {
  const emit = (outcome: RefGuardInstallOutcome, message: string): RefGuardInstallOutcome => {
    logger.emit({
      phase: 'orchestrator',
      skill: 'forge-ref-guard-install',
      event_type: outcome === 'refused-foreign' ? 'error' : 'log',
      initiative_id: logger.cycleId,
      input_refs: [],
      output_refs: [],
      message: `forge-ref-guard.${outcome}`,
      metadata: { forgeRoot, reason: message },
    });
    return outcome;
  };

  const hooksDir = resolveHooksDir(forgeRoot);
  if (hooksDir === null) {
    return emit('skipped-not-a-repo', `${forgeRoot} is not inside a git repository — no ref guard to install`);
  }

  const hookPath = join(hooksDir, FORGE_REF_GUARD_HOOK_NAME);
  const script = forgeRefGuardHookScript();

  if (!existsSync(hookPath)) {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(hookPath, script, { mode: 0o755 });
    chmodSync(hookPath, 0o755);
    return emit('installed', `wrote ${hookPath}`);
  }

  const existing = readFileSync(hookPath, 'utf8');
  if (!existing.includes(FORGE_REF_GUARD_MARKER_PREFIX)) {
    return emit(
      'refused-foreign',
      `${hookPath} already exists and carries no forge marker — left byte-identical, forge's ref guard is NOT installed`,
    );
  }
  if (existing === script) {
    return emit('already-present', `${hookPath} already matches the current script — nothing to do`);
  }
  writeFileSync(hookPath, script, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  return emit('updated', `${hookPath} carried an older/different forge marker version — rewritten`);
}
