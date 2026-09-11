/**
 * Bead `forge-a9o9` (T1 rulings 670 / 691) — a turn may use the tools its kind
 * DECLARED, and nothing else. Deny by default, with no enumeration anywhere.
 *
 * THE MEASUREMENT. S1 run 5's demo write pass denied every read door bead
 * 7.3.6 knew about — `Bash`, `Read`, `Glob`, `Grep`, `TodoWrite` — and read
 * anyway:
 *
 *   TaskOutput → LSP → Glob → Skill(glob) → Write → Edit → LSP
 *
 * Four of seven calls hunting for a way to read, three of them through tools
 * that appear NOWHERE in this repo: not in an `allowed-tools` list, not in a
 * `disallowed-tools` list, not in any kind's spec. The SDK ships them anyway,
 * and the agent's own logged reasoning was "the environment only has a subset.
 * Let me use what's actually available."
 *
 * WHY NOT A LONGER DENY LIST. #641 added those three names for one pass of one
 * kind. **19 skills carry a deny list, and the complete set of tools the
 * product has ever named in one is twelve** — so every kind keeps whatever the
 * next SDK release adds, and a deny list can only ever name tools its authors
 * have heard of. `spawn-env.ts` settled this class one seam over, for env vars:
 * "A denylist only stops leaks the author already thought of… An allowlist
 * inverts the failure mode: an unrecognised var is stripped by construction,
 * not by omission." This is that argument, one layer along.
 *
 * WHY `canUseTool` AND NOT `disallowedTools`. `allowedTools` is advisory; the
 * SDK's only by-name enforcement is `disallowedTools`, which is an enumeration
 * again. `canUseTool` is the one hook that can refuse a tool nobody named.
 *
 * WHY THE KERNEL. The spawn paths that need this sit in `packages/sessions`,
 * `packages/agents` and `packages/factory`. The kernel is the only layer all
 * three already stand on, and it cannot import any of them — so it owns the
 * generic decision and each caller composes it with whatever else it fences.
 */

/** The SDK's permission-prompt handler, as this repo uses it. */
export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }>;

/** The complete option triple a fenced turn runs with — never one of the three. */
export type ToolFenceOptions = {
  permissionMode: 'default';
  allowedTools: string[];
  canUseTool: CanUseTool;
};

/**
 * Build the fence for one turn.
 *
 * `onDeny` receives every refused tool name so the caller can emit its own
 * structured event (kind, tool, turn) against its own logger — the kernel does
 * not know what a session is, and a refusal nobody records is the silence this
 * bead exists to end.
 *
 * `inner` is an already-built fence — today the write-root one in
 * `packages/sessions` — whose decision still applies to the tools the kind DID
 * declare. The tool gate runs FIRST: an undeclared tool never reaches it.
 */
export function toolFenceOptions(args: {
  allowedTools: readonly string[];
  onDeny: (toolName: string) => void;
  inner?: ToolFenceOptions;
}): ToolFenceOptions {
  const declared = new Set(args.allowedTools);
  return {
    // A fence is three settings, not one (`session-write-fence.ts`, paid for by
    // a turn that ran with a non-empty writeRoots and still wrote three files
    // outside every root). `acceptEdits` auto-accepts the edit tools and a name
    // in `allowedTools` is pre-approved — either one short-circuits the prompt
    // this callback rides on, so the mode must be `default`.
    permissionMode: 'default',
    // The DECLARED names stay pre-approved, so an ordinary turn never pauses
    // and unattended operation holds. When an inner fence is present it has
    // already stripped the names it needs the SDK to route to it, and that
    // stripped list wins.
    allowedTools: [...(args.inner?.allowedTools ?? args.allowedTools)],
    canUseTool: async (toolName, input, options) => {
      if (!declared.has(toolName)) {
        args.onDeny(toolName);
        return {
          behavior: 'deny',
          message:
            `${toolName} is not declared by this agent's skill, so it is not available in this turn. ` +
            'Do not look for another way to do what it would have done; use the tools you were given.',
        };
      }
      if (args.inner !== undefined) return args.inner.canUseTool(toolName, input, options);
      return { behavior: 'allow', updatedInput: input };
    },
  };
}
