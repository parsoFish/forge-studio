/**
 * Bead forge-8vfn.6.10.19 — the architect turn runs ON THE GROUND.
 *
 * `runStructuredTurn` passed no `cwd`, so the SDK session inherited the
 * BRIDGE's cwd — the forge repo root — and any relative write by that session
 * would land in forge's own tree. M5-B ruled this out as 6.12's writer by
 * execution (a session at exactly that cwd wrote nothing forge-wide), which
 * makes it a real open door rather than a live leak, and a door is closed by
 * naming the property, not by snapshotting it: the golden in
 * `tests/regression/interactive-runners-golden.test.ts` also records the `cwd`
 * now, but a golden can be regenerated. This test states what the value must BE.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import { runArchitectTurn } from './architect.ts';
import type { QueryFn } from '../interactive-session.ts';

const SESSION_ID = '2026-09-06T00-00-00-groundcwd';

test('kills "the architect inherits the bridge\'s cwd": options.cwd IS the project ground, not the forge root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'architect-ground-cwd-'));
  try {
    const projectRoot = join(root, 'projects', 'project');
    mkdirSync(join(projectRoot, '_architect', SESSION_ID), { recursive: true });
    const skillPromptPath = join(root, 'skill.md');
    writeFileSync(skillPromptPath, [
      'Ground-cwd fixture.',
      '',
      '<!-- turn: interview -->',
      'FIXTURE architect INTERVIEW turn.',
      '',
      '<!-- turn: explore -->',
      'FIXTURE architect EXPLORE turn.',
      '',
      '<!-- turn: draft -->',
      'FIXTURE architect DRAFT turn.',
      '',
      '<!-- turn: draft-force-emit -->',
      'FIXTURE architect FORCE-EMIT turn.',
    ].join('\n'));
    writeFileSync(
      join(projectRoot, '_architect', SESSION_ID, 'status.json'),
      JSON.stringify({
        session_id: SESSION_ID,
        project: 'testproj',
        project_repo_path: projectRoot,
        phase: 'interviewing',
        round: 1,
        idea: 'Add a dark-mode toggle.',
        updated_at: new Date(0).toISOString(),
      }),
    );

    let cwdSeen: unknown = '<never spawned>';
    const queryFn: QueryFn = ({ options }) => {
      cwdSeen = (options as { cwd?: unknown }).cwd;
      async function* gen(): AsyncGenerator<unknown> {
        yield {
          type: 'result', subtype: 'success', total_cost_usd: 0.01,
          structured_output: {
            done: false,
            questions: [{
              question: 'Should the toggle follow the OS setting?',
              header: 'OS sync',
              options: [
                { label: 'Follow OS', description: 'Match the system theme.' },
                { label: 'Manual only', description: 'Operator toggles it.' },
              ],
            }],
          },
        };
      }
      return gen();
    };

    await runArchitectTurn({
      sessionId: SESSION_ID,
      projectRoot,
      queryFn,
      logsRoot: join(root, '_logs'),
      logger: createLogger(`_architect-${SESSION_ID}`, join(root, '_logs')),
      skillPromptPath,
      brainCwd: root,
    });

    assert.equal(cwdSeen, projectRoot, 'the SDK must be told the ground; inheriting the caller\'s cwd is how a relative write reaches forge\'s tree');
    assert.notEqual(cwdSeen, process.cwd(), 'and it must not be whatever directory the bridge happened to start in');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
