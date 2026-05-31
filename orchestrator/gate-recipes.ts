/**
 * Gate auto-derivation (known-gaps 2026-05-31, betterado #2).
 *
 * The PM writes a per-WI `quality_gate_cmd` that must FAIL on a clean tree and
 * PASS once the AC is met (contract C1's discrimination facet). The *shape* of a
 * discriminating, scoped gate is language-specific, and the operator should not
 * have to hand-encode it in the manifest — forge derives it from the project.
 *
 * This module detects the project's primary language from the worktree and
 * returns a concrete, copy-able gate recipe (template + the traps that make a
 * gate silently non-discriminating). The PM phase injects the recipe into the
 * PM prompt so the agent writes a correct scoped gate on pass 1; onboarding /
 * preflight can surface the same recipe.
 *
 * Pure: filesystem reads only, no SDK / network / mutation.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type ProjectLanguage =
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'python'
  | 'rust'
  | 'unknown';

export type GateRecipe = {
  language: ProjectLanguage;
  /** One-line summary of the scoped-gate idiom for this language. */
  summary: string;
  /** A concrete, copy-able argv template (placeholders in <angle-brackets>). */
  template: string[];
  /**
   * Language-specific traps that make a gate silently stop discriminating
   * (hollow / false-pass / poisoned). Each is a complete sentence.
   */
  traps: string[];
};

/**
 * Detect the project's primary language from build-manifest presence. Order
 * matters: a polyglot repo is classified by its *primary* manifest. go.mod /
 * Cargo.toml / pyproject are unambiguous; package.json splits TS vs JS on a
 * tsconfig. Returns 'unknown' when no manifest is recognised (the recipe then
 * gives language-agnostic guidance).
 */
export function detectProjectLanguage(worktreePath: string): ProjectLanguage {
  const has = (rel: string): boolean => existsSync(join(worktreePath, rel));
  if (has('go.mod')) return 'go';
  if (has('Cargo.toml')) return 'rust';
  if (has('pyproject.toml') || has('setup.py') || has('setup.cfg')) return 'python';
  if (has('package.json')) {
    return has('tsconfig.json') ? 'typescript' : 'javascript';
  }
  return 'unknown';
}

const RECIPES: Record<ProjectLanguage, Omit<GateRecipe, 'language'>> = {
  go: {
    summary:
      'Scope the gate to the EXACT package dir and a NEW `-run <Prefix>` so it fails on a clean tree.',
    template: ['go', 'test', '-tags', 'all', '-run', '<NewTestPrefix>', './path/to/pkg/'],
    traps: [
      '`-tags all` is mandatory where unit tests sit behind `//go:build` tags — without it the runner silently runs 0 tests and the gate false-passes.',
      'Scope to the exact package dir (e.g. `./azuredevops/internal/service/foo/`), NEVER `./...` — a test-less sibling package prints `[no tests to run]` and poisons the whole run, failing the gate even when the real tests pass.',
'`-run <NewTestPrefix>` scopes to the new tests. NOTE: `go test` EXITS 0 on a clean tree when no test matches (`[no tests to run]`) or the package has no test files (`[no test files]`) — so it is forge\'s no-work scan, NOT the exit code, that makes the gate fail until real tests run. A bare `go test ./pkg/` that passes at iter-0 on the package\'s existing tests is the `gate-too-loose` case to avoid; scope to the new prefix.',
    ],
  },
  typescript: {
    summary: 'Scope the gate to the NEW test file (which does not exist yet) so it fails on a clean tree.',
    template: ['node', '--test', '--experimental-strip-types', 'tests/<NewFile>.test.ts'],
    traps: [
      'Scope to the new test file, never the project-level `npm test` — the umbrella passes on the existing suite alone (`gate-too-loose`).',
      'The named test file must not exist yet on the worktree, so the gate fails until the agent writes both the file AND its assertions.',
      'If the project uses a runner (vitest/jest), scope to the single new spec (`vitest run tests/<NewFile>.test.ts`), not the whole config.',
    ],
  },
  javascript: {
    summary: 'Scope the gate to the NEW test file (which does not exist yet) so it fails on a clean tree.',
    template: ['node', '--test', 'tests/<NewFile>.test.js'],
    traps: [
      'Scope to the new test file, never the project-level `npm test` — the umbrella passes on the existing suite alone (`gate-too-loose`).',
      'The named test file must not exist yet on the worktree, so the gate fails until the agent writes both the file AND its assertions.',
    ],
  },
  python: {
    summary: 'Scope the gate to the NEW test node (file::class::test) so it fails on a clean tree.',
    template: ['pytest', '-q', 'tests/test_<new>.py::<TestClass>::<test_new>'],
    traps: [
      'Scope to the new test node, never a bare `pytest` — the full suite passes without exercising the new work (`gate-too-loose`).',
      'The named node must not exist yet, so collection fails (then passes once written) — a discriminating signal.',
      'Add `-p no:cacheprovider` if a stale `.pytest_cache` masks collection.',
    ],
  },
  rust: {
    summary: 'Scope the gate to the NEW test path so it fails on a clean tree.',
    template: ['cargo', 'test', '<module>::tests::<new_test>'],
    traps: [
      'Scope to the new test path, never a bare `cargo test` — the full suite passes without the new work (`gate-too-loose`).',
      'The named test must not exist yet, so the filter matches nothing and the gate fails until the agent adds it.',
    ],
  },
  unknown: {
    summary: 'Scope the gate to the unit of change so an empty tree FAILS and real work PASSES.',
    template: ['<test-runner>', '<scope-to-the-new-test-only>'],
    traps: [
      'Never use the project-level umbrella test command — it passes on the existing suite alone (`gate-too-loose`).',
      'Scope to the new test target (a file / node / filter) that does not exist yet, so the gate fails on a clean tree and passes only once the AC is met.',
      'For a monorepo, scope to the touched package — never a repo-wide wildcard (a test-less sibling can poison a multi-target run).',
    ],
  },
};

export function gateRecipeFor(language: ProjectLanguage): GateRecipe {
  return { language, ...RECIPES[language] };
}

/** Detect the language and return its recipe in one call. */
export function deriveGateRecipe(worktreePath: string): GateRecipe {
  return gateRecipeFor(detectProjectLanguage(worktreePath));
}

/**
 * Render the recipe as a PM-prompt block: the language, the scoped-gate idiom,
 * a concrete template, and the traps to avoid. The PM uses this to write a
 * discriminating per-WI `quality_gate_cmd` without the operator encoding it.
 */
export function renderGateRecipeBlock(recipe: GateRecipe): string {
  const lines = [
    '## Quality-gate recipe (derived from the project)',
    '',
    `Detected language: **${recipe.language}**. ${recipe.summary}`,
    '',
    'Template (fill the `<…>` placeholders for THIS work item):',
    '',
    '```json',
    JSON.stringify(recipe.template),
    '```',
    '',
    'Traps that make a gate silently non-discriminating (avoid all):',
    ...recipe.traps.map((t) => `- ${t}`),
  ];
  return lines.join('\n');
}
