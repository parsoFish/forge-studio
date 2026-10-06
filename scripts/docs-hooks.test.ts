/**
 * Hooks B (docs-budget), C (line-cap) and D (docs-impact), docs refactor W7,
 * plus the covers: map they share (scripts/docs-covers.mjs). Each test names
 * the wrong implementation it kills.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- plain .mjs modules
import { decide as budget } from './hooks/docs-budget.mjs';
// @ts-ignore
import { decide as lineCap } from './hooks/line-cap.mjs';
// @ts-ignore
import { decide as impact, sessionChanges, lastAssistantText } from './hooks/docs-impact.mjs';
// @ts-ignore
import { parseCovers, pagesCovering, readCoversMap } from './docs-covers.mjs';

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), 'hooks');
const P = '/proj';
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const guide = (n: number) => `---\ntitle: G\n---\n${words(n)}\n`;

function tmp() {
  return mkdtempSync(join(tmpdir(), 'docs-hooks-'));
}
function runHook(script: string, input: unknown, env: Record<string, string> = {}) {
  return spawnSync('node', [join(HOOKS, script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env } });
}

// ── B: docs-budget ───────────────────────────────────────────────────────────
test('B: a guide over its 1000-word ceiling blocks and names the overage', () => {
  // kills: a hook that never blocks, or reports the count without the ceiling
  const r = budget({ toolName: 'Edit', filePath: `${P}/apps/docs/src/content/docs/guides/x.md`, projectDir: P, readFile: () => guide(1010) });
  assert.equal(r.block, true);
  assert.match(r.message, /1010 prose words, ceiling 1000 for a guide page — 10 over/);
  assert.match(r.message, /Never raise a ceiling/);
});

test('B: a page at its ceiling passes; a non-site path is never read', () => {
  // kills: an off-by-one at the ceiling, and judging files outside the site
  assert.equal(budget({ toolName: 'Write', filePath: `${P}/apps/docs/src/content/docs/guides/x.md`, projectDir: P, readFile: () => guide(1000) }).block, false);
  const unread = () => { throw new Error('read a non-site file'); };
  assert.equal(budget({ toolName: 'Edit', filePath: `${P}/README.md`, projectDir: P, readFile: unread }).block, false);
  assert.equal(budget({ toolName: 'Read', filePath: `${P}/apps/docs/src/content/docs/guides/x.md`, projectDir: P, readFile: unread }).block, false);
});

test('B: the ceiling follows the page type (how-to 800, landing 600)', () => {
  // kills: one ceiling for every page
  const howto = '---\ntitle: H\ntype: how-to\n---\n' + words(801);
  assert.equal(budget({ toolName: 'Edit', filePath: `${P}/apps/docs/src/content/docs/a.md`, projectDir: P, readFile: () => howto }).block, true);
  assert.equal(budget({ toolName: 'Edit', filePath: `${P}/apps/docs/src/content/docs/index.mdx`, projectDir: P, readFile: () => guide(601) }).block, true);
});

test('B (door): the script exits 2 with the message on stderr for an over-budget page, 0 under it', () => {
  // kills: a decide() that is right but a main() that exits 0 or writes to stdout
  const root = tmp();
  try {
    const page = join(root, 'apps/docs/src/content/docs/guides/x.md');
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, guide(1200));
    const over = runHook('docs-budget.mjs', { tool_name: 'Edit', tool_input: { file_path: page }, cwd: root });
    assert.equal(over.status, 2);
    assert.match(over.stderr, /200 over/);
    writeFileSync(page, guide(10));
    assert.equal(runHook('docs-budget.mjs', { tool_name: 'Edit', tool_input: { file_path: page }, cwd: root }).status, 0);
    assert.equal(spawnSync('node', [join(HOOKS, 'docs-budget.mjs')], { input: 'not json', encoding: 'utf8' }).status, 2, 'unreadable input fails closed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── C: line-cap ──────────────────────────────────────────────────────────────
test('C: root CLAUDE.md at 151 lines blocks; 150 passes; a nested CLAUDE.md is not judged', () => {
  // kills: a cap off by one, and matching any file named CLAUDE.md
  assert.equal(lineCap({ toolName: 'Edit', filePath: `${P}/CLAUDE.md`, projectDir: P, countLines: () => 150 }).block, false);
  const r = lineCap({ toolName: 'Edit', filePath: `${P}/CLAUDE.md`, projectDir: P, countLines: () => 151 });
  assert.equal(r.block, true);
  assert.match(r.message, /151 lines, cap 150 — 1 over/);
  assert.equal(lineCap({ toolName: 'Edit', filePath: `${P}/apps/CLAUDE.md`, projectDir: P, countLines: () => 999 }).block, false);
});

test('C (door): the script exits 2 on a 151-line CLAUDE.md written to disk', () => {
  // kills: a hook that uses its own line count instead of the CI check's
  const root = tmp();
  try {
    writeFileSync(join(root, 'CLAUDE.md'), 'x\n'.repeat(151));
    const r = runHook('line-cap.mjs', { tool_name: 'Write', tool_input: { file_path: join(root, 'CLAUDE.md') }, cwd: root });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cap 150/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── shared covers map ───────────────────────────────────────────────────────
test('covers: flow lists parse; ** crosses directories, * does not', () => {
  // kills: treating the list as one glob, or * matching across /
  assert.deepEqual(parseCovers('[packages/flows/**, apps/forge/cli.ts]'), ['packages/flows/**', 'apps/forge/cli.ts']);
  assert.throws(() => parseCovers('[a, b'), /malformed/);
  const map = [{ page: 'p.md', globs: ['packages/flows/*.ts'], generated: false }];
  assert.equal(pagesCovering(map, ['packages/flows/a.ts']).length, 1);
  assert.equal(pagesCovering(map, ['packages/flows/sub/a.ts']).length, 0);
});

// ── D: docs-impact ───────────────────────────────────────────────────────────
const MAP = [{ page: 'apps/docs/src/content/docs/reference/cli.md', globs: ['apps/forge/cli.ts'], generated: true }];

test('D: covered code changed, no docs, no marker → blocks naming the page and the path', () => {
  // kills: a hook that never fires
  const r = impact({ stopHookActive: false, changed: ['apps/forge/cli.ts'], lastMessage: 'done', coversMap: MAP });
  assert.equal(r.block, true);
  assert.match(r.reason, /reference\/cli\.md \(generated[^)]*\) covers apps\/forge\/cli\.ts/);
  assert.match(r.reason, /Docs impact: none — <reason>/);
});

test('D: each way out allows the stop — stop_hook_active, a docs edit, the marker, uncovered code', () => {
  // kills: a hook that loops forever, ignores docs edits, or ignores the marker
  const base = { changed: ['apps/forge/cli.ts'], lastMessage: 'done', coversMap: MAP, stopHookActive: false };
  assert.equal(impact({ ...base, stopHookActive: true }).block, false);
  assert.equal(impact({ ...base, changed: [...base.changed, 'apps/docs/src/content/docs/reference/cli.md'] }).block, false);
  assert.equal(impact({ ...base, lastMessage: 'Docs impact: none — internal refactor' }).block, false);
  assert.equal(impact({ ...base, changed: ['scripts/x.mjs'] }).block, false);
});

test('D: the last assistant text is read from a transcript, skipping tool-use rows', () => {
  // kills: reading the last line whatever its type
  const jsonl = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Docs impact: none — x' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
    { type: 'user', message: { content: 'ok' } },
  ].map((r) => JSON.stringify(r)).join('\n');
  assert.equal(lastAssistantText(jsonl), 'Docs impact: none — x');
  assert.equal(lastAssistantText(''), null);
});

test('D (door): a real repo with a covered change and no docs gets the block JSON; stop_hook_active gets nothing', () => {
  // kills: sessionChanges missing untracked/committed-ahead files, and a main() that never prints the decision
  const root = tmp();
  try {
    const g = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    const page = join(root, 'apps/docs/src/content/docs/reference/cli.md');
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, '---\ntitle: CLI\ncovers: [apps/forge/cli.ts]\n---\nbody\n');
    g('add', '.'); g('commit', '-qm', 'base');
    g('branch', 'up'); g('switch', '-qc', 'work'); g('branch', '--set-upstream-to=up');
    mkdirSync(join(root, 'apps/forge'), { recursive: true });
    writeFileSync(join(root, 'apps/forge/cli.ts'), 'x');
    g('add', 'apps/forge/cli.ts'); g('commit', '-qm', 'code');
    assert.deepEqual(sessionChanges(root), ['apps/forge/cli.ts'], 'a commit ahead of upstream counts');
    writeFileSync(join(root, 'new.txt'), 'u');
    assert.deepEqual(sessionChanges(root), ['apps/forge/cli.ts', 'new.txt'], 'an untracked file counts');
    assert.equal(readCoversMap(root).length, 1);
    const transcript = join(root, 't.jsonl');
    writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }) + '\n');
    const r = runHook('docs-impact.mjs', { stop_hook_active: false, cwd: root, transcript_path: transcript });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).decision, 'block');
    const quiet = runHook('docs-impact.mjs', { stop_hook_active: true, cwd: root, transcript_path: transcript });
    assert.equal(quiet.stdout, '');
    const noGit = runHook('docs-impact.mjs', { stop_hook_active: false, cwd: join(root, 'nope'), transcript_path: transcript });
    assert.equal(noGit.status, 1, 'an unreadable repo is a named non-blocking error, never a silent pass');
    assert.match(noGit.stderr, /could not judge docs impact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
