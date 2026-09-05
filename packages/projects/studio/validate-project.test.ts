/**
 * Tests for `validate-project.ts` — the disk-discovered project set.
 * Moved verbatim from `apps/forge/validate.test.ts` with the validators
 * themselves (T1 ruling 159).
 *
 * The `validateProject` half was DELETED with the function it tested
 * (2026-09-05, bead `forge-8vfn.6.10.10`, operator ruling 204): three of its
 * four rules are enforced more strictly by `project-config-validate.ts`'s
 * parsers, the fourth by `validateDiscoveredProjects` below, and its one
 * unique rule ran over a `ProjectDefinition` that nothing in the repository
 * constructs. Tests for a deleted function are the cheapest kind of green.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateDiscoveredProjects } from './validate-project.ts';

describe('validateDiscoveredProjects — unique-ids', () => {
  it('duplicate project id → error unique-ids', () => {
    const findings = validateDiscoveredProjects([
      { id: 'betterado', path: 'projects/betterado', hasConfig: true },
      { id: 'betterado', path: 'projects/betterado-2', hasConfig: true },
    ]);
    const f = findings.find((x) => x.check === 'unique-ids');
    assert.ok(f, 'expected unique-ids finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('betterado'));
  });

  it('unique project ids → no unique-ids finding', () => {
    const findings = validateDiscoveredProjects([
      { id: 'betterado', path: 'projects/betterado', hasConfig: true },
      { id: 'claude-harness', path: 'projects/claude-harness', hasConfig: true },
    ]);
    assert.ok(!findings.some((x) => x.check === 'unique-ids'));
  });
});

describe('validateDiscoveredProjects — slug', () => {
  it('id failing PROJECT_ID_RE → error slug (W7-A4: mixed case/underscore are legal; path/space shapes are not)', () => {
    const findings = validateDiscoveredProjects([
      { id: 'my project', path: 'projects/my', hasConfig: true },
    ]);
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('my project'));
    assert.ok(!validateDiscoveredProjects([{ id: 'My_Project', path: 'projects/My_Project', hasConfig: true }]).some((x) => x.check === 'slug'));
  });

  it('clean, configured projects → no findings', () => {
    const findings = validateDiscoveredProjects([
      { id: 'betterado', path: 'projects/betterado', hasConfig: true },
    ]);
    assert.deepEqual(findings, []);
  });
});

describe('validateDiscoveredProjects — missing config', () => {
  it('project dir without .forge/project.json → flag missing-config', () => {
    const findings = validateDiscoveredProjects([
      { id: 'half-onboarded', path: 'projects/half-onboarded', hasConfig: false },
    ]);
    const f = findings.find((x) => x.check === 'missing-config');
    assert.ok(f, 'expected missing-config finding');
    assert.equal(f.level, 'flag');
    assert.ok(f.message.includes('half-onboarded'));
  });

  it('zero projects → no findings', () => {
    assert.deepEqual(validateDiscoveredProjects([]), []);
  });
});
