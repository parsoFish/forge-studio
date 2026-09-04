import { bandAgentDeps } from './band-agent-deps.ts';

/**
 * The manifest ports a ported session kind needs, bound HERE because this is
 * the one place that may import them (M4 rulings 79 and 81).
 *
 * `packages/flows` is rank 5 and `packages/sessions` is rank 4, so sessions may
 * not import the manifest FUNCTIONS. The manifest SHAPE is a different matter:
 * ruling 81 lifted `InitiativeManifest` into `@forge/contracts`, so both sides
 * name one type and neither declares a structural stand-in for the other's.
 *
 * `apps/forge` is unranked assembly and may import both, which is what makes
 * this file the honest seam rather than a workaround.
 */
import {
  parseManifest,
  serializeManifest,
  mintAndPersistManifestCycleId,
} from '@forge/flows/manifest.ts';
import { promoteManifests } from '@forge/flows/promote-manifests.ts';
import type { ArchitectManifestPorts } from '@forge/sessions/kinds/architect-ports.ts';
import type { ParseManifestPort } from '@forge/sessions/studio/session-transcript.ts';

/** Bound once; the same object is handed to every architect turn. */
export const architectManifestPorts: ArchitectManifestPorts = {
  parseManifest,
  serializeManifest,
  mintAndPersistManifestCycleId,
  promoteManifests,
};

/** The single port the `roadmap-draft` artifact renderer needs. */
export const parseManifestPort: ParseManifestPort = parseManifest;

/**
 * The agent-dispatch deps, defined ONCE (G1 P1) and beside the ports they
 * carry. Every path that can reach `cmdAgentRun` must pass this — the four
 * legacy `cmd<X>Run` delegates as well as the generic `case 'agent'` arm.
 * `spawn-deps-parity.test.ts` is the structural control and carries the full
 * account of the defect it closes.
 */
export const AGENT_DISPATCH_DEPS = {
  band: bandAgentDeps,
  sessionKind: { manifestPorts: architectManifestPorts },
} as const;

