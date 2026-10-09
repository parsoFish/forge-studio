/**
 * A planted project for the claim gate's tests: the preflight-passing ground
 * (C1 quality gate, C2 scratch hygiene, C4 roadmap + central brain) plus the
 * Face-A definition Studio reads off the roster (`.forge/project.json` +
 * `AGENTS.md`). Layout is `<forgeRoot>/projects/<name>`, as the roster expects.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { SCRATCH_PATHS } from '@forge/projects';

/** The Face-A fields; each defaults to the Studio-ready value. */
export type DefinitionOverrides = {
  northStar?: string;
  /** `null` plants no AGENTS.md and no project.json `instructions`. */
  instructions?: string | null;
  demoProcess?: Array<{ kind: string; text: string }>;
  skills?: string[];
  /** `null` plants no `kb` key. */
  kb?: string | null;
  /** The declared local gate command (`testProcess.local.cmd`); defaults to a node script. */
  gateCmd?: string[];
};

export function plantPreflightPassingGround(dir: string): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test-project', scripts: { test: 'node test.mjs' } }));
  writeFileSync(join(dir, '.gitignore'), SCRATCH_PATHS.join('\n') + '\n');
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
  // Brain 3 is forge-owned + CENTRAL (SPEC §4): <forgeRoot>/brain/projects/<name>/.
  const centralBrain = join(dir, '..', '..', 'brain', 'projects', basename(dir));
  mkdirSync(centralBrain, { recursive: true });
  writeFileSync(join(centralBrain, 'profile.md'), '# Profile\n');
}

export function plantDefinition(dir: string, o: DefinitionOverrides = {}): void {
  const instructions = o.instructions === undefined ? 'Read the roadmap, then build.' : o.instructions;
  const kb = o.kb === undefined ? 'test-kb' : o.kb;
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({
      name: basename(dir),
      testProcess: { local: { cmd: o.gateCmd ?? ['node', 'test.mjs'] } },
      northStar: o.northStar ?? 'A tool that reports how long each build stage took.',
      demoProcess: o.demoProcess ?? [
        { kind: 'capture', text: 'node demo.mjs' },
        { kind: 'verify', text: 'node verify.mjs' },
      ],
      skills: o.skills ?? ['some-skill'],
      ...(kb === null ? {} : { kb }),
    }),
  );
  // A declared skill must RESOLVE (preflight SKILLS, hard): plant each project-locally.
  for (const id of o.skills ?? ['some-skill']) {
    mkdirSync(join(dir, '.forge', 'skills', id), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', id, 'SKILL.md'), `# ${id}\n`);
  }
  if (instructions !== null) writeFileSync(join(dir, 'AGENTS.md'), instructions + '\n');
}

/** Preflight-passing ground AND a Studio-ready definition. */
export function plantStudioReadyProject(dir: string, o: DefinitionOverrides = {}): void {
  plantPreflightPassingGround(dir);
  plantDefinition(dir, o);
}
