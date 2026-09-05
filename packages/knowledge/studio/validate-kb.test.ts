/**
 * Tests for `validate-kb.ts`. Moved verbatim from `apps/forge/validate.test.ts`
 * with the validator itself (T1 ruling 159).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { KbDescriptor } from '@forge/contracts/studio/types.ts';
import { validateKb } from './validate-kb.ts';


// ---------------------------------------------------------------------------
// validateKb
// ---------------------------------------------------------------------------

describe('validateKb — slug', () => {
  it('id failing KB_ID_RE → error slug (W7-A4: "Cycles_KB" is legal; a path-shaped id is not)', () => {
    const kb: KbDescriptor = {
      id: 'cycles/../kb',
      name: 'Cycles',
      binding: { kind: 'flow', ref: 'forge-develop' },
      desc: 'Patterns.',
      path: '/brain/cycles/kb.yaml',
    };
    const findings = validateKb(kb);
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('cycles/../kb'));
  });

  it('valid kb → no findings', () => {
    const kb: KbDescriptor = {
      id: 'cycles',
      name: 'Cycles',
      binding: { kind: 'flow', ref: 'forge-develop' },
      desc: 'Patterns.',
      path: '/brain/cycles/kb.yaml',
    };
    const findings = validateKb(kb);
    assert.deepEqual(findings, []);
  });
});
