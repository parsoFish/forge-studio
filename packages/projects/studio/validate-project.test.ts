/**
 * Tests for `validate-project.ts` — the studio `ProjectDefinition` rules and
 * the disk-discovered project set. Moved verbatim from
 * `apps/forge/validate.test.ts` with the validators themselves (T1 ruling 159).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ProjectDefinition } from '@forge/contracts/studio/types.ts';
import { validateDiscoveredProjects, validateProject } from './validate-project.ts';

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

// ---------------------------------------------------------------------------
// validateProject
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectDefinition> = {}): ProjectDefinition {
  return {
    id: 'my-project',
    name: 'My Project',
    northStar: 'Build something great.',
    instructions: 'Always write tests.',
    demoProcess: [{ kind: 'capture', text: 'Screenshot home.' }],
    skills: ['demo'],
    kb: null,
    ...overrides,
  };
}

describe('validateProject — slug', () => {
  it('id not matching PROJECT_ID_RE → error slug (W7-A4: "My_Project" is legal; "../x" is not)', () => {
    const findings = validateProject(makeProject({ id: '../x' }));
    const f = findings.find((x) => x.check === 'slug');
    assert.ok(f, 'expected slug finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('../x'));
    assert.ok(!validateProject(makeProject({ id: 'My_Project' })).some((x) => x.check === 'slug'));
  });

  it('valid id → no slug finding', () => {
    const findings = validateProject(makeProject());
    assert.ok(!findings.some((x) => x.check === 'slug'));
  });
});

describe('validateProject — readiness/north-star', () => {
  it('empty northStar → flag readiness/north-star', () => {
    const findings = validateProject(makeProject({ northStar: '' }));
    const f = findings.find((x) => x.check === 'readiness/north-star');
    assert.ok(f, 'expected readiness/north-star finding');
    assert.equal(f.level, 'flag');
    assert.ok(f.object.startsWith('project:'));
  });

  it('northStar > 140 chars → error readiness/north-star', () => {
    const findings = validateProject(makeProject({ northStar: 'x'.repeat(141) }));
    const f = findings.find((x) => x.check === 'readiness/north-star');
    assert.ok(f, 'expected readiness/north-star finding');
    assert.equal(f.level, 'error');
  });

  it('northStar exactly 140 chars → no readiness/north-star finding', () => {
    const findings = validateProject(makeProject({ northStar: 'x'.repeat(140) }));
    assert.ok(!findings.some((x) => x.check === 'readiness/north-star'));
  });

  it('non-empty northStar ≤ 140 → no readiness/north-star finding', () => {
    const findings = validateProject(makeProject());
    assert.ok(!findings.some((x) => x.check === 'readiness/north-star'));
  });
});

describe('validateProject — demoProcess kinds', () => {
  it('demoProcess step with invalid kind → error demoProcess/kind', () => {
    const findings = validateProject(
      makeProject({ demoProcess: [{ kind: 'invalid' as never, text: 'step' }] }),
    );
    const f = findings.find((x) => x.check === 'demoProcess/kind');
    assert.ok(f, 'expected demoProcess/kind finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('invalid'));
  });

  it('demoProcess with all valid kinds → no demoProcess/kind finding', () => {
    const findings = validateProject(
      makeProject({
        demoProcess: [
          { kind: 'capture', text: 'a' },
          { kind: 'verify', text: 'b' },
          { kind: 'present', text: 'c' },
        ],
      }),
    );
    assert.ok(!findings.some((x) => x.check === 'demoProcess/kind'));
  });

  it('empty demoProcess array → no demoProcess/kind finding', () => {
    const findings = validateProject(makeProject({ demoProcess: [] }));
    assert.ok(!findings.some((x) => x.check === 'demoProcess/kind'));
  });
});

describe('validateProject — skills', () => {
  it('skills array containing a non-string entry → error skills/type', () => {
    const findings = validateProject(
      makeProject({ skills: [42 as unknown as string, 'demo'] }),
    );
    const f = findings.find((x) => x.check === 'skills/type');
    assert.ok(f, 'expected skills/type finding');
    assert.equal(f.level, 'error');
  });

  it('skills array of strings → no skills/type finding', () => {
    const findings = validateProject(makeProject({ skills: ['demo', 'tdd-workflow'] }));
    assert.ok(!findings.some((x) => x.check === 'skills/type'));
  });

  it('empty skills array → no skills/type finding', () => {
    const findings = validateProject(makeProject({ skills: [] }));
    assert.ok(!findings.some((x) => x.check === 'skills/type'));
  });
});

describe('validateProject — fully valid project', () => {
  it('fully-valid project → [] findings', () => {
    const findings = validateProject(makeProject());
    assert.deepEqual(findings, []);
  });
});
