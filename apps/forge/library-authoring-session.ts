/**
 * The `AuthoringSessionPort` binding — sessions' facts, handed to
 * `@forge/library`'s authoring finalize route (handoffs L1–L4, ruling 137).
 *
 * Library is rank 2 and cannot import the session spine; it declares the port
 * and this file satisfies it, beside the other kind dependencies the assembly
 * already binds (`session-kind-deps.ts`'s shape). The `AuthoringSessionPort`
 * annotation is the drift check between the two sides.
 *
 * `runInteractiveTurn` stays a DYNAMIC import: a static one would pull the
 * Claude Agent SDK into bridge start-up, which is why the route did it that
 * way before the port existed.
 */
import type { AuthoringSessionPort } from '@forge/library/studio/authoring-session.ts';

import { guardedReadSessionStatus, guardedWriteSessionStatus } from '@forge/sessions/session-status-io.ts';
import { InteractiveFinalizerError } from '@forge/sessions/interactive-finalizers.ts';
import { loadSessionKinds } from '@forge/sessions/studio/session-kinds.ts';

export const authoringSessionPort: AuthoringSessionPort = {
  readStatus: guardedReadSessionStatus,
  writeStatus: guardedWriteSessionStatus,
  runAuthoringTurn: async (input) => {
    const descriptor = loadSessionKinds(input.forgeRoot).find((d) => d.id === 'authoring');
    if (!descriptor) return null;
    const { runInteractiveTurn } = await import('@forge/sessions/interactive-runner.ts');
    return runInteractiveTurn(descriptor, input);
  },
  isFinalizerError: (err) => err instanceof InteractiveFinalizerError,
};
