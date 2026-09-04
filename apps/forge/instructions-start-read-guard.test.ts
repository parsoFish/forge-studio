/**
 * forge-osz — POST /api/instructions/start must contain the request-supplied
 * `project` segment BEFORE it is folded into the repoPath handed to
 * readAgentInstructionsFile.
 *
 * WHY A SOURCE / ORDERING GATE (not a route-behaviour test): the read result
 * feeds only the local `mode` default, and the handler's own session-dir guard
 * rejects an out-of-root `project` a few lines later, so two requests that
 * differ only in whether the read escaped return the SAME response — the oracle
 * is not observable through the wire. And a call-record spy is not available
 * here: this repo has empirically verified (see cli/ui-bridge-authoring-start.test.ts's
 * spawn note) that node:test's mock.method cannot redefine ui-bridge's named ESM
 * imports. The only honest, RED-at-base assertion left is a structural one, the
 * same shape roadmap-serpentine-retired.test.ts uses to pin the ABSENCE of code.
 *
 * RED-AT-BASE: on the unfixed handler the first readAgentInstructionsFile(...)
 * call inside the /api/instructions/start block is preceded by NO
 * resolveGuardedPath containment of body.project (only invalidProjectRepoPath,
 * which guards the projectRepoPath field, and guardedSessionDir, which runs
 * AFTER the read). This test FAILS there.
 *
 * GREEN CONDITION (this file's expiry): body.project is passed through
 * resolveGuardedPath(projectsRoot, [body.project]) before the read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// M4 session-routes carve: the /api/instructions/start handler moved verbatim
// out of cli/ui-bridge.ts into @forge/sessions. This is a SOURCE / ORDERING
// gate, so it has to read the file the handler now lives in — repointing it is
// the whole difference between a guard that still watches the ordering and one
// that reads a file where the code no longer is and passes vacuously.
const SRC = readFileSync(
  join(import.meta.dirname, '..', '..', 'packages', 'sessions', 'bridge-studio-instructions.ts'),
  'utf8',
);

/** Extract the POST /api/instructions/start handler block: from its route match
 *  to the next handler (POST /api/instructions/brief). */
function instructionsStartBlock(src: string): string {
  const startMarker = "url === '/api/instructions/start'";
  const endMarker = "url === '/api/instructions/brief'";
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, 'could not locate the /api/instructions/start handler');
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, 'could not bound the /api/instructions/start handler');
  return src.slice(start, end);
}

test('instructions/start contains body.project before the instruction-file read', () => {
  const block = instructionsStartBlock(SRC);

  const readIdx = block.indexOf('readAgentInstructionsFile(');
  assert.ok(readIdx >= 0, 'expected an instruction-file read in the handler (sanity)');

  // The containment guard on the untrusted project segment — the SAME
  // resolveGuardedPath choke point the sibling /start routes use.
  const guardRe = /resolveGuardedPath\(\s*ctx\.projectsRoot\s*,\s*\[\s*body\.project\s*\]\s*\)/;
  const guardMatch = guardRe.exec(block);
  assert.ok(
    guardMatch,
    'body.project is not contained via resolveGuardedPath in the handler — the read-before-guard is open',
  );
  assert.ok(
    guardMatch.index < readIdx,
    'body.project is contained only AFTER readAgentInstructionsFile — the guard must precede the read',
  );
});
