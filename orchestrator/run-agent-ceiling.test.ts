/**
 * Acceptance tests for WI-2 (R6-04): the per-kickoff cost ceiling, wired to
 * runAgent's EXISTING SDK-budget enforcement path (`options.maxBudgetUsd`).
 *
 * ============================================================================
 * HONESTY BOUND (read before trusting a green run of this file)
 * ============================================================================
 * Forge does NOT enforce the kickoff ceiling in-process. The Claude Agent SDK
 * is the thing that actually halts an over-budget run — exactly as it already
 * does for an agent's own declared `budgets.maxBudgetUsd`. Every test below
 * either:
 *   (a) asserts that the operator's ceiling value reaches `options.maxBudgetUsd`
 *       — the exact call record the SDK reads to decide whether to stop a run
 *       (a real, observable fact about what runAgent sends downstream), or
 *   (b) *simulates* the SDK's stop by injecting a `queryFn` stub that yields a
 *       `result` message with `subtype: 'error_max_budget_usd'`, then asserts
 *       runAgent surfaces that stop distinctly (never silently as success).
 * No test here asserts or implies that forge itself halts spend mid-run. If a
 * later reader is tempted to read a green run as "forge enforces the budget",
 * that reading is wrong — re-read this header.
 * ============================================================================
 *
 * The prescribed contract (from the WI): runOneShotSpawn's effective budget
 * becomes `ctx.kickoffCeilingUsd ?? resolveOneShotBudgetUsd(def.budgets, initiative)`
 * — an explicit per-run operator ceiling WINS over the agent's own declared
 * budget (not max()/min() of the two), and when absent, today's behaviour
 * (resolveOneShotBudgetUsd alone) is unchanged, including the "no cap ⇒ the
 * `maxBudgetUsd` key is absent from options, not present-as-undefined" case
 * already pinned for the declared-budget path in run-agent.test.ts.
 *
 * Two new pieces of surface are expected to land:
 *   - `RunContext.kickoffCeilingUsd?: number` on `./run-agent.ts` (a ctx
 *     field, not exported as a symbol — just a type-level addition; nothing
 *     to import for it)
 *   - `MAX_KICKOFF_COST_CEILING_USD` — the sane absolute maximum an operator
 *     ceiling may not exceed (validated at the bridge route; imported here
 *     only so this file never hardcodes the number, matching the sibling
 *     bridge ceiling test).
 * PLACEMENT RATIFIED (round 2): `MAX_KICKOFF_COST_CEILING_USD` lives in
 * `./config.ts`, alongside the established `DEFAULT_*`/`MAX_*` policy-bound
 * cluster (`DEFAULT_TRIGGERED_RUN_COST_BUDGET_USD`, `DEV_WI_CONCURRENCY_CEILING`,
 * …) rather than in `./run-agent.ts` (round-1's initial guess) — both the
 * kickoff default and its ceiling are run-level policy, not runAgent's own
 * concern; splitting them across two modules would leave `run-agent.ts`
 * holding validation policy it never applies itself.
 *
 * Until that lands, importing `MAX_KICKOFF_COST_CEILING_USD` fails at module
 * load (an import error) — a legitimate RED for a not-yet-existing export,
 * not a fixture/environment problem.
 *
 * ROUND 2 FIX: every test below that injects a `queryFn` it expects to
 * actually be INVOKED now wraps its `runAgent`/`dispatchAgentRun` call with
 * `withoutSpawnSuppressionEnv()`. Round 1 omitted this — `runAgent`'s
 * self-lifecycle path checks `FORGE_DRY_BRIDGE`/`FORGE_ARCHITECT_NO_SPAWN`
 * UNCONDITIONALLY, even when `ctx.queryFn` is injected, and short-circuits to
 * a suppressed result BEFORE ever calling it. Every assertion in this file
 * happened to still prove the intended RED under a clean local shell (neither
 * var was ambient), but the guard is required for correctness regardless of
 * ambient CI env — `run-agent.test.ts` establishes exactly this precedent and
 * calls out in its own comments that CI sets `FORGE_ARCHITECT_NO_SPAWN=1` as
 * an inherited env step.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent, resolveOneShotBudgetUsd } from './run-agent.ts';
import { MAX_KICKOFF_COST_CEILING_USD } from './config.ts';
import { dispatchAgentRun } from './agent-dispatch.ts';
import { listAgentDefinitions } from './studio/registry.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';

const ROOT = process.cwd();

/**
 * Save + delete BOTH spawn-suppression env vars so a test that injects a
 * `queryFn` it expects to actually be INVOKED runs deterministically,
 * regardless of what the ambient shell/CI has set (mirrors
 * `run-agent.test.ts`'s identical helper — redefined locally since that file
 * does not export it). Call the returned restore function from a `finally`.
 */
function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

/** Look up a named library fixture from the real roster (mirrors
 * run-agent.test.ts's identical helper — redefined locally since that file
 * does not export it). */
function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def;
}

/** Clone a roster def with a declared one-shot runtime + optional budget caps
 * (mirrors run-agent.test.ts's identical helper). */
function oneShotClone(
  def: AgentDefinition,
  budgets: AgentDefinition['budgets'] = {},
): AgentDefinition {
  return {
    ...def,
    runtime: { ...def.runtime, loopStrategy: 'one-shot' },
    budgets,
  };
}

/** A capturing queryFn: records {prompt, options} and yields the given
 * message stream (default: one assistant message then a plain success
 * result) — mirrors run-agent.test.ts's identical helper. */
function capturingQueryFn(
  calls: Array<{ prompt: string; options: Record<string, unknown> }>,
  messages?: unknown[],
): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    async function* gen() {
      for (const m of messages ?? [
        { type: 'assistant', message: { content: [] } },
        {
          type: 'result',
          subtype: 'success',
          total_cost_usd: 0.33,
          duration_ms: 1234,
          usage: { input_tokens: 7, output_tokens: 9 },
        },
      ]) {
        yield m;
      }
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function readEvents(logFilePath: string): Array<Record<string, unknown>> {
  return readFileSync(logFilePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Recursively scan a JSON-shaped value for a needle (number matched exactly,
 * string matched as a substring). Used ONLY where the WI does not prescribe
 * an exact field/key name for a recorded fact (the ceiling-in-force + SDK
 * subtype inside the `end` event's metadata) — a specific key-path assertion
 * there would pin an implementation detail the WI leaves to the implementer,
 * and a wrong guess would make this test permanently red for the wrong
 * reason. Distinct, low-collision-probability numeric fixture values are
 * used at every call site to keep this a meaningful pin rather than a
 * decorative one. */
function deepIncludes(value: unknown, needle: number | string): boolean {
  if (typeof needle === 'number') {
    if (typeof value === 'number' && value === needle) return true;
  } else if (typeof value === 'string' && value.includes(needle)) {
    return true;
  }
  if (Array.isArray(value)) return value.some((v) => deepIncludes(v, needle));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => deepIncludes(v, needle));
  }
  return false;
}

// ---------------------------------------------------------------------------
// (A) Precedence: ctx.kickoffCeilingUsd ?? resolveOneShotBudgetUsd(...)
// Assert the CALL RECORD (the captured SDK `options` object), not merely an
// outcome — this is the exact defect class the WI names: a declared value
// that is parsed and surfaced but never reaches the thing that enforces it.
// ---------------------------------------------------------------------------

test('runAgent one-shot: ctx.kickoffCeilingUsd reaches options.maxBudgetUsd verbatim when the agent declares no budget at all (kills "the ceiling is parsed but never wired to the SDK call")', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a1-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {});
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      kickoffCeilingUsd: 0.75,
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].options.maxBudgetUsd,
      0.75,
      'the operator kickoff ceiling must reach options.maxBudgetUsd — the exact value the SDK reads to decide when to stop',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: no ctx.kickoffCeilingUsd ⇒ options.maxBudgetUsd falls back to resolveOneShotBudgetUsd(def.budgets, initiative) unchanged (fallback direction, today\'s behaviour preserved)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a2-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const budgets: AgentDefinition['budgets'] = { maxBudgetUsd: 3 };
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), budgets);
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const expected = resolveOneShotBudgetUsd(budgets, undefined);

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      // Deliberately NO kickoffCeilingUsd.
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls[0].options.maxBudgetUsd, expected);
    assert.equal(expected, 3, 'sanity: resolveOneShotBudgetUsd itself must resolve the flat floor');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: neither kickoffCeilingUsd nor a declared budget ⇒ the "maxBudgetUsd" key is ABSENT from options, not set to undefined (kills an unconditional-assignment implementation)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a3-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {});
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(
      'maxBudgetUsd' in calls[0].options,
      false,
      'a wrong implementation that does `options.maxBudgetUsd = ctx.kickoffCeilingUsd ?? resolveOneShotBudgetUsd(...)` unconditionally would leave the key present with value undefined — `in` catches that, unlike `=== undefined`',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: an operator ceiling SMALLER than the declared flat budget still wins (kills a max()-of-the-two implementation)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a4a-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), { maxBudgetUsd: 100 });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      kickoffCeilingUsd: 5,
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(
      calls[0].options.maxBudgetUsd,
      5,
      'max(100, 5) would wrongly give 100 — the operator ceiling must win regardless of magnitude',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: an operator ceiling LARGER than the declared flat budget still wins (kills a min()-of-the-two implementation, and a "declared budget always wins" implementation)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a4b-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), { maxBudgetUsd: 2 });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      kickoffCeilingUsd: 50,
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(
      calls[0].options.maxBudgetUsd,
      50,
      'min(2, 50) would wrongly give 2, and a "declared budget wins" implementation would also wrongly give 2',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot: an operator ceiling wins over a maxBudgetUsdShare-derived budget too (not just the flat maxBudgetUsd field)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a5-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), { maxBudgetUsdShare: 0.5 });
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '',
      workdir,
      prompt: 'p',
      lifecycle: 'caller',
      bindings: { initiative: { id: 'init-1', costBudgetUsd: 100 } }, // share resolves to 50
      kickoffCeilingUsd: 3,
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(
      calls[0].options.maxBudgetUsd,
      3,
      'the share-derived budget (50) must not leak through — an implementation that only special-cases the flat maxBudgetUsd field for precedence would wrongly give 50 here',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot + SELF lifecycle: ctx.kickoffCeilingUsd reaches options.maxBudgetUsd exactly as in the caller-lifecycle path (the plumbing is not lifecycle-specific)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-a6-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {});
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await runAgent(def, {
      runId: '_agent-ceiling-self',
      workdir,
      prompt: 'p',
      logsRoot,
      kickoffCeilingUsd: 1.23,
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(calls[0].options.maxBudgetUsd, 1.23);
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// dispatchAgentRun (agent-dispatch.ts) — the IN-PROCESS half of "dispatch
// path → ctx": `DispatchAgentRunOpts` must grow a kickoffCeilingUsd-shaped
// field and thread it through to runAgent's ctx unchanged. The OTHER half —
// the CLI-argv boundary (`spawnAgentDispatch`'s pure arg-builder →
// `cmdAgentDispatch`'s parse → this same `dispatchAgentRun` call) — is pinned
// in the sibling `cli/ui-bridge-agent-run-ceiling.test.ts`, because both
// `buildAgentDispatchArgs` and `cmdAgentDispatch` are cli/-layer symbols;
// importing them here would invert forge's cli/ → orchestrator/ dependency
// direction.
// ---------------------------------------------------------------------------

// =============================================================================
// R6-04 WI-2 ROUND 7 — spawner ruling on an adversarial-review finding:
// `dispatchAgentRun`'s ORIGINAL test #8 (below, now split into a refusal/
// positive-control pair) drove the REAL `project-scoped-review` fixture
// WITHOUT a one-shot override and expected the ceiling to THREAD. It failed;
// the implementer's first read was "missing oneShotClone in the test". The
// review checked the real roster instead: of 19 dispatchable agents (surface
// != interactive), only 4 declare `loopStrategy: 'one-shot'` (ceiling
// enforceable via `options.maxBudgetUsd`); 1 declares `'ralph'` (already
// throws, unrelated reason); the remaining 14 declare NO loopStrategy at all
// and take `runInvocationSpawn` (the legacy adapter path), which has NO
// budget concept whatsoever — for those 14, an operator-set ceiling would be
// validated, recorded, shown in the UI, and silently unenforced. Test #8 was
// the ONLY test in either ceiling file driving a real roster agent as
// actually dispatched, which is exactly why it was the only one that saw
// this — every other test proves the plumbing works FOR the one-shot class,
// none of them prove the plumbing is REFUSED for everyone else.
//
// RULING: R6-04 ships FAIL CLOSED. A ceiling that cannot be enforced is
// REFUSED, never silently accepted, at BOTH layers:
//   - `runAgent` throws when `ctx.kickoffCeilingUsd` is set and
//     `def.runtime.loopStrategy !== 'one-shot'` — pinned directly below.
//   - The bridge route ALSO refuses (400) before any spawn — pinned in
//     cli/ui-bridge-agent-run-ceiling.test.ts, since `forge agent dispatch
//     --cost-ceiling-usd` is a real second entry point that never passes
//     through the bridge at all; a route-only guard would leave the CLI
//     silently ignoring the ceiling — the same defect, one door over.
//
// Message wording (delegated to me, per the ruling's "e.g." example, adopted
// verbatim as MY pinned choice since it already names both the reason and
// the enforceable class cleanly): every refusal message must contain the
// substring "ceiling not enforceable for this agent's loop strategy" AND
// separately name "one-shot" as the enforceable class. Asserted as two
// substring matches (not a single full-string comparison) so a reasonable
// implementer's exact surrounding prose/prefix isn't over-constrained — the
// ruling gave an example, not a verbatim template this time (contrast with
// the WI-1 gate-refusal messages, which WERE given as an exact template and
// are asserted with full-string equality there).
// =============================================================================

test('dispatchAgentRun: kickoffCeilingUsd against the REAL roster agent "project-scoped-review" (undeclared loopStrategy on disk — the legacy-path case for 14 of 19 dispatchable agents) is REFUSED, not silently threaded. This is the amended test #8: it keeps its original value (the one test in either ceiling file driving a real roster agent as actually dispatched) but now pins the refusal the review found missing, not the threading the review found wrong', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-dispatch-refuse-'));
  try {
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    await assert.rejects(
      dispatchAgentRun({
        slug: 'project-scoped-review',
        skillsDir: join(ROOT, 'skills'),
        runId: '_agent-dispatch-ceiling-refuse',
        logsRoot: join(scratchRoot, '_logs'),
        workdir: mkdtempSync(join(scratchRoot, 'wd-')),
        kickoffCeilingUsd: 0.6,
        queryFn: capturingQueryFn(calls),
      }),
      (err: Error) => {
        assert.match(err.message, /ceiling not enforceable for this agent's loop strategy/, `expected the pinned reason in the error message — got: ${JSON.stringify(err.message)}`);
        assert.match(err.message, /one-shot/, `expected the enforceable class named in the error message — got: ${JSON.stringify(err.message)}`);
        return true;
      },
    );
    assert.equal(calls.length, 0, 'the refusal must happen BEFORE any SDK call is attempted — nothing may reach the spawn point');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('dispatchAgentRun: ONE-SHOT POSITIVE CONTROL, paired deliberately alongside the refusal test above — the SAME agent, SAME kickoffCeilingUsd, but cloned to loopStrategy:"one-shot" is ACCEPTED and threads to options.maxBudgetUsd exactly as before. Without this pair, the refusal test could pass for a trivial reason (e.g. an implementation that refuses EVERY ceiling, one-shot or not) — this is the control that forces the guard to be genuinely conditional on loopStrategy, not a blanket rejection', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-dispatch-oneshot-'));
  try {
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const base = getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review');
    const out = await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: join(ROOT, 'skills'),
      runId: '_agent-dispatch-ceiling-oneshot',
      logsRoot: join(scratchRoot, '_logs'),
      workdir: mkdtempSync(join(scratchRoot, 'wd-')),
      kickoffCeilingUsd: 0.6,
      loadDefs: () => [oneShotClone(base)],
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(out.slug, 'project-scoped-review');
    assert.equal(
      calls[0]?.options.maxBudgetUsd,
      0.6,
      'a one-shot agent must still accept and thread the ceiling — the new guard must not have widened into refusing everyone',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('dispatchAgentRun: NEGATIVE TWIN, load-bearing — no kickoffCeilingUsd at all against the SAME non-one-shot agent behaves EXACTLY as it does today: no refusal, no maxBudgetUsd anywhere in the SDK call. This is the path every ordinary dispatch of the 14 non-one-shot roster agents takes; if the new refusal leaked into this case, most of the roster would break to add a limit feature', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-dispatch-negtwin-'));
  try {
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const out = await dispatchAgentRun({
      slug: 'project-scoped-review',
      skillsDir: join(ROOT, 'skills'),
      runId: '_agent-dispatch-ceiling-negtwin',
      logsRoot: join(scratchRoot, '_logs'),
      workdir: mkdtempSync(join(scratchRoot, 'wd-')),
      // Deliberately no kickoffCeilingUsd — the ordinary, ubiquitous case.
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(out.slug, 'project-scoped-review');
    assert.equal(calls.length, 1, 'the legacy path must still genuinely proceed to the real SDK call — this is not a refusal, and the run must actually happen');
    assert.equal(
      Object.prototype.hasOwnProperty.call(calls[0]?.options ?? {}, 'maxBudgetUsd'),
      false,
      'the legacy path has no budget concept at all — "maxBudgetUsd" must never appear in its SDK call options, with or without this feature',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: throws directly when ctx.kickoffCeilingUsd is set and the agent\'s loopStrategy is not "one-shot" — the SECOND enforcement layer (guard symmetry). "forge agent dispatch --cost-ceiling-usd" never passes through the bridge route at all, so the route\'s own 400 alone would leave this CLI path silently ignoring the ceiling — the same defect, one door over', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-direct-refuse-'));
  try {
    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const def = getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'); // real, undeclared loopStrategy
    await assert.rejects(
      runAgent(def, {
        runId: '_agent-runagent-ceiling-refusal',
        workdir: mkdtempSync(join(scratchRoot, 'wd-')),
        prompt: 'irrelevant — the refusal must happen before this is ever used',
        logsRoot: join(scratchRoot, '_logs'),
        kickoffCeilingUsd: 1.5,
        queryFn: capturingQueryFn(calls),
      } as Parameters<typeof runAgent>[1]),
      (err: Error) => {
        assert.match(err.message, /ceiling not enforceable for this agent's loop strategy/, `expected the pinned reason — got: ${JSON.stringify(err.message)}`);
        assert.match(err.message, /one-shot/, `expected the enforceable class named — got: ${JSON.stringify(err.message)}`);
        return true;
      },
    );
    assert.equal(calls.length, 0, 'the refusal must happen BEFORE any SDK call is attempted');
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (C) A ceiling-stopped run surfaces as a DISTINCT terminal state — the
// run-agent-level half. The GET /api/agents/runs/:runId half (the bridge's
// derived `state` token) is pinned in cli/ui-bridge-agent-run-ceiling.test.ts.
// Here we pin what runAgent itself records into `_logs/<runId>/events.jsonl`.
// ---------------------------------------------------------------------------

test('runAgent one-shot + self lifecycle: a ceiling-stop (SDK subtype error_max_budget_usd) still returns the runaway cost + subtype, and records BOTH the ceiling-in-force and the SDK subtype into the end event (kills "a budget-stopped run is logged identically to a clean success")', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-c-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {});
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');
    const runId = '_agent-ceiling-stop';

    // Distinctive, low-collision values: the ceiling (0.37) differs from the
    // runaway cost (0.6109) and from any other numeric field runAgent logs
    // (duration_ms, tokens_in/out) — a coincidental deepIncludes match on the
    // wrong field is implausible.
    const CEILING = 0.37;
    const RUNAWAY_COST = 0.6109;

    const runaway: StreamQueryFn = (() => {
      async function* gen() {
        yield {
          type: 'result',
          subtype: 'error_max_budget_usd',
          total_cost_usd: RUNAWAY_COST,
          duration_ms: 9999,
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const result = await runAgent(def, {
      runId,
      workdir,
      prompt: 'p',
      logsRoot,
      kickoffCeilingUsd: CEILING,
      queryFn: runaway,
    });

    // The RunAgentResult surface (already correctly threaded today — asserted
    // here as a precondition for the events.jsonl check below, not as the
    // novel part of this test).
    assert.equal(result.resultSubtype, 'error_max_budget_usd');
    assert.equal(result.costUsd, RUNAWAY_COST, 'the reported cost must be the runaway cost, not zero');

    const events = readEvents(join(logsRoot, runId, 'events.jsonl'));
    const end = events.find((e) => e.event_type === 'end');
    assert.ok(end, 'expected an end event even for a ceiling-stopped run (it must not throw/crash the lifecycle)');
    assert.equal(end!.cost_usd, RUNAWAY_COST);

    // NEW facts this WI requires runAgent to record. The exact field/key path
    // is an implementer choice the WI does not prescribe, so this is a
    // value-presence scan over the whole end event (see deepIncludes doc
    // comment above) rather than a specific key assertion.
    assert.ok(
      deepIncludes(end, CEILING),
      `expected the end event to record the ceiling that was in force (${CEILING}) somewhere in its payload — today runAgent's end-event metadata only carries {agent_phase, agent_slug}, so this is currently absent`,
    );
    assert.ok(
      deepIncludes(end, 'error_max_budget_usd'),
      'expected the end event to record the SDK result subtype somewhere in its payload — today resultSubtype is computed and returned from runOneShotSpawn but never logged into the end event',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent one-shot + self lifecycle: an ordinary successful run does NOT falsely carry a ceiling-stop subtype (control — proves the C test above is not vacuously true for every end event)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'run-agent-ceiling-c-control-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = oneShotClone(getFixtureDef(defs, 'project-scoped-review'), {});
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');
    const runId = '_agent-ceiling-control';

    const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const result = await runAgent(def, {
      runId,
      workdir,
      prompt: 'p',
      logsRoot,
      kickoffCeilingUsd: 9,
      queryFn: capturingQueryFn(calls),
    });

    assert.equal(result.resultSubtype, 'success');
    const events = readEvents(join(logsRoot, runId, 'events.jsonl'));
    const end = events.find((e) => e.event_type === 'end');
    assert.ok(end);
    assert.ok(
      !deepIncludes(end, 'error_max_budget_usd'),
      'a clean success must never carry the ceiling-stop subtype anywhere in its end event',
    );
  } finally {
    restoreEnv();
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (B), the constant itself — the run-agent-owned half of "import the
// constant; do not hardcode the number". The bridge's use of it as a
// validation boundary is pinned in the sibling ui-bridge ceiling test.
// ---------------------------------------------------------------------------

test('MAX_KICKOFF_COST_CEILING_USD: exported, finite, and strictly positive (a sane absolute maximum, not a placeholder)', () => {
  assert.equal(typeof MAX_KICKOFF_COST_CEILING_USD, 'number');
  assert.ok(Number.isFinite(MAX_KICKOFF_COST_CEILING_USD));
  assert.ok(MAX_KICKOFF_COST_CEILING_USD > 0);
});
