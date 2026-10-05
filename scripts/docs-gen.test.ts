import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProjectConfig } from '../packages/projects/project-config.ts';
// @ts-ignore -- plain .mjs module
import { SOURCES, renderProjectJson, renderCli, generate, stalePages, runCli } from './docs-gen.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'docs-gen.mjs');
const PAGE = 'apps/docs/src/content/docs/reference/project-json.md';
const SCHEMA = 'docs/schemas/project-config.schema.json';

const FIXTURE = {
  title: 'Demo',
  description: 'Top level.',
  type: 'object',
  required: ['gate'],
  additionalProperties: true,
  properties: {
    gate: {
      type: 'object',
      description: 'The gate.',
      required: ['cmd'],
      additionalProperties: false,
      properties: {
        cmd: { type: 'array', items: { type: 'string' }, description: 'Argv command.' },
        timeoutMs: { type: 'integer', exclusiveMinimum: 0, description: 'Timeout.' },
        mode: { type: 'string', enum: ['fast', 'full'], description: 'Run mode.' },
      },
    },
    repo: { type: 'string', pattern: '^[a-z]+/[a-z]+$', description: 'Owner and name.' },
    steps: {
      type: 'array',
      description: 'Steps.',
      items: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: { text: { type: 'string', description: 'Step text.' } },
      },
    },
    kb: { type: ['string', 'null'], description: 'Knowledge base id.' },
  },
};

const cliSource = (word: string) =>
  `console.log(process.argv.slice(2).join(' ') === '--help' ? 'top ${word}' : 'studio ${word}');\n`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docs-gen-'));
  mkdirSync(join(dir, 'docs/schemas'), { recursive: true });
  mkdirSync(join(dir, 'apps/docs/src/content/docs/reference'), { recursive: true });
  writeFileSync(join(dir, SCHEMA), JSON.stringify(FIXTURE, null, 2) + '\n');
  mkdirSync(join(dir, 'apps/forge'), { recursive: true });
  writeFileSync(join(dir, 'apps/forge/cli.ts'), cliSource('one'));
  return dir;
}
const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

test('the source table names the config page', () => {
  const s = SOURCES.find((x: { out: string }) => x.out === PAGE);
  assert.ok(s);
  assert.equal(s.source, SCHEMA);
  assert.equal(typeof s.render, 'function');
});

test('page carries the contract frontmatter, header and sections', () => {
  const md: string = renderProjectJson(FIXTURE);
  assert.match(md, /^---\ntitle: .+\ndescription: .+\ntype: reference\nowner: parsoFish\nlast_verified: \d{4}-\d{2}-\d{2}\n/);
  assert.match(md, /covers: \[docs\/schemas\/project-config\.schema\.json, packages\/projects\/project-config\.ts\]/);
  assert.match(md, /generated_from: docs\/schemas\/project-config\.schema\.json\n---\n/);
  assert.match(md, /---\n<!-- .*node scripts\/docs-gen\.mjs.* -->\n/);
  const heads = md.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, ['## Shape', '## Fields', '## Limits']);
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('shape is built from required fields only', () => {
  const md: string = renderProjectJson(FIXTURE);
  const shape = md.split('## Shape')[1].split('## Fields')[0];
  assert.match(shape, /"gate"/);
  assert.match(shape, /"cmd"/);
  assert.doesNotMatch(shape, /timeoutMs|repo/);
});

test('one table per object level with dotted headings, in schema order', () => {
  const md: string = renderProjectJson(FIXTURE);
  assert.match(md, /\| Name \| Type \| Required \| Default \| Description \|/);
  assert.match(md, /### gate\n/);
  assert.match(md, /### steps\[\]\n/);
  const f = md.split('## Fields')[1];
  assert.ok(f.indexOf('`gate`') < f.indexOf('`repo`') && f.indexOf('`repo`') < f.indexOf('`kb`'));
  assert.match(md, /\| `kb` \| string or null \| no \|/);
  assert.match(md, /\| `cmd` \| array of string \| yes \|/);
});

test('limits list required fields, additionalProperties, enums, patterns', () => {
  const lim = (renderProjectJson(FIXTURE) as string).split('## Limits')[1];
  assert.match(lim, /`gate`/);
  assert.match(lim, /`fast`, `full`/);
  assert.match(lim, /\^\[a-z\]\+\/\[a-z\]\+\$/);
  assert.match(lim, /greater than 0/);
  assert.match(lim, /unknown keys/i);
});

test('rendering is deterministic', () => {
  assert.equal(renderProjectJson(FIXTURE), renderProjectJson(structuredClone(FIXTURE)));
});

test('generate maps output path to content without writing', () => {
  const dir = makeFixture();
  try {
    const out = generate(dir) as Map<string, string>;
    assert.ok(out.get(PAGE)?.includes('title:'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('write then --check passes; edits and missing pages fail naming the file', () => {
  const dir = makeFixture();
  try {
    assert.equal(run(['--root', dir, '--check']).status, 1, 'missing page is stale');
    assert.equal(run(['--root', dir]).status, 0);
    assert.equal(run(['--root', dir, '--check']).status, 0);
    const page = join(dir, PAGE);
    writeFileSync(page, readFileSync(page, 'utf8') + 'hand edit\n');
    const r = run(['--root', dir, '--check']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /project-json\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the committed page matches the committed schema', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const r = run(['--root', repo, '--check']);
  assert.equal(r.status, 0, r.stderr);
});

test('the generated Shape example is a config the validator accepts', () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const md = readFileSync(join(repo, PAGE), 'utf8');
  const m = md.match(/## Shape\n\n```json\n([\s\S]*?)\n```/);
  assert.ok(m, 'Shape block present');
  const cfg = validateProjectConfig(JSON.parse(m[1]));
  assert.ok(cfg.testProcess.local.cmd.length > 0);
});

test('limits state the refused key and the blocked env names', () => {
  const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', PAGE), 'utf8');
  assert.match(md, /`testProcess\.acceptance` refuses the key `required`/);
  assert.match(md, /`PATH`, `HOME`, `SHELL`/);
});

const CLI_PAGE = 'apps/docs/src/content/docs/reference/cli.md';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const cliRoot = (_word: string) => makeFixture();

test('the CLI page is a source entry that names cli.ts', () => {
  const s = SOURCES.find((x: { out: string }) => x.out === CLI_PAGE);
  assert.equal(s?.source, 'apps/forge/cli.ts');
});

test('the CLI page holds each help block verbatim under its command heading', () => {
  const md: string = renderCli((args: string[]) => (args[0] === '--help' ? 'TOP HELP\n' : 'STUDIO HELP\n'));
  assert.match(md, /covers: \[apps\/forge\/cli\.ts\]\ngenerated_from: apps\/forge\/cli\.ts\n---\n<!-- .*node scripts\/docs-gen\.mjs/);
  assert.match(md, /## forge\n\n```text\nTOP HELP\n```/);
  assert.match(md, /## forge studio\n\n```text\nSTUDIO HELP\n```/);
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('the committed CLI page matches the current help output', () => {
  const committed = readFileSync(join(REPO_ROOT, CLI_PAGE), 'utf8');
  assert.equal(committed, renderCli((args: string[]) => runCli(REPO_ROOT, args)));
});

test('the help text carries no retired narration', () => {
  const help: string = runCli(REPO_ROOT, ['--help']) + runCli(REPO_ROOT, ['studio', '--help']);
  assert.doesNotMatch(help, /DEC-\d|S9|example-factory|take over any previous/);
});

test('changing the help text makes --check exit 1', () => {
  const dir = cliRoot('one');
  try {
    assert.equal(run(['--root', dir]).status, 0);
    assert.equal(run(['--root', dir, '--check']).status, 0);
    writeFileSync(
      join(dir, 'apps/forge/cli.ts'),
      readFileSync(join(dir, 'apps/forge/cli.ts'), 'utf8').replaceAll('one', 'two'),
    );
    const r = run(['--root', dir, '--check']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /reference\/cli\.md/);
    assert.doesNotMatch(r.stderr, /project-json\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an injected help runner is what --check compares against', () => {
  const dir = cliRoot('one');
  try {
    run(['--root', dir]);
    assert.deepEqual(stalePages(dir, { run: () => 'other\n' }), [CLI_PAGE]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
