import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- plain .mjs module
import { decide } from './hooks/guard-paths.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'hooks', 'guard-paths.mjs');
const P = '/proj';
const GEN = '---\ntitle: S5\ngenerated_from: tests/stories/S5.story.mjs\n---\nbody\n';
const run = (toolName: string, filePath: string, content: string | null = null) =>
  decide({ toolName, filePath, projectDir: P, readFile: () => content });

test('generated how-to page blocks and names story + command', () => {
  // kills: allowing hand edits to generated pages
  const r = run('Edit', `${P}/docs/how-to/S5.md`, GEN);
  assert.equal(r.block, true);
  assert.match(r.message!, /tests\/stories\/S5\.story\.mjs/);
  assert.match(r.message!, /--story S5/);
});

test('hand-written tutorial without generated_from is allowed', () => {
  // kills: matching on path alone, which would block hand-written tutorials
  assert.equal(run('Edit', `${P}/docs/tutorials/getting-started.md`, '---\ntitle: x\n---\nhi').block, false);
});

test('generated_from outside frontmatter does not block', () => {
  // kills: grepping the whole body instead of the frontmatter
  assert.equal(run('Edit', `${P}/docs/how-to/a.md`, '---\ntitle: x\n---\ngenerated_from: foo.story.mjs\n').block, false);
});

test('new file under docs/how-to is allowed', () => {
  // kills: treating a missing file as generated
  assert.equal(run('Write', `${P}/docs/how-to/new.md`, null).block, false);
});

test('nested generated page blocks', () => {
  // kills: only checking the top level of docs/how-to
  assert.equal(run('Edit', `${P}/docs/how-to/sub/deep/S1.md`, GEN).block, true);
});

test('future generated how-to home blocks regardless of content', () => {
  // kills: requiring frontmatter for the starlight path
  const r = run('Write', `${P}/apps/docs/src/content/docs/guides/how-to/x.md`, null);
  assert.equal(r.block, true);
  assert.match(r.message!, /generated how-to/);
});

test('retired top-level dirs block', () => {
  // kills: ignoring the retired segment list
  for (const f of ['orchestrator/foo.ts', 'cli/x.ts', 'forge-ui/a.tsx', 'loops/y.ts']) {
    const r = run('Write', `${P}/${f}`);
    assert.equal(r.block, true, f);
    assert.match(r.message!, /was retired/);
  }
});

test('segment merely containing a retired word is allowed', () => {
  // kills: substring matching instead of first-segment equality
  assert.equal(run('Edit', `${P}/packages/orchestration/x.ts`).block, false);
  assert.equal(run('Edit', `${P}/docs/cli.md`).block, false);
  assert.equal(run('Edit', `${P}/packages/orchestrator/x.ts`).block, false);
});

test('path outside project, other tools allowed; relative resolves', () => {
  // kills: blocking outside the project; guarding Read; not resolving relative paths
  assert.equal(run('Edit', '/elsewhere/orchestrator/x.ts').block, false);
  assert.equal(run('Edit', `${P}/../proj2/orchestrator/x.ts`).block, false);
  assert.equal(run('Read', `${P}/orchestrator/x.ts`).block, false);
  assert.equal(run('Edit', 'orchestrator/x.ts').block, true);
});

function cli(input: string, files: Record<string, string> = {}, env: Record<string, string> = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'guard-'));
  try {
    for (const [k, v] of Object.entries(files)) {
      mkdirSync(dirname(join(tmp, k)), { recursive: true });
      writeFileSync(join(tmp, k), v);
    }
    return spawnSync(process.execPath, [SCRIPT], {
      input: input.replaceAll('$TMP', tmp),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, ...env },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('CLI blocks generated page with exit 2 and stderr message', () => {
  // kills: exit 1 or stdout-only reporting
  const r = cli('{"tool_name":"Edit","tool_input":{"file_path":"$TMP/docs/how-to/S5.md"}}', { 'docs/how-to/S5.md': GEN });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--story S5/);
});

test('CLI allows hand-written page silently', () => {
  // kills: noisy or non-zero allow
  const r = cli('{"tool_name":"Edit","tool_input":{"file_path":"$TMP/docs/tutorials/g.md"}}', { 'docs/tutorials/g.md': 'hi' });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '');
});

test('CLI honours notebook_path', () => {
  // kills: reading only file_path
  const r = cli('{"tool_name":"NotebookEdit","tool_input":{"notebook_path":"$TMP/cli/n.ipynb"}}');
  assert.equal(r.status, 2);
});

test('CLI fails closed on malformed JSON and missing path', () => {
  // kills: failing open on unreadable input
  const a = cli('not json');
  assert.equal(a.status, 2);
  assert.match(a.stderr, /unreadable hook input/);
  const b = cli('{"tool_name":"Edit","tool_input":{}}');
  assert.equal(b.status, 2);
  assert.match(b.stderr, /unreadable hook input/);
});

test('CLI falls back to cwd when env unset, blocks when neither', () => {
  // kills: ignoring cwd fallback; failing open with no project dir
  const a = cli('{"tool_name":"Edit","cwd":"$TMP","tool_input":{"file_path":"$TMP/cli/x.ts"}}', {}, { CLAUDE_PROJECT_DIR: '' });
  assert.equal(a.status, 2);
  assert.match(a.stderr, /was retired/);
  const b = cli('{"tool_name":"Edit","tool_input":{"file_path":"/x/cli/x.ts"}}', {}, { CLAUDE_PROJECT_DIR: '' });
  assert.equal(b.status, 2);
  assert.match(b.stderr, /unreadable hook input/);
});

test('CLI ignores non-guarded tools even with no path', () => {
  // kills: failing closed on tools we do not guard
  assert.equal(cli('{"tool_name":"Read","tool_input":{}}').status, 0);
});
