/**
 * check-kb-ingest-affordance.test.ts — R1-06 WI-3 group B (3): the
 * no-ingest-affordance RATCHET (operator decision 3, 2026-08-03 —
 * docs/decisions/010-brain-first.md line 22, docs/roadmaps/
 * R1-contract-componentry.md lines ~213-227: "Explicit negative AC
 * (decision 3): no ingest affordance anywhere in creation or maintenance
 * ... grep-level assert no UI route/action triggers ingest").
 *
 * This is a TEST-file-local checker (no companion production script —
 * T3 writes acceptance tests only) asserting two things about the REAL
 * repository:
 *
 *   1. No forge-ui `data-action="..."` value names ingest.
 *   2. No bridge KB route (cli/*.ts, excluding *.test.ts) has an
 *      `op === 'ingest'` / `case 'ingest'` dispatch arm.
 *   3. The literal strings `reflector-ingest` / `DEFAULT_KB_INGEST` appear
 *      ONLY in the three files where they are legitimate today: the
 *      descriptor-default definition/re-export
 *      (orchestrator/studio/kb-descriptor.ts, orchestrator/studio/
 *      registry.ts) and the reflection-path builtin invocation
 *      (orchestrator/kb-health.ts) — never in a dispatch arm or a UI
 *      action.
 *
 * GREEN-AT-BIRTH, DISCLOSED: all three checks currently PASS against the
 * real repo (verified below in Group 2) — there is no ingest affordance
 * today. This file's job is to make that invariant a RATCHET: it fails
 * the moment anyone adds one. Group 1 proves the checker itself is not
 * vacuous by mutating a SYNTHETIC fixture tree (never the real repo) to
 * inject exactly the three forbidden shapes and confirming each is
 * caught, before Group 2 trusts a clean run of the same function against
 * the real tree as meaningful.
 *
 * RUN: node --experimental-strip-types --test scripts/check-kb-ingest-affordance.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// R4-19-F2 addition (Group 3 below): unlike every check above, which
// duplicates the ratchet's logic inline per this file's own established
// "prove-from-first-principles" convention, Group 3 calls the REAL exported
// function from the production script directly — the whole point of those
// tests is to prove the PRODUCTION check gains a new rule, not a test-local
// stand-in for it.
import { checkNoIngestAffordance as checkNoIngestAffordanceReal } from './check-kb-ingest-affordance.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Directories walked for forge-ui UI-action affordances.
const UI_SCAN_DIRS = ['forge-ui/app', 'forge-ui/components', 'forge-ui/lib'];
// Directories walked for bridge KB-route dispatch code.
const BRIDGE_SCAN_DIRS = ['cli'];
// Files where DEFAULT_KB_INGEST / 'reflector-ingest' legitimately appear —
// the descriptor default (+ its re-export) and the reflection builtin.
const ALLOWED_INGEST_FILES = new Set([
  'orchestrator/studio/kb-descriptor.ts',
  'orchestrator/studio/registry.ts',
  'orchestrator/kb-health.ts',
]);

function isTestFile(p: string): boolean {
  return /\.test\.(ts|tsx|mjs|js)$/.test(p);
}

function walk(dirAbs: string, exts: string[], skip: (p: string) => boolean): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out; // dir doesn't exist in this tree — not an error, just nothing to scan
  }
  for (const e of entries) {
    const full = join(dirAbs, e.name);
    if (skip(full)) continue;
    if (e.isDirectory()) {
      out.push(...walk(full, exts, skip));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const GLOBAL_SKIP = (p: string): boolean =>
  p.includes(`${join('node_modules')}`) || p.includes(`${join('.git')}`) ||
  // Transient git worktrees are duplicate checkouts of the repo (e.g. parked
  // lane worktrees), not additional repo state — scanning them double-counts
  // the same allowed reflection files under a path the allowlist can't match.
  p.includes(`${join('.claude', 'worktrees')}`) ||
  p.includes(`${join('brain')}`) || p.includes(`${join('mockups')}`) ||
  p.includes(`${join('demos')}`) || isTestFile(p);

/**
 * Scan `root` for the no-ingest-affordance invariant. Returns a list of
 * human-readable violation strings; empty = clean.
 */
function checkNoIngestAffordance(root: string): string[] {
  const violations: string[] = [];

  // 1. forge-ui: no data-action="...ingest..." (case-insensitive).
  for (const dir of UI_SCAN_DIRS) {
    const files = walk(join(root, dir), ['.ts', '.tsx'], GLOBAL_SKIP);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const re = /data-action=["']([^"']*)["']/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (m[1].toLowerCase().includes('ingest')) {
          violations.push(`${relative(root, file)}: data-action="${m[1]}" is a UI ingest affordance (forbidden — operator decision 3)`);
        }
      }
    }
  }

  // 2. bridge KB routes: no op-dispatch arm named 'ingest'.
  for (const dir of BRIDGE_SCAN_DIRS) {
    const files = walk(join(root, dir), ['.ts'], GLOBAL_SKIP);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/\bop\s*===\s*['"]ingest['"]/.test(text) || /\bcase\s+['"]ingest['"]/.test(text)) {
        violations.push(`${relative(root, file)}: bridge route dispatches op === 'ingest' (forbidden — operator decision 3)`);
      }
    }
  }

  // 3. reflector-ingest / DEFAULT_KB_INGEST literal must only appear in the
  //    allowed descriptor-default / reflection-builtin files.
  const allFiles = walk(root, ['.ts', '.tsx'], GLOBAL_SKIP);
  for (const file of allFiles) {
    const relPath = relative(root, file).split('\\').join('/');
    if (ALLOWED_INGEST_FILES.has(relPath)) continue;
    const text = readFileSync(file, 'utf8');
    if (text.includes('reflector-ingest') || text.includes('DEFAULT_KB_INGEST')) {
      violations.push(`${relPath}: references reflector-ingest/DEFAULT_KB_INGEST outside the allowed descriptor-default/reflection files`);
    }
  }

  return violations;
}

// =============================================================================
// Group 1 — synthetic fixture tree: prove the checker is not vacuous
// =============================================================================

function makeCleanFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-ingest-ratchet-'));
  mkdirSync(join(root, 'forge-ui/app/knowledge'), { recursive: true });
  mkdirSync(join(root, 'cli'), { recursive: true });
  mkdirSync(join(root, 'orchestrator/studio'), { recursive: true });
  writeFileSync(
    join(root, 'forge-ui/app/knowledge/page.tsx'),
    [
      "export function KbMaintenance() {",
      "  return (",
      '    <div data-component="kb-maintenance">',
      '      <button data-action="kb-lint">Lint</button>',
      '      <button data-action="kb-index">Refresh index</button>',
      '    </div>',
      "  );",
      "}",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'cli/bridge-studio-kbs.ts'),
    [
      "export function handle(op: string) {",
      "  if (op === 'lint') return runLint();",
      "  if (op === 'index') return runIndex();",
      "}",
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'orchestrator/studio/kb-descriptor.ts'),
    "export const DEFAULT_KB_INGEST = { builtin: 'reflector-ingest' };\n",
  );
  return root;
}

test('mutation-proof (1/3): a fake UI data-action="kb-ingest-now" IS flagged', () => {
  const root = makeCleanFixture();
  try {
    // Precondition: the clean fixture starts with ZERO violations.
    assert.deepEqual(checkNoIngestAffordance(root), [], 'fixture sanity: clean tree must start violation-free');

    // Mutate: inject a fake ingest UI action into a temp COPY (never the real repo).
    writeFileSync(
      join(root, 'forge-ui/app/knowledge/page.tsx'),
      [
        "export function KbMaintenance() {",
        "  return (",
        '    <div data-component="kb-maintenance">',
        '      <button data-action="kb-lint">Lint</button>',
        '      <button data-action="kb-ingest-now">Ingest now</button>',
        '    </div>',
        "  );",
        "}",
        '',
      ].join('\n'),
    );

    const violations = checkNoIngestAffordance(root);
    assert.ok(
      violations.some((v) => v.includes('kb-ingest-now')),
      `expected a violation naming the injected fake ingest action, got: ${JSON.stringify(violations)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mutation-proof (2/3): a fake bridge op === \'ingest\' dispatch arm IS flagged', () => {
  const root = makeCleanFixture();
  try {
    assert.deepEqual(checkNoIngestAffordance(root), [], 'fixture sanity: clean tree must start violation-free');

    writeFileSync(
      join(root, 'cli/bridge-studio-kbs.ts'),
      [
        "export function handle(op: string) {",
        "  if (op === 'lint') return runLint();",
        "  if (op === 'ingest') return runIngest();", // injected forbidden dispatch arm
        "}",
        '',
      ].join('\n'),
    );

    const violations = checkNoIngestAffordance(root);
    assert.ok(
      violations.some((v) => v.includes('bridge-studio-kbs.ts') && v.includes("op === 'ingest'")),
      `expected a violation naming the injected op === 'ingest' dispatch arm, got: ${JSON.stringify(violations)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('mutation-proof (3/3): a reflector-ingest reference OUTSIDE the allowed files IS flagged', () => {
  const root = makeCleanFixture();
  try {
    assert.deepEqual(checkNoIngestAffordance(root), [], 'fixture sanity: clean tree must start violation-free');

    // A stray reference in a file that is NOT in ALLOWED_INGEST_FILES.
    writeFileSync(
      join(root, 'cli/bridge-studio-kbs.ts'),
      [
        "const builtinName = 'reflector-ingest';", // injected, wrong file
        "export function handle(op: string) {",
        "  if (op === 'lint') return runLint();",
        "}",
        '',
      ].join('\n'),
    );

    const violations = checkNoIngestAffordance(root);
    assert.ok(
      violations.some((v) => v.includes('cli/bridge-studio-kbs.ts') && v.includes('reflector-ingest')),
      `expected a violation for the stray reflector-ingest reference, got: ${JSON.stringify(violations)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sanity: an unmodified clean fixture stays violation-free (the checker does not just always fail)', () => {
  const root = makeCleanFixture();
  try {
    assert.deepEqual(checkNoIngestAffordance(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// =============================================================================
// Group 2 — RATCHET: the REAL repository, green-at-birth
// =============================================================================

test('precondition: the allowed-files allowlist is not vacuous — the real descriptor file DOES reference DEFAULT_KB_INGEST/reflector-ingest', () => {
  const descriptorPath = join(FORGE_ROOT, 'orchestrator/studio/kb-descriptor.ts');
  const text = readFileSync(descriptorPath, 'utf8');
  assert.ok(text.includes('DEFAULT_KB_INGEST'), 'fixture-precondition: real kb-descriptor.ts must still define DEFAULT_KB_INGEST');
  assert.ok(text.includes('reflector-ingest'), 'fixture-precondition: real kb-descriptor.ts must still name the reflector-ingest builtin');
});

test('RATCHET (green-at-birth): the real repo has no forge-ui/bridge KB ingest affordance today', () => {
  const violations = checkNoIngestAffordance(FORGE_ROOT);
  assert.deepEqual(violations, [], `found forbidden ingest affordance(s):\n${violations.join('\n')}`);
});

// =============================================================================
// Group 3 — R4-19-F2: extend the ratchet to a FOURTH shape — a runtime
// agent's SKILL.md composing `brain-ingest` via `composition.skills`. The
// three existing rules never look at .md files at all (rules 1/2 scan
// forge-ui/cli .ts(x); rule 3 scans every .ts(x) file in the repo for a bare
// string) — so a SKILL.md that composes brain-ingest sails through today
// undetected. This is the specific shape the brain-maintenance agent
// (R4-19-F2) must never carry: "the agent must NOT compose brain-ingest and
// must have no ingest affordance of any kind" (operator decision 3 —
// docs/decisions/010-brain-first.md line 22: "Ingest stays reflection-only").
//
// Written FIRST, against the CURRENT (unmodified) check-kb-ingest-affordance.mjs
// — confirmed empirically (see the two tests immediately below) that neither
// half is a false catch: today the "must fail" fixture passes with ZERO
// violations (the blind spot), and the "must pass" fixture also passes with
// zero violations (not a trivial always-fail either). The implementer's job
// is to add a fourth rule to checkNoIngestAffordance in the .mjs script that
// walks skills/*\/SKILL.md, parses (or greps) `composition.skills`, and
// flags any entry equal to `brain-ingest` — mirroring the existing
// ALLOWED_INGEST_FILES allowlist shape, since skills/reflector/SKILL.md
// LEGITIMATELY composes `brain-ingest` (see the real-repo test at the bottom
// of this group) and must not be a false positive once the rule lands.
// =============================================================================

/**
 * A synthetic skills/<slug>/SKILL.md fixture, minimal but shaped like a real
 * studio agent def (frontmatter fields loadAgentDefinition would require),
 * with a caller-supplied `composition.skills` flow-style array literal —
 * exactly the shape a real SKILL.md uses (e.g. skills/reflector/SKILL.md's
 * `skills: [brain-query, brain-ingest]`).
 */
function makeSkillCompositionFixture(skillsCompositionLine: string): { root: string; skillMdPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-ingest-ratchet-skill-'));
  const skillDirAbs = join(root, 'skills', 'some-other-agent');
  mkdirSync(skillDirAbs, { recursive: true });
  const skillMdPath = join(skillDirAbs, 'SKILL.md');
  writeFileSync(
    skillMdPath,
    [
      '---',
      'name: some-other-agent',
      'description: fixture agent for the no-ingest-affordance ratchet extension test.',
      'library: false',
      'purpose: fixture only.',
      'composition:',
      `  skills: ${skillsCompositionLine}`,
      '  tools: []',
      '  mcps: []',
      '  guards: []',
      'runtime:',
      '  sdk: claude',
      '  strategy: fixed',
      '  model: claude-haiku-4-5-20251001',
      'brainAccess: none',
      'interactivity: fixture only.',
      'allowed-tools: [Read]',
      'disallowed-tools: []',
      '---',
      '',
      '# Fixture Agent',
      '',
    ].join('\n'),
  );
  return { root, skillMdPath };
}

test('R4-19-F2 RATCHET EXTENSION (RED until implemented): a SKILL.md composing brain-ingest via composition.skills IS flagged by the REAL check-kb-ingest-affordance.mjs', () => {
  const { root, skillMdPath } = makeSkillCompositionFixture('[brain-ingest]');
  try {
    const violations = checkNoIngestAffordanceReal(root);
    const relPath = relative(root, skillMdPath).split('\\').join('/');
    assert.ok(
      violations.some((v: string) => v.includes(relPath) && v.toLowerCase().includes('brain-ingest')),
      `expected an actionable one-line violation naming ${relPath} and 'brain-ingest'; the ratchet has not gained the skills-composition rule yet, so this is expected to be RED until it does. Got: ${JSON.stringify(violations)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('R4-19-F2 RATCHET EXTENSION: a SKILL.md with no brain-ingest in composition.skills PASSES the REAL check-kb-ingest-affordance.mjs (the checker is not a trivial always-fail)', () => {
  const { root } = makeSkillCompositionFixture('[]');
  try {
    const violations = checkNoIngestAffordanceReal(root);
    assert.deepEqual(violations, [], `expected zero violations on a clean fixture, got: ${JSON.stringify(violations)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'R4-19-F2: the real repo still passes the (eventually) extended ratchet — GREEN-AT-ARRIVAL, DISCLOSED: ' +
    'no rule scans SKILL.md composition today, so this cannot yet catch a wrong implementation of the new rule. ' +
    'It is still worth keeping as the regression guard for skills/reflector/SKILL.md\'s LEGITIMATE ' +
    '`composition.skills: [brain-query, brain-ingest]` (reflector is the one place ingest IS invoked, per ' +
    'CLAUDE.md "Ingest stays reflection-only") — once the composition rule ships it MUST allowlist reflector ' +
    '(mirroring how ALLOWED_INGEST_FILES already allowlists the descriptor-default files for rule 3), or this ' +
    'test flips red the moment the naive/unscoped version of the rule lands.',
  () => {
    const violations = checkNoIngestAffordanceReal(FORGE_ROOT);
    assert.deepEqual(violations, [], `found forbidden ingest affordance(s) in the real repo:\n${violations.join('\n')}`);
  },
);
