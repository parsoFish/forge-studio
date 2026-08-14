/**
 * Acceptance tests for the NOT-YET-IMPLEMENTED skills/brain-maintenance/SKILL.md
 * (R4-19-F2 — the brain MAINTENANCE runtime agent).
 *
 * T3 (test-writer) rule: this file writes ACCEPTANCE TESTS ONLY. It does not,
 * and must not, create skills/brain-maintenance/SKILL.md — a later
 * implementer writes that file; this suite is the red->green proof.
 *
 * Contract under test (operator brief, R4-19-F2):
 *   - `name: brain-maintenance`, `surface: interactive`, `library: false`.
 *   - a `runtime:` block (`sdk: claude`, `strategy: fixed`, a real claude
 *     model id) — load-bearing because `discoverRuntimeAgentIds` (in
 *     orchestrator/studio/session-kinds.ts) scans skills/*\/SKILL.md for
 *     exactly this block, and a later work item's session-kind descriptor
 *     (`agent: brain-maintenance`) only validates if this agent resolves.
 *   - `allowed-tools: [Read, Grep, Glob, Write]`; `disallowed-tools`
 *     including Edit, Bash, NotebookEdit, WebFetch, WebSearch — the agent
 *     drafts a cleanup PLAN from brain-lint findings, it never edits brain
 *     files itself.
 *   - NEVER composes `brain-ingest` and carries no ingest affordance of any
 *     kind (operator decision 3: ingest stays reflection-only —
 *     docs/decisions/010-brain-first.md line 22).
 *
 * `discoverRuntimeAgentIds` itself is a private (non-exported) function in
 * orchestrator/studio/session-kinds.ts. Rather than modify production code
 * to export it (out of scope for a test-writer, and unnecessary), Group 1
 * below keeps a TEST-LOCAL, byte-for-byte reimplementation built ONLY from
 * that module's own exported building blocks (`listSkillMdDirs`/`skillsDir`
 * from orchestrator/skill-path.ts + `gray-matter`) — the same
 * "prove-from-first-principles" idiom scripts/check-kb-ingest-affordance.test.ts
 * already uses for its own companion ratchet. Run over the REAL worktree
 * root (not a synthetic fixture), so it is red only because the real
 * skills/brain-maintenance/SKILL.md does not exist yet.
 *
 * RUN: node --experimental-strip-types --test skills/brain-maintenance/brain-maintenance.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';

import { deriveAgentSpec } from '../../orchestrator/studio/derive.ts';
import { FORGE_ROOT, skillPath, skillPathRelative, skillsDir, listSkillMdDirs } from '../../orchestrator/skill-path.ts';
import { MODEL_BY_TIER } from '../../orchestrator/phase-agent.ts';

const AGENT_SLUG = 'brain-maintenance';

// =============================================================================
// Group 1 — existence + runtime discovery (kills: shipping a SKILL.md with no
// `runtime:` block, which would make the later session-kind descriptor
// `agent: brain-maintenance` fail validateSessionKinds's unknown-agent check)
// =============================================================================

/**
 * Byte-for-byte mirror of orchestrator/studio/session-kinds.ts's private
 * `discoverRuntimeAgentIds` — see file header for why this is a test-local
 * reimplementation rather than an import.
 */
function discoverRuntimeAgentIdsLocal(forgeRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const dir of listSkillMdDirs(skillsDir(forgeRoot))) {
    const skillMdPath = join(dir, 'SKILL.md');
    try {
      const raw = readFileSync(skillMdPath, 'utf8');
      const { data } = matter(raw, {});
      if (data !== null && typeof data === 'object' && !Array.isArray(data) && 'runtime' in (data as Record<string, unknown>)) {
        ids.add(basename(dir));
      }
    } catch {
      // Unreadable/unparseable SKILL.md doesn't resolve as a known agent —
      // mirrors the production function's own catch-and-skip exactly.
    }
  }
  return ids;
}

test('brain-maintenance is discovered as a runtime-bearing agent over the real worktree (mirrors session-kinds.ts discoverRuntimeAgentIds)', () => {
  const ids = discoverRuntimeAgentIdsLocal(FORGE_ROOT);
  assert.ok(
    ids.has(AGENT_SLUG),
    `expected '${AGENT_SLUG}' among runtime-bearing skills (a SKILL.md with a "runtime:" frontmatter block); got: ${[...ids].sort().join(', ') || '(none)'}`,
  );
});

// =============================================================================
// Group 2 — the derived spec is real and minimal (kills: an agent granted
// edit/shell power, which would let it mutate the brain outside the approval
// gate the operator brief requires)
// =============================================================================

test('deriveAgentSpec on brain-maintenance yields a real model id and exactly the read/search/write tool set', () => {
  const spec = deriveAgentSpec(skillPathRelative(AGENT_SLUG));

  const model = MODEL_BY_TIER[spec.tier];
  assert.ok(
    typeof model === 'string' && model.length > 0 && model.startsWith('claude-'),
    `expected a non-empty claude model id, got tier=${String(spec.tier)} -> ${String(model)}`,
  );

  assert.deepEqual(
    [...spec.allowedTools].sort(),
    ['Glob', 'Grep', 'Read', 'Write'],
    `expected exactly [Read, Grep, Glob, Write], got: ${JSON.stringify(spec.allowedTools)}`,
  );
  assert.ok(!spec.allowedTools.includes('Edit'), 'brain-maintenance must NOT be granted Edit — it drafts a plan, it never edits brain files');
  assert.ok(!spec.allowedTools.includes('Bash'), 'brain-maintenance must NOT be granted Bash — no shell escape hatch around the plan-only contract');
});

// =============================================================================
// Group 3 — structural no-ingest, on the REAL file (kills: a doc-only
// no-ingest claim — the prose says "never ingests" but the frontmatter
// quietly composes brain-ingest anyway)
// =============================================================================

test('brain-maintenance SKILL.md frontmatter has zero ingest affordance', () => {
  const raw = readFileSync(skillPath(AGENT_SLUG), 'utf8');

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fmMatch, 'SKILL.md must have a --- delimited frontmatter block');
  const frontmatterBlock = fmMatch![1];
  assert.ok(
    !frontmatterBlock.includes('brain-ingest'),
    `the frontmatter block must not reference "brain-ingest" anywhere, found in:\n${frontmatterBlock}`,
  );

  const { data } = matter(raw, {});
  const d = data as Record<string, unknown>;
  const composition = (d.composition ?? {}) as Record<string, unknown>;

  const skillsList = Array.isArray(composition.skills) ? (composition.skills as unknown[]) : [];
  assert.ok(
    !skillsList.includes('brain-ingest'),
    `composition.skills must not include brain-ingest, got: ${JSON.stringify(skillsList)}`,
  );

  const toolsList = Array.isArray(composition.tools) ? (composition.tools as unknown[]) : [];
  assert.ok(
    !toolsList.some((t) => typeof t === 'string' && t.toLowerCase().includes('ingest')),
    `composition.tools must name no ingest tool, got: ${JSON.stringify(toolsList)}`,
  );
});

// =============================================================================
// Group 4 — not a library agent (kills: a maintenance agent showing up as a
// composable library agent in the Studio palette)
// =============================================================================

test('brain-maintenance declares library: false', () => {
  const raw = readFileSync(skillPath(AGENT_SLUG), 'utf8');
  const { data } = matter(raw, {});
  const d = data as Record<string, unknown>;
  assert.equal(d.library, false, `expected library: false, got: ${JSON.stringify(d.library)}`);
});
