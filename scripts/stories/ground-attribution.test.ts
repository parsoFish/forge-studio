/**
 * Ruling 663 — containment attributed by the MINTING SESSION'S OWN WRITES.
 *
 * The narrow rule (`classifyOwnGroundDrift` before this) licensed only what sat
 * INSIDE a session dir the run minted. S1 run 5 priced that: nine changes in
 * `projects/gitweave` read as undeclared and the run went red, and four of the
 * nine were the onboarding agent's own writes, recorded in its own event log
 * all along.
 *
 * THE FIXTURES ARE REAL BYTES, TRIMMED — never a hand-written log. Lane A's
 * rule, learned on #607: "a hand-written fixture is a second implementation of
 * the thing under test, and it is always the one that agrees with you." Five
 * door tests written in the shape I assumed passed while the product's real
 * `./`-prefixed manifest keys matched nothing, and a $3.2562 run found it. So
 * every line here is copied verbatim out of S1 run 5's session logs; the trim
 * drops lines, never edits them, and it keeps EVERY `file_change` and EVERY
 * write-tool `tool_use` so the write record is complete rather than convenient.
 *
 * The trim also keeps the lines that must NOT attribute: the architect's
 * `Read`s of `roadmap.md` and `brain/profile.md`, and the onboarding agent's
 * `Bash` whose command text names `brain/profile.md`. A rule that matched on a
 * path merely APPEARING in the log would license three files nobody wrote.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mintedSessionPaths, mintedSessionWrites, sessionWriteTargets, classifyOwnGroundDrift } from './ground-hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

/** The ground those logs really wrote into — the absolute path their `output_refs` carry. */
const GROUND = '/home/parso/forge-m6-a/projects/gitweave';

const AGENT = '_agent-onboarding-agent-2026-09-11T05-14-09-130-k7bw';
const ARCHITECT = '_architect-2026-09-11T05-21-53-0b1e0a19';
const DEMO = '_demo-2026-09-11T05-17-10-096ca9db';
/** Run 5's onboarding session really did hold nothing but a `turn.pid`. */
const ONBOARDING = '_onboarding-2026-09-11T05-14-09-4857c9a9';

/** S1 run 5's `_logs`, rebuilt from the committed extracts. */
function runFiveLogs(): string {
  const logs = mkdtempSync(join(tmpdir(), 'stories-attrib-'));
  for (const [dir, fixture] of [
    [AGENT, 's1-run5-agent-onboarding.events.jsonl'],
    [ARCHITECT, 's1-run5-architect.events.jsonl'],
    [DEMO, 's1-run5-demo.events.jsonl'],
  ] as const) {
    mkdirSync(join(logs, dir));
    copyFileSync(join(FIXTURES, fixture), join(logs, dir, 'events.jsonl'));
  }
  mkdirSync(join(logs, ONBOARDING));
  writeFileSync(join(logs, ONBOARDING, 'turn.pid'), '12345\n');
  return logs;
}

/** The nine changes S1 run 5's containment check really reported. */
const RUN_FIVE_CHANGES = {
  added: [
    '.forge/agent-run/PROMPT.md',
    '.forge/contract-compliance-report.json',
    '.forge/project.json',
    '.forge/skills/demo-design/SKILL.md',
    'CONSTRAINTS.md',
    'brain/profile.md',
    'roadmap.md',
  ],
  modified: ['.gitignore', 'CLAUDE.md'],
  removed: [] as string[],
};

test('663 DOOR: S1 run 5 — the four paths its own sessions wrote are PRODUCED, each naming the session', () => {
  const logs = runFiveLogs();
  try {
    const minted = mintedSessionPaths([], readdirSync(logs), logs);
    const { produced, undeclared } = classifyOwnGroundDrift(
      RUN_FIVE_CHANGES,
      minted,
      mintedSessionWrites(minted, logs, GROUND),
    );
    assert.deepEqual(produced, [
      'A .forge/project.json — written by _agent/onboarding-agent-2026-09-11T05-14-09-130-k7bw',
      'A .forge/skills/demo-design/SKILL.md — written by _agent/onboarding-agent-2026-09-11T05-14-09-130-k7bw, _demo/2026-09-11T05-17-10-096ca9db',
      'A CONSTRAINTS.md — written by _agent/onboarding-agent-2026-09-11T05-14-09-130-k7bw',
      'M CLAUDE.md — written by _agent/onboarding-agent-2026-09-11T05-14-09-130-k7bw',
    ]);
    // MEASURED, NOT ASSUMED. Ruling 663 expected all nine to attribute; the real
    // logs account for four. The other five are the BRIDGE's own writes into the
    // ground — `.forge/agent-run/PROMPT.md` from `runAgent` before the session
    // starts logging (`packages/agents/run-agent.ts:691`), the compliance report
    // from the contract checker (`apps/forge/cli.ts:933`), and the `.gitignore`
    // + `roadmap.md` + `brain/profile.md` scaffold behind
    // `POST /api/studio/projects` (`apps/studio/lib/studio-client.ts:2094`).
    // None of the three runs inside a session, so none appears in any session's
    // `events.jsonl`. This assertion records that gap rather than papering over
    // it: closing it needs a second evidence source, not a wider match here.
    assert.deepEqual(undeclared, [
      'A .forge/agent-run/PROMPT.md — nothing this run minted accounts for it',
      'A .forge/contract-compliance-report.json — nothing this run minted accounts for it',
      'A brain/profile.md — nothing this run minted accounts for it',
      'M .gitignore — nothing this run minted accounts for it',
      'A roadmap.md — nothing this run minted accounts for it',
    ].sort());
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('663 DOOR, the red half: with no session writes read, all NINE go undeclared — the state that failed S1 run 5', () => {
  const logs = runFiveLogs();
  try {
    const minted = mintedSessionPaths([], readdirSync(logs), logs);
    const { produced, undeclared } = classifyOwnGroundDrift(RUN_FIVE_CHANGES, minted, new Map());
    assert.deepEqual(produced, [], 'the narrow rule licensed nothing outside a minted session dir');
    assert.equal(undeclared.length, 9, 'and so reported all nine changes as a containment failure');
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('663: a Bash-driven write with NO paired tool_use is still attributed — the tool_use stream is the sampled one', () => {
  const targets = sessionWriteTargets(join(FIXTURES, 's1-run5-agent-onboarding.events.jsonl'), GROUND);
  assert.ok(
    targets.includes('.forge/skills/demo-design/SKILL.md'),
    'the onboarding agent put SKILL.md there through Bash; its log carries the `file.add` and no write-tool line at all',
  );
  // The proof that it is not a write-tool line doing the work: no `tool.Write`
  // or `tool.Edit` in the extract names it, and the only Bash tool use that
  // mentions the path is a `cat` of the SOURCE file in another tree.
  const text = readFileSync(join(FIXTURES, 's1-run5-agent-onboarding.events.jsonl'), 'utf8');
  for (const line of text.split('\n').filter((l) => l !== '')) {
    const ev = JSON.parse(line) as { event_type: string; metadata?: { tool?: string }; output_refs?: string[] };
    if (ev.event_type !== 'tool_use') continue;
    assert.ok(
      !(ev.output_refs ?? []).some((r) => r.endsWith('/.forge/skills/demo-design/SKILL.md')),
      'no write-tool event names SKILL.md — if one appears, this test has stopped proving the sampling point',
    );
  }
});

test('663: reading a path is not writing it — the architect READ roadmap.md and brain/profile.md and wrote neither', () => {
  assert.deepEqual(sessionWriteTargets(join(FIXTURES, 's1-run5-architect.events.jsonl'), GROUND), []);
});

test('663: two sessions writing one path are BOTH named — attribution is not first-writer-wins', () => {
  const logs = runFiveLogs();
  try {
    const minted = mintedSessionPaths([], readdirSync(logs), logs);
    const writes = mintedSessionWrites(minted, logs, GROUND);
    const wrote = [...writes].filter(([, p]) => p.includes('.forge/skills/demo-design/SKILL.md')).map(([s]) => s);
    assert.deepEqual(wrote.sort(), [
      '_agent/onboarding-agent-2026-09-11T05-14-09-130-k7bw',
      '_demo/2026-09-11T05-17-10-096ca9db',
    ]);
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('663: a minted session with no events.jsonl accounts for nothing and does not throw', () => {
  const logs = runFiveLogs();
  try {
    const writes = mintedSessionWrites([`_onboarding/2026-09-11T05-14-09-4857c9a9`], logs, GROUND);
    assert.deepEqual(writes.get('_onboarding/2026-09-11T05-14-09-4857c9a9'), []);
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('663: a half-written final line is skipped, not fatal — a killed session ends mid-line', () => {
  const logs = mkdtempSync(join(tmpdir(), 'stories-attrib-cut-'));
  try {
    mkdirSync(join(logs, AGENT));
    const text = readFileSync(join(FIXTURES, 's1-run5-agent-onboarding.events.jsonl'), 'utf8');
    writeFileSync(join(logs, AGENT, 'events.jsonl'), `${text}{"event_id":"EV_cut","event_ty`);
    const targets = sessionWriteTargets(join(logs, AGENT, 'events.jsonl'), GROUND);
    assert.deepEqual(targets, ['.forge/project.json', '.forge/skills/demo-design/SKILL.md', 'CLAUDE.md', 'CONSTRAINTS.md']);
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('663: a write OUTSIDE the ground is not attributed — the log names absolute paths in several trees', () => {
  const logs = mkdtempSync(join(tmpdir(), 'stories-attrib-out-'));
  try {
    mkdirSync(join(logs, AGENT));
    writeFileSync(
      join(logs, AGENT, 'events.jsonl'),
      `${JSON.stringify({
        event_type: 'file_change',
        output_refs: ['/home/parso/forge-m6-a/projects/OTHER/CLAUDE.md', `${GROUND}/CLAUDE.md`],
        message: 'file.modify',
      })}\n`,
    );
    assert.deepEqual(sessionWriteTargets(join(logs, AGENT, 'events.jsonl'), GROUND), ['CLAUDE.md']);
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('663: a RELATIVE output_ref is ignored, never resolved against cwd — #607\'s shape, refused at the door', () => {
  const logs = mkdtempSync(join(tmpdir(), 'stories-attrib-rel-'));
  try {
    mkdirSync(join(logs, AGENT));
    writeFileSync(
      join(logs, AGENT, 'events.jsonl'),
      `${JSON.stringify({ event_type: 'file_change', output_refs: ['CLAUDE.md', './CLAUDE.md'], message: 'file.modify' })}\n`,
    );
    assert.deepEqual(sessionWriteTargets(join(logs, AGENT, 'events.jsonl'), GROUND), []);
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('673(iii): a BRIDGE run the run minted attributes its ground writes — no new mechanism, and this is the test that keeps it', () => {
  // MEASURED BEFORE BUILDING. T1 ruled a follow-up here: `mintedSessionWrites`
  // should also read `_logs/_bridge-*` dirs born since the run's start. It
  // already does, and nothing needed to change — so what this test adds is not
  // behaviour but a GUARD on behaviour that arrived by accident of shape.
  //
  // Three existing decisions compose to produce it, none of which was made with
  // the bridge in mind:
  //   * `mintedSessionPaths`' name regex is `_<kind>-<id>` with the kind free,
  //     so `_bridge-<stamp>-<rand>` parses as kind `bridge` with no special case.
  //   * its session-evidence check accepts any dir carrying `events.jsonl`, and
  //     `emitGroundFileChanges` (`packages/kernel/logging.ts:228`) opens exactly
  //     one per bridge run.
  //   * the before/after LISTING already answers "born since the run's start"
  //     — the snapshot is taken at run start, so a dir created during the run is
  //     in `after` and not `before`. Birth time would give the same answer here
  //     and is not needed while that snapshot exists.
  //
  // A rename of the bridge's run-id prefix, or a logger that wrote its first
  // event somewhere other than `events.jsonl`, would silently un-attribute every
  // bridge write and send S1's five paths back to UNDECLARED — a red run for the
  // product working, which is the exact failure 594 and 663 were both about.
  const logs = mkdtempSync(join(tmpdir(), 'stories-bridge-'));
  const ground = '/home/parso/forge-m6-a/projects/gitweave';
  try {
    // The shape `bridgeCycleId()` really produces: `_bridge-<ISO with : and .
    // replaced by ->-<8 random chars>`.
    const dir = '_bridge-2026-09-11T08-52-11-000-ab12cd34';
    mkdirSync(join(logs, dir));
    writeFileSync(
      join(logs, dir, 'events.jsonl'),
      ['.gitignore', 'roadmap.md', 'brain/profile.md']
        .map((rel) => JSON.stringify({
          cycle_id: dir,
          event_type: 'file_change',
          output_refs: [`${ground}/${rel}`],
          message: 'file.write',
          metadata: { path: `${ground}/${rel}`, op: 'write' },
        }))
        .join('\n') + '\n',
    );

    const minted = mintedSessionPaths([], readdirSync(logs), logs);
    assert.deepEqual(minted, ['_bridge/2026-09-11T08-52-11-000-ab12cd34'], 'the bridge run is minted with no special case');

    const { produced, undeclared } = classifyOwnGroundDrift(
      { added: ['.gitignore', 'roadmap.md', 'brain/profile.md'], removed: [], modified: [] },
      minted,
      mintedSessionWrites(minted, logs, ground),
    );
    assert.deepEqual(undeclared, [], `the bridge's own writes are the product working: ${undeclared.join(' | ')}`);
    assert.equal(produced.length, 3);
    assert.ok(produced.every((l) => l.includes('written by _bridge/')), produced.join(' | '));
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});

test('673(iii): a bridge dir that PREDATES the run is not this run\'s, and stays undeclared', () => {
  // The control, and the reason the before/after listing is the right mechanism
  // rather than "any `_bridge-*` dir". A long-lived bridge writes into a ground
  // between runs; those writes belong to whoever caused them, not to the next
  // run that happens to hash the ground afterwards.
  const logs = mkdtempSync(join(tmpdir(), 'stories-bridge-old-'));
  const ground = '/home/parso/forge-m6-a/projects/gitweave';
  try {
    const dir = '_bridge-2026-09-10T01-00-00-000-99999999';
    mkdirSync(join(logs, dir));
    writeFileSync(join(logs, dir, 'events.jsonl'), `${JSON.stringify({
      event_type: 'file_change', output_refs: [`${ground}/.gitignore`], message: 'file.write',
    })}\n`);

    // It is in BEFORE as well as after — the run did not mint it.
    const minted = mintedSessionPaths(readdirSync(logs), readdirSync(logs), logs);
    assert.deepEqual(minted, [], 'a dir present before the run is not minted by it');

    const { undeclared } = classifyOwnGroundDrift(
      { added: ['.gitignore'], removed: [], modified: [] },
      minted,
      mintedSessionWrites(minted, logs, ground),
    );
    assert.equal(undeclared.length, 1, 'so its write is undeclared, and the run is right to say so');
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
});
