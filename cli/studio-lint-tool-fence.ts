/**
 * `skill-tool-fence` — one Studio-lint check, in its own module because
 * `cli/studio-lint.ts` sits at this repo's 800-line hard cap.
 *
 * WHY THIS CHECK EXISTS. Per the installed Agent SDK's own `runtimeTypes.d.ts`,
 * `allowedTools` is auto-allow-WITHOUT-PROMPTING, not a restriction ("To
 * restrict which tools are available, use the `tools` option instead"), and
 * this repo sets `options.tools` at NONE of its production spawn sites. So a
 * SKILL.md's `allowed-tools:` fences nothing; `disallowed-tools:` — which the
 * SDK documents as removing a tool from the model's context — is the only
 * declarative field that does.
 *
 * The subagent-spawn tool reaches a general-purpose subagent with full tools,
 * and it must be named under BOTH the SDK's own permission-machinery name
 * (`Task`) and the name this harness surfaces the same tool as (`Agent`, from
 * the JSON-Schema `AgentInput` type). `skills/brain-maintenance/SKILL.md` was
 * the first skill to work that out by hand; its frontmatter comment carries the
 * belt-and-braces rationale in full.
 *
 * WHY IT IS A LINT AND NOT JUST A SWEEP. W8-C2a added the two names to all 19
 * roster skills that were missing them. A hand sweep rots the moment skill #31
 * is authored without the pattern — detection re-done by hand every wave is a
 * tax, and this check is what stops the bleed. It deliberately cannot judge
 * "does this skill genuinely need to spawn a subagent"; a human made that call
 * once per skill. It only keeps the mechanical half from silently regressing.
 *
 * NOT A COMPLETE FENCE, and the difference matters: this check proves the two
 * names are DECLARED. Whether a declaration is ENFORCED depends on the spawn
 * site threading `disallowedTools` into the SDK options at all — W8-C2a found
 * three that did not (`architect-runner`, `completeness-critic-runner`,
 * `instructions-runner`, all via `runStructuredTurn`) and fixed them. A new
 * spawn site that drops the field would make every declaration decorative
 * again without this lint noticing.
 */

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
// gray-matter has no usable types; treated as `any` like cli/studio-lint.ts,
// cli/brain-lint.ts and cli/brain-fix-auto.ts, which import it the same way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import matter from 'gray-matter';

import { listSkillDirs } from '../orchestrator/skill-path.ts';
import type { Finding } from '../orchestrator/studio/validate.ts';

const TOOL_FENCE_REQUIRED_NAMES = ['Task', 'Agent'] as const;

/**
 * `skill-tool-fence/task-agent-not-disallowed` — a roster SKILL.md that
 * declares tool frontmatter at all (`allowed-tools:`/`disallowed-tools:`
 * present, empty or not) must list `Task` AND `Agent` in `disallowed-tools`
 * — the only real fence against the subagent-spawn tool, since `allowed-
 * tools` is advisory-only and no spawn site sets the SDK's `tools` option.
 * Both names: `Task` (SDK permission-machinery name) and `Agent` (this
 * harness's external name for the same tool) — see
 * `skills/brain-maintenance/SKILL.md`'s frontmatter comment for the model.
 * A skill that genuinely needs to spawn one stays out of this sweep with
 * its own comment explaining why — a human call this lint can't make; it
 * only keeps that pattern from silently regressing.
 */
export function lintSkillToolFence(forgeRoot: string): Finding[] {
  const findings: Finding[] = [];

  for (const dir of listSkillDirs(forgeRoot)) {
    const id = basename(dir);
    let data: Record<string, unknown>;
    try {
      data = (matter(readFileSync(join(dir, 'SKILL.md'), 'utf8'), {}).data ?? {}) as Record<string, unknown>;
    } catch {
      continue; // malformed frontmatter — already surfaced elsewhere as a load error
    }

    const declaresToolFrontmatter = 'allowed-tools' in data || 'disallowed-tools' in data;
    if (!declaresToolFrontmatter) continue; // the "declares neither" set is out of scope

    const disallowedRaw = data['disallowed-tools'];
    const disallowed = Array.isArray(disallowedRaw) ? disallowedRaw.map((v) => String(v)) : [];
    const missing = TOOL_FENCE_REQUIRED_NAMES.filter((name) => !disallowed.includes(name));

    if (missing.length > 0) {
      findings.push({
        level: 'error',
        object: `skill:${id}`,
        check: 'skill-tool-fence/task-agent-not-disallowed',
        message: `Skill "${id}" declares tool frontmatter but its disallowed-tools list omits ${missing
          .map((n) => `"${n}"`)
          .join(' and ')} — allowed-tools is advisory only (no production spawn site sets options.tools), so disallowed-tools is the only real fence against this skill reaching the subagent-spawn tool. Add ${TOOL_FENCE_REQUIRED_NAMES.join(', ')} to "disallowed-tools:" in ${id}/SKILL.md, or, if this skill genuinely needs to spawn a subagent, leave it out and add a frontmatter comment explaining why (see skills/brain-maintenance/SKILL.md for the model).`,
      });
    }
  }

  return findings;
}

