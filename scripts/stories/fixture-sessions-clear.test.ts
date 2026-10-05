/**
 * fixture-sessions-clear.test.ts — a fixture story's own sessions do not
 * outlive the story (forge-8vfn.30.8, T1 1975d).
 *
 * Sessions live under `<root>/_logs/_sessions/<project>/…`, outside the fixture
 * ground, so removing the ground left them behind. A later story's Studio then
 * counted them: in docs-w2w3's recorded sitting S7's `_instructions` session,
 * still `briefing`, made S9 read one active session where it expected none.
 * The fixture teardown now captures and clears the story's own session dirs —
 * `story-<id>/` and its knowledge scaffold `.kb-story-<id>/` — and nothing else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { teardownFixtureGround } from './fixture-ground.mjs';
import { listInstructionsSessions } from '../../packages/sessions/bridge-studio-session-index.ts';

const STAMP = '2026-10-06T00-00-00-000Z';

function plantSession(root: string, project: string, kindDir: string, sid: string, phase: string): string {
  const dir = join(root, '_logs', '_sessions', project, kindDir, sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sid, project, phase, updated_at: '2026-10-06T00:00:00Z' }));
  return dir;
}

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'fixture-sessions-clear-'));
  mkdirSync(join(root, 'projects', 'story-s7'), { recursive: true });
  writeFileSync(join(root, 'projects', 'story-s7', 'README.md'), 'fixture\n');
  return root;
}

test('a non-terminal session planted under story-X is gone after X\'s teardown, and a sibling story counts none of it', () => {
  const root = tree();
  try {
    plantSession(root, 'story-s7', '_instructions', 'sid-briefing', 'briefing');
    plantSession(root, '.kb-story-s7', '_project-brain', 'sid-kb', 'committed');
    const logsRoot = join(root, '_logs');
    assert.equal(listInstructionsSessions(logsRoot).length, 1, 'precondition: the product sees the leftover session');

    const r = teardownFixtureGround(root, { storyId: 'S7', project: 'story-s7', runStamp: STAMP });

    assert.equal(r.removed, true, JSON.stringify(r));
    assert.equal(existsSync(join(logsRoot, '_sessions', 'story-s7')), false, 'story-s7 sessions cleared');
    assert.equal(existsSync(join(logsRoot, '_sessions', '.kb-story-s7')), false, '.kb-story-s7 sessions cleared');
    assert.equal(listInstructionsSessions(logsRoot).length, 0, 'the next story\'s Studio reads 0 sessions');
    const captured = join(logsRoot, '_story-logs-clear', 'S7', STAMP, '_sessions', 'story-s7', '_instructions', 'sid-briefing', 'status.json');
    assert.match(readFileSync(captured, 'utf8'), /briefing/, 'captured before it was removed');
    assert.deepEqual([...r.sessions.cleared].sort(), ['.kb-story-s7', 'story-s7']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('another story\'s sessions and a real project\'s sessions are left alone', () => {
  const root = tree();
  try {
    plantSession(root, 'story-s9', '_authoring', 'sid-other', 'awaiting-review');
    plantSession(root, 'gitpulse', '_architect', 'sid-real', 'committed');
    const r = teardownFixtureGround(root, { storyId: 'S7', project: 'story-s7', runStamp: STAMP });
    assert.equal(r.removed, true);
    assert.equal(existsSync(join(root, '_logs', '_sessions', 'story-s9', '_authoring', 'sid-other')), true);
    assert.equal(existsSync(join(root, '_logs', '_sessions', 'gitpulse', '_architect', 'sid-real')), true);
    assert.deepEqual(r.sessions.cleared, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
