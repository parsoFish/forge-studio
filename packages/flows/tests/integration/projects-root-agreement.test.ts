/**
 * SPEC §6 / the claim gate's roster: the scheduler and Studio resolve ONE
 * projects dir. The daemon's layout bootstrap used to derive it as
 * `dirname(queueRoot)/projects`, while Studio's roster (`loadProjectsWithMeta`)
 * reads the configured dir (`FORGE_PROJECTS_DIR` / `projectsDir`) — so under a
 * configured dir the claim gate looked for a project where the scheduler had
 * made a different directory. Both now go through `resolveProjectsDir`.
 *
 * `serve` (once-mode, empty queue) is driven from a tmp forge root as cwd, as
 * `queue-root-agreement.test.ts` does; nothing is spawned and nothing touches
 * the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadProjectsWithMeta } from '@forge/projects';
import { projectKbBindings } from '@forge/knowledge';
import { serve } from '../../scheduler.ts';
import { rosterEntryFor } from '../../claim-validator.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';

type Case = { label: string; config: Record<string, unknown> | null; env: string | null; dir: string };

const CASES: Case[] = [
  { label: 'default (no config, no env)', config: null, env: null, dir: 'projects' },
  { label: 'config projectsDir', config: { projectsDir: 'grounds' }, env: null, dir: 'grounds' },
  { label: 'FORGE_PROJECTS_DIR override', config: { projectsDir: 'grounds' }, env: 'elsewhere/ground-set', dir: 'elsewhere/ground-set' },
];

for (const c of CASES) {
  test(`the scheduler's projects root is the dir Studio's roster reads — ${c.label}`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'forge-projroot-')));
    const cwd = process.cwd();
    const log = console.log;
    const prevEnv = process.env.FORGE_PROJECTS_DIR;
    try {
      if (c.config !== null) writeFileSync(join(root, 'forge.config.json'), JSON.stringify(c.config));
      if (c.env === null) delete process.env.FORGE_PROJECTS_DIR;
      else process.env.FORGE_PROJECTS_DIR = c.env;
      process.chdir(root);
      console.log = () => {};
      await serve({ mode: 'once', phaseWiring: {} as unknown as PhaseWiring, worktreesRoot: join(root, '_worktrees') });
      console.log = log;

      const expected = resolve(root, c.dir);
      assert.ok(existsSync(expected), `the scheduler's layout bootstrap made ${expected}`);
      if (c.dir !== 'projects') {
        assert.equal(existsSync(join(root, 'projects')), false, 'and did not make the unconfigured <forgeRoot>/projects beside the queue');
      }

      // A project in that dir is on the roster Studio reads, at that path.
      mkdirSync(join(expected, 'alpha'), { recursive: true });
      const roster = loadProjectsWithMeta(root, projectKbBindings);
      assert.deepEqual(roster.map((p) => p.id), ['alpha'], 'the roster reads the same dir the scheduler made');
      assert.equal(rosterEntryFor(roster, join(expected, 'alpha'), root)?.id, 'alpha');
    } finally {
      console.log = log;
      process.chdir(cwd);
      if (prevEnv === undefined) delete process.env.FORGE_PROJECTS_DIR;
      else process.env.FORGE_PROJECTS_DIR = prevEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });
}
