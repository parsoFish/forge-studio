#!/usr/bin/env node
/**
 * forge-ui-live-demo — drives queue + log state changes in sequence with
 * pauses, so the operator (browser tab open at http://localhost:4124)
 * can watch the UI react in real time via WebSocket.
 *
 * Sequence:
 *   1. New manifest appears in _queue/pending/      → cycles tab updates
 *   2. Moves to _queue/in-flight/ + log dir created → status changes, toast
 *   3. Events appended one at a time                → event tail streams,
 *                                                     state machine + sidebar
 *                                                     react per phase
 *   4. Moves to _queue/ready-for-review/            → verdict form appears,
 *                                                     toast fires
 *   5. Operator's "approve" verdict simulated       → form would close
 *   6. Moves to _queue/done/                        → final toast
 *
 * Cleans up the synthetic on exit.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INIT_ID = 'INIT-2026-05-24-live-demo';
const PROJECT = 'live-demo';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const CYCLE_ID = `${stamp}_${INIT_ID}`;

const QPENDING = resolve(FORGE_ROOT, '_queue/pending');
const QINFLIGHT = resolve(FORGE_ROOT, '_queue/in-flight');
const QRFR = resolve(FORGE_ROOT, '_queue/ready-for-review');
const QDONE = resolve(FORGE_ROOT, '_queue/done');
const LOGDIR = resolve(FORGE_ROOT, '_logs', CYCLE_ID);

const MANIFEST = `---
type: implementation
initiative_id: ${INIT_ID}
project: ${PROJECT}
features:
  - id: FEAT-1
    name: live UI demo
---

# Live UI demo

Synthetic initiative driven by scripts/forge-ui-live-demo.mjs so the
operator can watch the forge-ui react to queue + log transitions in
real time.
`;

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  for (const dir of [QPENDING, QINFLIGHT, QRFR, QDONE]) {
    const path = join(dir, `${INIT_ID}.md`);
    try { rmSync(path, { force: true }); } catch {}
    try { rmSync(`${path}.lock`, { recursive: true, force: true }); } catch {}
    try { rmSync(join(dir, `${INIT_ID}.verdict-response.md`), { force: true }); } catch {}
    try { rmSync(join(dir, `${INIT_ID}.verdict-prompt.md`), { force: true }); } catch {}
  }
  try { rmSync(LOGDIR, { recursive: true, force: true }); } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('exit', cleanup);

function step(label, body) {
  console.log(`\n▶ ${label}`);
  return body();
}

async function pause(seconds, what) {
  console.log(`  … pausing ${seconds}s ${what ? `(${what})` : ''}`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
}

function writeManifest(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const tmp = join(targetDir, `${INIT_ID}.md.tmp`);
  writeFileSync(tmp, MANIFEST);
  renameSync(tmp, join(targetDir, `${INIT_ID}.md`));
}

function moveManifest(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  renameSync(join(fromDir, `${INIT_ID}.md`), join(toDir, `${INIT_ID}.md`));
}

function appendEvent(phase, eventType, message, metadata = {}) {
  mkdirSync(LOGDIR, { recursive: true });
  const entry = {
    event_id: `EV_${Math.random().toString(36).slice(2, 10)}`,
    cycle_id: CYCLE_ID,
    initiative_id: INIT_ID,
    started_at: new Date().toISOString(),
    phase,
    skill: phase,
    event_type: eventType,
    input_refs: [],
    output_refs: [],
    message,
    metadata,
  };
  appendFileSync(join(LOGDIR, 'events.jsonl'), JSON.stringify(entry) + '\n');
}

async function main() {
  console.log('====================================================');
  console.log(`forge-ui live demo — initiative ${INIT_ID}`);
  console.log(`cycle log dir: _logs/${CYCLE_ID}/`);
  console.log('Open http://localhost:4124 in your browser and watch.');
  console.log('Ctrl-C at any time to clean up.');
  console.log('====================================================');

  await pause(3, 'so you can see the starting state');

  step('1. Drop a new manifest into _queue/pending/', () => {
    writeManifest(QPENDING);
  });
  await pause(4, 'a new "pending" cycle tab should appear');

  step('2. Move to _queue/in-flight/ + open the cycle log', () => {
    moveManifest(QPENDING, QINFLIGHT);
    appendEvent('architect', 'start', 'architect phase started');
  });
  await pause(4, 'cycle tab status flips to in-flight; toast pops up; state-machine architect = active');

  step('3a. Architect finishes', () => {
    appendEvent('architect', 'end', 'architect phase complete');
    appendEvent('project-manager', 'start', 'project-manager phase started');
    appendEvent('project-manager', 'tool_use', 'brain-query: traffic-physics-and-flow');
    appendEvent('project-manager', 'tool_use', 'Glob src/**/*.ts');
  });
  await pause(4, 'architect = complete, project-manager = active with 2 tool uses');

  step('3b. PM emits work items + finishes', () => {
    // Write a synthetic graph so the WI graph panel renders.
    mkdirSync(join(LOGDIR, 'work-items-snapshot'), { recursive: true });
    writeFileSync(
      join(LOGDIR, 'work-items-snapshot', '_graph.md'),
      `# Work-item dependency graph — ${INIT_ID}\n\n` +
        '```mermaid\n' +
        'graph TD\n' +
        '    WI-1["WI-1: scaffold ui-demo seed"]\n' +
        '    WI-2["WI-2: cycle tab integration test"]\n' +
        '    WI-3["WI-3: verdict-form integration test"]\n' +
        '\n' +
        '    WI-1 --> WI-2\n' +
        '    WI-1 --> WI-3\n' +
        '```\n',
    );
    appendEvent('project-manager', 'end', 'pm.end', { work_item_count: 3, per_item_error_count: 0 });
  });
  await pause(4, 'WORK ITEMS panel should now show WI-1/2/3 with "after:" / "unblocks:"');

  step('3c. Dev-loop iterates', () => {
    appendEvent('developer-loop', 'start', 'developer-loop start');
    appendEvent('developer-loop', 'iteration', 'WI-1 iter 1', { work_item_id: 'WI-1' });
    appendEvent('developer-loop', 'tool_use', 'Write src/seed.ts',     { work_item_id: 'WI-1' });
    appendEvent('developer-loop', 'tool_use', 'Bash npm test',         { work_item_id: 'WI-1' });
    appendEvent('developer-loop', 'iteration', 'WI-2 iter 1', { work_item_id: 'WI-2' });
    appendEvent('developer-loop', 'tool_use', 'Write src/seed.test.ts', { work_item_id: 'WI-2' });
  });
  await pause(5, 'activity sidebar developer-loop fills with events/tool/iter counts');

  step('3d. Dev-loop done, review starts', () => {
    appendEvent('developer-loop', 'end', 'developer-loop complete');
    appendEvent('review-loop', 'start', 'review prep iteration');
    appendEvent('review-loop', 'tool_use', 'Bash gh pr create --draft');
  });
  await pause(4, 'state-machine review-loop = active');

  step('4. Move to _queue/ready-for-review/', () => {
    moveManifest(QINFLIGHT, QRFR);
  });
  await pause(5, 'verdict form should appear at the top; another toast fires');

  step('5. Wait for your verdict (synthesising "approve" in 8s)', async () => {
    await pause(8, 'you can click "approve and merge" in your browser if you want; otherwise I will simulate it');
    const verdictPath = join(QRFR, `${INIT_ID}.verdict-response.md`);
    if (!existsSync(verdictPath)) {
      writeFileSync(
        verdictPath,
        `---\nverdict: approve\nrationale: |\n  Live-demo synthetic verdict.\n---\n`,
      );
      console.log('  (wrote synthetic approve verdict)');
    } else {
      console.log('  (you submitted a verdict via the UI — using yours)');
    }
  });
  await pause(2);

  step('6. Move to _queue/done/', () => {
    moveManifest(QRFR, QDONE);
    appendEvent('review-loop', 'end', 'review complete');
    appendEvent('closure', 'start', 'closure');
    appendEvent('closure', 'end', 'merged');
  });
  await pause(5, 'cycle moves out of "live" into "recent done" with a final toast');

  console.log('\n✓ Live demo complete. Cleaning up synthetic state in 5s — press Ctrl-C now if you want to inspect.');
  await pause(5);
  cleanup();
  console.log('cleaned up.');
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  console.error(err.stack);
  cleanup();
  process.exit(1);
});
