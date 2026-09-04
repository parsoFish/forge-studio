/**
 * An inert `AuthoringSessionPort` for tests that build the route table but
 * never drive the authoring finalize route.
 *
 * Deliberately inert rather than a stub that pretends to work: every member
 * throws or refuses, so a test that DOES reach the authoring path fails loudly
 * naming this fixture instead of silently exercising a fake turn. The finalize
 * route's own tests bind their own behaviour.
 */
import type { AuthoringSessionPort } from '../../studio/authoring-session.ts';

export const inertAuthoringSession: AuthoringSessionPort = {
  readStatus: () => null,
  writeStatus: () => null,
  runAuthoringTurn: async () => {
    throw new Error('inertAuthoringSession: this test bound no authoring turn');
  },
  isFinalizerError: () => false,
};
