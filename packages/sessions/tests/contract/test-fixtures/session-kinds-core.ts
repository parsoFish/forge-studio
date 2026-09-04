/**
 * The shared head of the `session-kinds` contract suites — imports, the tmp-root
 * factory and its cleanup, and the descriptor builders.
 *
 * Extracted whole when `studio/session-kinds.test.ts` (2,398 lines) was split
 * on its own `// ===` banners (M4 exit row 5, C1). Every seam falls between
 * tests; nothing here was rewritten, only re-anchored.
 *
 * `REPO_ROOT` is `FORGE_ROOT` rather than a `../../..` chain: this file sits two
 * levels deeper than the suite it came from, and re-counting a relative chain
 * after a move is what §15.14 exists to stop.
 */

/**
 * Acceptance tests for packages/sessions/studio/session-kinds.ts (R2-10, PR1: the
 * session-shell backend contract).
 *
 * The module under test does not exist yet — this file is RED at branch base
 * (ERR_MODULE_NOT_FOUND on the `./session-kinds.ts` import is the expected
 * red). Mirrors packages/library/studio/template-library.ts / .test.ts's idiom:
 * real fs fixtures under mkdtempSync, plus the REAL repo (REPO_ROOT) for facts
 * that must stay true (the 3 shipped session kinds, their real agent ids).
 *
 * AT numbers below are a flat sequence AT-1..AT-48 spanning THREE files:
 *   AT-1  .. AT-18 — this file (session-kinds.ts)
 *   AT-19 .. AT-37 — packages/sessions/studio/session-transcript.test.ts
 *   AT-38 .. AT-48 — packages/sessions/bridge-studio-sessions.test.ts
 * AT-amendment-2 round (T2-ratified, adversarial-review findings) adds:
 *   AT-49 .. AT-56 — this file (A3: legacyRoutes declared-data-fails-open;
 *                    A4: YAML structural coverage gap)
 *   AT-57 .. AT-58 — session-transcript.test.ts (A2: phase-driven pending)
 *   AT-59 .. AT-60 — bridge-studio-sessions.test.ts (A1: status.json symlink
 *                    escape blocker; A2 route-level re-ask case)
 * AT-amendment-3 round (fresh re-review of the amendment-2 fix, `8893ffcd`)
 * adds:
 *   AT-61 .. AT-67 — this file (A1: legacyRouteResolves has no containment
 *                    check — a regression the amendment-2 FIX ITSELF
 *                    introduced while closing the original declared-data
 *                    gap; see the AT-61..67 block below)
 *   AT-68 .. AT-69 — session-transcript.test.ts (A2: listDirEntries can
 *                    enumerate an outside directory when manifests/themes
 *                    is itself a dir-level symlink)
 *   AT-70 .. AT-74 — bridge-studio-sessions.test.ts (A3: the 404 message
 *                    buckets for every status.json failure shape)
 *
 * A3 (this file, AT-49..52): `legacyRoutes` was parsed, typed, and echoed
 * back, but never actually checked — declared-data-fails-open. New contract:
 * `validateSessionKinds` errors when a `legacyRoutes` entry is empty/blank OR
 * does not correspond to a real route directory under `apps/studio/app/` (route
 * path segments map 1:1 onto Next.js App Router directory names, including
 * literal `[sessionId]` dynamic-segment folders — e.g.
 * `/architect/[sessionId]/interview` → `apps/studio/app/architect/[sessionId]/interview`,
 * verified to exist on disk for AT-52).
 *
 * AT-amendment-3, A1 (this file, AT-61..67): the amendment-2 fix for A3
 * added `legacyRouteResolves(forgeRoot, route)`, which does
 * `existsSync(join(forgeRoot, 'apps', 'studio', 'app', ...segments))` with NO
 * check that the resolved path stays under `apps/studio/app/` — `path.join`
 * normalizes `..` segments before `existsSync` ever runs. A route entry
 * containing enough `..` escapes to ANY real directory (including, via
 * enough `..` segments to clamp past the filesystem root, arbitrary
 * absolute paths like `/etc`) and is wrongly accepted as "resolved". Every
 * AT below was empirically verified against the actual (unfixed)
 * `legacyRouteResolves`/`validateSessionKinds` before being written — see
 * each test's comment for whether it demonstrates a LIVE bypass (RED today)
 * or pins an already-safe shape (GREEN today, coverage only — reported
 * honestly per T2's brief, not disguised as a fresh catch).
 *
 * AT-R422-1 .. AT-R422-10 (this file) — R4-22 WI-1, ADR-043
 * (docs/decisions/043-generic-interactive-surface.md §1): the additive-optional
 * `turnSpec` field on SessionKindDescriptor. The module under test does NOT
 * carry `turnSpec`, `TURN_STYLES`, `TURN_STEPS`, `FINALIZER_IDS`, `SCHEMA_IDS`,
 * `turnStyleState`, `turnStepState`, `finalizerIdState`, or `schemaIdState` yet
 * — every AT-R422-* test is RED at branch base. Unlike the file's original
 * bring-up (where a missing STATIC import crashes the whole file), these use
 * a DYNAMIC `await import('../../../studio/session-kinds.ts')` inside each test body so a
 * missing named export fails only that one test (the namespace object simply
 * has `undefined` for the missing key) — the pre-existing AT-1..AT-67 tests
 * keep running and passing throughout this file's RED phase.
 *
 * Design pinned here (proposed by T3; flagged as ambiguous in the report —
 * the ADR's worked example never exercises `schema` at all):
 *   - `turnSpec` shape: `{ kindDir, style, schema?, phases: [{ phase, step,
 *     writes?, next?, finalizer? }] }`. `schema` is a TOP-LEVEL optional
 *     field (a sibling of kindDir/style/phases), not per-phase — chosen
 *     because the ADR's only worked example (style: agent) never uses it,
 *     consistent with "structured-style sessions carry one schema" and
 *     avoiding inventing an un-cited 5th TURN_STEPS value.
 *   - Four frozen row-object registries (mirrors SESSION_ARTIFACT_KINDS's
 *     shape, not a bare string array, precisely so the deep-freeze-vs-shallow-
 *     freeze distinction is meaningful): `TURN_STYLES`, `TURN_STEPS`,
 *     `FINALIZER_IDS`, `SCHEMA_IDS`, each `readonly { id: string }[]`.
 *   - Four total lookup fns, one per registry, mirroring
 *     `sessionArtifactKindState`'s exact shape (`.find(...)?.id`, never
 *     throws, `undefined` for unknown): `turnStyleState`, `turnStepState`,
 *     `finalizerIdState`, `schemaIdState`.
 *   - New Finding check ids, mirroring the `session-kinds/unknown-*` family:
 *     `session-kinds/turnspec-unknown-style`, `-unknown-step`,
 *     `-unknown-finalizer`, `-unknown-schema`.
 *   - Validated set membership per AT-6/AT-9's shape: every error message
 *     names BOTH the offending value AND enumerates every id in the relevant
 *     imported registry (loop-based, self-adapting to however many ids the
 *     implementer seeds — including the degenerate case of an empty
 *     SCHEMA_IDS, which would make that one loop vacuous; see the T3 report).
 *
 * Design decisions this file pins (see the T3 report for the full rationale):
 *   - `studio/session-kinds.yaml` is a bare top-level YAML sequence of
 *     descriptor objects (mirrors nothing else in the repo exactly, but is
 *     the simplest shape for a single-purpose registry file).
 *   - `loadSessionKinds` is STRUCTURAL only (mirrors loadFlowDefinition /
 *     loadCatalog): it throws on missing file / unparseable YAML / a missing
 *     required scalar field, but does NOT validate closed-vocabulary
 *     membership (stage tokens, artifact kinds, agent refs, duplicate ids,
 *     slug shape) — those are SEMANTIC checks, live only in
 *     `validateSessionKinds`, exactly mirroring the load/validate split
 *     validate.ts already draws for agents/flows (validateAgent's slug check
 *     is a Finding, not a load-time throw).
 *   - Agent-ref resolution scans EVERY skill dir's SKILL.md (skills/<slug>/SKILL.md)
 *     with a `runtime:` block, REGARDLESS of `library: false` — NOT `listAgentDefinitions()`,
 *     which deliberately excludes `library: false` agents from the composable
 *     Studio roster (instructions-creator and project-brain-builder are both
 *     `library: false` internal agents dispatched by the bridge — see their
 *     SKILL.md frontmatter). Using `listAgentDefinitions()` for resolution
 *     would wrongly flag 2 of the 3 real session-kind descriptors. AT-17
 *     pins this against the real repo.
 *
 * AT-R422-11 .. AT-R422-19 (this file) — R4-22 WI-1 adversarial-review
 * findings (T3 gap-pin round): AT-R422-1..10 above proved WI-1 validates
 * turnSpec VOCABULARY MEMBERSHIP only (style/step/finalizer/schema each
 * resolve against a closed set) — but `turnSpec.phases` is a STATE MACHINE,
 * and its GRAPH COHERENCE is validated nowhere. Every gap below was
 * CONFIRMED BY EXECUTION against the real (unfixed) module before being
 * written — each loads clean, zero findings, today. New Finding check ids
 * (invented here, mirroring the `session-kinds/turnspec-unknown-*` naming
 * convention — the implementer must match these exact strings):
 *   `session-kinds/turnspec-unsafe-kind-dir`   (AT-R422-11, 12)
 *   `session-kinds/turnspec-dangling-next`     (AT-R422-13)
 *   `session-kinds/turnspec-finalize-missing-finalizer` (AT-R422-14)
 *   `session-kinds/turnspec-no-terminal-phase` (AT-R422-15)
 *   `session-kinds/turnspec-duplicate-phase`   (AT-R422-16)
 *   `session-kinds/turnspec-empty-phases`      (AT-R422-17)
 *   `session-kinds/turnspec-structured-unsupported` (AT-R422-18)
 * AT-R422-19 extends the AT-16/AT-R422-6 load/validate split to all six
 * graph-coherence checks in one combined fixture.
 *
 * CRITICAL for the implementer (AT-R422-12): `kindDir`'s sibling field
 * `d.id` is checked against `SLUG_RE` (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`,
 * packages/agents/skill-path.ts) one screen up in the same function — but every
 * REAL `kindDir` value in this design is underscore-prefixed (`_authoring`,
 * `_architect`, `_demo`, ADR-043 §1's own worked example). SLUG_RE requires
 * a leading `a-z` letter, so it REJECTS every one of them. Reusing
 * SLUG_RE/CHECK_SLUG for kindDir would make every real shipped kindDir value
 * a lint error. The kindDir check must be a NEW, distinct "safe single path
 * segment" shape check (no separators, no `.`/`..`, no control characters —
 * mirrors `isSafeSegment` in packages/kernel/path-guard.ts, which the generic
 * runner's own `resolveGuardedPath(projectRoot, [kindDir, sessionId])` relies
 * on one layer further down, but which nothing calls at LINT time today).
 */

import { after } from 'node:test';
import assert from 'node:assert/strict';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import matter from 'gray-matter';

import { type SessionKindDescriptor } from '../../../studio/session-kinds.ts';
// R4-19-F2 — the constraint test (ADR-043's whole point): a new interactive
// session kind must ride the EXISTING generic runInteractiveTurn spine, never
// a new AGENT_RUNNERS entry. Imported directly from the real production
// registry (packages/agents/agent-run.ts), not re-derived, so the assertion below is
// against the actual dispatch table a "just add a fifth runner"
// implementation would touch. `cli/` importing FROM `orchestrator/studio/` is
// the established direction (this test file lives at
// packages/sessions/studio/session-kinds.test.ts and imports packages/agents/agent-run.ts, the
// mirror image of packages/agents/agent-run.ts's own `import { loadSessionKinds } from
// '../../../studio/session-kinds.ts'` at its top) — no cycle: this
// TEST file is never itself imported by production code.
// The real Finding type (level/object/check/message) `validateSessionKinds`
// actually returns — imported directly rather than hand-narrowed/cast so the
// AT-R422-* assertions below typecheck against the SAME shape production
// code returns (TS2352 fix: a hand-narrowed `{ check: string }` local was
// too structurally distant from `{ level: string }` / `{ message: string }`
// for `as` to convert between them; the fix is a correct type, not a
// broader cast).
// Real production call path (Ruling 36): `runStudioLint` is what `forge
// studio lint` actually calls (apps/forge/studio-lint.ts -> cmdStudioLint,
// apps/forge/cli.ts), and CI invokes exactly that command
// (.github/workflows/ci.yml: `node --experimental-strip-types
// apps/forge/cli.ts studio lint`). This import is STATIC (not dynamic)
// because runStudioLint already exists and works today — no RED risk here.
// SLUG_RE is the SAME regex CHECK_SLUG already applies one screen up in
// validateSessionKinds (`d.id` — the sibling field to `turnSpec.kindDir`).
// Imported directly (not re-derived) so AT-R422-12's sanity precondition
// tests the REAL regex the implementer might be tempted to reuse for
// kindDir, not a hand-copied guess of it.

export const REPO_ROOT = FORGE_ROOT;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

export function makeForgeRoot(prefix = 'session-kinds-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

export type FixtureDescriptor = {
  id: string;
  agent: string;
  title: string;
  legacyRoutes: string[];
  stages: string[];
  defaultStage: string;
  artifact: { kind: string; label: string };
};

export function baseDescriptor(overrides: Partial<FixtureDescriptor> = {}): FixtureDescriptor {
  return {
    id: 'fixture-kind',
    agent: 'fixture-agent',
    title: 'Fixture Kind',
    legacyRoutes: ['/fixture/[sessionId]'],
    stages: ['roadmap'],
    defaultStage: 'roadmap',
    artifact: { kind: 'roadmap-draft', label: 'Fixture draft' },
    ...overrides,
  };
}

/** Write `studio/session-kinds.yaml` from a list of plain descriptor objects. */
export function writeSessionKindsYaml(root: string, descriptors: unknown[]): string {
  const dir = join(root, 'studio');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'session-kinds.yaml');
  writeFileSync(p, yaml.dump(descriptors), 'utf8');
  return p;
}

/** Write a minimal SKILL.md with a `runtime:` block (a resolvable agent),
 *  optionally `library: false` (an internal agent, still resolvable — this is
 *  the exact shape instructions-creator / project-brain-builder use). */
export function writeAgentSkill(root: string, slug: string, opts: { libraryFalse?: boolean } = {}): void {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {
    name: slug,
    description: `Fixture agent ${slug}.`,
    purpose: 'Fixture purpose.',
    composition: { skills: [], tools: [], mcps: [], guards: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fixture.',
    'allowed-tools': [],
    'disallowed-tools': [],
    budgets: {},
  };
  if (opts.libraryFalse) data.library = false;
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nFixture body.\n', data), 'utf8');
}

export function byId(descs: readonly SessionKindDescriptor[], id: string): SessionKindDescriptor {
  const d = descs.find((x) => x.id === id);
  assert.ok(d, `expected descriptor "${id}" to be present`);
  return d!;
}

/** Creates a REAL `apps/studio/app/<...segments>/` directory under `root` for a
 *  legacyRoutes entry like `/fixture-kind/[sessionId]` — route path segments
 *  map 1:1 onto Next.js App Router directory names, including a literal
 *  `[sessionId]` dynamic-segment folder (verified against the real repo:
 *  `apps/studio/app/architect/[sessionId]/interview/page.tsx` exists on disk). */
export function writeForgeUiRoute(root: string, routePath: string): void {
  const segments = routePath.replace(/^\//, '').split('/').filter((s) => s.length > 0);
  mkdirSync(join(root, 'apps', 'studio', 'app', ...segments), { recursive: true });
}

