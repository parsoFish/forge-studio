/**
 * Unit tests for packages/projects/project-config.ts's `validateProjectConfig`
 * — the field-level validation concern behind the production
 * `project-config-validate.ts` parsers (`parseTestProcess`, `parseNorthStar`,
 * `parseInstructions`, `parseDemoProcess`, `parseSkills`, `parseKb`,
 * `parseArtifactRoot`, `parseReleaseProcess`, `parseBuildProcess`,
 * `parseMetrics`, `parseSweep`, `parseLogging`, `optionalArgv`) plus the
 * derived flat-accessor equality and the flat-gate-key migration rejection
 * that `validateProjectConfig` itself owns (see project-config.ts's header —
 * that function stays in the BARREL to avoid a circular import, but every
 * case below drives it directly, in-memory, with no filesystem — so it is
 * grouped here by concern, not by which literal file the code under test
 * lives in). `validateProjectConfig` throws on any structural/semantic
 * violation and returns the typed `ProjectConfig` otherwise (fail-closed per
 * CONTRACTS.md C1 + council 04 F8).
 *
 * Split out of project-config.test.ts (originally 1,025 lines, 77 cases) when
 * that file grew past the 800-line baseline cap — see
 * scripts/baselines/file-size.json / scripts/check-file-size.mjs. Siblings:
 * project-config.test.ts (the barrel — load-path mechanics,
 * `readAgentInstructionsFile`, `PROJECT_CONFIG_REL_PATH`),
 * project-config-sidecar.test.ts (the `.forge/quality_gate_cmd` interplay),
 * project-config-repo.test.ts (pre-existing — `repo:`/`REPO_RE`).
 *
 * No filesystem fixtures needed here — every case is a pure in-memory call.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateProjectConfig } from '../../project-config.ts';

test('loadProjectConfig: ci_gate + ci_fix_cmd are optional (absent ⇒ undefined)', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
  });
  assert.equal(cfg.ci_gate, undefined);
  assert.equal(cfg.ci_fix_cmd, undefined);
});

test('validateProjectConfig: testProcess.ci.cmd must be an argv string[] when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: {
          local: { cmd: ['true'] },
          ci: { cmd: 'make test && lint' },
        },
      }),
    /testProcess\.ci\.cmd/,
  );
});

// ----- A2/A3 testing-contract seams (2026-06-06) -----

test('validateProjectConfig: testProcess.ci.unsetEnv + standing_work_item_acs + testProcess.acceptance round-trip', () => {
  const cfg = validateProjectConfig({
    testProcess: {
      local: { cmd: ['true'] },
      ci: { cmd: ['true'], unsetEnv: ['TF_ACC'] },
      acceptance: { match: 'acceptancetests', required: true, requiresEnv: ['TF_ACC'] },
    },
    standing_work_item_acs: ['live acc test', 'CI must be green'],
  });
  assert.deepEqual(cfg.ci_gate_unset_env, ['TF_ACC']);
  assert.deepEqual(cfg.standing_work_item_acs, ['live acc test', 'CI must be green']);
  assert.deepEqual(cfg.acceptance_gate, { match: 'acceptancetests', required: true, requires_env: ['TF_ACC'] });
});

test('validateProjectConfig: the three A2/A3 seams are optional (absent ⇒ undefined)', () => {
  const cfg = validateProjectConfig({ testProcess: { local: { cmd: ['true'] } } });
  assert.equal(cfg.ci_gate_unset_env, undefined);
  assert.equal(cfg.standing_work_item_acs, undefined);
  assert.equal(cfg.acceptance_gate, undefined);
});

test('validateProjectConfig: testProcess.ci.unsetEnv must be an argv string[] when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: {
          local: { cmd: ['true'] },
          ci: { cmd: ['true'], unsetEnv: 'TF_ACC' },
        },
      }),
    /testProcess\.ci\.unsetEnv/,
  );
});

// FIX 4 (R5-02, security): ci_gate_unset_env is external input (project.json)
// at a trust boundary. Declaring PATH/HOME/SHELL would WEAKEN the gate child
// (PATH loss → wrong-binary resolution), not act as a live-test trigger — so
// reject those names with a clear error rather than silently self-sabotaging
// the gate. Validate + fail fast.

for (const forbidden of ['PATH', 'HOME', 'SHELL']) {
  test(`validateProjectConfig: testProcess.ci.unsetEnv rejects ${forbidden} (would weaken the gate child, not trigger a live test)`, () => {
    assert.throws(
      () =>
        validateProjectConfig({
          testProcess: {
            local: { cmd: ['true'] },
            ci: { cmd: ['true'], unsetEnv: ['TF_ACC', forbidden] },
          },
        }),
      new RegExp(`testProcess\\.ci\\.unsetEnv.*${forbidden}`),
    );
  });
}

test('validateProjectConfig: testProcess.ci.unsetEnv still accepts legitimate live-test trigger vars', () => {
  const cfg = validateProjectConfig({
    testProcess: {
      local: { cmd: ['true'] },
      ci: { cmd: ['true'], unsetEnv: ['TF_ACC', 'RUN_INTEGRATION', 'AZURE_ACC'] },
    },
  });
  assert.deepEqual(cfg.ci_gate_unset_env, ['TF_ACC', 'RUN_INTEGRATION', 'AZURE_ACC']);
});

test('validateProjectConfig: testProcess.acceptance requires a non-empty match', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: {
          local: { cmd: ['true'] },
          acceptance: { required: true },
        },
      }),
    /testProcess\.acceptance\.match/,
  );
});

test('validateProjectConfig: testProcess.acceptance.required must be a boolean', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: {
          local: { cmd: ['true'] },
          acceptance: { match: 'acceptancetests', required: 'yes' },
        },
      }),
    /testProcess\.acceptance\.required/,
  );
});

// ----- M2 fields (northStar / instructions / demoProcess / skills / kb) -----

test('validateProjectConfig: M2 fields all absent → valid (backward compat)', () => {
  const cfg = validateProjectConfig({ testProcess: { local: { cmd: ['true'] } } });
  assert.equal(cfg.northStar, undefined);
  assert.equal(cfg.instructions, undefined);
  assert.equal(cfg.demoProcess, undefined);
  assert.equal(cfg.skills, undefined);
  assert.equal(cfg.kb, undefined);
});

test('validateProjectConfig: northStar ≤ 140 chars → accepted', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    northStar: 'Build a self-sustaining autonomous agent loop.',
  });
  assert.equal(cfg.northStar, 'Build a self-sustaining autonomous agent loop.');
});

test('validateProjectConfig: northStar > 140 chars → throws', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        northStar: 'x'.repeat(141),
      }),
    /northStar/,
  );
});

test('validateProjectConfig: northStar must be a string when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        northStar: 42,
      }),
    /northStar/,
  );
});

test('validateProjectConfig: instructions string round-trips', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    instructions: 'Always write tests first.',
  });
  assert.equal(cfg.instructions, 'Always write tests first.');
});

test('validateProjectConfig: instructions must be a string when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        instructions: 99,
      }),
    /instructions/,
  );
});

test('validateProjectConfig: demoProcess array of valid steps round-trips', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    demoProcess: [
      { kind: 'capture', text: 'Screenshot home page.' },
      { kind: 'verify', text: 'Check API returns 200.' },
      { kind: 'present', text: 'Show the diff.' },
    ],
  });
  assert.deepEqual(cfg.demoProcess, [
    { kind: 'capture', text: 'Screenshot home page.' },
    { kind: 'verify', text: 'Check API returns 200.' },
    { kind: 'present', text: 'Show the diff.' },
  ]);
});

test('validateProjectConfig: demoProcess step with bad kind → throws', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        demoProcess: [{ kind: 'invalid', text: 'step' }],
      }),
    /demoProcess/,
  );
});

test('validateProjectConfig: demoProcess must be an array when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        demoProcess: 'capture everything',
      }),
    /demoProcess/,
  );
});

test('validateProjectConfig: skills string array round-trips', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    skills: ['demo', 'tdd-workflow'],
  });
  assert.deepEqual(cfg.skills, ['demo', 'tdd-workflow']);
});

test('validateProjectConfig: skills must be an array of strings when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        skills: [42, 'demo'],
      }),
    /skills/,
  );
});

test('validateProjectConfig: kb string round-trips', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    kb: 'cycles',
  });
  assert.equal(cfg.kb, 'cycles');
});

test('validateProjectConfig: kb null is accepted', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    kb: null,
  });
  assert.equal(cfg.kb, null);
});

test('validateProjectConfig: all M2 fields valid together → round-trips', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    northStar: 'Build a great product.',
    instructions: 'Always write tests.',
    demoProcess: [{ kind: 'capture', text: 'Take a screenshot.' }],
    skills: ['demo'],
    kb: 'cycles',
  });
  assert.equal(cfg.northStar, 'Build a great product.');
  assert.equal(cfg.instructions, 'Always write tests.');
  assert.deepEqual(cfg.demoProcess, [{ kind: 'capture', text: 'Take a screenshot.' }]);
  assert.deepEqual(cfg.skills, ['demo']);
  assert.equal(cfg.kb, 'cycles');
});

// ----- artifactRoot validation -----

test('validateProjectConfig: artifactRoot absent → undefined (no own key in result)', () => {
  const cfg = validateProjectConfig({ testProcess: { local: { cmd: ['true'] } } });
  assert.equal(cfg.artifactRoot, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(cfg, 'artifactRoot'));
});

test('validateProjectConfig: artifactRoot "." → normalised to undefined (legacy layout)', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    artifactRoot: '.',
  });
  assert.equal(cfg.artifactRoot, undefined);
});

test('validateProjectConfig: artifactRoot "" → normalised to undefined', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    artifactRoot: '',
  });
  assert.equal(cfg.artifactRoot, undefined);
});

test('validateProjectConfig: artifactRoot "  " (whitespace only) → normalised to undefined', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    artifactRoot: '  ',
  });
  assert.equal(cfg.artifactRoot, undefined);
});

test('validateProjectConfig: artifactRoot "forge" → preserved as-is', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    artifactRoot: 'forge',
  });
  assert.equal(cfg.artifactRoot, 'forge');
});

test('validateProjectConfig: artifactRoot "forge/x" (nested clean relative) → preserved', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    artifactRoot: 'forge/x',
  });
  assert.equal(cfg.artifactRoot, 'forge/x');
});

test('validateProjectConfig: artifactRoot "/abs" (leading slash) → throws mentioning artifactRoot', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        artifactRoot: '/abs',
      }),
    /artifactRoot/,
  );
});

test('validateProjectConfig: artifactRoot "../escape" (dotdot segment) → throws mentioning artifactRoot', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        artifactRoot: '../escape',
      }),
    /artifactRoot/,
  );
});

test('validateProjectConfig: artifactRoot "a/../b" (embedded dotdot) → throws mentioning artifactRoot', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        artifactRoot: 'a/../b',
      }),
    /artifactRoot/,
  );
});

test('validateProjectConfig: artifactRoot with backslash → throws mentioning artifactRoot', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        artifactRoot: 'a\\b',
      }),
    /artifactRoot/,
  );
});

test('validateProjectConfig: artifactRoot as number → throws mentioning artifactRoot', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        artifactRoot: 42,
      }),
    /artifactRoot/,
  );
});

test('validateProjectConfig: artifactRoot as object → throws mentioning artifactRoot', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        artifactRoot: { path: 'forge' },
      }),
    /artifactRoot/,
  );
});

test('validateProjectConfig: full valid config WITH artifactRoot round-trips alongside M2 fields', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    northStar: 'Ship great things.',
    instructions: 'Write tests first.',
    demoProcess: [{ kind: 'verify', text: 'Check API.' }],
    skills: ['demo'],
    kb: 'cycles',
    artifactRoot: 'forge',
  });
  assert.equal(cfg.artifactRoot, 'forge');
  assert.equal(cfg.northStar, 'Ship great things.');
  assert.equal(cfg.instructions, 'Write tests first.');
  assert.deepEqual(cfg.demoProcess, [{ kind: 'verify', text: 'Check API.' }]);
  assert.deepEqual(cfg.skills, ['demo']);
  assert.equal(cfg.kb, 'cycles');
});

// ----- releaseProcess validation (WS-F1) -----

test('validateProjectConfig: releaseProcess full round-trip (steps + paths + command)', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    releaseProcess: {
      steps: [
        { kind: 'docs', phase: 'in-cycle', text: 'Refresh the README usage section.' },
        { kind: 'changelog', phase: 'pre-merge', text: 'Add a CHANGELOG entry.' },
        {
          kind: 'version',
          phase: 'pre-merge',
          text: 'Bump the version file.',
          command: ['bash', '-lc', 'npm version patch --no-git-tag-version'],
        },
      ],
      versionFile: 'package.json',
      changelogPath: 'CHANGELOG.md',
      docsDir: 'docs',
    },
  });
  assert.deepEqual(cfg.releaseProcess, {
    steps: [
      { kind: 'docs', phase: 'in-cycle', text: 'Refresh the README usage section.' },
      { kind: 'changelog', phase: 'pre-merge', text: 'Add a CHANGELOG entry.' },
      {
        kind: 'version',
        phase: 'pre-merge',
        text: 'Bump the version file.',
        command: ['bash', '-lc', 'npm version patch --no-git-tag-version'],
      },
    ],
    versionFile: 'package.json',
    changelogPath: 'CHANGELOG.md',
    docsDir: 'docs',
  });
});

test('validateProjectConfig: releaseProcess absent → undefined (no own key in result)', () => {
  const cfg = validateProjectConfig({ testProcess: { local: { cmd: ['true'] } } });
  assert.equal(cfg.releaseProcess, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(cfg, 'releaseProcess'));
});

test('validateProjectConfig: releaseProcess step with bad kind → throws', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: { steps: [{ kind: 'tag', phase: 'pre-merge', text: 'Tag the release.' }] },
      }),
    /releaseProcess\.steps\[0\]\.kind/,
  );
});

test('validateProjectConfig: releaseProcess step with bad phase → throws', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: { steps: [{ kind: 'docs', phase: 'post-merge', text: 'Refresh docs.' }] },
      }),
    /releaseProcess\.steps\[0\]\.phase/,
  );
});

test('validateProjectConfig: releaseProcess.versionFile rejects "../escape"', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: {
          steps: [{ kind: 'version', phase: 'pre-merge', text: 'Bump version.' }],
          versionFile: '../escape',
        },
      }),
    /releaseProcess\.versionFile/,
  );
});

test('validateProjectConfig: releaseProcess.changelogPath rejects "../escape"', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: {
          steps: [{ kind: 'changelog', phase: 'pre-merge', text: 'Add entry.' }],
          changelogPath: '../escape',
        },
      }),
    /releaseProcess\.changelogPath/,
  );
});

test('validateProjectConfig: releaseProcess.docsDir rejects "../escape"', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: {
          steps: [{ kind: 'docs', phase: 'in-cycle', text: 'Refresh docs.' }],
          docsDir: '../escape',
        },
      }),
    /releaseProcess\.docsDir/,
  );
});

test('validateProjectConfig: releaseProcess step command round-trips', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    releaseProcess: {
      steps: [
        {
          kind: 'docs',
          phase: 'in-cycle',
          text: 'Regenerate the docs site.',
          command: ['make', 'docs'],
        },
      ],
    },
  });
  assert.ok(cfg.releaseProcess);
  assert.deepEqual(cfg.releaseProcess.steps[0].command, ['make', 'docs']);
});

test('validateProjectConfig: releaseProcess must be an object when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: 'bump and ship',
      }),
    /releaseProcess/,
  );
});

test('validateProjectConfig: releaseProcess requires a steps array', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: { versionFile: 'package.json' },
      }),
    /releaseProcess\.steps/,
  );
});

test('validateProjectConfig: releaseProcess step command must be argv string[] when present', () => {
  assert.throws(
    () =>
      validateProjectConfig({
        testProcess: { local: { cmd: ['true'] } },
        releaseProcess: {
          steps: [{ kind: 'version', phase: 'pre-merge', text: 'Bump.', command: 'npm version' }],
        },
      }),
    /releaseProcess\.steps\[0\]\.command/,
  );
});

test('validateProjectConfig: full valid config WITH releaseProcess round-trips alongside all fields', () => {
  const cfg = validateProjectConfig({
    testProcess: { local: { cmd: ['true'] } },
    northStar: 'Ship great things.',
    instructions: 'Write tests first.',
    demoProcess: [{ kind: 'verify', text: 'Check API.' }],
    skills: ['demo'],
    kb: 'cycles',
    artifactRoot: 'forge',
    releaseProcess: {
      steps: [
        { kind: 'docs', phase: 'in-cycle', text: 'Refresh docs.' },
        { kind: 'version', phase: 'pre-merge', text: 'Bump version.' },
      ],
      versionFile: 'package.json',
      docsDir: 'docs',
    },
  });
  assert.equal(cfg.artifactRoot, 'forge');
  assert.equal(cfg.kb, 'cycles');
  assert.ok(cfg.releaseProcess);
  assert.equal(cfg.releaseProcess.steps.length, 2);
  assert.equal(cfg.releaseProcess.versionFile, 'package.json');
  assert.equal(cfg.releaseProcess.docsDir, 'docs');
  assert.equal(cfg.releaseProcess.changelogPath, undefined);
});

// ---------------------------------------------------------------------------
// R1-03-F1: flat-key rejection, conflict, sidecar re-rooting, timeouts,
// derivation equality — the migration contract's own pins.
// ---------------------------------------------------------------------------

test('validateProjectConfig: a flat gate key alone → migration message naming the full mapping', () => {
  assert.throws(
    () => validateProjectConfig({ quality_gate_cmd: ['npm', 'test'] }),
    /moved to the typed testProcess object \(R1-03\).*quality_gate_cmd → testProcess\.local\.cmd/,
  );
  assert.throws(
    () => validateProjectConfig({ testProcess: { local: { cmd: ['npm', 'test'] } }, ci_gate: ['make', 'ci'] }),
    /conflicting flat gate key\(s\) alongside testProcess.*ci_gate → testProcess\.ci\.cmd/,
  );
});

test('validateProjectConfig: every flat key is named in the rejection', () => {
  const err = (() => {
    try {
      validateProjectConfig({
        quality_gate_cmd: ['a'],
        ci_gate: ['b'],
        ci_fix_cmd: ['c'],
        ci_gate_unset_env: ['TF_ACC'],
        acceptance_gate: { match: 'x', required: false },
      });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();
  assert.ok(err !== null);
  for (const frag of [
    'quality_gate_cmd → testProcess.local.cmd',
    'ci_gate → testProcess.ci.cmd',
    'ci_fix_cmd → testProcess.ci.fixCmd',
    'ci_gate_unset_env → testProcess.ci.unsetEnv',
    'acceptance_gate → testProcess.acceptance',
  ]) {
    assert.ok(err.includes(frag), `rejection names "${frag}" (got: ${err})`);
  }
});

test('validateProjectConfig: timeoutMs fields parse (positive int) and reject nonsense', () => {
  const cfg = validateProjectConfig({
    testProcess: {
      local: { cmd: ['npm', 'test'], timeoutMs: 60000 },
      ci: { cmd: ['make', 'ci'], timeoutMs: 1200000 },
      acceptance: { match: 'acc', required: false, timeoutMs: 900000 },
    },
  });
  assert.equal(cfg.testProcess.local.timeoutMs, 60000);
  assert.equal(cfg.testProcess.ci?.timeoutMs, 1200000);
  assert.equal(cfg.testProcess.acceptance?.timeoutMs, 900000);
  for (const bad of [0, -5, 1.5, 'fast']) {
    assert.throws(
      () => validateProjectConfig({ testProcess: { local: { cmd: ['t'], timeoutMs: bad } } }),
      /timeoutMs must be a positive integer/,
    );
  }
});

test('validateProjectConfig: derived flat accessors equal the declared testProcess (derivation equality)', () => {
  const cfg = validateProjectConfig({
    testProcess: {
      local: { cmd: ['npm', 'test'] },
      ci: { cmd: ['make', 'ci'], fixCmd: ['make', 'fmt'], unsetEnv: ['TF_ACC'] },
      acceptance: { match: 'acceptance', required: true, requiresEnv: ['TF_ACC'] },
    },
  });
  assert.deepEqual(cfg.quality_gate_cmd, cfg.testProcess.local.cmd);
  assert.deepEqual(cfg.ci_gate, cfg.testProcess.ci?.cmd);
  assert.deepEqual(cfg.ci_fix_cmd, cfg.testProcess.ci?.fixCmd);
  assert.deepEqual(cfg.ci_gate_unset_env, cfg.testProcess.ci?.unsetEnv);
  assert.deepEqual(cfg.acceptance_gate, {
    match: 'acceptance',
    required: true,
    requires_env: ['TF_ACC'],
  });
});

