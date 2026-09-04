/**
 * The assembly's binding for `@forge/library`'s `FlowSource` port (ruling 113).
 *
 * Library is rank 2 and `@forge/flows` is rank 5, so the Flow kind's loaders
 * reach library by injection. Deep imports, not the package door: importing a
 * barrel pulls every module it re-exports into the import-graph-walking guards
 * and makes files request-reachable that no request reaches (COMMON §15.138).
 * The `FlowSource` annotation is the drift check — if either side's shape
 * moves, this fails to compile rather than satisfying a stale port.
 */
import { listFlowIds, loadFlowDefinition } from '@forge/flows/studio/flow-registry.ts';
import type { FlowSource } from '@forge/library/studio/template-library.ts';

export const libraryFlowSource: FlowSource = { listFlowIds, loadFlowDefinition };
