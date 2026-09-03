/**
 * PORTS 5–6 BEFORE/AFTER EVIDENCE — the pin that replaces a spawn-capture golden.
 *
 * `brain-fix-runner.ts` and `preflight-fix-runner.ts` are the last two bespoke
 * runners (M4 exit row 3, ruling 60/62). Unlike the four `AGENT_RUNNERS` kinds
 * ported in s3, **neither has a spawn-capture golden**: they are
 * `apps/forge/cli.ts` subcommands, they were never in the R4-22 WI-0 baseline,
 * and `orchestrator/test-fixtures/spawn-capture/` is an IMMUTABLE pinned set
 * this lane may not extend. So the byte-identical proof the first four ports
 * enjoyed does not exist for these two, and this file is what stands in for it.
 *
 * It is recorded on MAIN, BEFORE any code moves, deliberately: a pin written in
 * the same PR as the port can be tuned to the port. Landing it first means the
 * fixtures on disk describe the pre-port runners and nothing else, so the port
 * PR's only honest move is to leave them unchanged.
 *
 * WHAT IS PINNED, per runner, from ONE real turn driven through the injected
 * `queryFn` seam:
 *
 *   1. `prompt` — the whole assembled string (skill prompt + user payload).
 *   2. `options` CONTENT — every key the runner hands the SDK, deep-compared.
 *   3. `optionsKeyOrder` — the insertion order of those keys, pinned
 *      SEPARATELY and on purpose. Key order is not behaviour, but it IS a
 *      byte-level difference, and a port that reorders the bag must DISCLOSE
 *      that rather than have it hide inside a deep-equal. If the port changes
 *      this array and nothing else, that is the finding, in the open.
 *   4. the returned result object.
 *   5. the full event log — every event's `event_type`, `phase`, `skill`,
 *      `initiative_id`, `message`, `metadata`, `input_refs`, `output_refs`,
 *      and whether `cost_usd` is present — in order.
 *   6. the observable filesystem effects the turn is responsible for (the
 *      `_logs/<cycle>/` dir, its `.heartbeat`, `events.jsonl`).
 *
 * WHAT IS NORMALISED (and why each is not behaviour): mkdtemp roots and the
 * paths under them (a fresh temp dir per run), `event_id`/`parent_event_id`
 * (uuids), `ts`/`duration_ms` (clocks), and `canUseTool`/`hooks`/
 * `abortController` (functions and instances — a function's identity is not
 * comparable, so its PRESENCE and the key it sits on are what get pinned).
 * `model`, `allowedTools` and `disallowedTools` come from the REAL
 * `skills/<name>/SKILL.md` frontmatter via `deriveAgentSpec` at module load
 * and are captured VERBATIM — a port that changes the tool grant or the model
 * reaching the SDK is exactly the wrong implementation this pin must kill.
 *
 * The skill PROMPT, by contrast, is read from a fixture `SKILL.md` planted in
 * the temp root (both runners resolve it through `skillPath(name, forgeRoot)`),
 * so the pin is sensitive to a prompt-ASSEMBLY regression without being
 * coupled to unrelated SKILL.md prose edits — the same split
 * `interactive-runners-golden.test.ts` draws with `skillPromptPath`.
 *
 * The message sequence the stub yields exercises EVERY branch of the stream
 * loop both runners hand-roll — `tool_use`, `text`, `thinking`,
 * `redacted_thinking`, then `result` with a cost — so a port that drops one
 * sink cannot pass by never reaching it.
 *
 * ONE THING THIS PIN CANNOT SEE, stated rather than left implicit: `hooks`.
 * Both runners call `sdkHooksForAgent` WITHOUT a `forgeRoot`, so it resolves
 * against the REAL repo (its module-level `FORGE_ROOT`) and returns undefined
 * for both skills — the key is absent from the captured bag, and a port that
 * DROPPED the wiring entirely would capture identically. That hole is closed by
 * an existing guard, not by this one: `packages/agents/hook-dispatch-coverage.test.ts`
 * enumerates every file that value-imports the pinned query and fails unless it
 * wires hook dispatch or carries a named exemption. A port must keep that
 * ratchet's census whole — the spawn-capable file MOVES, so the name shifts and
 * the count must not (COMMON §15.82/.85).
 *
 * FOUR ARMS, because the happy path cannot see the other three: brain-fix and
 * preflight-fix on a resolvable, succeeding turn; brain-fix with an
 * UNRESOLVABLE kbId (its deliberate fail-closed fence); and brain-fix on a
 * THROWING stream (the error event, the gate that still runs, the end event
 * that must not appear). Each arm's own header says which wrong port it kills.
 *
 * GREEN ON ARRIVAL: this is a characterization pin, so it proves itself by
 * MUTATION, not by starting red. The mutations run and their results are in
 * the PR body.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBrainFixTurn } from '../../brain-fix-runner.ts';
import { runPreflightFixTurn } from '../../preflight-fix-runner.ts';

/**
 * `test-fixtures/` is the repo's own marker for non-production test data:
 * `scripts/check-owner.mjs`'s NOT_PRODUCTION regex excludes any such
 * directory, and `packages/knowledge/tests/{unit,integration,regression}/
 * test-fixtures/` is the in-package precedent. A pin belongs in a data file,
 * and this keeps it out of the package's production LOC by the convention
 * already encoded in the guards rather than by a denominator invented for
 * one PR.
 */
const FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'test-fixtures', 'fix-turn');

/** Set `FIX_TURN_CAPTURE_WRITE=1` to (re-)record. Never in CI, never silently. */
const WRITE = process.env.FIX_TURN_CAPTURE_WRITE === '1';

// ---------------------------------------------------------------------------
// Capture plumbing
// ---------------------------------------------------------------------------

type Captured = { prompt: string; options: Record<string, unknown> };

/**
 * The stub `queryFn`. Records what reached the SDK, then yields one message of
 * every kind the runners' loops branch on. `effect` is the agent's "edit",
 * applied at the point the real agent's first tool call would land.
 */
function recordingQuery(sink: Captured[], effect?: () => void) {
  return ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
    sink.push({ prompt, options });
    async function* gen(): AsyncGenerator<unknown> {
      effect?.();
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '  pinned thinking block  ' },
            { type: 'redacted_thinking', data: 'opaque-never-captured' },
            { type: 'text', text: '  pinned reasoning text  ' },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/pinned/target' } },
          ],
        },
      };
      // A second assistant message, so `toolSeq` advances past 0.
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/pinned/read' } }] },
      };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.0042 };
    }
    return gen();
  };
}

/** Replace every run-varying string with a stable placeholder. */
function makeScrubber(subs: ReadonlyArray<readonly [string, string]>) {
  // Longest first: `<ROOT>/projects/p` must not be rewritten as `<ROOT>`-then-tail.
  const ordered = [...subs].sort((a, b) => b[0].length - a[0].length);
  return function scrub(value: unknown): unknown {
    if (typeof value === 'string') {
      let out = value;
      for (const [from, to] of ordered) out = out.split(from).join(to);
      return out;
    }
    if (typeof value === 'function') return '<fn>';
    if (Array.isArray(value)) return value.map(scrub);
    if (value instanceof AbortController) return '<AbortController>';
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrub(v);
      return out;
    }
    return value;
  };
}

/**
 * Clocks and uuids. `started_at` is the field `createLogger` actually writes —
 * enumerated from a recorded capture, not guessed, because a volatile field
 * left OUT of this set makes the pin fail on its own second run, and a stable
 * field wrongly put IN it makes the pin blind to a real change.
 */
const VOLATILE_EVENT_KEYS = new Set([
  'event_id', 'parent_event_id', 'started_at', 'ended_at', 'ts', 'timestamp', 'duration_ms',
]);

/** One event, reduced to the fields a port must preserve. */
function scrubEvent(raw: Record<string, unknown>, scrub: (v: unknown) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort()) {
    if (VOLATILE_EVENT_KEYS.has(key)) {
      // Presence and linkage are behaviour; the uuid/clock value is not.
      out[key] = raw[key] === undefined ? undefined : `<${key}>`;
      continue;
    }
    if (key === 'cost_usd') {
      out[key] = raw[key];
      continue;
    }
    out[key] = scrub(raw[key]);
  }
  return out;
}

function readEvents(logsRoot: string, cycleId: string, scrub: (v: unknown) => unknown): unknown[] {
  const path = join(logsRoot, cycleId, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => scrubEvent(JSON.parse(line) as Record<string, unknown>, scrub));
}

/**
 * Compare against the committed fixture, or record it. A mismatch prints the
 * capture so the diff is readable rather than a wall of one-line JSON.
 */
function assertPinned(name: string, capture: unknown): void {
  const path = join(FIXTURE_DIR, `${name}.json`);
  const serialised = `${JSON.stringify(capture, null, 2)}\n`;
  if (WRITE) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(path, serialised);
    return;
  }
  assert.ok(
    existsSync(path),
    `missing pin ${path} — re-record with FIX_TURN_CAPTURE_WRITE=1 only when the change is INTENDED and explained`,
  );
  const expected = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  assert.deepEqual(
    JSON.parse(serialised),
    expected,
    `${name}: the turn reaching the SDK, its result or its event log changed.\n` +
      `A port of this runner must leave this pin byte-identical (M4 exit row 3).\n` +
      `Captured:\n${serialised}`,
  );
}

// ---------------------------------------------------------------------------
// brain-fix fixture — a theme missing its `description` frontmatter field
// ---------------------------------------------------------------------------

function buildBrainFixture(): { forgeRoot: string; themePath: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'fix-turn-brain-'));
  const brain = join(forgeRoot, 'brain');
  const cycles = join(brain, 'cycles');
  const themes = join(cycles, 'themes');
  mkdirSync(themes, { recursive: true });
  mkdirSync(join(brain, 'forge-dev'), { recursive: true });

  // `resolveKbBrainDir` requires a real kb.yaml; without it the write fence
  // resolves to an EMPTY root list, which denies every write (fail closed).
  writeFileSync(
    join(cycles, 'kb.yaml'),
    'id: cycles\nname: cycles\nbinding: { kind: unique }\ndesc: fix-turn capture fixture.\n',
  );
  writeFileSync(join(brain, 'INDEX.md'), '# Brain\n\nnavigation hub.\n');
  for (const cat of ['patterns', 'antipatterns', 'decisions', 'operations']) {
    writeFileSync(join(cycles, `${cat}.md`), `# ${cat}\n`);
  }
  for (const cat of ['decisions', 'reference']) {
    writeFileSync(join(brain, 'forge-dev', `${cat}.md`), `# ${cat}\n`);
  }

  const themePath = join(themes, 'no-description.md');
  writeFileSync(
    themePath,
    [
      '---',
      'title: capture fixture theme',
      'category: pattern',
      'created_at: 2026-01-01T00:00:00Z',
      'updated_at: 2026-01-01T00:00:00Z',
      'keywords: []',
      'related_themes: []',
      '---',
      '',
      '# theme body',
      '',
      'Some content here.',
    ].join('\n') + '\n',
  );

  seedSkill(forgeRoot, 'brain-fix', '# Brain-Fix\n\nApply a single targeted fix.\n');
  return { forgeRoot, themePath };
}

function seedSkill(forgeRoot: string, name: string, body: string): void {
  const dir = join(forgeRoot, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
}

// ---------------------------------------------------------------------------
// The two pins
// ---------------------------------------------------------------------------

describe('ports 5-6 before/after evidence (no spawn-capture golden exists)', () => {
  test('brain-fix: the turn reaching the SDK, its result and its event log', async () => {
    const { forgeRoot, themePath } = buildBrainFixture();
    try {
      const runId = 'capture-brainfix';
      const captured: Captured[] = [];
      const result = await runBrainFixTurn({
        runId,
        kbId: 'cycles',
        file: themePath,
        check: 'checkFrontmatter',
        kind: 'frontmatter.missing-field',
        message: 'missing required frontmatter field: description',
        fixHint: 'Add a description field to the YAML frontmatter.',
        forgeRoot,
        queryFn: recordingQuery(captured, () => {
          const original = readFileSync(themePath, 'utf8');
          writeFileSync(
            themePath,
            original.replace(
              'title: capture fixture theme\n',
              'title: capture fixture theme\ndescription: Added by the capture stub.\n',
            ),
          );
        }),
      });

      assert.equal(captured.length, 1, 'the turn must reach the SDK exactly once');
      const scrub = makeScrubber([
        [themePath, '<THEME>'],
        [forgeRoot, '<ROOT>'],
      ]);
      const logsRoot = join(forgeRoot, '_logs');
      const cycleId = `_brainfix-${runId}`;

      assertPinned('brain-fix', {
        prompt: scrub(captured[0]!.prompt),
        options: scrub(captured[0]!.options),
        optionsKeyOrder: Object.keys(captured[0]!.options),
        result: scrub(result),
        events: readEvents(logsRoot, cycleId, scrub),
        logDirEntries: readdirSync(join(logsRoot, cycleId)).sort(),
      });
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  /**
   * THE FAIL-CLOSED ARM, and the reason it is pinned separately.
   *
   * `resolveKbBrainDir` returns nothing for a kbId with no `kb.yaml`, and
   * brain-fix hands the resulting EMPTY root list to `writeRootFenceOptions`
   * anyway — which installs `permissionMode: 'default'`, STRIPS every
   * fence-gated tool from the grant, and installs a `canUseTool` that denies
   * a write matching no root. Every write is refused. The runner's own comment
   * calls that deliberate.
   *
   * It is a separate pin because the resolvable arm above cannot see it, and
   * the obvious port is exactly what breaks it: the spine's `runAgentTurn`
   * computes `fenced = writeRoots !== undefined && writeRoots.length > 0`, so
   * an empty list there means UNFENCED — `acceptEdits`, the grant unfiltered,
   * no `canUseTool` at all. Routing this runner through that function without
   * noticing would turn a fail-CLOSED branch into a fail-OPEN one, with the
   * happy-path pin still green. Measured before the port, not after.
   */
  test('brain-fix, unresolvable kbId: the fence stays installed and denies every write', async () => {
    const { forgeRoot, themePath } = buildBrainFixture();
    try {
      const runId = 'capture-brainfix-nokb';
      const captured: Captured[] = [];
      const result = await runBrainFixTurn({
        runId,
        kbId: 'no-such-kb',
        file: themePath,
        check: 'checkFrontmatter',
        kind: 'frontmatter.missing-field',
        message: 'missing required frontmatter field: description',
        forgeRoot,
        queryFn: recordingQuery(captured),
      });

      const opts = captured[0]!.options;
      // Asserted directly as well as pinned: a pin can be re-recorded, and
      // these three are the fence, which must never be re-recorded away.
      assert.equal(opts.permissionMode, 'default', 'an unfenced turn here would be a write escape');
      assert.ok(typeof opts.canUseTool === 'function', 'the deny-all fence must be installed');
      assert.deepEqual(opts.allowedTools, ['Read'], 'the fence-gated grants must be stripped');

      const scrub = makeScrubber([[themePath, '<THEME>'], [forgeRoot, '<ROOT>']]);
      assertPinned('brain-fix-unresolvable-kb', {
        prompt: scrub(captured[0]!.prompt),
        options: scrub(opts),
        optionsKeyOrder: Object.keys(opts),
        result: scrub(result),
        events: readEvents(join(forgeRoot, '_logs'), `_brainfix-${runId}`, scrub),
      });
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  /**
   * THE CRASH ARM. Both runners catch around the stream, emit an `error` event,
   * flush the sink and return early — brain-fix additionally runs its edit gate
   * on the way out, because a crashed turn's writes are still on disk, and
   * NEITHER emits an `end` event. A port that let the exception propagate, or
   * that reached the `end` event anyway, or that skipped the gate, would change
   * all three; none of it is visible from the success arms.
   */
  test('brain-fix, a throwing stream: error event, the gate still runs, no end event', async () => {
    const { forgeRoot, themePath } = buildBrainFixture();
    try {
      const runId = 'capture-brainfix-crash';
      const result = await runBrainFixTurn({
        runId,
        kbId: 'cycles',
        file: themePath,
        check: 'checkFrontmatter',
        kind: 'frontmatter.missing-field',
        message: 'missing required frontmatter field: description',
        forgeRoot,
        queryFn: () => {
          async function* gen(): AsyncGenerator<unknown> {
            yield { type: 'assistant', message: { content: [{ type: 'text', text: 'about to fail' }] } };
            throw new Error('pinned stream failure');
          }
          return gen();
        },
      });

      const scrub = makeScrubber([[themePath, '<THEME>'], [forgeRoot, '<ROOT>']]);
      const events = readEvents(join(forgeRoot, '_logs'), `_brainfix-${runId}`, scrub) as Array<{ event_type?: string }>;
      assert.ok(events.some((e) => e.event_type === 'error'), 'the crash must be recorded');
      assert.equal(events.some((e) => e.event_type === 'end'), false, 'a crashed turn emits no end event');
      assert.equal(result.cleared, false);
      assert.ok(result.editAudit, 'a crashed turn is still audited — omitting the audit is not refusing the edit');

      assertPinned('brain-fix-crash', { result: scrub(result), events });
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });

  test('preflight-fix: the turn reaching the SDK, its result and its event log', async () => {
    const forgeRoot = mkdtempSync(join(tmpdir(), 'fix-turn-preflight-'));
    try {
      const projectDir = join(forgeRoot, 'projects', 'captureproj');
      mkdirSync(projectDir, { recursive: true });
      seedSkill(forgeRoot, 'preflight-fix', '# Preflight-Fix\n\nApply the operator decision.\n');

      const runId = 'capture-preflightfix';
      const captured: Captured[] = [];
      const result = await runPreflightFixTurn({
        runId,
        projectDir,
        clause: 'C5',
        instruction: 'forge honours git ownership; never edit tests to pass.',
        detail: 'no constraints doc found',
        forgeRoot,
        queryFn: recordingQuery(captured, () => {
          writeFileSync(join(projectDir, 'CONSTRAINTS.md'), '# Constraints\n\nNo test tampering.\n');
        }),
      });

      assert.equal(captured.length, 1, 'the turn must reach the SDK exactly once');
      const scrub = makeScrubber([
        [projectDir, '<PROJECT>'],
        [forgeRoot, '<ROOT>'],
      ]);
      const logsRoot = join(forgeRoot, '_logs');
      const cycleId = `_preflight-fix-${runId}`;

      assertPinned('preflight-fix', {
        prompt: scrub(captured[0]!.prompt),
        options: scrub(captured[0]!.options),
        optionsKeyOrder: Object.keys(captured[0]!.options),
        result: scrub(result),
        events: readEvents(logsRoot, cycleId, scrub),
        logDirEntries: readdirSync(join(logsRoot, cycleId)).sort(),
      });
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
});
