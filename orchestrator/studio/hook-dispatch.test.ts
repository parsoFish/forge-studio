/**
 * W8-B6 (forge-6gv.15 / forge-vvp, regate library-39) — acceptance for the
 * hook DISPATCH seam.
 *
 * The defect this suite kills: at `parsoFish/main` `1df6727e` a library hook
 * could be authored, scanned, approved and bound to an agent through the full
 * Studio UI and **could never fire**. `runHookScript`
 * (`orchestrator/studio/hook-runtime.ts:138`) had zero production callers, and
 * no `hooks` option was passed to any Agent SDK spawn anywhere.
 *
 * WHAT EACH TEST KILLS (immutable-gates: a green test that cannot name the
 * wrong implementation it kills is decoration):
 *
 *  - "no bindings ⇒ no hooks key" kills an implementation that always emits a
 *    `hooks` key. That would change the spawn options bag for EVERY agent and
 *    break the golden spawn-capture fixtures — which is precisely why those
 *    fixtures are this lane's independent parity proof.
 *  - "a bound + approved hook actually fires" kills the HEAD implementation
 *    (zero callers) AND a builder that returns no-op callbacks: the assertion
 *    is a side-effect file written by the hook's own bash process, not a mock
 *    call count.
 *  - "a bound but UNAPPROVED hook does not spawn" kills any dispatch that
 *    resolves runnability once at spawn time, or that bypasses
 *    `hookRunState`. The gate is re-consulted per fire, from its source of
 *    truth.
 *  - the exit-code tests kill "the exit code is captured and enforced
 *    nowhere" — the campaign's `declared-data-fails-open` class recurring
 *    inside the fix for it.
 *  - the matcher tests kill "pass forge's declared matcher straight to the
 *    SDK's `HookCallbackMatcher.matcher`". Those two syntaxes are NOT the
 *    same: forge's UI placeholder is literally `Bash(gh pr create)`
 *    (`forge-ui/app/hooks/new/page.tsx:109`) and the OOTB
 *    `pre-pr-security-review` ships exactly that, while the SDK's field is a
 *    tool-NAME pattern. Handing it over verbatim yields a hook that is
 *    registered, displayed as bound, and never fires — the same defect in a
 *    new field.
 *  - the env test kills a dispatch that widens the hook child's env. It is
 *    non-tautological: the canary is set in the parent AT DISPATCH TIME and
 *    asserted absent in the child.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { createLogger, type EventLogEntry, type EventLogger } from '../logging.ts';
import { approveHook } from './hook-scan.ts';
import type { HookLifecycleEvent, HookPermissionManifest } from './hook-library.ts';

import { describeHookRunFailure, sdkHooksForAgent, type SdkHooksOption } from './hook-dispatch.ts';
import { HookRunError } from './hook-runtime.ts';

// ---------------------------------------------------------------------------
// Fixture helpers — a real on-disk forge root: skills/<slug>/SKILL.md +
// studio/hooks/<id>/. Nothing is mocked; the hook really spawns.
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

const NO_ENV: HookPermissionManifest = { env: [], read: [], network: false };

function writeAgent(root: string, slug: string, hooks: string[]): string {
  const dir = join(root, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const frontmatter = [
    '---',
    `name: ${slug}`,
    `description: Test agent ${slug} for the hook-dispatch suite.`,
    'phase: reflection',
    'surface: unattended',
    'library: false',
    `purpose: Test agent ${slug}.`,
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: []',
    `  hooks: [${hooks.join(', ')}]`,
    'runtime:',
    '  sdk: claude',
    '  strategy: fixed',
    '  model: claude-haiku-4-5-20251001',
    'brainAccess: none',
    'interactivity: Fully autonomous.',
    'allowed-tools: [Read]',
    'disallowed-tools: [Bash]',
    'budgets: {}',
    '---',
    '',
    `# ${slug}`,
    '',
    'Test agent.',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'SKILL.md'), frontmatter, 'utf8');
  return `skills/${slug}/SKILL.md`;
}

function writeHook(
  root: string,
  id: string,
  opts: { on: HookLifecycleEvent; matcher?: string; script: string; permissions?: HookPermissionManifest },
): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), opts.script, 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id,
      name: id,
      description: `Test hook ${id}.`,
      on: opts.on,
      ...(opts.matcher !== undefined ? { matcher: opts.matcher } : {}),
      script: 'scripts/run.sh',
      permissions: opts.permissions ?? NO_ENV,
    }),
    'utf8',
  );
}

function makeLogger(name: string): { logger: EventLogger; entries: () => EventLogEntry[] } {
  const logsRoot = makeRoot('hook-dispatch-logs-');
  const logger = createLogger(name, logsRoot);
  return {
    logger,
    entries: () =>
      readFileSync(join(logsRoot, name, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as EventLogEntry),
  };
}

/** A hook script that proves it really ran by writing a file only it can write. */
function touchScript(markerPath: string, exitCode = 0): string {
  return `#!/usr/bin/env bash\nset -euo pipefail\necho "fired" > ${JSON.stringify(markerPath)}\nexit ${exitCode}\n`;
}

/** Fire every callback the builder registered for `event`, sequentially. */
async function fire(
  hooks: SdkHooksOption | undefined,
  event: HookLifecycleEvent,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const matchers = hooks?.[event] ?? [];
  const out: Record<string, unknown>[] = [];
  for (const m of matchers) {
    for (const cb of m.hooks) {
      out.push((await cb({ hook_event_name: event, ...input } as never, undefined, {
        signal: new AbortController().signal,
      })) as Record<string, unknown>);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1 — honest absence. The unbound spawn shape must not change at all.
// ---------------------------------------------------------------------------

describe('sdkHooksForAgent: honest absence', () => {
  it('an agent binding NO hooks yields undefined — never an empty hooks object (kills: always emitting a hooks key, which would diff every golden spawn-capture fixture)', () => {
    const root = makeRoot('hook-dispatch-none-');
    const skill = writeAgent(root, 'no-hooks-agent', []);
    const { logger } = makeLogger('c-none');
    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    assert.equal(hooks, undefined);
  });

  it('an agent whose SKILL.md cannot be loaded yields undefined rather than crashing the spawn', () => {
    const root = makeRoot('hook-dispatch-bad-');
    const { logger } = makeLogger('c-bad');
    const hooks = sdkHooksForAgent({ skill: 'skills/does-not-exist/SKILL.md', logger, initiativeId: 'INIT-t', forgeRoot: root });
    assert.equal(hooks, undefined);
  });
});

// ---------------------------------------------------------------------------
// 2 — THE HEADLINE PIN: a bound, approved hook actually fires.
// ---------------------------------------------------------------------------

describe('sdkHooksForAgent: a bound + approved hook actually fires', () => {
  it('the hook process really runs — proven by a file only the hook script writes (kills: HEAD, which has zero production callers of runHookScript)', async () => {
    const root = makeRoot('hook-dispatch-fire-');
    const marker = join(makeRoot('hook-dispatch-marker-'), 'fired.txt');
    writeHook(root, 'fire-hook', { on: 'SessionEnd', script: touchScript(marker) });
    approveHook({ forgeRoot: root, id: 'fire-hook' });
    const skill = writeAgent(root, 'bound-agent', ['fire-hook']);
    const { logger } = makeLogger('c-fire');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    assert.ok(hooks, 'a bound hook must produce a hooks options bag');
    assert.deepEqual(Object.keys(hooks!), ['SessionEnd'], 'registered under the hook.yaml-declared lifecycle event, nowhere else');
    assert.equal(existsSync(marker), false, 'building the bag must not fire anything yet');

    const results = await fire(hooks, 'SessionEnd');

    assert.equal(existsSync(marker), true, 'the hook process must have really run');
    assert.equal(readFileSync(marker, 'utf8').trim(), 'fired');
    assert.equal(results.length, 1);
    assert.equal(results[0]!['continue'], true, 'a clean exit lets the run continue');
  });

  it('two hooks bound on the same event both fire, and a hook on another event does not (kills: registering only the first binding)', async () => {
    const root = makeRoot('hook-dispatch-two-');
    const dir = makeRoot('hook-dispatch-two-marks-');
    const a = join(dir, 'a.txt');
    const b = join(dir, 'b.txt');
    const c = join(dir, 'c.txt');
    writeHook(root, 'hook-a', { on: 'PreToolUse', script: touchScript(a) });
    writeHook(root, 'hook-b', { on: 'PreToolUse', script: touchScript(b) });
    writeHook(root, 'hook-c', { on: 'SessionStart', script: touchScript(c) });
    for (const id of ['hook-a', 'hook-b', 'hook-c']) approveHook({ forgeRoot: root, id });
    const skill = writeAgent(root, 'multi-agent', ['hook-a', 'hook-b', 'hook-c']);
    const { logger } = makeLogger('c-two');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    assert.deepEqual(Object.keys(hooks!).sort(), ['PreToolUse', 'SessionStart']);

    await fire(hooks, 'PreToolUse', { tool_name: 'Read', tool_input: {} });

    assert.equal(existsSync(a), true, 'first binding fired');
    assert.equal(existsSync(b), true, 'second binding on the SAME event fired too');
    assert.equal(existsSync(c), false, 'a hook declared on a different event must not fire');
  });

  it('SECURITY: dispatch does not widen the hook child env — a parent var set at dispatch time and absent from the manifest is invisible to the child', async () => {
    const root = makeRoot('hook-dispatch-env-');
    const out = join(makeRoot('hook-dispatch-env-out-'), 'seen.txt');
    writeHook(root, 'env-probe-hook', {
      on: 'SessionEnd',
      script: `#!/usr/bin/env bash\nset -euo pipefail\necho "CANARY=\${W8B6_DISPATCH_CANARY:-ABSENT}" > ${JSON.stringify(out)}\nexit 0\n`,
    });
    approveHook({ forgeRoot: root, id: 'env-probe-hook' });
    const skill = writeAgent(root, 'env-agent', ['env-probe-hook']);
    const { logger } = makeLogger('c-env');

    const prior = process.env['W8B6_DISPATCH_CANARY'];
    process.env['W8B6_DISPATCH_CANARY'] = 'leak-if-visible';
    try {
      await fire(sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root }), 'SessionEnd');
    } finally {
      if (prior === undefined) delete process.env['W8B6_DISPATCH_CANARY'];
      else process.env['W8B6_DISPATCH_CANARY'] = prior;
    }

    assert.match(readFileSync(out, 'utf8'), /CANARY=ABSENT/, 'dispatch must never hand the hook a var its manifest did not declare');
  });
});

// ---------------------------------------------------------------------------
// 3 — the approval gate holds AT DISPATCH, not merely at authoring time.
// ---------------------------------------------------------------------------

describe('sdkHooksForAgent: the approval gate holds at the dispatch point', () => {
  it('a bound but UNAPPROVED hook is registered yet never spawns, and the refusal is logged (kills: resolving runnability once at build time, or bypassing hookRunState)', async () => {
    const root = makeRoot('hook-dispatch-unapproved-');
    const marker = join(makeRoot('hook-dispatch-unapproved-mark-'), 'must-not-exist.txt');
    writeHook(root, 'unapproved-hook', { on: 'SessionEnd', script: touchScript(marker) });
    // deliberately NOT approved
    const skill = writeAgent(root, 'unapproved-agent', ['unapproved-hook']);
    const { logger, entries } = makeLogger('c-unapproved');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    assert.ok(hooks?.['SessionEnd'], 'still registered — refusal belongs at fire time, from the source of truth');

    const results = await fire(hooks, 'SessionEnd');

    assert.equal(existsSync(marker), false, 'an unapproved hook must never spawn');
    assert.equal(results[0]!['continue'], true, 'an unapproved hook gains no power to stop the run');
    const refusals = entries().filter((e) => e.event_type === 'error' && /not runnable|refus/i.test(e.message ?? ''));
    assert.ok(refusals.length >= 1, 'the refusal must be recorded, not silent');
  });

  // -------------------------------------------------------------------
  // W8-B6 FIX-3 (2026-08-24 hostile review): the catch below this call used to
  // log "refused or failed to spawn" for BOTH an approval-gate refusal and a
  // hook that blew its 30s budget. Those are opposite problems — one says the
  // operator never approved the package, the other says their script hung and
  // (the spawn being synchronous) stalled the daemon for thirty seconds — and
  // an operator reading the event log could not tell which had happened.
  // -------------------------------------------------------------------
  it('an approval-gate refusal is logged AS a refusal, naming the gate, and carries a typed failure reason (kills: conflating a refusal with a hung script)', async () => {
    const root = makeRoot('hook-dispatch-refusal-reason-');
    const marker = join(makeRoot('hook-dispatch-refusal-reason-mark-'), 'must-not-exist.txt');
    writeHook(root, 'refusal-reason-hook', { on: 'SessionEnd', script: touchScript(marker) });
    // deliberately NOT approved
    const skill = writeAgent(root, 'refusal-reason-agent', ['refusal-reason-hook']);
    const { logger, entries } = makeLogger('c-refusal-reason');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    await fire(hooks, 'SessionEnd');

    const dispatchErrors = entries().filter((e) => (e.metadata as { kind?: string } | undefined)?.kind === 'hook-dispatch');
    assert.equal(dispatchErrors.length, 1, `expected exactly one dispatch error, got ${JSON.stringify(dispatchErrors)}`);
    assert.equal(
      (dispatchErrors[0]!.metadata as { failure?: string }).failure,
      'not-runnable',
      'the reason must travel as a TYPED metadata field, not be recoverable only by re-parsing prose',
    );
    assert.doesNotMatch(
      dispatchErrors[0]!.message ?? '',
      /failed to spawn/i,
      'an unapproved hook did not fail to spawn — it was never allowed to try, and saying otherwise sends an operator to debug the wrong thing',
    );
    assert.match(dispatchErrors[0]!.message ?? '', /approval/i, 'the message must point at the approval gate');
  });

  it('editing the script after approval re-locks it — the stale approval does not carry (kills: caching the approval verdict across a fire)', async () => {
    const root = makeRoot('hook-dispatch-stale-');
    const marker = join(makeRoot('hook-dispatch-stale-mark-'), 'must-not-exist.txt');
    writeHook(root, 'stale-hook', { on: 'SessionEnd', script: touchScript(marker) });
    approveHook({ forgeRoot: root, id: 'stale-hook' });
    const skill = writeAgent(root, 'stale-agent', ['stale-hook']);
    const { logger } = makeLogger('c-stale');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    // The operator edits the script AFTER approval and AFTER the bag was built.
    writeFileSync(join(root, 'studio', 'hooks', 'stale-hook', 'scripts', 'run.sh'), touchScript(marker), 'utf8');
    writeFileSync(
      join(root, 'studio', 'hooks', 'stale-hook', 'scripts', 'run.sh'),
      `${touchScript(marker)}# edited after approval\n`,
      'utf8',
    );

    await fire(hooks, 'SessionEnd');

    assert.equal(existsSync(marker), false, 'an approval that no longer covers the current bytes must refuse the spawn');
  });
});

// ---------------------------------------------------------------------------
// 4 — the exit code is ENFORCED, not merely captured.
// ---------------------------------------------------------------------------

describe('sdkHooksForAgent: the hook exit code is enforced', () => {
  it('exit 2 on PreToolUse DENIES the tool call and carries the hook stderr as the reason (kills: capturing exitCode and enforcing it nowhere)', async () => {
    const root = makeRoot('hook-dispatch-deny-');
    writeHook(root, 'deny-hook', {
      on: 'PreToolUse',
      script: '#!/usr/bin/env bash\necho "nope: unreviewed auth diff" >&2\nexit 2\n',
    });
    approveHook({ forgeRoot: root, id: 'deny-hook' });
    const skill = writeAgent(root, 'deny-agent', ['deny-hook']);
    const { logger } = makeLogger('c-deny');

    const [result] = await fire(sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root }), 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create' },
    });

    const specific = result!['hookSpecificOutput'] as Record<string, unknown> | undefined;
    assert.equal(specific?.['hookEventName'], 'PreToolUse');
    assert.equal(specific?.['permissionDecision'], 'deny', 'exit 2 must actually block the tool call');
    assert.match(String(specific?.['permissionDecisionReason']), /nope: unreviewed auth diff/);
  });

  it('exit 2 on a non-tool event stops the run with a reason', async () => {
    const root = makeRoot('hook-dispatch-stop-');
    writeHook(root, 'stop-hook', { on: 'SessionStart', script: '#!/usr/bin/env bash\necho "blocked at start" >&2\nexit 2\n' });
    approveHook({ forgeRoot: root, id: 'stop-hook' });
    const skill = writeAgent(root, 'stop-agent', ['stop-hook']);
    const { logger } = makeLogger('c-stop');

    const [result] = await fire(sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root }), 'SessionStart');

    assert.equal(result!['continue'], false);
    assert.match(String(result!['stopReason']), /blocked at start/);
  });

  it('any other non-zero exit is a NON-blocking error: the run continues and the failure is logged (kills: treating every failure as a block, which would wedge a cycle on a broken hook)', async () => {
    const root = makeRoot('hook-dispatch-warn-');
    writeHook(root, 'warn-hook', { on: 'PreToolUse', script: '#!/usr/bin/env bash\necho "boom" >&2\nexit 1\n' });
    approveHook({ forgeRoot: root, id: 'warn-hook' });
    const skill = writeAgent(root, 'warn-agent', ['warn-hook']);
    const { logger, entries } = makeLogger('c-warn');

    const [result] = await fire(sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root }), 'PreToolUse', {
      tool_name: 'Read',
      tool_input: {},
    });

    assert.equal(result!['continue'], true);
    assert.equal(result!['hookSpecificOutput'], undefined, 'a non-blocking error must not carry a deny decision');
    // Assert the structured record, not the prose: the metadata is what a
    // downstream reader consumes, and it must say exit 1 AND non-blocking.
    const recorded = entries().find(
      (e) => e.event_type === 'error' && (e.metadata as Record<string, unknown> | undefined)?.['kind'] === 'hook-dispatch',
    );
    assert.ok(recorded, 'the non-zero exit must be recorded');
    assert.equal((recorded!.metadata as Record<string, unknown>)['exitCode'], 1);
    assert.equal((recorded!.metadata as Record<string, unknown>)['blocking'], false);
  });
});

// ---------------------------------------------------------------------------
// W8-B6 FIX-3 — the three failure modes map to three distinct descriptions.
// Tested directly (ADR 042: a pure function with an explicit error contract
// may be exported for direct test) rather than through four real spawns, one
// of which would make this suite wait out a real 30-second timeout to prove
// one branch.
// ---------------------------------------------------------------------------

describe('describeHookRunFailure: three failure modes, three answers', () => {
  it('each typed reason gets its own description, and none of them says "failed to spawn" unless it did', () => {
    const refusal = describeHookRunFailure(new HookRunError('not-runnable', 'x'));
    assert.equal(refusal.failure, 'not-runnable');
    assert.match(refusal.description, /approval/i);
    assert.doesNotMatch(refusal.description, /spawn/i);

    const timeout = describeHookRunFailure(new HookRunError('timeout', 'x'));
    assert.equal(timeout.failure, 'timeout');
    assert.match(timeout.description, /budget|timed out|killed/i);
    assert.doesNotMatch(timeout.description, /approval/i);

    const spawnFailed = describeHookRunFailure(new HookRunError('spawn-failed', 'x'));
    assert.equal(spawnFailed.failure, 'spawn-failed');
    assert.match(spawnFailed.description, /spawn/i);

    const all = [refusal.description, timeout.description, spawnFailed.description];
    assert.equal(new Set(all).size, 3, 'three modes must produce three DISTINCT descriptions — that is the entire point of the fix');
  });

  it('an unrecognised throw is reported as unknown, never silently attributed to one of the three', () => {
    const out = describeHookRunFailure(new Error('something else entirely'));
    assert.equal(out.failure, 'unknown');
    assert.doesNotMatch(out.description, /approval|budget/i, 'guessing is worse than admitting the reason is not known');
  });
});

// ---------------------------------------------------------------------------
// 5 — the declared matcher is honoured in FORGE's syntax, not handed to the
//     SDK's (different) one.
// ---------------------------------------------------------------------------

describe('sdkHooksForAgent: the declared matcher is enforced in forge syntax', () => {
  it('never populates the SDK-side matcher field — forge matcher syntax is Tool(args), the SDK field is a tool-NAME pattern (kills: passing it through verbatim, which registers a hook that can never match)', () => {
    const root = makeRoot('hook-dispatch-matcher-field-');
    writeHook(root, 'm-hook', { on: 'PreToolUse', matcher: 'Bash(gh pr create)', script: touchScript('/dev/null') });
    approveHook({ forgeRoot: root, id: 'm-hook' });
    const skill = writeAgent(root, 'm-agent', ['m-hook']);
    const { logger } = makeLogger('c-mfield');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });
    assert.equal(hooks!['PreToolUse']![0]!.matcher, undefined);
  });

  it('Bash(gh pr create) fires for a Bash command with that prefix, and NOT for another Bash command or another tool', async () => {
    const root = makeRoot('hook-dispatch-matcher-');
    const dir = makeRoot('hook-dispatch-matcher-marks-');
    const hit = join(dir, 'hit.txt');
    writeHook(root, 'match-hook', { on: 'PreToolUse', matcher: 'Bash(gh pr create)', script: touchScript(hit) });
    approveHook({ forgeRoot: root, id: 'match-hook' });
    const skill = writeAgent(root, 'match-agent', ['match-hook']);
    const { logger } = makeLogger('c-match');
    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });

    await fire(hooks, 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/x' } });
    assert.equal(existsSync(hit), false, 'a different tool must not fire it');

    await fire(hooks, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'gh issue list' } });
    assert.equal(existsSync(hit), false, 'the right tool with the wrong command must not fire it');

    await fire(hooks, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'gh pr create --draft --title x' } });
    assert.equal(existsSync(hit), true, 'the declared command prefix must actually fire it');
  });

  // -------------------------------------------------------------------
  // W8-B6 FIX-2 (2026-08-24 hostile review): a malformed matcher was a
  // PERMANENTLY INERT hook with zero diagnostics anywhere. The old fallback
  // treated the whole raw string as a tool name, `hookMatcherMatches` could
  // then never be true, and the no-match branch returned silently — no log on
  // the first fire, none on the thousandth. A guard-shaped hook was authored,
  // approved, displayed as carried, and did nothing.
  //
  // The write paths now refuse the shape (hook-trigger-coherence.test.ts), so
  // this is the defence in depth for a package that predates the check or was
  // hand-edited on disk. It is reported ONCE, when the options bag is built —
  // not per fire, which for a PostToolUse binding would flood a real cycle's
  // event log with one identical error per tool call.
  // -------------------------------------------------------------------
  it('a MALFORMED matcher is reported ONCE at bag-build time and the hook never fires (kills: the silent no-op, and kills a per-fire log that would flood the event log)', async () => {
    const root = makeRoot('hook-dispatch-malformed-');
    const dir = makeRoot('hook-dispatch-malformed-marks-');
    const hit = join(dir, 'hit.txt');
    // Written straight to disk, bypassing the write-path gate — exactly the
    // package shape this defence in depth exists for.
    writeHook(root, 'malformed-hook', { on: 'PreToolUse', matcher: 'Bash(gh pr create', script: touchScript(hit) });
    approveHook({ forgeRoot: root, id: 'malformed-hook' });
    const skill = writeAgent(root, 'malformed-agent', ['malformed-hook']);
    const { logger, entries } = makeLogger('c-malformed');

    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });

    const buildTime = entries().filter((e) => (e.metadata as { kind?: string } | undefined)?.kind === 'hook-dispatch');
    assert.equal(buildTime.length, 1, `the malformed matcher must be reported exactly once when the bag is built, got ${JSON.stringify(buildTime)}`);
    assert.match(buildTime[0]!.message ?? '', /Bash\(gh pr create/, 'the report must quote the matcher the operator typed');

    for (const command of ['gh pr create --draft', 'ls', 'gh issue list']) {
      await fire(hooks, 'PreToolUse', { tool_name: 'Bash', tool_input: { command } });
    }
    assert.equal(existsSync(hit), false, 'a matcher that can never equal a real tool name must never fire the hook');

    const after = entries().filter((e) => (e.metadata as { kind?: string } | undefined)?.kind === 'hook-dispatch');
    assert.equal(after.length, 1, `three fires must add NO further matcher reports — said once, not per fire (got ${after.length})`);
  });

  it('a bare tool-name matcher matches on tool name only, and an absent matcher fires for every tool', async () => {
    const root = makeRoot('hook-dispatch-bare-');
    const dir = makeRoot('hook-dispatch-bare-marks-');
    const named = join(dir, 'named.txt');
    const any = join(dir, 'any.txt');
    writeHook(root, 'named-hook', { on: 'PreToolUse', matcher: 'Bash', script: touchScript(named) });
    writeHook(root, 'any-hook', { on: 'PreToolUse', script: touchScript(any) });
    for (const id of ['named-hook', 'any-hook']) approveHook({ forgeRoot: root, id });
    const skill = writeAgent(root, 'bare-agent', ['named-hook', 'any-hook']);
    const { logger } = makeLogger('c-bare');
    const hooks = sdkHooksForAgent({ skill, logger, initiativeId: 'INIT-t', forgeRoot: root });

    await fire(hooks, 'PreToolUse', { tool_name: 'Read', tool_input: {} });
    assert.equal(existsSync(named), false, 'a bare tool-name matcher must not fire for a different tool');
    assert.equal(existsSync(any), true, 'no matcher means every occurrence of the event');

    await fire(hooks, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    assert.equal(existsSync(named), true, 'a bare tool-name matcher fires on the tool name alone');
  });
});
