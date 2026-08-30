/**
 * forge-6gv.19 (W8-B4) — the CLIENT-side mirror of `cli/studio-lint-tool-
 * fence.ts`'s own exported `TOOL_FENCE_REQUIRED_NAMES`: the two tool names
 * a SKILL.md's `disallowed-tools:` must list before that lint's
 * `skill-tool-fence/task-agent-not-disallowed` check stops firing — `Task`
 * (the SDK's own permission-machinery name) and `Agent` (this harness's
 * external name for the same subagent-spawn tool). See that check's own
 * module header (`cli/studio-lint-tool-fence.ts`) for the full "why both
 * names, why disallowed-tools and not allowed-tools" rationale.
 *
 * Hand-mirrored, never a cross-boundary import — forge-ui never imports
 * cli/ at runtime (see `forge-ui/lib/session-lifecycle-client.ts`'s and
 * `forge-ui/lib/session-client.ts`'s own headers for the same stated
 * convention). Kept honest by `cli/tool-fence-required-names-parity.test.ts`,
 * a NODE-SIDE TEST (not part of either production bundle) that imports BOTH
 * arrays directly and fails the moment they disagree — the exact precedent
 * `forge-ui/lib/authoring-package-shape.ts` /
 * `cli/authoring-package-shape-parity.test.ts` (W8-B4 FIX-1) already set for
 * this repo's cli/<->forge-ui boundary.
 *
 * WHY THIS FILE EXISTS AT ALL (forge-6gv.19): before this fix,
 * `forge-ui/app/agents/[id]/page.tsx`'s `BLANK_STATE` shipped
 * `disallowedTools: []` with nothing tying it to the lint's own required
 * names — a from-blank Agent Builder compose was therefore born failing
 * `forge studio lint`. `BLANK_STATE` (now `forge-ui/lib/agent-authoring-
 * view.ts`, moved out of the page so it is importable by a test — a
 * `'use client'` Next `page.tsx` may only export Next's own whitelisted
 * names, `forge-ui/lib/page-exports-whitelist.test.ts` enforces it) seeds
 * its `disallowedTools` from this array specifically so the two can never
 * drift apart again.
 */
export const TOOL_FENCE_REQUIRED_NAMES = ['Task', 'Agent'] as const;
