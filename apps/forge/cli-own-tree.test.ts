/**
 * The forge a run's agents actually invoke must be the forge that dispatched
 * them, operating on the projects root that run was configured with.
 *
 * Bead forge-8vfn.6.11.26 (P1, REOPENED by ruling 348). S1 run 8 dispatched an
 * onboarding agent from `/home/parso/forge-m5-b` and the agent's contract work
 * landed in `/home/parso/forge` — the operator's own checkout — while the
 * ground the story provisioned never received it (beat 9 `FAIL C2`). Two
 * independent defects in one family produced that, and both are pinned here:
 *
 *   D1  `resolvePreflightProjectDir` resolved its managed candidate as
 *       `resolve('projects', target)` against the cwd, so `FORGE_PROJECTS_DIR`
 *       and `forge.config.json`'s `projectsDir` were dead for every command
 *       that used it (`preflight`, `preflight fix`, `instructions compose`,
 *       `constraints author`) — while every other projects consumer in the
 *       tree honours them through `resolveProjectsDir`.
 *
 *   D2  README:49 documents `npm link`, so the `forge` on PATH is bound to ONE
 *       checkout. `FORGE_ROOT` is derived from `import.meta.dirname` and the
 *       CLI chdirs to it, so it operates on its own install whatever cwd it is
 *       handed. An agent that types `forge preflight converge` — which its own
 *       PROMPT.md instructs — therefore wrote into a different tree entirely.
 *       The fix makes every forge process lead its children's PATH with its
 *       own `bin/`, which `AGENT_ENV_ALLOWLIST` already carries through
 *       `buildChildEnv` to the SDK child.
 *
 * The measured reproduction, $0 and zero writes, is in the ledger: the same
 * command through the linked `forge` and through the in-tree `cli.ts` named two
 * different projects roots, and neither honoured `FORGE_PROJECTS_DIR`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, accessSync, constants, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(FORGE_ROOT, 'apps', 'forge', 'cli.ts');

// ---------------------------------------------------------------------------
// D1 — the configured projects root is the one the command uses.
// ---------------------------------------------------------------------------

test('D1: `forge preflight <name>` resolves the project under the CONFIGURED projects root (FORGE_PROJECTS_DIR), not the <forgeRoot>/projects literal', () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'own-tree-projects-'));
  const projectDir = join(projectsRoot, 'ownedproj');
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(
    join(projectDir, '.forge', 'project.json'),
    `${JSON.stringify({ name: 'ownedproj', northStar: 'probe', testProcess: { local: { cmd: ['true'] } } }, null, 2)}\n`,
    'utf8',
  );

  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', CLI, 'preflight', 'ownedproj'],
    { encoding: 'utf8', env: { ...process.env, FORGE_PROJECTS_DIR: projectsRoot }, timeout: 120_000 },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;

  // The project exists ONLY under the configured root. A command that ignores
  // that root cannot find it at all, and says so by naming the path it looked
  // at — which is the exact string the defect prints.
  assert.doesNotMatch(
    out,
    /project directory not found/,
    `preflight looked in the wrong place: ${out.trim()} — the project exists at ${projectDir}, under the configured FORGE_PROJECTS_DIR root`,
  );
  assert.notEqual(r.status, 2, `expected preflight to RUN (exit 0 or 1 on the clause verdict), got the argument-error exit 2: ${out.trim()}`);
});

// ---------------------------------------------------------------------------
// D2 — a forge process's children resolve `forge` to that process's own tree.
// ---------------------------------------------------------------------------

test('D2: <forgeRoot>/bin holds an executable named exactly `forge` — the name an agent types — resolving to this tree\'s launcher', () => {
  const binForge = join(FORGE_ROOT, 'bin', 'forge');
  assert.ok(
    statSync(binForge, { throwIfNoEntry: false }) !== undefined,
    `${binForge} does not exist — prepending <forgeRoot>/bin to PATH would be a silent no-op, because PATH lookup needs a file named "forge", not "forge.mjs"`,
  );
  accessSync(binForge, constants.X_OK);
  assert.equal(
    realpathSync(binForge),
    realpathSync(join(FORGE_ROOT, 'bin', 'forge.mjs')),
    'bin/forge must resolve to this tree\'s own launcher',
  );
});

test('D2: the CLI leads its own process PATH with <forgeRoot>/bin, so every child it spawns — agent SDK children included — resolves `forge` to THIS tree', () => {
  const recorded = join(mkdtempSync(join(tmpdir(), 'own-tree-path-')), 'path.txt');
  // The CLI exits from inside its own dispatch, so the value is captured from
  // an `exit` handler installed BEFORE the import rather than read after it.
  const child = [
    `import { writeFileSync } from 'node:fs';`,
    `process.on('exit', () => { try { writeFileSync(${JSON.stringify(recorded)}, process.env.PATH ?? ''); } catch {} });`,
    `process.argv = [process.argv[0], ${JSON.stringify(CLI)}, '--help'];`,
    `await import(${JSON.stringify(CLI)});`,
  ].join('\n');

  spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', child], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '/usr/bin:/bin' },
    timeout: 120_000,
  });

  const seen = statSync(recorded, { throwIfNoEntry: false }) === undefined ? '' : readFileSync(recorded, 'utf8');
  assert.equal(
    seen.split(delimiter)[0],
    join(FORGE_ROOT, 'bin'),
    `the CLI's PATH leads with "${seen.split(delimiter)[0]}" — an agent dispatched by this process would resolve \`forge\` to whichever install happens to be linked on the host, not to the tree that dispatched it (that is exactly what moved the operator's ground in S1 run 8)`,
  );
});

test('D2: a child given that PATH resolves `forge` to this tree — the mechanism end to end', () => {
  const r = spawnSync('command', ['-v', 'forge'], {
    encoding: 'utf8',
    shell: '/bin/bash',
    env: { ...process.env, PATH: [join(FORGE_ROOT, 'bin'), '/usr/bin', '/bin'].join(delimiter) },
    timeout: 60_000,
  });
  assert.equal(
    (r.stdout ?? '').trim(),
    join(FORGE_ROOT, 'bin', 'forge'),
    `a child with this tree's bin leading PATH must resolve \`forge\` here, got "${(r.stdout ?? '').trim()}"`,
  );
});
