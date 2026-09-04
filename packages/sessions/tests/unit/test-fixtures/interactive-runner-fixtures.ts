import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSessionKinds, type SessionKindDescriptor } from '../../../studio/session-kinds.ts';
import { type QueryFn } from '../../../interactive-session.ts';
import { createLogger } from '@forge/kernel';

/**
 * R4-22 WI-3 (T3, acceptance tests) — pins the contract for the generic
 * interactive-turn runner, `packages/sessions/interactive-runner.ts`, BEFORE it
 * exists (ADR-043 §2: docs/decisions/043-generic-interactive-surface.md).
 *
 * `runInteractiveTurn(descriptor, ctx)` is the ONE spine every future
 * `turnSpec`-bearing session kind runs through instead of a bespoke
 * `orchestrator/*-runner.ts`. It owns, once: the SEC-04 containment preamble
 * (`resolveGuardedPath(projectRoot, [kindDir, sessionId])` →
 * `guardedReadSessionStatus`), the ADR-024 spec/model/prompt derivation
 * (`deriveAgentSpec(skillPathRelative(agent))` → `modelForSpec`), the shared
 * telemetry (`createLogger` / `makeToolEventSink` / `flushIteration(1)`), and
 * the phase-table dispatch loop (`status.phase` → matching `turnSpec.phases`
 * row → run the row's `step` → advance to `next`).
 *
 * RED-NOW: this whole suite fails at import time
 * ("Cannot find module './interactive-runner.ts'") because the module does
 * not exist yet — see the run output recorded in this WI's report. No
 * implementation code lives in this file.
 *
 * ---------------------------------------------------------------------------
 * FIXTURE DESIGN
 * ---------------------------------------------------------------------------
 *
 * No real `studio/session-kinds.yaml` row carries a `turnSpec` yet (that
 * lands with a later WI), so every test here builds its OWN tiny forgeRoot
 * with its own `studio/session-kinds.yaml` and loads descriptors through the
 * REAL `loadSessionKinds` parse path (studio/session-kinds.ts) rather than a
 * hand-built object literal — three rows, all shaped exactly like ADR-043
 * §1's own worked example:
 *
 *   - `test-kind`               — the ADR's 4-phase table verbatim
 *                                 (analyzing→agent, awaiting-review→noop,
 *                                 committing→finalize(copyStagingToLibrary),
 *                                 committed→terminal), kindDir `_interactivetest`.
 *   - `test-kind-bad-finalizer` — a `committing` phase naming a finalizer id
 *                                 that does NOT exist in FINALIZERS.
 *   - `test-kind-bad-kinddir`   — a `kindDir` that is itself a traversal
 *                                 string (`../evil-escape`).
 *
 * `agent: project-brain-builder` — a REAL skill already on this branch
 * (skills/project-brain-builder/SKILL.md, `allowed-tools: […, Write]`,
 * `runtime: {sdk: claude, strategy: fixed, model: claude-sonnet-4-6}`) so
 * `deriveAgentSpec(skillPathRelative(descriptor.agent))` resolves for real
 * instead of throwing on a fabricated agent id — the ADR-024 derivation leg
 * is exercised genuinely, only the LLM call itself is stubbed via `queryFn`.
 *
 * ---------------------------------------------------------------------------
 * MY CALL, on the parts ADR-043 / the WI-3 brief leave open (stated
 * explicitly, mirroring the WI-2 finalizers suite's own precedent, so the
 * implementer has one target):
 * ---------------------------------------------------------------------------
 *
 *   1. `FinalizerContext.libraryRoot` / `.packageId` derivation from
 *      `ctx.forgeRoot` + the session is UNSPECIFIED by ADR-043 and the WI-3
 *      brief — there is no `turnSpec` field, no `ctx` field, and no existing
 *      config constant anywhere in the repo that names it (grepped; the only
 *      precedent is the WI-2 finalizers suite's OWN test-local guess,
 *      `join(forgeRoot, 'library')`). The finalize-step test (AT-3) does NOT
 *      assert a hardcoded destination path for this reason: it asserts
 *      exclusively through the runner's OWN return contract (`result.wrote`
 *      entries must exist on disk and byte-match the staged content), which
 *      holds regardless of which literal directory the implementer picks. As
 *      a filesystem-precondition hedge only (copyStagingToLibrary's own
 *      contract requires its `libraryRoot` to already exist —
 *      `realpathSync` throws otherwise), the fixture pre-creates BOTH
 *      plausible candidates (`<forgeRoot>/library` and
 *      `<forgeRoot>/studio/library`) so the test does not spuriously fail on
 *      "containment root does not exist" for a reason unrelated to the
 *      runner's actual correctness. Flagged in the WI-3 report as a real
 *      open question, not silently resolved here.
 *   2. `result.artifacts` semantics are entirely unpinned by ADR-043's
 *      signature (`Record<string, unknown>` with no key contract stated
 *      anywhere). Left unasserted throughout this file rather than guessed —
 *      pinning invented keys here would dictate an implementation choice
 *      nobody has actually made yet.
 *   3. The local `TestStatus` shape (`{ session_id, phase, updated_at }`) is
 *      this file's own minimal status-file fixture — `runInteractiveTurn` is
 *      generic over any `{ phase: string, … }` JSON, mirroring how
 *      `guardedReadSessionStatus<S>` is generic in interactive-session.ts.
 *
 * Every test asserts its seeded precondition (the status file's phase, or an
 * outside canary's content / a directory's entry list) BEFORE invoking
 * `runInteractiveTurn` and reading any verdict, per this initiative's T3
 * discipline.
 */


// RED-NOW: this module does not exist yet — see the report for the exact
// failure this import produces.

// ---------------------------------------------------------------------------
// Fixture yaml — three rows, all real-parsed through loadSessionKinds.
// ---------------------------------------------------------------------------

const FIXTURE_SESSION_KINDS_YAML = `
- id: test-kind
  agent: project-brain-builder
  title: Interactive Runner Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
      - { phase: committing, step: finalize, finalizer: copyStagingToLibrary, next: committed }
      - { phase: committed, step: terminal }
- id: test-kind-bad-finalizer
  agent: project-brain-builder
  title: Interactive Runner Test Kind (unregistered finalizer)
  stages: [committing]
  defaultStage: committing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-badfin
    style: agent
    phases:
      - { phase: committing, step: finalize, finalizer: totallyBogusFinalizerId, next: committed }
      - { phase: committed, step: terminal }
- id: test-kind-bad-kinddir
  agent: project-brain-builder
  title: Interactive Runner Test Kind (traversal kindDir)
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: "../evil-escape"
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
- id: test-kind-ghost-next-agent
  agent: project-brain-builder
  title: Interactive Runner Test Kind (Finding 1 - ghost next, agent step)
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-ghostnext-agent
    style: agent
    phases:
      - { phase: analyzing, step: agent, next: ghost-next-phase }
- id: test-kind-ghost-next-finalize
  agent: project-brain-builder
  title: Interactive Runner Test Kind (Finding 1 - ghost next, finalize step)
  stages: [committing]
  defaultStage: committing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-ghostnext-finalize
    style: agent
    phases:
      - { phase: committing, step: finalize, finalizer: copyStagingToLibrary, next: ghost-next-phase }
- id: test-kind-no-writes-declared
  agent: project-brain-builder
  title: Interactive Runner Test Kind (P1 - no writes declared, true carve-out)
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _interactivetest-nowrites
    style: agent
    phases:
      - { phase: analyzing, step: agent, next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;
// NOTE (Finding 1 fixtures): both "-ghost-next-*" rows above declare a
// `next` naming a phase absent from their OWN `phases` list. This is
// deliberately NOT rejected by loadSessionKinds (a purely structural
// parse — see parseTurnSpec's own doc comment) nor by this file's
// loadFixtureDescriptor helper, which calls ONLY loadSessionKinds, never
// validateSessionKinds (the separate semantic/lint pass that DOES have a
// CHECK_TURNSPEC_DANGLING_NEXT rule, used by `forge studio lint`, not by
// the runtime runInteractiveTurn path this suite exercises). That split is
// exactly Finding 1's live gap: the static lint can catch an authoring
// typo, but the generic runner itself has no equivalent runtime defense —
// a session whose `next` was valid at lint time but drifts (or a
// lint-skipped hand-edit) still bricks a live session today.

// ---------------------------------------------------------------------------
// Shared fixture helpers — every test builds its own isolated tempdir tree;
// nothing depends on process.cwd() or ambient state.
// ---------------------------------------------------------------------------

export type TestStatus = { session_id: string; phase: string; updated_at: string; package_id?: string; modelTier?: string };

type Fixture = {
  root: string;
  forgeRoot: string;
  projectRoot: string;
  logsRoot: string;
  /** The "good" test-kind's session id + dir (kindDir=_interactivetest). */
  sessionId: string;
  sessionDir: string;
};

export function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-10T00-00-00';
  const sessionDir = join(projectRoot, '_interactivetest', sessionId);
  return { root, forgeRoot, projectRoot, logsRoot, sessionId, sessionDir };
}

export function loadFixtureDescriptor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

export const logger = (logsRoot: string, sid: string) => createLogger(`_interactive-runner-test-${sid}`, logsRoot);

/** A queryFn stub that fails the test outright if ever invoked — proves a
 *  containment/dispatch rejection happens BEFORE any turn logic runs. */
export function neverCalledQueryFn(): QueryFn {
  return () => {
    throw new Error('queryFn must not be called for this test — the runner must refuse before reaching a turn');
  };
}

/** A queryFn stub for an `agent`-style step that does no filesystem work of
 *  its own (unlike AT-1's stub) — used by tests where the fixture ALREADY
 *  planted whatever staging/ content matters and only needs the turn to
 *  complete normally so the runner reaches its post-turn dispatch logic
 *  (the `next`-write / listWrittenFiles code this file's new pins target). */
export function noopAgentQueryFn(): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

/** Recursively snapshot a directory as a sorted { relPath: content } map, for
 *  byte-for-byte before/after comparison. Absent dir ⇒ {}. */
export function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(current: string, rel: string): void {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) out[relPath] = readFileSync(abs, 'utf8');
    }
  }
  if (existsSync(dir)) walk(dir, '');
  return out;
}

/** FORGE_ROOT, not a `..` chain: this fixture sits three levels deeper than
 *  the suite it was extracted from, and re-counting a chain after a move is
 *  what §15.14 exists to stop. */
export const REPO_ROOT = FORGE_ROOT;
/** Loads the REAL "authoring" descriptor from REPO_ROOT and builds an
 *  isolated (never-the-real-repo) forgeRoot/projectRoot/logsRoot tree whose
 *  session dir matches the descriptor's OWN declared `turnSpec.kindDir` —
 *  never a hardcoded `_authoring` literal, so a kindDir drift in the real
 *  yaml surfaces as a containment failure in the tests below rather than a
 *  silently-mismatched fixture path. */
export function setupRealAuthoring(): RealAuthoringFixture {
  const descriptor = loadSessionKinds(REPO_ROOT).find((d) => d.id === 'authoring');
  // Fixture precondition — see the "MUST-precede-verdict" discipline this
  // file already follows: fail the arrangement loudly, naming what's missing,
  // rather than letting a later assertion's failure be ambiguous about
  // whether the REAL yaml is missing the row entirely vs. missing turnSpec.
  if (!descriptor) throw new Error('test fixture bug: REPO_ROOT/studio/session-kinds.yaml has no "authoring" descriptor at all');
  if (!descriptor.turnSpec) {
    throw new Error(
      'REPO_ROOT/studio/session-kinds.yaml "authoring" row has no turnSpec — this IS the RED this suite pins ' +
        '(R4-21 phase 2, WI-1, D1): loadSessionKinds(REPO_ROOT) must return "authoring" WITH a turnSpec whose 4 ' +
        'phase rows deep-equal ADR-043 §1\'s table before this fixture (and every test below) can run at all.',
    );
  }
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-real-authoring-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(forgeRoot, { recursive: true });
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-11T00-00-00';
  const sessionDir = join(projectRoot, descriptor.turnSpec.kindDir, sessionId);
  return { root, forgeRoot, projectRoot, logsRoot, sessionId, sessionDir, descriptor };
}

export type RealAuthoringFixture = {
  root: string;
  forgeRoot: string;
  projectRoot: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
  descriptor: SessionKindDescriptor;
};
