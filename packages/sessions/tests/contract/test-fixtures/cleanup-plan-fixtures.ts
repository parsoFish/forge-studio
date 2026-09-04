/**
 * The kb-cleanup plan builders shared by the cleanup-plan and cleanupScan
 * suites — hoisted for the same reason as `session-kinds-turnspec.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionKindDescriptor } from '../../../studio/session-kinds.ts';

/** R4-19-F2: the new "kb-cleanup" session kind (studio/session-kinds.yaml —
 *  not shipped yet at branch base; see session-kinds.test.ts's own R4-19-F2
 *  block). deriveSessionArtifact never reads `stages` at all, so this stays
 *  decoupled from the SEPARATE SESSION_STAGES vocabulary concern, mirroring
 *  authoringDescriptor's own header note. */
export function kbCleanupDescriptor(overrides: Partial<SessionKindDescriptor> = {}): SessionKindDescriptor {
  return {
    id: 'kb-cleanup',
    agent: 'brain-maintenance',
    title: 'KB cleanup session',
    legacyRoutes: [],
    stages: ['brain'],
    defaultStage: 'brain',
    artifact: { kind: 'cleanup-plan', label: 'Cleanup plan' },
    ...overrides,
  } as SessionKindDescriptor;
}
/** Writes the session dir's `plan/cleanup-plan.md` — the ONLY place the
 *  agent's proposed actions live (never the findings; those are ALWAYS
 *  caller-supplied — see the derive-don't-store header above). Mirrors this
 *  file's own `writeStagingFile` idiom: a DEDICATED subdirectory, so a
 *  kb-cleanup session's plan can never collide with the fixed
 *  CANDIDATE_SOURCE_FILES transcript scan every session dir is
 *  unconditionally scanned against regardless of kind. */
export function writeCleanupPlanFile(sessionDir: string, body: string): void {
  const abs = join(sessionDir, 'plan', 'cleanup-plan.md');
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body, 'utf8');
}
/** A minimal caller-supplied finding, shaped like skills/brain-maintenance/
 *  SKILL.md's own documented input contract (`check`, `kind`, `file`,
 *  `message`) — deliberately NOT imported from packages/knowledge/brain-lint.ts's real
 *  `Finding` type: this module stays a pure, fs-only derivation with no
 *  business importing the lint engine (mirrors `fixtureContractStages`'s own
 *  header rationale, above, for hand-fixturing rather than cross-importing —
 *  the route, packages/sessions/bridge-studio-sessions.ts, is the layer that wires the
 *  real `runBrainLint`/`lintThemeFiles` output in). */
export function fixtureFinding(kind: string, file: string, message = 'fixture finding'): { check: string; kind: string; file: string; message: string } {
  return { check: kind, kind, file, message };
}
