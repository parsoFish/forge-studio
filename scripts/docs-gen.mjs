#!/usr/bin/env node
/**
 * docs-gen.mjs — writes the GENERATED reference pages of the published docs
 * from their sources of truth.
 *
 *   node scripts/docs-gen.mjs            write every page
 *   node scripts/docs-gen.mjs --check    regenerate in memory; exit 1 naming
 *                                        each page that is missing or stale
 *   --root <dir>                         repo root (default: this repo)
 *
 * SOURCES is the table of pages: {out, source, render}. A new generated page is
 * one more entry. render(sourceText, {root, run}) gets the source file's text
 * and `run(args)`, which returns the stdout of the forge CLI at that root. Output is deterministic: it reads nothing time-varying, and
 * key order follows the source.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF_DIR = 'apps/docs/src/content/docs/reference';
const REGEN = 'node scripts/docs-gen.mjs';

// The date every generated page claims as last verified. A constant, not the
// clock or git history, so output never changes between runs or after a
// rebase. Bump it by hand whenever this generator changes.
export const LAST_VERIFIED = '2026-10-06';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s) => '`' + s + '`';

function typeOf(node) {
  const t = node.type;
  if (Array.isArray(t)) return t.join(' or ');
  if (t === 'array') {
    const it = node.items ?? {};
    return `array of ${Array.isArray(it.type) ? it.type.join(' or ') : (it.type ?? 'any')}`;
  }
  return t ?? 'any';
}

/** The object schema a property describes, if any: itself or its array items. */
function objectOf(node) {
  if (node.type === 'object') return { obj: node, suffix: '' };
  if (node.type === 'array' && node.items?.type === 'object') return { obj: node.items, suffix: '[]' };
  return null;
}

function example(node) {
  if (node.enum) return node.enum[0];
  const t = Array.isArray(node.type) ? node.type[0] : node.type;
  if (t === 'object') {
    const out = {};
    for (const k of node.required ?? []) out[k] = example(node.properties[k]);
    return out;
  }
  if (t === 'array') {
    return node.items?.type === 'object' ? [example(node.items)] : ['text'];
  }
  if (t === 'integer' || t === 'number') return 1;
  if (t === 'boolean') return true;
  return 'text';
}

/** Every object level, depth first in schema order: [{path, obj}]. */
function levels(obj, path = '') {
  const out = [{ path, obj }];
  for (const [name, node] of Object.entries(obj.properties ?? {})) {
    const o = objectOf(node);
    if (o) out.push(...levels(o.obj, (path ? path + '.' : '') + name + o.suffix));
  }
  return out;
}

function table(obj) {
  const req = new Set(obj.required ?? []);
  const rows = Object.entries(obj.properties ?? {}).map(([name, node]) =>
    `| ${code(name)} | ${cell(typeOf(node))} | ${req.has(name) ? 'yes' : 'no'} | ${
      node.default !== undefined ? code(JSON.stringify(node.default)) : '-'
    } | ${cell(node.description)} |`);
  return ['| Name | Type | Required | Default | Description |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

function valueLimits(node, label, lines) {
  if (node.enum) lines.push(`- ${label} is one of ${node.enum.map(code).join(', ')}.`);
  if (node.not?.enum) lines.push(`- ${label} is none of ${node.not.enum.map(code).join(', ')}.`);
  if (node.pattern === '\\S') lines.push(`- ${label} is not blank.`);
  else if (node.pattern) lines.push(`- ${label} matches ${code(node.pattern)}.`);
  if (node.minLength === 1 && node.pattern !== '\\S') lines.push(`- ${label} is not empty.`);
  else if (node.minLength > 1) lines.push(`- ${label} is at least ${node.minLength} characters.`);
  if (node.exclusiveMinimum !== undefined) lines.push(`- ${label} must be greater than ${node.exclusiveMinimum}.`);
  if (node.maxLength !== undefined) lines.push(`- ${label} is at most ${node.maxLength} characters.`);
}

function limits(schema) {
  const lines = [];
  const walk = (obj, path) => {
    const at = path ? code(path) : 'The top level';
    if (obj.required?.length) lines.push(`- ${at} requires ${obj.required.map(code).join(', ')}.`);
    if (obj.additionalProperties === false) lines.push(`- ${at} rejects unknown keys.`);
    else if (obj.additionalProperties === true) lines.push(`- ${at} allows unknown keys.`);
    if (obj.not?.required) lines.push(`- ${at} refuses the key ${obj.not.required.map(code).join(', ')}.`);
    for (const [name, node] of Object.entries(obj.properties ?? {})) {
      const p = (path ? path + '.' : '') + name;
      valueLimits(node, code(p), lines);
      if (node.type === 'array' && node.items && node.items.type !== 'object') valueLimits(node.items, `Each entry of ${code(p)}`, lines);
      const o = objectOf(node);
      if (o) walk(o.obj, p + o.suffix);
    }
  };
  walk(schema, '');
  return lines.join('\n');
}

/** Render the page for a project.json schema. */
export function renderProjectJson(schema) {
  const [rootLevel, ...nested] = levels(schema);
  const parts = [
    [
      '---',
      'title: project.json',
      "description: Fields of a project's .forge/project.json file.",
      'type: reference',
      'owner: parsoFish',
      `last_verified: ${LAST_VERIFIED}`,
      'covers: [docs/schemas/project-config.schema.json, packages/projects/project-config.ts]',
      'generated_from: docs/schemas/project-config.schema.json',
      '---',
      `<!-- Generated by ${REGEN} from docs/schemas/project-config.schema.json. Do not edit; change the schema and run it again. -->`,
    ].join('\n'),
    schema.description,
    '## Shape\n\n```json\n' + JSON.stringify(example(schema), null, 2) + '\n```',
    '## Fields\n\n' + [table(rootLevel.obj), ...nested.map((l) => `### ${l.path}\n\n${table(l.obj)}`)].join('\n\n'),
  ];
  const examples = schema.examples;
  if (Array.isArray(examples) && examples.length) {
    parts.push('## Examples\n\n' + examples.map((e) => '```json\n' + JSON.stringify(e, null, 2) + '\n```').join('\n\n'));
  }
  parts.push('## Limits\n\n' + limits(schema));
  return parts.join('\n\n') + '\n';
}

const CLI_ENV = Object.freeze({ ANTHROPIC_API_KEY: 'docs-gen', FORCE_COLOR: '0', NO_COLOR: '1' });

/** Stdout of `forge <args>` run from the CLI at `root`, with a fixed env. */
export function runCli(root, args) {
  return execFileSync(process.execPath, ['--experimental-strip-types', 'apps/forge/cli.ts', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...CLI_ENV },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** CLI commands documented on the page: heading and the args that print their help. */
const CLI_COMMANDS = [
  { heading: 'forge', args: ['--help'] },
  { heading: 'forge studio', args: ['studio', '--help'] },
];

/** Render the CLI page from the help text `run` returns. */
export function renderCli(run) {
  const sections = CLI_COMMANDS.map(
    (c) => `## ${c.heading}\n\n\`\`\`text\n${run(c.args).replace(/\s+$/, '')}\n\`\`\``,
  );
  return [
    [
      '---',
      'title: forge CLI',
      'description: Commands and flags of the forge command line.',
      'type: reference',
      'owner: parsoFish',
      `last_verified: ${LAST_VERIFIED}`,
      'covers: [apps/forge/cli.ts]',
      'generated_from: apps/forge/cli.ts',
      '---',
      `<!-- Generated by ${REGEN} from the help text of apps/forge/cli.ts. Do not edit; change the help text and run it again. -->`,
    ].join('\n'),
    'The help output of the `forge` command and of `forge studio`.',
    ...sections,
  ].join('\n\n') + '\n';
}

/** The generated pages: output path, source path, render function. */
export const SOURCES = [
  {
    out: `${REF_DIR}/project-json.md`,
    source: 'docs/schemas/project-config.schema.json',
    render: (text) => renderProjectJson(JSON.parse(text)),
  },
  {
    out: `${REF_DIR}/cli.md`,
    source: 'apps/forge/cli.ts',
    render: (_text, ctx) => renderCli(ctx.run),
  },
];

/** Regenerate every page in memory: Map of output path to content. */
export function generate(root = REPO, { run = (args) => runCli(root, args) } = {}) {
  const out = new Map();
  for (const s of SOURCES) out.set(s.out, s.render(readFileSync(join(root, s.source), 'utf8'), { root, run }));
  return out;
}

/** Output paths whose committed content is missing or differs. */
export function stalePages(root = REPO, opts) {
  const stale = [];
  for (const [out, content] of generate(root, opts)) {
    const file = join(root, out);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) stale.push(out);
  }
  return stale;
}

function main(argv) {
  let root = REPO;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--root' && argv[i + 1] !== undefined) root = resolve(argv[++i]);
    else {
      console.error(`docs-gen: unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  if (check) {
    const stale = stalePages(root);
    if (stale.length === 0) return;
    for (const f of stale) console.error(`docs-gen: stale or missing: ${f}`);
    console.error(`docs-gen: run \`${REGEN}\` and commit the result`);
    process.exit(1);
  }
  for (const [out, content] of generate(root)) {
    const file = join(root, out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    console.log(`docs-gen: wrote ${out}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
