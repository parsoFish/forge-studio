#!/usr/bin/env node
/**
 * probe-write-fence.mjs — the LIVE end-to-end proof for the write-root fence
 * (W7-A2, sessions-kinds-V01, beads forge-w08 / forge-eip).
 *
 * Spends real tokens (one short haiku turn), so it is NOT part of `npm test`
 * — the T2 runs it once per fence change and records the output in the PR.
 * The unit contract lives in orchestrator/interactive-session-fence-mode.test.ts.
 *
 * What it does: builds a throwaway session dir with a `staging/` write root,
 * runs a REAL `runAgentTurn` through the pinned SDK with
 * `writeRoots = [<sessionDir>/staging]` and the same tool grant a
 * generic-interactive-session SKILL.md typically declares (Write IN the
 * allow list — historically community-refresh's own grant shape, W8-B5b
 * WI-3 retired that kind), and asks the model to (1) Write an absolute path
 * OUTSIDE the root and (2) Write a file INSIDE it. Then it checks the
 * filesystem — the artifact, not the status code:
 *   PASS  = outside file absent AND inside file present
 *   FAIL  = outside file present (fence bypassed) or inside file absent
 *           (fence over-strict — a false rejection is also a defect)
 *
 * Usage:  node --experimental-strip-types scripts/probe-write-fence.mjs
 * Env:    FORGE_FENCE_PROBE_MODEL (default claude-haiku-4-5-20251001)
 */
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { runAgentTurn } = await import(join(REPO_ROOT, 'packages', 'sessions', 'interactive-session.ts'));
const { pinnedSdkQuery } = await import(join(REPO_ROOT, 'packages', 'agents', 'pinned-sdk-query.ts'));

const model = process.env.FORGE_FENCE_PROBE_MODEL ?? 'claude-haiku-4-5-20251001';
const root = mkdtempSync(join(tmpdir(), 'fence-probe-'));
const sessionDir = join(root, 'session');
const writeRoot = join(sessionDir, 'staging');
mkdirSync(writeRoot, { recursive: true });
const outsideDir = join(root, 'outside');
mkdirSync(outsideDir, { recursive: true });
const outsidePath = join(outsideDir, 'escaped.txt');
const insidePath = join(writeRoot, 'inside.txt');

const prompt = [
  'You are a file-writing test harness. Perform EXACTLY these two steps using the Write tool, in order, then stop:',
  `1. Use the Write tool to create the file at the absolute path ${outsidePath} with the content OUTSIDE.`,
  `2. Use the Write tool to create the file at the absolute path ${insidePath} with the content INSIDE.`,
  'If a Write is refused, do not retry it with a different path or tool — move on to the next step. Do not use Bash. Reply "done" when finished.',
].join('\n');

const denials = [];
const toolUses = [];
console.log(`[probe] model=${model}`);
console.log(`[probe] writeRoot=${writeRoot}`);
console.log(`[probe] outside=${outsidePath}`);
const started = Date.now();
let costUsd = 0;
try {
  const result = await runAgentTurn({
    queryFn: pinnedSdkQuery,
    prompt,
    cwd: sessionDir,
    model,
    allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'WebFetch', 'WebSearch'],
    disallowedTools: ['Edit', 'Bash', 'NotebookEdit'],
    maxTurns: 6,
    writeRoots: [writeRoot],
    onToolUse: (d) => { toolUses.push(`${d.name} ${d.inputSummary ?? ''}`.trim()); },
    onText: (t) => { if (/refused|outside|denied/i.test(t)) denials.push(t.slice(0, 200)); },
    label: 'fence-probe',
  });
  costUsd = result.costUsd;
} catch (err) {
  console.log(`[probe] turn threw: ${err instanceof Error ? err.message : String(err)}`);
}
const elapsedMs = Date.now() - started;
const outsideExists = existsSync(outsidePath);
const insideExists = existsSync(insidePath);
console.log(`[probe] tool_use: ${JSON.stringify(toolUses)}`);
console.log(`[probe] model text mentioning refusal: ${JSON.stringify(denials)}`);
console.log(`[probe] outside file exists: ${outsideExists}${outsideExists ? ` (content=${JSON.stringify(readFileSync(outsidePath, 'utf8'))})` : ''}`);
console.log(`[probe] inside  file exists: ${insideExists}${insideExists ? ` (content=${JSON.stringify(readFileSync(insidePath, 'utf8'))})` : ''}`);
console.log(`[probe] cost=$${costUsd.toFixed(4)} elapsed=${elapsedMs}ms`);
const pass = !outsideExists && insideExists;
console.log(pass ? '[probe] PASS — out-of-root Write refused, in-root Write landed' : '[probe] FAIL — see above');
rmSync(root, { recursive: true, force: true });
process.exit(pass ? 0 : 1);
