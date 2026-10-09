/**
 * forge-mfv5.1.20 — repo-status says everything a Save would act on.
 *
 * Fixture = the gitweave capstone's live state on 2026-10-09: forge-studio 4 commits
 * ahead of main, plus uncommitted `.gitignore` (scratch lines), `roadmap.md`, the old
 * in-ground `brain/` stub and `.forge/contract-compliance-report.json`. The project
 * page reads this route to enable Save and show the adopt list; only the CONTRACT
 * files are adopt candidates (the report and the stub are not contract).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { handleProjectRepoStatus } from '../../project-preflight-read.ts';

function g(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

async function repoStatus(forgeRoot: string, id: string): Promise<{ status: number | null; body: Record<string, unknown> }> {
  let status: number | null = null;
  let payload = '';
  const res = {
    writeHead(s: number) { status = s; return res; },
    end(p?: string) { if (p !== undefined) payload = p; return res; },
  } as unknown as ServerResponse;
  await handleProjectRepoStatus({ headers: {} } as IncomingMessage, res, { forgeRoot, logsRoot: join(forgeRoot, '_logs') }, `/api/studio/projects/${id}/repo-status`, 'GET');
  return { status, body: JSON.parse(payload) as Record<string, unknown> };
}

function ground(): { forgeRoot: string; dir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'repo-status-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  const dir = join(forgeRoot, 'projects', 'weave');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  g(dir, ['config', 'user.email', 't@forge.dev']);
  g(dir, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ name: 'weave', testProcess: { local: { cmd: ['pytest', '-q'] } } }));
  g(dir, ['add', '.gitignore', '.forge/project.json']);
  g(dir, ['commit', '-q', '-m', 'init']);
  return { forgeRoot, dir };
}

test('the capstone state: pending forge-studio commits AND the uncommitted contract files, nothing else', async () => {
  const { forgeRoot, dir } = ground();
  try {
    g(dir, ['checkout', '-q', '-b', 'forge-studio']);
    for (const f of ['AGENTS.md', '.forge/demo-a', '.forge/demo-b', '.forge/demo-c']) {
      writeFileSync(join(dir, f), `${f}\n`);
      g(dir, ['add', f]);
      g(dir, ['commit', '-q', '-m', f]);
    }
    appendFileSync(join(dir, '.gitignore'), '.forge/work-items/\n');
    writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
    mkdirSync(join(dir, 'brain'));
    writeFileSync(join(dir, 'brain', 'profile.md'), '# stub\n');
    writeFileSync(join(dir, '.forge', 'contract-compliance-report.json'), '{}\n');

    const r = await repoStatus(forgeRoot, 'weave');
    assert.equal(r.status, 200);
    assert.equal(r.body.pending, true);
    assert.equal(r.body.branch, 'forge-studio');
    assert.deepEqual(r.body.uncommitted, ['.gitignore', 'roadmap.md']);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a clean ground reports nothing to save', async () => {
  const { forgeRoot } = ground();
  try {
    const r = await repoStatus(forgeRoot, 'weave');
    assert.equal(r.body.pending, false);
    assert.deepEqual(r.body.uncommitted, []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
