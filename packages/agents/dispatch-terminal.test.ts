/**
 * Bead `forge-8vfn.5.38` — a dispatched run always ends its own record.
 *
 * The defect these pin, measured from `_1.0/evidence/M4-projects-s3-S3/`: the
 * dispatch process is killed while the agent it spawned works on, and because
 * `cmdAgentDispatch` covered only a normal return and a thrown error, the run's
 * log was left with no terminal event and its `status.json` a perpetual
 * `running`. The heartbeat cadence in that evidence is the proof it was the
 * WRITER that stopped: `agent_heartbeat` is emitted by the dispatch process
 * every ~15 s, and it stops at the same instant the tool events do.
 *
 * The central control here signals a REAL process. The claim is about what
 * survives a signal, and a stubbed `process.on` cannot be wrong in the way an
 * actual SIGTERM can.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISPATCH_TERMINAL_SIGNALS,
  installDispatchSignalGuard,
  recordDispatchTerminal,
  type DispatchTerminalSignal,
} from './dispatch-terminal.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { createLogger } from '@forge/kernel';

const HERE = dirname(fileURLToPath(import.meta.url));

function readEvents(forgeRoot: string, runId: string): Array<Record<string, unknown>> {
  const path = join(forgeRoot, '_logs', runId, 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// The control that matters: a real process, a real signal.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: a dispatch SIGTERMed mid-run leaves a terminal event — the exit that had none', async (t) => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-'));
  const runId = '_agent-onboarding-agent-2026-09-03T00-00-00-000-test';
  const childPath = join(forgeRoot, 'child.ts');
  writeFileSync(
    childPath,
    `import { installDispatchSignalGuard } from ${JSON.stringify(join(HERE, 'dispatch-terminal.ts'))};
     installDispatchSignalGuard({
       runId: ${JSON.stringify(runId)},
       slug: 'onboarding-agent',
       forgeRoot: ${JSON.stringify(forgeRoot)},
     });
     process.stdout.write('ready\\n');
     setInterval(() => {}, 1000);`,
  );

  const child = spawn(process.execPath, ['--experimental-strip-types', childPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    try {
      process.kill(child.pid!, 'SIGKILL');
    } catch {
      /* already exited, which is the point */
    }
    rmSync(forgeRoot, { recursive: true, force: true });
  });

  await new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += String(c);
      if (out.includes('ready')) resolve();
    });
    child.on('exit', () => reject(new Error(`the child exited before it was ready: ${out}`)));
    setTimeout(() => reject(new Error('the child never reported ready')), 20_000);
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? (signal ? -1 : 0)));
    process.kill(child.pid!, 'SIGTERM');
  });

  const events = readEvents(forgeRoot, runId);
  const terminal = events.find((e) => e['message'] === 'agent-dispatch.interrupted');
  assert.ok(
    terminal,
    `a SIGTERMed dispatch wrote NO terminal event — the run's log cannot be read as complete or incomplete, and the bridge reports a perpetual "running": ${JSON.stringify(events)}`,
  );
  assert.equal((terminal!['metadata'] as Record<string, unknown>)['outcome'], 'interrupted');
  assert.equal((terminal!['metadata'] as Record<string, unknown>)['detail'], 'SIGTERM');
  // 128 + SIGTERM(15). The exit status still says how it died.
  assert.equal(exitCode, 143, 'the dispatch must still report a signalled exit status');
});

test('the terminal event lands in the RUN\'s own log root, never wherever the process happens to stand', async (t) => {
  // The same door bead 5.37 opened: an agent that changes directory changes
  // where its events are written. `recordDispatchTerminal` resolves against
  // the forge root it is handed, so a child started elsewhere still writes to
  // the run's own tree.
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-root-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'dispatch-terminal-elsewhere-'));
  const runId = '_agent-root-test';
  const childPath = join(forgeRoot, 'child.ts');
  writeFileSync(
    childPath,
    `import { recordDispatchTerminal } from ${JSON.stringify(join(HERE, 'dispatch-terminal.ts'))};
     recordDispatchTerminal({
       runId: ${JSON.stringify(runId)},
       slug: 'onboarding-agent',
       forgeRoot: ${JSON.stringify(forgeRoot)},
       outcome: 'interrupted',
       detail: 'SIGTERM',
     });`,
  );
  t.after(() => {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', childPath], {
      cwd: elsewhere, // deliberately NOT the forge root
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (c) => {
      err += String(c);
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`child failed: ${err}`))));
  });

  assert.equal(readEvents(forgeRoot, runId).length, 1, 'the terminal event is missing from the run log root');
  assert.equal(
    existsSync(join(elsewhere, '_logs')),
    false,
    'the terminal event followed the process cwd — a run that ends elsewhere has no terminus where anyone reads',
  );
});

// ---------------------------------------------------------------------------
// The handler's own rules.
// ---------------------------------------------------------------------------

function fakeSignalSeams() {
  const handlers = new Map<DispatchTerminalSignal, Array<() => void>>();
  const exits: number[] = [];
  return {
    exits,
    handlers,
    on: (sig: DispatchTerminalSignal, h: () => void) => {
      if (!handlers.has(sig)) handlers.set(sig, []);
      handlers.get(sig)!.push(h);
    },
    off: (sig: DispatchTerminalSignal, h: () => void) => {
      const list = handlers.get(sig) ?? [];
      const i = list.indexOf(h);
      if (i !== -1) list.splice(i, 1);
    },
    exit: (code: number) => void exits.push(code),
    fire: (sig: DispatchTerminalSignal) => {
      for (const h of [...(handlers.get(sig) ?? [])]) h();
    },
  };
}

test('two signals write ONE terminus — a run must not look like it ended twice', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-idem-'));
  try {
    const seams = fakeSignalSeams();
    installDispatchSignalGuard({ runId: '_agent-idem', slug: 's', forgeRoot, ...seams });
    // A process that leads its own group receives both the group signal and
    // the direct one — `reap.mjs` sends exactly that pair.
    seams.fire('SIGTERM');
    seams.fire('SIGTERM');
    const terminal = readEvents(forgeRoot, '_agent-idem').filter(
      (e) => e['message'] === 'agent-dispatch.interrupted',
    );
    assert.equal(terminal.length, 1);
    assert.deepEqual(seams.exits, [143, 143], 'every signal must still exit, even the one that writes nothing');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('the guard is fully uninstalled — a long-lived process running several dispatches leaks no listener', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-off-'));
  try {
    const seams = fakeSignalSeams();
    const uninstall = installDispatchSignalGuard({ runId: '_agent-off', slug: 's', forgeRoot, ...seams });
    for (const sig of DISPATCH_TERMINAL_SIGNALS) {
      assert.equal(seams.handlers.get(sig)?.length, 1, `no handler installed for ${sig}`);
    }
    uninstall();
    for (const sig of DISPATCH_TERMINAL_SIGNALS) {
      assert.equal(seams.handlers.get(sig)?.length ?? 0, 0, `${sig} handler survived uninstall`);
    }
    seams.fire('SIGTERM');
    assert.deepEqual(readEvents(forgeRoot, '_agent-off'), [], 'an uninstalled guard still wrote a terminus');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('an interrupted dispatch writes the session terminal phase too, distinguishable from a thrown error', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-phase-'));
  try {
    const seams = fakeSignalSeams();
    const phases: Array<[string, string]> = [];
    installDispatchSignalGuard({
      runId: '_agent-phase',
      slug: 's',
      forgeRoot,
      writePhase: (outcome, detail) => void phases.push([outcome, detail]),
      ...seams,
    });
    seams.fire('SIGINT');
    assert.deepEqual(phases, [['failed', 'dispatch interrupted by SIGINT']]);
    assert.deepEqual(seams.exits, [130], '128 + SIGINT(2)');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a terminal event that cannot be written is REPORTED — the one write that stops a perpetual running', () => {
  // Deferred in #324 for want of lines in `agent-run.ts`: the marker's write
  // was `catch { }` with nothing in it. A silent failure there is the defect
  // reporting on itself.
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-terminal-unwritable-'));
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));
  try {
    // A FILE where the run directory must be, so `createLogger`'s mkdir fails.
    mkdirSync(join(dir, '_logs'), { recursive: true });
    writeFileSync(join(dir, '_logs', '_agent-unwritable'), 'not a directory');
    const written = recordDispatchTerminal({
      runId: '_agent-unwritable',
      slug: 's',
      forgeRoot: dir,
      outcome: 'interrupted',
      detail: 'SIGTERM',
    });
    assert.equal(written, null);
    const reported = errors.find((e: string) => e.includes('could not write the terminal event'));
    assert.ok(reported, `the failure was swallowed; console.error saw ${JSON.stringify(errors)}`);
    assert.match(reported!, /perpetual "running"/, 'the report must name the consequence, not just the errno');
  } finally {
    console.error = realError;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The bead's other half: `file_change` is not a second defect.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: a write AFTER the 50-emit cap still appears as file_change', () => {
  // The bead reads "zero file_change" as a second defect and suspects the
  // sampler. It is not: `makeToolEventSink` emits `file_change` BEFORE and
  // independent of the sampling decision, so a write past the cap is durable
  // while its `tool_use` is coalesced away. The S3 log has none because the
  // recorded tools are Bash/Read/TodoWrite — every write happened after the
  // writer was gone. Pinned so nobody re-opens it as a sampler bug.
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-filechange-'));
  try {
    const runId = '_agent-cap';
    const logger = createLogger(runId, join(forgeRoot, '_logs'));
    const sink = makeToolEventSink(logger, {
      initiativeId: runId,
      parentEventId: 'EV_parent',
      phase: 'orchestrator',
      skill: 'onboarding-agent',
    });

    for (let seq = 1; seq <= 55; seq += 1) {
      sink.onToolUse({ name: 'Bash', inputSummary: `cmd ${seq}`, seq });
    }
    // Emit #55 by count — well past the 50 cap — and a real write.
    sink.onToolUse({ name: 'Write', inputSummary: 'write', seq: 56, filePath: 'AGENTS.md', op: 'modify' });
    sink.flushIteration(1);

    const events = readEvents(forgeRoot, runId);
    const toolUse = events.filter((e) => e['event_type'] === 'tool_use' && e['message'] !== 'tool.coalesced');
    const fileChange = events.filter((e) => e['event_type'] === 'file_change');

    assert.equal(toolUse.length, 50, `the cap must bind at 50 individual tool_use emits, saw ${toolUse.length}`);
    assert.equal(fileChange.length, 1, 'a write past the cap was NOT recorded as a file_change');
    assert.equal((fileChange[0]!['metadata'] as Record<string, unknown>)['path'], 'AGENTS.md');
    assert.ok(
      events.some((e) => e['message'] === 'tool.coalesced'),
      'what the sampler dropped must be surfaced, never silently capped',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The reproduction: the real command, signalled mid-run.
//
// The cases above prove the mechanism. This one proves the DEFECT — it drives
// `cmdAgentDispatch` itself, which is what the story runner invokes, and it was
// RED before the guard was wired in: a SIGTERM there ran neither the success
// path nor the catch, so the run's log ended with no terminus at all. That is
// the S3 evidence reproduced, not a lookalike.
// ---------------------------------------------------------------------------

test('REPRODUCTION: cmdAgentDispatch SIGTERMed mid-dispatch writes a terminus (red before the guard was wired)', async (t) => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-terminal-cmd-'));
  const runId = '_agent-cmd-repro';
  const childPath = join(forgeRoot, 'child.ts');
  writeFileSync(
    childPath,
    `import { cmdAgentDispatch } from ${JSON.stringify(join(HERE, 'agent-dispatch-cmd.ts'))};
     // Node exits on an unsettled top-level await unless something holds the
     // loop open — without this the child dies before the signal arrives and
     // the test would pass for the wrong reason (no terminus because no run).
     setInterval(() => {}, 1000);
     // 'ready' is written from INSIDE the injected dispatch, not before the
     // call: the guard is installed just above it, so signalling on this line
     // proves the guard was in place before the dispatch began. Announcing
     // readiness earlier raced the install and made this test flaky in exactly
     // the direction that hides the defect.
     await cmdAgentDispatch(
       ['onboarding-agent', '--run-id', ${JSON.stringify(runId)}],
       ${JSON.stringify(forgeRoot)},
       { dispatch: (() => { process.stdout.write('ready\\n'); return new Promise(() => {}); }) as never },
     );`,
  );

  const child = spawn(process.execPath, ['--experimental-strip-types', childPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += String(c);
  });
  t.after(() => {
    try {
      process.kill(child.pid!, 'SIGKILL');
    } catch {
      /* already exited */
    }
    rmSync(forgeRoot, { recursive: true, force: true });
  });

  await new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (c) => {
      out += String(c);
      if (out.includes('ready')) resolve();
    });
    child.on('exit', () => reject(new Error(`the child exited before it was ready: ${stderr}`)));
    setTimeout(() => reject(new Error(`the child never reported ready: ${stderr}`)), 20_000);
  });

  await new Promise<void>((resolve) => {
    child.on('exit', () => resolve());
    process.kill(child.pid!, 'SIGTERM');
  });

  const events = readEvents(forgeRoot, runId);
  assert.ok(
    events.some((e) => e['message'] === 'agent-dispatch.interrupted'),
    `cmdAgentDispatch was SIGTERMed and left NO terminal event: the run's log cannot be read as complete or incomplete and the bridge reports a perpetual "running" (bead forge-8vfn.5.38). Events: ${JSON.stringify(events)}`,
  );
});
