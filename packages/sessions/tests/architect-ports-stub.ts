/**
 * Stub manifest ports for architect tests that do NOT assert manifest content.
 *
 * The architect kind takes its manifest functions by injection and REFUSES
 * without them (M4 ruling 77's no-fallback condition), so every test that
 * drives a turn has to supply them. Two kinds of test need two different
 * things:
 *
 *   - a test asserting PROMPT assembly, the brain-index block, the fail-open
 *     explore stage or the forced-emit retry does not care what a manifest
 *     serialises to. It gets these stubs, and gets them from HERE rather than
 *     from `@forge/flows` — sessions (rank 4) may not import flows (rank 5),
 *     and pulling the real functions into those files purely to satisfy the
 *     seam would MINT the very boundary rows this seam exists to close.
 *
 *   - a test asserting real manifest round-trips — that what `promoteManifests`
 *     wrote parses back with the fields the product put there — must use the
 *     REAL functions, because a stubbed format would let it assert a shape the
 *     product never produces. `tests/integration/architect-runner.test.ts`
 *     does exactly that and passes the real ones; it already carries the flows
 *     row for that reason, deliberately.
 *
 * The stubs are loud rather than plausible: `parseManifest` throws. A test that
 * unexpectedly reads a manifest back fails saying so, instead of quietly
 * agreeing with a fabricated format.
 */
import type { ArchitectManifestPorts } from '../kinds/architect-ports.ts';

/** Serialise just enough to be a file: frontmatter-shaped, never claimed to
 *  match the product's format. Nothing here is read back by design. */
export function stubArchitectManifestPorts(): ArchitectManifestPorts {
  return {
    serializeManifest: (m) => `---\ninitiative_id: ${m.initiative_id}\n---\n${m.body}`,
    parseManifest: () => {
      throw new Error(
        'stubArchitectManifestPorts: parseManifest is deliberately unimplemented — a test that reads a ' +
          'manifest back needs the REAL flows functions, not this stub, or it will assert a format the ' +
          'product does not produce.',
      );
    },
    mintAndPersistManifestCycleId: (manifestPath) => manifestPath,
    promoteManifests: () => ({ writtenManifestPaths: [], writtenInitiativeIds: [] }),
  };
}
