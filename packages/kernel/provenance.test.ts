/**
 * The pure-mapping test QUARRY:76 named as this module's precondition.
 *
 * `cli/studio-provenance.ts` could not move here while its ONLY test was
 * AT-3a inside a 654-line bridge integration test that boots `ui-bridge.ts` —
 * that test cannot follow a module into a package without dragging the bridge
 * across the boundary, and a kernel module with no package-level test is the
 * shape this campaign exists to stop. So the mapping's own cases move here,
 * beside the module, as a static import rather than the dynamic one AT-3a
 * needed to survive a missing file.
 *
 * The bridge test keeps every case that is genuinely about a ROUTE's response.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { provenanceOfOrigin, AGENT_PROVENANCE, PROJECT_PROVENANCE } from './provenance.ts';

test('provenanceOfOrigin maps seed/ootb-library -> ootb, studio -> operator, and everything else -> unknown (kills: a mapping that guesses a badge from an origin it has never seen)', () => {
  const cases: Array<[string | undefined | null, string]> = [
    ['seed', 'ootb'],
    ['ootb-library', 'ootb'],
    ['studio', 'operator'],
    [undefined, 'unknown'],
    [null, 'unknown'],
    ['', 'unknown'],
    ['something-else', 'unknown'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(
      provenanceOfOrigin(input),
      expected,
      `provenanceOfOrigin(${JSON.stringify(input)}) must be ${expected}`,
    );
  }
});

test('the two un-attestable types report the literal unknown token (kills: a constant quietly flipped to ootb/operator, which would fabricate a badge for a type carrying no on-disk origin signal at all)', () => {
  assert.equal(AGENT_PROVENANCE, 'unknown', 'AGENT_PROVENANCE must be the unknown token');
  assert.equal(PROJECT_PROVENANCE, 'unknown', 'PROJECT_PROVENANCE must be the unknown token');
});
