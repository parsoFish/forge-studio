/**
 * `fixedTierForSessionKind` — the read-time fallback for a session that
 * recorded no model tier of its own (W8-B3, sessions-kinds-R06 /
 * sessions-kinds-31).
 *
 * The defect: for the three `strategy:fixed` session kinds (architect,
 * project-brain, onboarding) the model was never named ANYWHERE. The kickoff
 * chip printed the literal string "fixed · read-only", the session chip read
 * "model: not recorded" seconds after the session started, and the sessions
 * index showed "—". On a cost review there was no way to tell what the most
 * expensive session kind in forge actually ran on. Their start routes persist
 * no `modelTier` (correctly — there is nothing for the operator to choose),
 * and the capability payload exposed the RANGE but not the resolved tier, so
 * the whole chain had nothing to render.
 *
 * The rule, and why it is scoped rather than blanket:
 *   - `strategy:fixed` — exactly one legal tier exists, so a session of that
 *     kind provably ran on it. Naming it is a derivation, not a guess.
 *   - `strategy:range` — an untiered session ran on whatever the cheapest
 *     tier in the envelope was AT THE TIME. Today's envelope may differ, so
 *     "not recorded" stays the honest answer and this returns null.
 *
 * Derived at read time from the agent's own SKILL.md, never stored: a skill
 * re-pointed at a different model cannot leave a stale copy behind anywhere.
 * Every failure mode (unknown agent, unreadable SKILL.md, a model outside the
 * catalog) degrades to `null` — "not recorded" — never to a guessed tier and
 * never to a thrown read route.
 */

import { loadAgentDefinition } from '../orchestrator/studio/registry.ts';
import { agentCapabilityDescriptor } from '../orchestrator/studio/derive.ts';
import { skillsDir } from '../orchestrator/skill-path.ts';
import { resolveGuardedPath } from './studio-path-guard.ts';
import type { SessionKindDescriptor } from '../orchestrator/studio/session-kinds.ts';

export function fixedTierForSessionKind(forgeRoot: string, descriptor: SessionKindDescriptor): string | null {
  // The agent slug comes from the session-kind registry (authored, validated
  // by validateSessionKinds' unknown-agent check), never from a request — but
  // it is routed through the same guarded choke point as every other
  // SKILL.md read so there is one path, not two.
  const guard = resolveGuardedPath(skillsDir(forgeRoot), [descriptor.agent, 'SKILL.md']);
  if (!guard.ok || !guard.exists) return null;
  try {
    const capability = agentCapabilityDescriptor(loadAgentDefinition(guard.realPath), forgeRoot);
    return capability.fixedTier ?? null;
  } catch {
    return null;
  }
}
