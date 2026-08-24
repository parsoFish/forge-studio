/**
 * W7-FIX-A2 (W7A2-03, SECURITY — closes bead forge-w08) — Bash is FENCED on
 * a write-root-fenced turn.
 *
 * The sweep confirmed: `FENCE_GATED_TOOLS` was {Write, Edit, MultiEdit,
 * NotebookEdit}; `makeWriteRootCanUseTool` allowed EVERY other tool name
 * unconditionally; and on a fenced turn `Bash` survived the allowedTools
 * strip — so an authoring/creation-agent turn (allowed-tools includes Bash,
 * fenced = true) could `printf x > /outside/root/file` and reach the
 * filesystem. ADR-043's own 2026-08-19 §3 stated it as the residual.
 *
 * Contract pinned here (RED at branch base):
 *   1. On a fenced turn `Bash` is stripped from `allowedTools` handed to the
 *      SDK (so the SDK routes it through `canUseTool`, exactly the proven
 *      Write mechanism) and NOT pushed into `disallowedTools`.
 *   2. The fence's `canUseTool` DENIES `Bash` by default — a fenced kind that
 *      does not opt in has no ungated write-capable tool at all.
 *   3. A kind that opts in (`turnSpec.bashFence: inspect`, the ONE authored
 *      switch, validated against a frozen vocabulary) gets a static,
 *      fail-closed inspection: every write-shaped operation (`>`, `>>`,
 *      `tee`, `cp`, `mv`, `rm`, `mkdir`, `touch`, `chmod`, `dd of=`, …)
 *      must target a path INSIDE writeRoots (relative paths resolve against
 *      the turn's cwd, `cd` tracked); `git` is read-only-subcommands only;
 *      interpreters / `sh -c` / `eval` / `xargs` / `find -delete|-exec` /
 *      command substitution / unknown commands / unparseable input are all
 *      denied. Only an allowlist of read-only commands passes without a
 *      path check.
 *   4. The REAL descriptors: `authoring` (creation-agent grants Bash) opts
 *      in and gets inspection; `kb-cleanup` does not opt in and denies Bash
 *      outright — checked through `runInteractiveTurn` with a queryFn that
 *      captures the real `options.canUseTool`, i.e. the live-shaped seam, no
 *      tokens spent. (`community-refresh` was a third non-opted-in real
 *      descriptor exercised here until it was retired in W8-B5b.)
 *
 * RUN: node --test --experimental-strip-types orchestrator/bash-fence.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectBashCommand } from './bash-fence.ts';
import { makeWriteRootCanUseTool, runAgentTurn, writeSessionStatus, type QueryFn, type WriteRootCanUseTool } from './interactive-session.ts';
import { runInteractiveTurn } from './interactive-runner.ts';
import { loadSessionKinds, validateSessionKinds, BASH_FENCE_MODES } from './studio/session-kinds.ts';
import { createLogger } from './logging.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'claude-sonnet-4-6';

function fixture(): { sessionDir: string; staging: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'bash-fence-'));
  const sessionDir = join(root, 'session');
  const staging = join(sessionDir, 'staging');
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, 'SKILL.md'), '# x\n');
  const outside = join(root, 'outside');
  mkdirSync(outside, { recursive: true });
  return { sessionDir, staging, outside };
}

// ---------------------------------------------------------------------------
// 3. inspectBashCommand — the pure static inspector
// ---------------------------------------------------------------------------

function verdict(cmd: string, fx = fixture()): { allow: boolean; reason?: string } {
  return inspectBashCommand(cmd, { cwd: fx.sessionDir, realWriteRoots: [fx.staging] });
}

test('bash-fence inspect: ALLOWS read-only commands, in-root writes (absolute + cwd-relative), tracked cd, fd dups and /dev/null', () => {
  const fx = fixture();
  const ok = [
    'ls -la staging',
    'cat staging/SKILL.md | head -20',
    'grep -rn foo staging',
    `printf 'x' > ${fx.staging}/out.txt`,
    'echo hi >> ./staging/log.txt 2>/dev/null',
    'mkdir -p staging/scripts && chmod +x staging/scripts/run.sh',
    'cp staging/a staging/b',
    'mv staging/a staging/scripts/b',
    'rm -f staging/tmp.txt',
    'touch staging/x && truncate -s 0 staging/x',
    'cd staging && echo x > y.txt',
    'ls staging 2>&1',
    'echo $HOME',
    'git status && git log --oneline -5 && git diff -- staging',
    'git -C staging status',
    'tee staging/x < staging/SKILL.md',
    'dd if=/dev/zero of=staging/blob bs=1 count=1',
    "cat > staging/run.sh <<'EOF'\n#!/bin/sh\necho 'a > b' > /this/is/heredoc/body\nEOF",
    'FOO=bar ls staging',
    'test -f staging/x && echo present',
    'wc -l staging/SKILL.md; du -sh staging',
  ];
  for (const cmd of ok) {
    const v = verdict(cmd, fx);
    assert.equal(v.allow, true, `expected ALLOW for ${JSON.stringify(cmd)}, got deny: ${v.reason}`);
  }
});

test('bash-fence inspect: DENIES every write-shaped op targeting a path outside writeRoots — redirections, tee, cp/mv/rm/mkdir/chmod, dd of=, relative escapes, normalised traversal', () => {
  const fx = fixture();
  const bad = [
    `printf 'x' > ${fx.outside}/file`,
    'echo x > ../escape.txt',
    'echo x > out.txt',
    'echo x > staging/../../evil',
    'echo x >| /tmp/clobber',
    'echo x &> /tmp/both',
    'ls 2> /tmp/errs',
    `tee ${fx.outside}/f`,
    'tee -a ../x',
    `cp staging/a ${fx.outside}/b`,
    'mv staging/a ..',
    'mv /tmp/something staging/x',
    'rm -rf /',
    'rm -rf ~/x',
    'mkdir -p /tmp/x',
    'chmod +x /usr/bin/foo',
    'touch ../y',
    `dd if=/dev/zero of=${fx.outside}/blob`,
    'true && echo x > /tmp/late',
    'ls; rm -rf /tmp/second-segment',
    'ls | tee /tmp/piped',
    'cd .. && echo x > y.txt',
    'cd /tmp && echo x > y.txt',
  ];
  for (const cmd of bad) {
    const v = verdict(cmd, fx);
    assert.equal(v.allow, false, `expected DENY for ${JSON.stringify(cmd)}`);
    assert.ok(typeof v.reason === 'string' && v.reason.length > 0, 'a deny names its reason');
  }
});

test('bash-fence inspect: DENIES interpreters, shell -c, eval/exec/source, xargs, find write-actions, git writes, link creation, archives/network fetchers — fail closed on the whole class, not a path check', () => {
  const fx = fixture();
  const bad = [
    'sed -i s/a/b/ staging/x',
    'sed -n 1p staging/x',
    "python3 -c \"open('/x','w')\"",
    'node -e "require(\'fs\').writeFileSync(\'/x\',\'y\')"',
    "perl -e 'print 1'",
    'awk \'{print > "/x"}\' staging/SKILL.md',
    'bash -c "echo x > /outside"',
    'sh -c ls',
    'eval "ls"',
    'exec ls',
    'source staging/env.sh',
    '. staging/env.sh',
    'find . -delete',
    'find . -name x -exec rm {} \\;',
    'ls | xargs rm',
    'git add .',
    'git commit -m x',
    'git checkout -- .',
    'git push',
    'git init',
    'git clone https://example.com/x',
    'git stash',
    'git branch -D main',
    'git config user.name x',
    'ln -s /etc/passwd staging/pw',
    'ln /etc/x staging/y',
    'cp -a /outside/tree staging/',
    'cp -r ../tree staging/',
    'tar xf staging/x.tar',
    'unzip staging/x.zip',
    'curl -o staging/x https://example.com',
    'wget https://example.com',
    'rsync -a . staging/',
    'install -m 755 x staging/y',
    'patch -p1 < staging/x.diff',
    'sudo ls',
    'nohup ls',
    'env FOO=1 bash -c ls',
    'timeout 5 sh -c ls',
  ];
  for (const cmd of bad) {
    const v = verdict(cmd, fx);
    assert.equal(v.allow, false, `expected DENY for ${JSON.stringify(cmd)}`);
  }
});

test('bash-fence inspect: DENIES anything it cannot reason about — command/process substitution, unresolvable targets ($VAR, ~, braces), unknown commands, unbalanced quotes, empty input, NUL', () => {
  const fx = fixture();
  const bad = [
    'echo $(rm -rf /tmp/x)',
    'echo `rm -rf /tmp/x`',
    'cat <(ls)',
    'ls > >(tee /tmp/x)',
    'echo x > $OUT',
    'echo x > ${OUT}',
    'echo x > ~/file',
    'mkdir staging/{..,x}/evil',
    'cd $DIR && rm x',
    'unknowncmd staging/x',
    'echo "abc',
    "echo 'abc",
    '',
    '   ',
    "ls\u0000staging",
    'echo $((1+1)) > staging/x',
  ];
  for (const cmd of bad) {
    const v = verdict(cmd, fx);
    assert.equal(v.allow, false, `expected DENY for ${JSON.stringify(cmd)}`);
  }
});

test('bash-fence inspect: a symlinked directory INSIDE the root that points outside cannot be written through (realpath of the deepest existing ancestor)', () => {
  const fx = fixture();
  symlinkSync(fx.outside, join(fx.staging, 'link'));
  const v = verdict('echo x > staging/link/escaped.txt', fx);
  assert.equal(v.allow, false, 'a write through an in-root symlink to an outside dir must be denied');
  const v2 = verdict('mkdir -p staging/link/deeper/still', fx);
  assert.equal(v2.allow, false);
});

// ---------------------------------------------------------------------------
// 2. makeWriteRootCanUseTool — Bash policy
// ---------------------------------------------------------------------------

test('bash-fence canUseTool: DEFAULT policy denies Bash outright — even a harmless `ls` — on a fenced turn (a fenced kind that does not opt in has no ungated write-capable tool)', async () => {
  const fx = fixture();
  const canUseTool: WriteRootCanUseTool = makeWriteRootCanUseTool([fx.staging]);
  const r = await canUseTool('Bash', { command: 'ls staging' }, {});
  assert.equal(r.behavior, 'deny');
  assert.match((r as { message: string }).message, /Bash/);
  const w = await canUseTool('Bash', { command: `printf x > ${fx.outside}/f` }, {});
  assert.equal(w.behavior, 'deny');
  // Non-Bash, non-gated tools still pass (Read/Grep/Glob are reads).
  const read = await canUseTool('Read', { file_path: join(fx.outside, 'anything') }, {});
  assert.equal(read.behavior, 'allow');
});

test('bash-fence canUseTool: `bash: inspect` allows an in-root write and a read-only command, denies an out-of-root write, a missing/non-string command, and an interpreter', async () => {
  const fx = fixture();
  const canUseTool = makeWriteRootCanUseTool([fx.staging], { bash: 'inspect', cwd: fx.sessionDir });
  assert.equal((await canUseTool('Bash', { command: 'ls staging' }, {})).behavior, 'allow');
  assert.equal((await canUseTool('Bash', { command: 'echo x > staging/out.txt' }, {})).behavior, 'allow');
  const denied = await canUseTool('Bash', { command: `printf x > ${fx.outside}/f` }, {});
  assert.equal(denied.behavior, 'deny');
  assert.match((denied as { message: string }).message, /write-root fence/);
  assert.equal((await canUseTool('Bash', {}, {})).behavior, 'deny', 'no command string ⇒ deny (fail closed)');
  assert.equal((await canUseTool('Bash', { command: 42 }, {})).behavior, 'deny');
  assert.equal((await canUseTool('Bash', { command: 'python3 -c "print(1)"' }, {})).behavior, 'deny');
});

// ---------------------------------------------------------------------------
// 1. runAgentTurn — Bash is stripped from allowedTools on a fenced turn
// ---------------------------------------------------------------------------

function capturingQueryFn(): { queryFn: QueryFn; captured: () => Record<string, unknown> } {
  let capturedOptions: Record<string, unknown> | undefined;
  const queryFn: QueryFn = ({ options }) => {
    capturedOptions = options;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
  return { queryFn, captured: () => { assert.ok(capturedOptions, 'queryFn must have been invoked'); return capturedOptions!; } };
}

const CREATION_AGENT_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'] as const;

test('bash-fence runAgentTurn: writeRoots non-empty ⇒ Bash is stripped from allowedTools (routed through canUseTool) and NOT pushed into disallowedTools; every other non-gated grant survives', async () => {
  const fx = fixture();
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: fx.sessionDir, model: MODEL, allowedTools: [...CREATION_AGENT_TOOLS], writeRoots: [fx.staging] });
  const opts = captured();
  const allowed = opts.allowedTools as string[];
  assert.ok(!allowed.includes('Bash'), `Bash must NOT be pre-approved on a fenced turn; got allowedTools=${JSON.stringify(allowed)}`);
  assert.deepEqual(allowed, ['Read', 'Grep', 'Glob'], 'reads survive verbatim; Write/Edit/Bash all go through canUseTool');
  assert.ok(!(opts.disallowedTools as string[]).includes('Bash'), 'Bash stays CALLABLE (gated), never removed');
  assert.equal(opts.permissionMode, 'default');
  assert.equal(typeof opts.canUseTool, 'function');
});

test('bash-fence runAgentTurn: writeRoots absent ⇒ Bash passes through allowedTools verbatim (byte-identical prior behaviour for unfenced callers)', async () => {
  const fx = fixture();
  const { queryFn, captured } = capturingQueryFn();
  await runAgentTurn({ queryFn, prompt: 'p', cwd: fx.sessionDir, model: MODEL, allowedTools: [...CREATION_AGENT_TOOLS] });
  assert.deepEqual(captured().allowedTools, [...CREATION_AGENT_TOOLS]);
  assert.equal(captured().canUseTool, undefined);
});

test('bash-fence runAgentTurn: the installed canUseTool honours `bashFence` — default denies `ls`; `inspect` allows `ls` and an in-root write, denies an out-of-root write', async () => {
  const fx = fixture();
  {
    const { queryFn, captured } = capturingQueryFn();
    await runAgentTurn({ queryFn, prompt: 'p', cwd: fx.sessionDir, model: MODEL, allowedTools: [...CREATION_AGENT_TOOLS], writeRoots: [fx.staging] });
    const cut = captured().canUseTool as WriteRootCanUseTool;
    assert.equal((await cut('Bash', { command: 'ls staging' }, {})).behavior, 'deny');
  }
  {
    const { queryFn, captured } = capturingQueryFn();
    await runAgentTurn({ queryFn, prompt: 'p', cwd: fx.sessionDir, model: MODEL, allowedTools: [...CREATION_AGENT_TOOLS], writeRoots: [fx.staging], bashFence: 'inspect' });
    const cut = captured().canUseTool as WriteRootCanUseTool;
    assert.equal((await cut('Bash', { command: 'ls staging' }, {})).behavior, 'allow');
    assert.equal((await cut('Bash', { command: 'printf x > staging/hook.yaml' }, {})).behavior, 'allow', 'relative to the turn cwd (the session dir), inside staging');
    assert.equal((await cut('Bash', { command: `printf x > ${fx.outside}/f` }, {})).behavior, 'deny');
  }
});

// ---------------------------------------------------------------------------
// Vocabulary — turnSpec.bashFence is validated, frozen, and authored ONCE
// ---------------------------------------------------------------------------

test('bash-fence vocab: BASH_FENCE_MODES is exactly {deny, inspect} (frozen); a bogus turnSpec.bashFence is a validateSessionKinds error naming the value and the allowed set', () => {
  assert.deepEqual(BASH_FENCE_MODES.map((m) => m.id), ['deny', 'inspect']);
  assert.ok(Object.isFrozen(BASH_FENCE_MODES));
  const root = mkdtempSync(join(tmpdir(), 'bash-fence-vocab-'));
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'session-kinds.yaml'), `
- id: bogus-bash-kind
  agent: creation-agent
  title: Bogus
  stages: [authoring]
  defaultStage: authoring
  artifact: { kind: file-package, label: "P" }
  turnSpec:
    kindDir: _bogus
    style: agent
    bashFence: yolo
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`);
  const descriptors = loadSessionKinds(root);
  assert.equal(descriptors[0]?.turnSpec?.bashFence, 'yolo', 'loadSessionKinds is structural — carries the value through');
  // validateSessionKinds loads from `<forgeRoot>/studio/session-kinds.yaml`
  // itself — the temp root IS the forge root here (its agent roster is empty,
  // so an unknown-agent finding rides along; only the bashFence one is asserted).
  const findings = validateSessionKinds(root);
  const hit = findings.find((f) => f.level === 'error' && /bashFence/.test(f.message) && /yolo/.test(f.message) && /deny/.test(f.message) && /inspect/.test(f.message));
  assert.ok(hit, `expected an error finding naming "yolo" and the allowed set; got: ${JSON.stringify(findings.map((f) => f.message))}`);
});

// ---------------------------------------------------------------------------
// 4. The REAL descriptors through runInteractiveTurn (live-shaped seam)
// ---------------------------------------------------------------------------

function realKindFixture(kindId: string): { descriptor: NonNullable<ReturnType<typeof loadSessionKinds>[number]>; forgeRoot: string; projectRoot: string; logsRoot: string; sessionId: string; sessionDir: string } {
  const descriptor = loadSessionKinds(REPO_ROOT).find((d) => d.id === kindId);
  if (!descriptor?.turnSpec) throw new Error(`test fixture bug: real session-kinds.yaml has no turnSpec kind "${kindId}"`);
  const root = mkdtempSync(join(tmpdir(), `bash-fence-real-${kindId}-`));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'community', 'registry.yaml'), 'meta: { schemaVersion: 1, lastRefresh: null }\nitems: []\n');
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-19T12-00-00';
  const sessionDir = join(projectRoot, descriptor.turnSpec.kindDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  return { descriptor, forgeRoot, projectRoot, logsRoot, sessionId, sessionDir };
}

async function captureRealCanUseTool(kindId: string, status: Record<string, unknown>, writesDir: string): Promise<{ cut: WriteRootCanUseTool; sessionDir: string; allowedTools: string[] }> {
  const fx = realKindFixture(kindId);
  writeSessionStatus(fx.sessionDir, { session_id: fx.sessionId, updated_at: new Date().toISOString(), ...status });
  let captured: Record<string, unknown> | undefined;
  const queryFn: QueryFn = ({ options }) => {
    captured = options;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(fx.sessionDir, writesDir), { recursive: true });
      writeFileSync(join(fx.sessionDir, writesDir, 'out.md'), '# out\n');
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
  await runInteractiveTurn(fx.descriptor, { sessionId: fx.sessionId, projectRoot: fx.projectRoot, forgeRoot: fx.forgeRoot, logsRoot: fx.logsRoot, queryFn, logger: createLogger(`_bash-fence-${kindId}`, fx.logsRoot) });
  assert.ok(captured, 'queryFn must have been invoked');
  assert.equal(typeof captured!.canUseTool, 'function', 'a fenced turn installs canUseTool');
  return { cut: captured!.canUseTool as WriteRootCanUseTool, sessionDir: fx.sessionDir, allowedTools: captured!.allowedTools as string[] };
}

test('bash-fence REAL authoring (creation-agent grants Bash; turnSpec opts in): Bash is not pre-approved, `ls`/in-root writes pass inspection, an out-of-root `printf > file` is DENIED — bead forge-w08 closed at the live seam', async () => {
  const { cut, sessionDir, allowedTools } = await captureRealCanUseTool('authoring', { phase: 'analyzing', prompt: 'make a hook' }, 'staging');
  assert.ok(!allowedTools.includes('Bash'), `Bash must not be pre-approved: ${JSON.stringify(allowedTools)}`);
  assert.equal((await cut('Bash', { command: 'ls staging' }, {})).behavior, 'allow');
  assert.equal((await cut('Bash', { command: 'mkdir -p staging/scripts && chmod +x staging/scripts/run.sh' }, {})).behavior, 'allow');
  const outside = join(dirname(sessionDir), 'escaped.txt');
  const denied = await cut('Bash', { command: `printf 'x' > ${outside}` }, {});
  assert.equal(denied.behavior, 'deny', 'the forge-w08 shape: a Bash redirect outside writeRoots');
  assert.equal((await cut('Bash', { command: 'git commit -am x' }, {})).behavior, 'deny');
});

test('bash-fence REAL kb-cleanup (no opt-in): Bash is denied outright by the fence even for `ls`', async () => {
  // community-refresh was a second non-opted-in real descriptor probed here
  // (identical `deny` shape) until it was retired in W8-B5b.
  const kb = await captureRealCanUseTool('kb-cleanup', { phase: 'drafting', kb_id: 'k', findings: [] }, 'plan');
  assert.equal((await kb.cut('Bash', { command: 'ls' }, {})).behavior, 'deny');
});
