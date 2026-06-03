/**
 * File-verdict path resolution for the review human moment.
 *
 * The verdict prompt/response files live beside the manifest in
 * `<queueRoot>/in-flight/`. The forge UI (the sole operator surface) drives the
 * review verdict via the bridge; the `forge review` CLI uses these paths to
 * locate the prompt/response files. Pure path resolution — no I/O.
 *
 * (The verdict-response *parser* was removed 2026-06-03: nothing read it — the
 * UI send-back re-enters the cycle via requeue with `resume_from: unifier`, not
 * by parsing this file. See orchestrator/cycle.ts + cli/ui-bridge.ts.)
 */

import { resolve } from 'node:path';

export type FileVerdictPaths = {
  promptPath: string;
  responsePath: string;
};

/**
 * Resolve the standard file-verdict paths for an initiative. Pure — no I/O.
 * Used by the `forge review` CLI to locate the prompt/response files.
 */
export function fileVerdictPaths(
  initiativeId: string,
  queueRoot = '_queue',
): FileVerdictPaths {
  const inFlight = resolve(queueRoot, 'in-flight');
  return {
    promptPath: resolve(inFlight, `${initiativeId}.verdict-prompt.md`),
    responsePath: resolve(inFlight, `${initiativeId}.verdict-response.md`),
  };
}
