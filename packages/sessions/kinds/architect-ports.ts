/**
 * The manifest seam for the architect kind (M4 rulings 79 and 81).
 *
 * Its own module rather than a block inside `architect.ts`: this is the
 * CONTRACT between sessions and the assembly that binds it, read by
 * `apps/forge/session-kind-deps.ts` and by the conformance test beside it, and
 * it should be findable without reading 1,600 lines of runner.
 */
import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';

/**
 * The manifest FUNCTIONS architect needs, bound at `apps/forge` and injected:
 * they live in `packages/flows` (rank 5) and this package is rank 4. The
 * manifest SHAPE is imported directly — ruling 81 lifted it to
 * `@forge/contracts`, and a type-only import counts as a boundary row too.
 */
export type ArchitectManifestPorts = {
  parseManifest: (content: string) => InitiativeManifest;
  serializeManifest: (m: InitiativeManifest) => string;
  mintAndPersistManifestCycleId: (manifestPath: string, initiativeId: string) => string;
  /** `opts` is `{ queueRoot }` alone — read off the real signature, not
   *  guessed; an invented wider shape is a lying declaration (§15.66/§15.73). */
  promoteManifests: (
    manifestsDir: string,
    opts: { queueRoot: string },
  ) => { writtenManifestPaths: string[]; writtenInitiativeIds: string[] };
};

/** NO SILENT DEFAULT (ruling 77, the no-fallback rule): a turn reaching
 *  manifest work without its ports REFUSES and names what is missing. A no-op
 *  fallback is declared-data-fails-open — the turn would report success while
 *  promoting nothing, and the operator would find an approved plan that never
 *  reached the queue. */
export function requirePorts(input: { manifestPorts?: ArchitectManifestPorts }): ArchitectManifestPorts {
  const ports = input.manifestPorts;
  if (!ports) {
    throw new Error(
      'architect runner: no manifest ports were injected — this turn cannot parse, serialize or promote initiative ' +
        'manifests. They are bound at `apps/forge` and ride in on the turn input; a turn without them refuses ' +
        'rather than silently promoting nothing.',
    );
  }
  return ports;
}
