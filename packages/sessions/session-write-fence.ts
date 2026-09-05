/**
 * session-write-fence.ts — the write-root tool fence for an interactive turn.
 *
 * Split out of `interactive-session.ts` at its 800-line cap (M5-A, T1 ruling 192).
 * Same code, same exports, BEHAVIOUR UNCHANGED. The seam was proven one-way first:
 * comments stripped, this block references nothing the parent declares.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

import { inspectBashCommand } from './bash-fence.ts';

// ---------------------------------------------------------------------------
// writeRoots fence (bead forge-eip, W6-CR-3) — a REAL, per-call containment
// check on every Write/Edit/MultiEdit/NotebookEdit a `runAgentTurn` turn
// attempts, closing the class this bead names: "a tool-name allowlist is
// NOT a fence" (a SKILL.md's `allowed-tools`/`disallowed-tools` is advisory
// prose the model can be steered around by untrusted content it reads —
// e.g. a fetched web page telling it to "save a copy to
// /forge/studio/community/registry.yaml") and "when the prompt hands an
// agent a sensitive absolute path, an unfenced Write reaches it" (this
// turn's own `buildTurnPrompt` inlines the WHOLE session status as JSON —
// historically this included community-refresh's own `registryPath`/
// `hubsPath` fields; that kind was retired in W8-B5b, but any future kind
// whose status.json carries an absolute path is exposed the same way).
//
// Generic, not per-kind-specific: this lives in the shared spine because the
// gap is the WHOLE turnSpec roster's (authoring's `staging/`, kb-cleanup's
// `plan/` both reach it — community-refresh's `staging/` was a third example
// before that kind's retirement), not one kind's. `writeRoots` is
// caller-supplied, TRUSTED, already-realpath-resolved, ALREADY-EXISTING
// absolute directory paths — this module performs no mkdir and no identity
// check on the roots themselves (mirrors how `cwd` is already trusted);
// `packages/sessions/interactive-runner.ts` derives them from each phase row's
// OWN declared `writes:` entries (never hardcoded), GUARD-TERMINAL-
// provisioning each one via `resolveGuardedPath` before the turn starts.
// ---------------------------------------------------------------------------

/** Tool names whose input names a file this fence must evaluate — mirrors
 *  `packages/agents/ralph/claude-agent.ts`'s own `FILE_MODIFYING_TOOLS` (kept as an
 *  independent literal here, not imported, so this spine file's only
 *  cross-subsystem edge stays the pre-existing type-only one). Every OTHER
 *  tool call passes through this fence unmodified — it never gates reads.
 *
 *  W7-FIX-A2 (W7A2-03, bead forge-w08): `Bash` is gated too — it is a
 *  write-capable tool with no single path, so it is not in THIS set (which
 *  drives the one-path check) but in `FENCE_STRIPPED_TOOLS` below, and gets
 *  its own policy (`BashFenceMode`): denied outright unless the kind opts
 *  into static inspection (`inspectBashCommand`, packages/sessions/bash-fence.ts). */
const FENCE_GATED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Every tool a fenced turn must NOT pre-approve via `allowedTools` (so the
 *  SDK routes each call through `canUseTool`): the one-path tools above plus
 *  Bash. Never pushed into `disallowedTools` — they stay callable, gated. */
const FENCE_STRIPPED_TOOLS = new Set([...FENCE_GATED_TOOLS, 'Bash']);

/** W7-FIX-A2 (W7A2-03) — the Bash policy of a fenced turn. `deny` (the
 *  default: a fenced kind that does not opt in has NO ungated write-capable
 *  tool at all) or `inspect` (the ONE authored opt-in, `turnSpec.bashFence`
 *  in studio/session-kinds.yaml, validated against BASH_FENCE_MODES): every
 *  Bash command is statically inspected and every write-shaped operation
 *  must target a path inside the write roots. Kept as a string-literal
 *  union here (not imported from studio/session-kinds.ts) so this spine
 *  file's dependency edges stay as they are; session-kinds' frozen
 *  BASH_FENCE_MODES is the vocabulary the yaml is validated against, and
 *  the runner threads the validated value through. */
export type BashFenceMode = 'deny' | 'inspect';
export type BashFenceOptions =
  | { readonly bash?: 'deny' }
  | { readonly bash: 'inspect'; /** the turn's cwd — relative paths resolve against it */ readonly cwd: string };

/** Extract the target file path from a gated tool's input — mirrors
 *  `packages/agents/ralph/claude-agent.ts`'s own `extractPath` (`file_path` for
 *  Write/Edit/MultiEdit, `notebook_path` for NotebookEdit, `path` as a
 *  belt-and-suspenders fallback). Returns `null` for a malformed/missing
 *  field — the caller DENIES on `null` (fail closed: "couldn't find a
 *  path" is never treated as "so allow it"). */
function extractGatedToolPath(input: Record<string, unknown>): string | null {
  const candidate = input.file_path ?? input.notebook_path ?? input.path;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * True iff `candidatePath` resolves (realpath of its PARENT directory +
 * its own literal basename — the file itself may not exist yet, e.g. a
 * `Write` creating a new file) to somewhere under one of `realWriteRoots`
 * (already realpath-resolved by the caller). A parent directory that
 * cannot be realpath-resolved at all (ENOENT/ELOOP/a permission error) is a
 * hard DENY, never "not created yet, allow it": every `writeRoots` entry is
 * pre-provisioned (mkdir'd) by the caller before the turn starts, so a
 * write naming a not-yet-existing INTERMEDIATE directory below an
 * already-provisioned root has no legitimate reason to exist. This closes
 * the symlink-swap shape too — `realpathSync` fully resolves the parent, so
 * a directory symlink planted at (or below) the root cannot redirect a
 * write to somewhere the root's own real location does not cover.
 */
function isUnderWriteRoot(candidatePath: string, realWriteRoots: readonly string[]): boolean {
  let realParent: string;
  try {
    realParent = realpathSync(dirname(candidatePath));
  } catch {
    return false;
  }
  const realCandidate = join(realParent, basename(candidatePath));
  return realWriteRoots.some((root) => realCandidate === root || realCandidate.startsWith(root + sep));
}

/** The subset of the real SDK's `CanUseTool`/`PermissionResult` shape this
 *  fence needs — kept local (not imported from the SDK package) so this
 *  spine file's fence logic is exercisable against the SAME loose `QueryFn`
 *  test seam every other turn in this module already uses, without pulling
 *  the SDK's real types into a value position here. Structurally compatible
 *  with the SDK's own `CanUseTool`/`PermissionResult` (verified by the SDK
 *  accepting this function at `options.canUseTool` — a plain, untyped
 *  `Record<string, unknown>` bag from this module's own perspective, per
 *  `QueryFn`'s doc comment above). */
export type WriteRootCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }>;

/**
 * Build the `canUseTool` callback `runAgentTurn` installs at `options.canUseTool`
 * when `writeRoots` is non-empty. Synchronous decision, no operator pause —
 * see this file's header note on why this does NOT reopen ADR 020's ruling.
 */
// Exported for direct unit tests (interactive-session.test.ts) — the
// integration shape (a fake `queryFn` capturing `options.canUseTool`) is
// ALSO covered, but a direct export lets the deny/allow/symlink-escape
// matrix be pinned without threading every case through a full turn.
export function makeWriteRootCanUseTool(writeRoots: readonly string[], bashFence: BashFenceOptions = {}): WriteRootCanUseTool {
  // Resolved ONCE, at turn start, not per tool call — every root was already
  // provisioned by the caller (see this section's own header), so a root
  // that still fails to realpath here is a caller bug: fail THAT ONE root
  // closed (it can never match anything, so every write claiming it is
  // denied) rather than throwing out of a factory function with no
  // sensible call-site catch.
  const realRoots = writeRoots
    .map((root) => {
      try {
        return realpathSync(root);
      } catch {
        return null;
      }
    })
    .filter((root): root is string => root !== null);

  return async (toolName, input, _options) => {
    if (toolName === 'Bash') {
      // W7-FIX-A2 (W7A2-03): Bash on a fenced turn — deny by default; a kind
      // that opted in gets the static inspector (fail closed on anything it
      // cannot reason about, `null`/non-string command included).
      if (bashFence.bash !== 'inspect') {
        return {
          behavior: 'deny',
          message:
            'Bash is not available on this write-root-fenced turn (this session kind did not opt into Bash inspection) ' +
            '— use Read/Grep/Glob to inspect and Write/Edit to change files inside the writable root(s) ' +
            `(${writeRoots.join(', ')}). Refused by the write-root fence.`,
        };
      }
      const command = input.command;
      if (typeof command !== 'string') {
        return { behavior: 'deny', message: 'Bash: no command string in tool input — refused by the write-root fence.' };
      }
      const verdict = inspectBashCommand(command, { cwd: bashFence.cwd, realWriteRoots: realRoots });
      if (!verdict.allow) {
        return {
          behavior: 'deny',
          message:
            `Bash command refused by the write-root fence: ${verdict.reason}. ` +
            `Only read-only commands and writes inside this session's writable root(s) (${writeRoots.join(', ')}) are permitted; ` +
            'use the Write/Edit tools for file changes.',
        };
      }
      return { behavior: 'allow', updatedInput: input };
    }
    if (!FENCE_GATED_TOOLS.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    const candidate = extractGatedToolPath(input);
    if (candidate === null) {
      return {
        behavior: 'deny',
        message: `${toolName}: no resolvable file path in tool input — refused by the write-root fence.`,
      };
    }
    if (!isUnderWriteRoot(candidate, realRoots)) {
      return {
        behavior: 'deny',
        message:
          `${toolName} to "${candidate}" is outside this session's writable root(s) ` +
          `(${writeRoots.join(', ')}) — refused by the write-root fence.`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

/**
 * The COMPLETE option triple a write-root-fenced turn must run with.
 *
 * W7-A2 (sessions-kinds-V01, beads forge-w08/forge-eip) paid for the fact that
 * a fence is three settings, not one. `canUseTool` is the SDK's
 * PERMISSION-PROMPT handler: it runs only for a tool call the CLI would
 * otherwise prompt on. Two settings in the same options bag short-circuit that
 * prompt for exactly the tools the fence gates:
 *
 *   - `permissionMode: 'acceptEdits'` auto-accepts Write/Edit/MultiEdit/
 *     NotebookEdit at the SDK level;
 *   - `allowedTools` pre-approves every listed name.
 *
 * Live evidence: a turn ran with a non-empty `writeRoots` and still wrote
 * three files outside every declared root. So a fenced turn runs in `default`
 * mode with the fence-gated names STRIPPED from `allowedTools` — they stay
 * callable (never pushed into `disallowedTools`), the SDK just routes each
 * call through `canUseTool`. Every read-only grant survives verbatim.
 *
 * W8-F1: extracted from `runAgentTurn`'s body so the SECOND fenced spawn path
 * — `runBrainFixTurn` (packages/sessions/brain-fix-runner.ts), which drives its own
 * raw SDK stream loop and therefore never went through `runAgentTurn` — cannot
 * get two of the three right and ship a fence the SDK never consults. One
 * enumeration of what "fenced" means, not one per caller.
 */
export function writeRootFenceOptions(args: {
  /** TRUSTED, already-existing absolute directory paths. Never request text. */
  writeRoots: readonly string[];
  /** The turn's declared grants; fence-gated names are stripped from the result. */
  allowedTools: readonly string[];
  /** The turn's cwd — relative Bash paths resolve against it. */
  cwd: string;
  /** Absent/`deny` denies every Bash call; `inspect` statically inspects each. */
  bashFence?: BashFenceMode;
}): { permissionMode: 'default'; allowedTools: string[]; canUseTool: WriteRootCanUseTool } {
  return {
    permissionMode: 'default',
    allowedTools: args.allowedTools.filter((t) => !FENCE_STRIPPED_TOOLS.has(t)),
    canUseTool: makeWriteRootCanUseTool(
      args.writeRoots,
      args.bashFence === 'inspect' ? { bash: 'inspect', cwd: args.cwd } : { bash: 'deny' },
    ),
  };
}
