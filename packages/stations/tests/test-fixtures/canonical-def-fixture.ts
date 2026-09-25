/**
 * Seam F4 (operator item 81, round 2 — no canonical default): every band,
 * phase function and binding builder now REQUIRES its executing node's own
 * agent def as an explicit parameter (CLAUDE.md: no fallbacks — a production
 * caller that forgets `def` must not silently run the canonical agent).
 *
 * Tests that exercise the CANONICAL agent (the overwhelming majority — this
 * is characterization/contract coverage of the shipped project-manager /
 * developer-ralph / reflector / adversarial-review pipelines, not of seam
 * F4 itself) need a def to pass. `canonicalDef(slug)` is the ONE place a test
 * loads it, memoized per slug so a suite calling it many times (e.g.
 * `reflector.test.ts`) does not re-read the SKILL.md on every call.
 *
 * Seam-F4-specific tests (a non-canonical def routed onto a band) build their
 * OWN def and must not use this helper — it always resolves the real,
 * canonical, on-disk `skills/<slug>/SKILL.md`.
 */
import { loadAgentDefinition, skillPath } from '@forge/agents';
import type { AgentDefinition } from '@forge/contracts';

const cache = new Map<string, AgentDefinition>();

/** The real, canonical, on-disk def for `slug` (e.g. `'project-manager'`). */
export function canonicalDef(slug: string): AgentDefinition {
  const cached = cache.get(slug);
  if (cached) return cached;
  const def = loadAgentDefinition(skillPath(slug));
  cache.set(slug, def);
  return def;
}
