/**
 * agent-dispatch-provenance — ROSTER PARITY pin (W7-C1 code-review round).
 *
 * THE DEFECT THIS PINS: `NOTE_BY_PHASE` originally keyed the reflector's note
 * under `reflection` — the EVENT-LOG phase name — while the value actually on
 * the wire (`Agent.phase`) is the SKILL frontmatter `phase: reflector`. The
 * note silently never rendered for the exact agent the module exists for,
 * and every unit test stayed green because they probed the map only with
 * hardcoded strings — the wave-4 "declared-data-fails-open" class (a derived
 * field enforced nowhere).
 *
 * So this test derives the truth from the REAL `skills/<slug>/SKILL.md`
 * frontmatter off disk (the session-kind-meta.test.ts precedent for reading
 * repo registries from vitest) and asserts, over the WHOLE roster:
 *   - exactly {release-finalizer, project-scoped-review, reflector} resolve
 *     a non-null provenance note from their declared phase;
 *   - every other skill's declared phase resolves null — in particular
 *     brain-fix and project-brain-builder, whose declared phase IS
 *     `reflection`, must never inherit the reflector's "dispatched after
 *     every confirmed merge" note (a fabricated provenance).
 */
import { test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dispatchProvenanceNote } from '@/lib/agent-dispatch-provenance';

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');

/** slug → SKILL-frontmatter `phase:` for every skills/<slug>/SKILL.md that
 *  declares one (frontmatter only — first `---` block). */
function readRosterPhases(): Map<string, string> {
  const out = new Map<string, string>();
  for (const slug of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!slug.isDirectory()) continue;
    const path = join(SKILLS_DIR, slug.name, 'SKILL.md');
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith('---')) continue;
    const end = text.indexOf('\n---', 3);
    const frontmatter = end === -1 ? text : text.slice(0, end);
    const m = frontmatter.match(/^phase:\s*(\S+)\s*$/m);
    if (m) out.set(slug.name, m[1]);
  }
  return out;
}

// The note is PHASE-derived by design (never a per-slug list), so every
// roster skill declaring one of the three outside-the-flow-graph phases gets
// it: changelog-semver + doc-updater declare `release-finalize` because they
// are the sub-skills release-finalizer composes (its SKILL `skills:` list) —
// the "dispatched by the approve→merge finalization chain" note is the
// honest provenance for them too.
const EXPECT_NOTE = new Set([
  'release-finalizer',
  'changelog-semver',
  'doc-updater',
  'project-scoped-review',
  'reflector',
]);

test('roster parity: exactly the finalization-chain trio + project-scoped-review + reflector get a dispatch-provenance note from their REAL declared phase', () => {
  const phases = readRosterPhases();
  // Guard the ground itself: each expected agent exists and declares a phase.
  for (const slug of EXPECT_NOTE) {
    expect(phases.has(slug), `skills/${slug}/SKILL.md declares a phase`).toBe(true);
  }
  const withNote = [...phases.entries()]
    .filter(([, phase]) => dispatchProvenanceNote(phase) !== null)
    .map(([slug]) => slug)
    .sort();
  expect(withNote).toEqual([...EXPECT_NOTE].sort());
});

test('roster parity: brain-fix / project-brain-builder (declared phase "reflection") never inherit the reflector note', () => {
  const phases = readRosterPhases();
  for (const slug of ['brain-fix', 'project-brain-builder']) {
    const phase = phases.get(slug);
    if (phase === undefined) continue; // slug renamed/removed — the exact-set test above still holds the line
    expect(dispatchProvenanceNote(phase), `${slug} (phase "${phase}") must have no note`).toBe(null);
  }
});
