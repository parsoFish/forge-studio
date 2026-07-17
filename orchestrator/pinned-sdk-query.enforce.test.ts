/**
 * G8 (2026-07 refinement) enforcement lock for the env-pin seam.
 *
 * Every SDK child spawn must route through `pinnedSdkQuery`
 * (orchestrator/pinned-sdk-query.ts) so `buildChildEnv` (orchestrator/spawn-env.ts)
 * always allowlist-filters the ambient env (stripping ANTHROPIC_BASE_URL,
 * ANTHROPIC_CUSTOM_HEADERS, CLAUDE_EFFORT, HEADROOM_*, and anything else not
 * explicitly allowlisted) before a spawned child ever sees it.
 *
 * Rule enforced on every .ts/.tsx/.mts/.cts source file under orchestrator/,
 * loops/, and cli/ (except the wrapper itself): ANY reference to the SDK
 * module specifier is a violation UNLESS it is
 *   (a) a whole-statement type import/re-export
 *       (`import type {...} from`, `export type {...} from`), or
 *   (b) a named import / named re-export whose specifiers are all
 *       type-prefixed or do not bind the `query` value.
 * Everything else is flagged, including the four verified bypass classes of
 * the earlier, narrower detector:
 *   1. re-exports  — `export { query } from` and `export * from` (the
 *      two-hop bypass: a downstream file importing `query` from the
 *      re-exporting file never mentions the SDK specifier itself, so the
 *      re-exporting side is where the lock must bite);
 *   2. namespace imports — `import * as x from` (banned outright, `type` or
 *      not: `x.query` escapes any specifier-level check);
 *   3. dynamic imports — `import('...')` (banned outright);
 *   4. CJS — `require('...')` (banned outright);
 * plus default/side-effect import forms and, as a catch-all, any leftover
 * occurrence of the specifier the patterns above don't recognize (e.g. the
 * bare string literal later handed to a loader).
 *
 * Comments are stripped before analysis, so prose mentions of the package
 * (doc comments, TODOs) never flag. This detector file itself never spells
 * the specifier literally — `SDK` below is assembled by joining fragments —
 * so the file is scanned like any other and stays clean, while a real
 * import added to it WOULD be caught.
 *
 * Known limitation (accepted for a structural lint): the comment stripper
 * does not model regex literals, so a pathological regex containing an
 * unescaped quote or comment-opener could confuse it; and a specifier built
 * by string concatenation escapes any static detector.
 *
 * Mirrors the frontmatter-regression-lock style of
 * orchestrator/studio/derive.test.ts (walk the tree, assert an explicit
 * invariant, guard against a vacuous pass with a "checked > 0" count).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** The one file allowed to hold a value import of the SDK's `query`. */
const WRAPPER_RELATIVE_PATH = 'orchestrator/pinned-sdk-query.ts';

/** Directories scanned for the SDK-reference invariant. */
const SCANNED_DIRS = ['orchestrator', 'loops', 'cli'];

/**
 * The SDK module specifier, assembled so this file's own source never
 * contains it literally (see the header comment).
 */
const SDK = ['@anthropic-ai', 'claude-agent-sdk'].join('/');

/** `SDK` escaped for embedding in RegExp source. */
const SDK_RE = SDK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SOURCE_FILE_RE = /\.(ts|tsx|mts|cts)$/;
const DECLARATION_FILE_RE = /\.d\.(ts|mts|cts)$/;

/**
 * Recursively collect every scannable source file under `dir`, walking with
 * Node's built-in recursive `readdirSync` (Node >=20.1; this repo's
 * `engines.node` floor is >=20).
 */
function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && SOURCE_FILE_RE.test(e.name) && !DECLARATION_FILE_RE.test(e.name))
    .map((e) => join((e as unknown as { parentPath: string }).parentPath, e.name));
}

/**
 * Remove line comments and block comments while preserving string /
 * template-literal contents and line structure. Minimal state machine —
 * deliberately does not model regex literals (see header limitation).
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block'; i += 2; continue; }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
      out += ch;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += ch; }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 2; continue; }
      if (ch === '\n') out += ch; // preserve line structure for snippets
      i += 1;
      continue;
    }
    // string states: single | double | template
    if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'template' && ch === '`')
    ) {
      state = 'code';
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * True if a named import/export specifier list (the text between the braces)
 * binds the VALUE `query` — i.e. contains a specifier whose imported name is
 * `query` (optionally aliased with `as`) without a per-specifier `type`
 * prefix.
 */
function bindsQueryValue(specifiers: string): boolean {
  return specifiers
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .some((spec) => !spec.startsWith('type ') && spec.split(/\s+as\s+/)[0].trim() === 'query');
}

const NAMED_IMPORT_RE = new RegExp(
  String.raw`import\s*(type\s+)?\{([^}]*)\}\s*from\s*['"]${SDK_RE}['"]`,
  'g',
);
const NAMED_REEXPORT_RE = new RegExp(
  String.raw`export\s*(type\s+)?\{([^}]*)\}\s*from\s*['"]${SDK_RE}['"]`,
  'g',
);

/** Import/require forms banned outright, regardless of what they name. */
const BANNED_FORMS: ReadonlyArray<{ rule: string; re: RegExp }> = [
  {
    rule: 'namespace-import',
    re: new RegExp(String.raw`import\s*(?:type\s+)?\*\s*as\s+[\w$]+\s*from\s*['"]${SDK_RE}['"]`, 'g'),
  },
  {
    rule: 'default-import',
    re: new RegExp(
      String.raw`import\s+[A-Za-z_$][\w$]*\s*(?:,\s*(?:\{[^}]*\}|\*\s*as\s+[\w$]+))?\s*from\s*['"]${SDK_RE}['"]`,
      'g',
    ),
  },
  {
    rule: 'star-re-export',
    re: new RegExp(String.raw`export\s*(?:type\s+)?\*\s*(?:as\s+[\w$]+\s*)?from\s*['"]${SDK_RE}['"]`, 'g'),
  },
  {
    rule: 'side-effect-import',
    re: new RegExp(String.raw`import\s*['"]${SDK_RE}['"]`, 'g'),
  },
  {
    rule: 'dynamic-import',
    re: new RegExp(String.raw`import\s*\(\s*['"\`]${SDK_RE}['"\`]\s*\)`, 'g'),
  },
  {
    rule: 'require-call',
    re: new RegExp(String.raw`require\s*\(\s*['"\`]${SDK_RE}['"\`]\s*\)`, 'g'),
  },
];

type SdkViolation = { rule: string; detail: string };

/**
 * All violations of the env-pin import rule in one file's source text.
 * Empty array = the file is clean.
 */
function findSdkViolations(source: string): SdkViolation[] {
  const violations: SdkViolation[] = [];
  let text = stripComments(source);
  if (!text.includes(SDK)) return violations;

  // (a)/(b): named imports — allowed unless a specifier binds the query value.
  text = text.replace(NAMED_IMPORT_RE, (full, typeKw: string | undefined, specifiers: string) => {
    if (!typeKw && bindsQueryValue(specifiers)) {
      violations.push({ rule: 'named-import-of-query-value', detail: full.trim() });
    }
    return '';
  });

  // Named re-exports — same rule; a value re-export of `query` is the
  // two-hop bypass (downstream importers never mention the specifier).
  text = text.replace(NAMED_REEXPORT_RE, (full, typeKw: string | undefined, specifiers: string) => {
    if (!typeKw && bindsQueryValue(specifiers)) {
      violations.push({ rule: 're-export-of-query-value', detail: full.trim() });
    }
    return '';
  });

  // Forms banned outright.
  for (const { rule, re } of BANNED_FORMS) {
    text = text.replace(re, (full) => {
      violations.push({ rule, detail: full.trim() });
      return '';
    });
  }

  // Catch-all: any leftover occurrence of the specifier (bare string literal
  // handed to a loader later, an import form not recognized above, ...).
  let idx = text.indexOf(SDK);
  while (idx !== -1) {
    const lineStart = text.lastIndexOf('\n', idx) + 1;
    const lineEnd = text.indexOf('\n', idx);
    violations.push({
      rule: 'unrecognized-sdk-reference',
      detail: text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim(),
    });
    idx = text.indexOf(SDK, idx + SDK.length);
  }

  return violations;
}

// ---------------------------------------------------------------------------
// The lock itself.
// ---------------------------------------------------------------------------

test('no file except the wrapper references the SDK module outside allowed type-only / non-query named imports', () => {
  const offenders: string[] = [];
  let checked = 0;

  for (const dirName of SCANNED_DIRS) {
    const absDir = join(ROOT, dirName);
    for (const file of collectSourceFiles(absDir)) {
      const relPath = relative(ROOT, file).split('\\').join('/');
      checked += 1;
      if (relPath === WRAPPER_RELATIVE_PATH) continue;
      const content = readFileSync(file, 'utf8');
      if (!content.includes(SDK)) continue; // fast path
      for (const v of findSdkViolations(content)) {
        offenders.push(`${relPath} — ${v.rule}: ${v.detail}`);
      }
    }
  }

  assert.ok(checked > 50, 'expected to have scanned a meaningful number of files under orchestrator/, loops/, cli/');
  assert.deepEqual(
    offenders,
    [],
    `these files reference the SDK module in a way that bypasses the env-pin seam — import \`pinnedSdkQuery\` from ${WRAPPER_RELATIVE_PATH} instead:\n${offenders.join('\n')}`,
  );
});

test('sanity: the wrapper file itself trips the detector (proves it is not vacuous)', () => {
  const wrapperContent = readFileSync(join(ROOT, WRAPPER_RELATIVE_PATH), 'utf8');
  const violations = findSdkViolations(wrapperContent);
  assert.equal(
    violations.length,
    1,
    `wrapper should trip exactly the query-value rule, got: ${JSON.stringify(violations)}`,
  );
  assert.equal(violations[0].rule, 'named-import-of-query-value');
});

// ---------------------------------------------------------------------------
// Synthetic fixtures. The four bypass classes below were each verified to
// slip past the earlier named-import-only detector — encode them so the
// detector can never regress to missing them.
// ---------------------------------------------------------------------------

test('fixture: type-only and non-query named imports/re-exports are allowed', () => {
  const allowed = [
    `import type { Options, SDKMessage } from '${SDK}';`,
    `import { type Options, type Query } from '${SDK}';`,
    `import { createSdkMcpServer } from '${SDK}';`,
    `export type { Options } from '${SDK}';`,
    `export { type Options } from '${SDK}';`,
  ];
  for (const src of allowed) {
    assert.deepEqual(findSdkViolations(src), [], `should be allowed: ${src}`);
  }
});

test('fixture: value imports of query are flagged (plain, aliased, mixed with type specifiers)', () => {
  const flagged = [
    `import { query } from '${SDK}';`,
    `import { query as sdkQuery } from '${SDK}';`,
    `import { type Options, query as q } from '${SDK}';`,
  ];
  for (const src of flagged) {
    const violations = findSdkViolations(src);
    assert.equal(violations.length, 1, `should be flagged: ${src}`);
    assert.equal(violations[0].rule, 'named-import-of-query-value', src);
  }
});

test('fixture: re-export bypasses are flagged (named query re-export + star re-export)', () => {
  const named = findSdkViolations(`export { query } from '${SDK}';`);
  assert.equal(named.length, 1);
  assert.equal(named[0].rule, 're-export-of-query-value');

  const namedAliased = findSdkViolations(`export { query as runAgent } from '${SDK}';`);
  assert.equal(namedAliased.length, 1);
  assert.equal(namedAliased[0].rule, 're-export-of-query-value');

  const star = findSdkViolations(`export * from '${SDK}';`);
  assert.equal(star.length, 1);
  assert.equal(star[0].rule, 'star-re-export');

  const starAs = findSdkViolations(`export * as sdk from '${SDK}';`);
  assert.equal(starAs.length, 1);
  assert.equal(starAs[0].rule, 'star-re-export');
});

test('fixture: namespace imports are flagged outright', () => {
  const violations = findSdkViolations(`import * as sdk from '${SDK}';\nconst q = sdk.query;`);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'namespace-import');
});

test('fixture: dynamic imports are flagged outright', () => {
  const singleQuoted = findSdkViolations(`const mod = await import('${SDK}');`);
  assert.equal(singleQuoted.length, 1);
  assert.equal(singleQuoted[0].rule, 'dynamic-import');

  const templateQuoted = findSdkViolations('const mod = await import(`' + SDK + '`);');
  assert.equal(templateQuoted.length, 1);
  assert.equal(templateQuoted[0].rule, 'dynamic-import');
});

test('fixture: require calls are flagged outright', () => {
  const violations = findSdkViolations(`const sdk = require('${SDK}');`);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'require-call');
});

test('fixture: other import forms are flagged (default, default+named, side-effect)', () => {
  const cases: Array<[string, string]> = [
    [`import sdk from '${SDK}';`, 'default-import'],
    [`import sdk, { query } from '${SDK}';`, 'default-import'],
    [`import '${SDK}';`, 'side-effect-import'],
  ];
  for (const [src, rule] of cases) {
    const violations = findSdkViolations(src);
    assert.equal(violations.length, 1, `should be flagged: ${src}`);
    assert.equal(violations[0].rule, rule, src);
  }
});

test('fixture: a bare specifier string literal is flagged by the catch-all (indirect-loader bypass)', () => {
  const violations = findSdkViolations(`const SPECIFIER = '${SDK}';\nconst mod = await import(SPECIFIER);`);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'unrecognized-sdk-reference');
});

test('fixture: comment mentions of the specifier are NOT flagged', () => {
  const src = [
    `// import { query } from '${SDK}'`,
    `/* export * from '${SDK}' */`,
    `/** replace with ${SDK} query() call */`,
    'const x = 1;',
  ].join('\n');
  assert.deepEqual(findSdkViolations(src), []);
});
