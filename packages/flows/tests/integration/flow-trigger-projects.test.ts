/**
 * ACCEPTANCE TESTS (T3, R2-08-F1) — per-project trigger scoping, `projects:`.
 *
 * Pins ADR-027's R2-08 amendment ("`projects:` — per-project trigger
 * scoping", docs/decisions/027-studio-object-model.md) BEFORE the
 * implementation exists. Landed before F1 ships — every test below is RED
 * against current `main`/this branch's tip except where explicitly marked
 * green-on-arrival (a pin of pre-existing behaviour that must survive F1).
 *
 * PINNED CONTRACT this file locks in (no such fields/status exist yet on the
 * real types — every reference below is a deliberate forward pin, verified
 * at runtime via `--experimental-strip-types`, which erases type annotations
 * without checking them, so these tests run and fail on ASSERTIONS, not on
 * TS compile errors):
 *
 *   - `FlowTrigger.projects?: string[]` (orchestrator/studio/types.ts) — the
 *     declaration field. Absent = unscoped; `[]` = scoped-to-nothing.
 *   - `TriggerCheckOpts.projectIds?: ReadonlySet<string>` (validate-triggers.ts)
 *     — mirrors the existing `flowIds` opt exactly; enables the lint check.
 *     Covered in orchestrator/studio/validate.test.ts, not here.
 *   - `FlowRunRequest.projects?: string[]` — a snapshot of the firing
 *     trigger's OWN `projects:` declaration, carried onto the staged request
 *     (never re-derived from prose at drain time — ADR-041 §5's "no free
 *     text into id/path space" invariant, extended).
 *   - `FlowRunRequest.eventProject?: string | null` — the project id THIS
 *     event resolved to. `null`/absent = unresolved.
 *   - A new `FlowRunDrainStatus` member `'skipped-out-of-scope'`.
 *   - The scoping rule inside `drainFlowRunRequests`:
 *       projects === undefined            → unscoped, unaffected (today's behaviour)
 *       projects !== undefined (scoped):
 *         eventProject unresolved         → 'skipped-out-of-scope' (fail closed)
 *         !projects.includes(eventProject)→ 'skipped-out-of-scope' (identity match)
 *         else                            → dispatch as normal
 *
 * If the implementer lands F1 with different field names, these tests will
 * still be RED and must be renegotiated with T1 — see the accompanying
 * report's "ambiguous / escalate" section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { loadFlowDefinition } from '../../studio/flow-registry.ts';
import {
  stageFlowRunRequest,
  drainFlowRunRequests,
  listFlowRunRequests,
  type FlowRunRequest,
} from '../../flow-run-requests.ts';
import type { FlowTrigger } from '@forge/contracts/studio/types.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function setup(): string {
  return tmp('trig-scope-queue-');
}

/** Runtime-only accessor for the not-yet-typed `projects` field on a parsed
 *  FlowTrigger — avoids depending on the implementer's exact TS type shape. */
function projectsOf(t: FlowTrigger): string[] | undefined {
  return (t as unknown as { projects?: string[] }).projects;
}

type ScopedRequestInput = Omit<FlowRunRequest, 'createdAt'> & {
  createdAt?: string;
  projects?: string[];
  eventProject?: string | null;
};

/**
 * Stage a request carrying the F1-pinned `projects`/`eventProject` fields
 * (not on FlowRunRequest's current TS type — cast through unknown so this
 * compiles regardless of implementation state).
 *
 * `stageFlowRunRequest`'s filename is `flow-run-<target.ref>-<createdAt>.json`
 * with NO collision-uniquification (unlike `mintTriggeredInitiative`'s
 * `idExistsInQueue` loop) — two calls for the SAME target.ref within the same
 * millisecond silently overwrite each other's file. Several tests below stage
 * multiple requests for the same target in a tight loop, so every call here
 * gets a monotonically-increasing, guaranteed-unique `createdAt` rather than
 * relying on wall-clock spacing.
 */
let scopedStageCounter = 0;
function stageScoped(req: ScopedRequestInput, queueRoot: string): void {
  const createdAt = req.createdAt ?? `2026-08-07T00:00:00.${String(scopedStageCounter++).padStart(3, '0')}Z`;
  stageFlowRunRequest(
    { ...req, createdAt } as unknown as Parameters<typeof stageFlowRunRequest>[0],
    { queueRoot },
  );
}

function makeFlowYaml(id: string, project: string, triggerLines: string[]): string {
  return [
    `id: ${id}`,
    `name: ${id}`,
    'version: 1',
    'goal: g',
    `project: ${project}`,
    'kb: null',
    'costCeilingUsd: 2',
    'origin: studio',
    'nodes:',
    '  - id: n',
    '    gate: human',
    'edges: []',
    'triggers:',
    ...triggerLines,
  ].join('\n');
}

function writeFlowYaml(root: string, id: string, yamlText: string): string {
  const dir = join(root, 'studio', 'flows', id);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'flow.yaml');
  writeFileSync(p, yamlText);
  return p;
}

// ---------------------------------------------------------------------------
// F1 #1 — absent vs. declared-empty are distinguishable on the parsed object.
// ---------------------------------------------------------------------------

test('(RED) [F1 #1] projects: absent parses to undefined; projects: [] parses to an empty array — never collapsed', () => {
  const root = tmp('trig-scope-parse-');
  try {
    const absentPath = writeFlowYaml(
      root,
      'absent-flow',
      makeFlowYaml('absent-flow', 'null', [
        '  - on: flow-complete',
        '    target: { kind: flow, ref: other-flow }',
      ]),
    );
    const emptyPath = writeFlowYaml(
      root,
      'empty-flow',
      makeFlowYaml('empty-flow', 'null', [
        '  - on: flow-complete',
        '    target: { kind: flow, ref: other-flow }',
        '    projects: []',
      ]),
    );

    const absentFlow = loadFlowDefinition(absentPath);
    const emptyFlow = loadFlowDefinition(emptyPath);
    assert.equal(absentFlow.triggers.length, 1);
    assert.equal(emptyFlow.triggers.length, 1);

    const absentProjects = projectsOf(absentFlow.triggers[0]);
    const emptyProjects = projectsOf(emptyFlow.triggers[0]);

    assert.equal(
      absentProjects,
      undefined,
      'an absent "projects:" key must parse to undefined (unscoped) — kills an implementation that defaults absent to []',
    );
    assert.deepEqual(
      emptyProjects,
      [],
      'a declared "projects: []" must parse to a real empty array (scoped-to-nothing) — kills an implementation that collapses [] back to undefined',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 #2 — shape errors fail loud at parse/load.
// ---------------------------------------------------------------------------

test('(RED) [F1 #2] a non-list "projects:" value fails loud at load, mirroring the stale "flow:" key precedent', () => {
  const root = tmp('trig-scope-shape-a-');
  try {
    const p = writeFlowYaml(
      root,
      'bad-flow-a',
      makeFlowYaml('bad-flow-a', 'null', [
        '  - on: flow-complete',
        '    target: { kind: flow, ref: other-flow }',
        '    projects: "gitpulse"',
      ]),
    );
    assert.throws(
      () => loadFlowDefinition(p),
      /projects/i,
      'loadFlowDefinition must throw synchronously for a non-list "projects:" value — a lenient parse would let a malformed scope silently become absent/empty',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [F1 #2] a non-string entry inside "projects:" fails loud at load', () => {
  const root = tmp('trig-scope-shape-b-');
  try {
    const p = writeFlowYaml(
      root,
      'bad-flow-b',
      makeFlowYaml('bad-flow-b', 'null', [
        '  - on: flow-complete',
        '    target: { kind: flow, ref: other-flow }',
        '    projects: [gitpulse, 42]',
      ]),
    );
    assert.throws(
      () => loadFlowDefinition(p),
      /projects/i,
      'a non-string entry in "projects:" must fail loud at load, never silently coerced or filtered out',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 #4/#5 — dispatch: two-project fixture, in-scope dispatches, out-of-scope
// does not, and the skip is a distinct typed status observable in results
// AND notify.
// ---------------------------------------------------------------------------

test('(RED) [F1 #4] two-project fixture: an in-scope event dispatches AND an out-of-scope event does not — both assertions in the SAME test (a passive "nothing matched" runner would pass this for the wrong reason if split)', () => {
  const root = setup();
  try {
    stageScoped(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'in-scope-fixture',
        sourceInitiativeId: 'INIT-in-scope',
        projects: ['betterado', 'gitpulse'],
        eventProject: 'gitpulse',
      },
      root,
    );
    stageScoped(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'out-of-scope-fixture',
        sourceInitiativeId: 'INIT-out-of-scope',
        projects: ['betterado', 'gitpulse'],
        eventProject: 'some-other-project',
      },
      root,
    );

    const dispatched: FlowRunRequest[] = [];
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: (r) => {
        dispatched.push(r);
      },
    });

    const dispatchedLabels = dispatched.map((r) => r.triggeredBy);
    assert.ok(
      dispatchedLabels.includes('in-scope-fixture'),
      `expected the in-scope event to dispatch — dispatched: ${JSON.stringify(dispatchedLabels)}`,
    );
    assert.ok(
      !dispatchedLabels.includes('out-of-scope-fixture'),
      `expected the out-of-scope event NOT to dispatch — dispatched: ${JSON.stringify(dispatchedLabels)}`,
    );
    assert.equal(results.length, 2, 'both requests must produce a recorded outcome');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [F1 #5] the out-of-scope case yields a distinct FlowRunDrainStatus member, observable in both the returned results and notify', () => {
  const root = setup();
  try {
    stageScoped(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'oos-status-fixture',
        sourceInitiativeId: 'INIT-oos-status',
        projects: ['gitpulse'],
        eventProject: 'betterado',
      },
      root,
    );

    const notifications: string[] = [];
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => {
        throw new Error('must not be called — the request is out of scope');
      },
      notify: (msg) => notifications.push(msg),
    });

    assert.equal(results.length, 1);
    assert.equal(
      results[0].status,
      'skipped-out-of-scope',
      `expected a NEW status distinct from skipped-concurrency/skipped-no-initiative/skipped-malformed/error/dispatched — got "${results[0].status}"`,
    );
    assert.ok(
      notifications.some((m) => /betterado|gitpulse|scope/i.test(m)),
      `expected the out-of-scope outcome to be surfaced via notify (rule 3: never a silent drop) — got ${JSON.stringify(notifications)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 #6 — projects: [] fires for nothing but still produces the typed skip.
// ---------------------------------------------------------------------------

test('(RED) [F1 #6] projects: [] fires for nothing but still produces the typed skip — kills an implementation that short-circuits an empty scope before recording it', () => {
  const root = setup();
  try {
    stageScoped(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'empty-scope-fixture',
        sourceInitiativeId: 'INIT-empty-scope',
        projects: [],
        eventProject: 'gitpulse',
      },
      root,
    );

    let dispatchCalled = false;
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => {
        dispatchCalled = true;
      },
    });

    assert.equal(dispatchCalled, false);
    assert.equal(results.length, 1, 'the empty-scope request must still produce ONE recorded outcome, not vanish silently');
    assert.equal(results[0].status, 'skipped-out-of-scope');
    assert.equal(
      listFlowRunRequests({ queueRoot: root }).length,
      0,
      'a recorded skip still clears the request file, mirroring the sibling skip kinds',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 #7 — an unresolvable event project fails closed when scoped, but leaves
// the unscoped path completely unaffected (green-on-arrival half).
// ---------------------------------------------------------------------------

test('(RED) [F1 #7a] an unresolvable event project against a SCOPED trigger fails closed — no "undeclared ⇒ allow all" arm', () => {
  const root = setup();
  try {
    stageScoped(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'unresolved-scoped-fixture',
        sourceInitiativeId: 'INIT-unresolved-scoped',
        projects: ['gitpulse'],
        eventProject: null,
      },
      root,
    );

    let dispatchCalled = false;
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => {
        dispatchCalled = true;
      },
    });

    assert.equal(dispatchCalled, false, 'an unresolvable project against a scoped trigger must never dispatch');
    assert.equal(results[0].status, 'skipped-out-of-scope');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(green-on-arrival) [F1 #7b] an unresolvable event project against an UNSCOPED trigger still dispatches, exactly as today — kills a fix that breaks the pre-existing unscoped path while closing the scoped one', () => {
  const root = setup();
  try {
    stageScoped(
      {
        target: { kind: 'flow', ref: 'demo-runner-flow' },
        origin: 'trigger',
        triggeredBy: 'unresolved-unscoped-fixture',
        sourceInitiativeId: 'INIT-unresolved-unscoped',
        // projects intentionally absent — unscoped.
        eventProject: null,
      },
      root,
    );

    let dispatchCalled = false;
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => {
        dispatchCalled = true;
      },
    });

    assert.equal(
      dispatchCalled,
      true,
      "an unscoped trigger must be completely unaffected by a resolution failure — this is TODAY's behaviour and must stay green after F1 ships",
    );
    assert.equal(results[0].status, 'dispatched');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 #8 — containment: a payload/event-derived project id must never escape
// the projects root, regardless of shape. Plant the sentinel directly; assert
// the artifact (byte-unchanged file, no minted manifest), not a status code.
// ---------------------------------------------------------------------------

test('(RED) [F1 #8] a malicious event-derived project id never escapes the projects root and never mints a manifest, across five escape shapes', () => {
  const forgeRoot = tmp('trig-scope-containment-forgeroot-');
  const outsideDir = tmp('trig-scope-containment-outside-');
  try {
    mkdirSync(join(forgeRoot, '_queue'), { recursive: true });
    mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
    mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
    // A REAL, legitimate project on disk — the flow's own binding.
    mkdirSync(join(forgeRoot, 'projects', 'gitpulse'), { recursive: true });
    writeFileSync(join(outsideDir, 'SENTINEL.txt'), 'containment sentinel\n');

    // The target flow needs no triggers declared on itself — the mint reads
    // flow.project directly; the scoping trigger lives on the STAGED request
    // (mirroring how a real firing site would have already resolved it).
    const flowId = 'containment-flow';
    writeFlowYaml(forgeRoot, flowId, makeFlowYaml(flowId, 'gitpulse', []));

    const outsideBasename = basename(outsideDir);
    const maliciousIds: Array<{ label: string; id: string | null }> = [
      { label: 'relative traversal', id: `../../${outsideBasename}` },
      { label: 'percent-encoded traversal', id: `..%2F..%2F${outsideBasename}` },
      { label: 'absolute path', id: outsideDir },
      { label: 'escape-and-return (normalizes onto the legit id)', id: 'gitpulse/../gitpulse' },
      { label: 'empty string', id: '' },
    ];

    const sentinelBefore = readFileSync(join(outsideDir, 'SENTINEL.txt'), 'utf8');

    for (const { label, id } of maliciousIds) {
      stageScoped(
        {
          target: { kind: 'flow', ref: flowId },
          origin: 'webhook',
          triggeredBy: `containment-${label.replace(/[^a-z0-9]+/gi, '-')}`,
          projects: ['gitpulse'],
          eventProject: id,
        },
        join(forgeRoot, '_queue'),
      );
    }

    const results = drainFlowRunRequests({ queueRoot: join(forgeRoot, '_queue'), forgeRoot });

    assert.equal(
      readFileSync(join(outsideDir, 'SENTINEL.txt'), 'utf8'),
      sentinelBefore,
      'the outside sentinel bytes must be byte-unchanged after draining every malicious variant',
    );

    const pendingDir = join(forgeRoot, '_queue', 'pending');
    const mintedForThisFlow = existsSync(pendingDir)
      ? readdirSync(pendingDir).filter((f) => f.endsWith('.md') && readFileSync(join(pendingDir, f), 'utf8').includes(`flow_id: ${flowId}`))
      : [];
    assert.equal(
      mintedForThisFlow.length,
      0,
      `expected NO manifest minted for any of the 5 malicious ids (none identity-match "gitpulse") — found ${mintedForThisFlow.length}: ${JSON.stringify(mintedForThisFlow)}. Drain results: ${JSON.stringify(results)}`,
    );

    assert.ok(
      results.every((r) => (r.status as string) === 'skipped-out-of-scope'),
      `expected every malicious-id request to be a typed out-of-scope skip — got ${JSON.stringify(results.map((r) => r.status))}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F1 #9 — identity match, never prefix/substring/containment.
// ---------------------------------------------------------------------------

test('(RED) [F1 #9] scope matching is strict IDENTITY, not prefix/substring — projects:[gitpulse] must not match near-miss ids', () => {
  const root = setup();
  try {
    const nearMisses = ['gitpulse-evil', 'x/gitpulse', 'gitpulseX', 'Xgitpulse', 'GITPULSE'];
    nearMisses.forEach((badId, i) => {
      stageScoped(
        {
          target: { kind: 'flow', ref: 'demo-runner-flow' },
          origin: 'trigger',
          triggeredBy: `identity-fixture-${i}`,
          sourceInitiativeId: `INIT-identity-${i}`,
          projects: ['gitpulse'],
          eventProject: badId,
        },
        root,
      );
    });

    let dispatchCalled = false;
    const results = drainFlowRunRequests({
      queueRoot: root,
      startFlowRun: () => {
        dispatchCalled = true;
      },
    });

    assert.equal(
      dispatchCalled,
      false,
      'a substring/prefix "match" must never dispatch — kills an implementation using .includes()/startsWith() cross-string, or case-insensitive comparison, instead of a strict identity check',
    );
    assert.ok(
      results.every((r) => (r.status as string) === 'skipped-out-of-scope'),
      `expected every near-miss id to be a typed out-of-scope skip — got ${JSON.stringify(results.map((r) => r.status))}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
