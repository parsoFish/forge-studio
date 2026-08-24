/**
 * W8-B6 — the ENUMERATION ratchet, plus the end-to-end plumbing pin through
 * the real `runAgent` dispatch.
 *
 * ## Why a structural test exists at all
 *
 * `forge-vvp` asserted, twice, that `orchestrator/run-agent.ts` was "the sole
 * dispatch entrypoint", and prescribed a fix confined to it. Derived by
 * execution it is one of SEVEN production sites that hand-build a claude SDK
 * options bag; there is no shared options builder. Wiring one of seven would
 * have left the architect, the developer loop, brain-fix, preflight-fix,
 * release-finalize, demo-builder, project-brain-builder, instructions-creator,
 * completeness-critic and every interactive session kind hook-blind — while
 * `/hooks` kept reporting them "carried by".
 *
 * A fix is only complete if an EIGHTH site cannot be added hook-blind. That is
 * what the first suite below enforces, in the style of
 * `orchestrator/pinned-sdk-query.enforce.test.ts`: because that test already
 * forbids importing the SDK's `query` anywhere except `pinned-sdk-query.ts`,
 * every real spawn site must import `pinnedSdkQuery`/`pinnedStreamQuery` as a
 * VALUE. So "imports the pinned query as a value" is a sound over-approximation
 * of "can spawn", and every such file must either wire hook dispatch or carry a
 * named, reasoned exemption.
 *
 * ## What this file does NOT prove
 *
 * That a hook process really runs is pinned in
 * `orchestrator/studio/hook-dispatch.test.ts`, by a real `bash` spawn writing a
 * side-effect file. Stated explicitly so plumbing coverage is never mistaken
 * for execution coverage.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { runAgent } from './run-agent.ts';
import { FORGE_ROOT } from './studio/derive.ts';
import { loadAgentDefinition } from './studio/registry.ts';
import type { AgentDefinition } from './studio/types.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';

// ---------------------------------------------------------------------------
// 1 — the ratchet
// ---------------------------------------------------------------------------

/** Roots scanned for spawn sites. `cli/` imports `isSafeRunId` from run-agent
 *  but never the pinned query as a value, so it holds no spawn site. */
const SCAN_ROOTS = ['orchestrator', 'loops'];

/**
 * Files that import the pinned SDK query as a VALUE yet legitimately do not
 * wire hook dispatch. Every row states WHY, and the reason must be a
 * structural fact — never "it seemed fine".
 */
const HOOK_DISPATCH_EXEMPT: Record<string, string> = {
  'orchestrator/phases/project-manager.ts':
    'imports pinnedStreamQuery only to DEFAULT options.queryFn; its actual spawn goes through runAgent(def, …) (:248), which builds the bag from the same derived spec.',
  'loops/_adapters/claude/index.ts':
    'the adapter registry shim. `query` is the raw stream boundary a direct-stream phase injects (that phase wires its own bag), and `createAgent` delegates to createClaudeAgent, which forwards opts.hooks.',
};

/** Any of these means the file participates in hook dispatch. */
const WIRED = /sdkHooksForAgent|SdkHooksOption/;

/** A VALUE import of the pinned query (a `type`-only import cannot spawn). */
const VALUE_IMPORT = /import\s*\{[^}]*\bpinned(?:SdkQuery|StreamQuery)\b[^}]*\}\s*from/;

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function spawnCapableFiles(): string[] {
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of listTsFiles(join(FORGE_ROOT, root))) {
      const rel = relative(FORGE_ROOT, file);
      const src = readFileSync(file, 'utf8');
      // Strip the `type`-only variant so `import type { StreamQueryFn }` and
      // `import { pinnedSdkQuery … }` are not conflated.
      if (/import\s+type\s*\{[^}]*\bpinned/.test(src) && !VALUE_IMPORT.test(src)) continue;
      if (VALUE_IMPORT.test(src)) found.push(rel);
    }
  }
  return found.sort();
}

describe('hook dispatch covers every spawn site (the enumeration ratchet)', () => {
  it('every file that can spawn either wires hook dispatch or carries a named exemption (kills: adding an eighth spawn site hook-blind — the exact shape forge-vvp prescribed)', () => {
    const offenders: string[] = [];
    for (const rel of spawnCapableFiles()) {
      if (rel in HOOK_DISPATCH_EXEMPT) continue;
      if (WIRED.test(readFileSync(join(FORGE_ROOT, rel), 'utf8'))) continue;
      offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      `these files import the pinned SDK query as a value (so they can spawn) but never reach ` +
        `orchestrator/studio/hook-dispatch.ts. Wire sdkHooksForAgent into the options bag, or add a ` +
        `reasoned row to HOOK_DISPATCH_EXEMPT:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('the ratchet actually sees the spawn sites — it is not vacuously green on an empty scan', () => {
    const files = spawnCapableFiles();
    assert.ok(
      files.length >= 12,
      `expected the scan to find the known spawn-capable files; found ${files.length}: ${files.join(', ')}`,
    );
    for (const known of [
      'orchestrator/run-agent.ts',
      'orchestrator/architect-runner.ts',
      'orchestrator/brain-fix-runner.ts',
      'orchestrator/preflight-fix-runner.ts',
      'orchestrator/phases/release-finalize.ts',
      'orchestrator/phases/developer-loop.ts',
      'loops/ralph/claude-agent.ts',
    ]) {
      assert.ok(files.includes(known), `the scan must see ${known}`);
    }
  });

  it('every exemption still names a file that exists and still imports the pinned query — a stale exemption is a hole', () => {
    const files = new Set(spawnCapableFiles());
    for (const rel of Object.keys(HOOK_DISPATCH_EXEMPT)) {
      assert.ok(files.has(rel), `stale exemption: ${rel} no longer imports the pinned SDK query as a value — delete the row`);
      assert.ok(HOOK_DISPATCH_EXEMPT[rel]!.length > 40, `exemption for ${rel} must state a real structural reason`);
    }
  });

  it('the ratchet\'s own premise holds: exactly one file may import the SDK query directly, and it is the pinned seam', () => {
    // This suite over-approximates "can spawn" as "imports pinnedSdkQuery/
    // pinnedStreamQuery as a value". That is only sound while
    // pinned-sdk-query.enforce.test.ts still forbids every OTHER file from
    // importing the SDK's `query` as a value — otherwise a new site could
    // spawn without ever touching the seam this scan keys on. Assert the
    // premise rather than assume it.
    assert.ok(
      readFileSync(join(FORGE_ROOT, 'orchestrator/pinned-sdk-query.enforce.test.ts'), 'utf8').includes('WRAPPER_RELATIVE_PATH'),
      'the structural lock this ratchet depends on must still exist',
    );
    const direct: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listTsFiles(join(FORGE_ROOT, root))) {
        const rel = relative(FORGE_ROOT, file);
        if (rel === 'orchestrator/pinned-sdk-query.ts') continue;
        if (/import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*'@anthropic-ai\/claude-agent-sdk'/.test(readFileSync(file, 'utf8'))) {
          direct.push(rel);
        }
      }
    }
    assert.deepEqual(direct, [], 'a file bypassing the pinned seam would also bypass this hook-dispatch ratchet');
  });

  it('the two interactive-session spawn shapes both forward the bag (they are the sites nine agents reach the SDK through)', () => {
    const src = readFileSync(join(FORGE_ROOT, 'orchestrator/interactive-session.ts'), 'utf8');
    const forwards = src.match(/\.\.\.\(args\.hooks !== undefined \? \{ hooks: args\.hooks \} : \{\}\)/g) ?? [];
    assert.equal(forwards.length, 2, 'runStructuredTurn AND runAgentTurn must each spread the hooks bag into their options');
  });
});

// ---------------------------------------------------------------------------
// 2 — end-to-end plumbing through the REAL runAgent dispatch
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

/**
 * A real `AgentDefinition` loaded from a SKILL.md written outside the install
 * root. `runAgent` derives its spec via `deriveAgentSpec(relative(FORGE_ROOT,
 * def.path))` and `sdkHooksForAgent` resolves the same string back against
 * `FORGE_ROOT`, so an out-of-tree fixture round-trips without the test writing
 * a single byte inside the repo. Hook ids still resolve against the REAL
 * `studio/hooks/`, which is what makes the OOTB binding below meaningful.
 */
function fixtureAgent(slug: string, hooks: string[]): AgentDefinition {
  const dir = join(tmp('hook-e2e-'), 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${slug}`,
      `description: W8-B6 end-to-end dispatch fixture (${slug}).`,
      'phase: reflection',
      'surface: unattended',
      'library: false',
      'purpose: Fixture.',
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
      "  loopStrategy: 'one-shot'",
      'brainAccess: none',
      'interactivity: Fully autonomous.',
      'allowed-tools: [Read]',
      'disallowed-tools: [Bash]',
      'budgets: {}',
      '---',
      '',
      `# ${slug}`,
      '',
      'Fixture.',
      '',
    ].join('\n'),
    'utf8',
  );
  return loadAgentDefinition(join(dir, 'SKILL.md'));
}

/** Captures the options bag `runAgent` hands the SDK, then ends the stream. */
function capturingQuery(sink: { options?: Record<string, unknown> }): StreamQueryFn {
  return ({ options }) => {
    sink.options = options;
    return (async function* () {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, duration_ms: 1, usage: {} };
    })();
  };
}

async function optionsFor(def: AgentDefinition): Promise<Record<string, unknown>> {
  const sink: { options?: Record<string, unknown> } = {};
  await runAgent(def, {
    runId: 'w8b6-e2e',
    workdir: tmp('hook-e2e-wd-'),
    prompt: 'noop',
    lifecycle: 'caller',
    logsRoot: tmp('hook-e2e-logs-'),
    queryFn: capturingQuery(sink),
  });
  assert.ok(sink.options, 'the fake query must have been called');
  return sink.options!;
}

describe('runAgent reaches the SDK options bag with the bound hooks (end-to-end plumbing)', () => {
  it('an agent binding a REAL library hook lands it under its declared lifecycle event (kills: HEAD, where no hooks key ever reached any spawn)', async () => {
    // post-merge-brain-ingest is an OOTB package under studio/hooks/, declared
    // `on: SessionEnd`. Deliberately NOT approved here: this pin is about the
    // plumbing reaching the SDK, and approving a package in the real install
    // to satisfy a test would be the "guard widened to fit the fixture" shape.
    const options = await optionsFor(fixtureAgent('w8b6-bound-fixture', ['post-merge-brain-ingest']));
    const hooks = options['hooks'] as Record<string, Array<{ hooks: unknown[] }>> | undefined;
    assert.ok(hooks, 'runAgent must pass a hooks option for an agent that binds one');
    assert.deepEqual(Object.keys(hooks), ['SessionEnd'], 'keyed by the hook.yaml-declared event, read off disk');
    assert.equal(hooks['SessionEnd']!.length, 1);
    assert.equal(hooks['SessionEnd']![0]!.hooks.length, 1);
    assert.equal(typeof hooks['SessionEnd']![0]!.hooks[0], 'function');
  });

  it('an agent binding nothing produces NO hooks key at all — the shape every shipped agent spawns with (kills: an always-on key, which would diff every golden spawn-capture fixture)', async () => {
    const options = await optionsFor(fixtureAgent('w8b6-unbound-fixture', []));
    assert.equal('hooks' in options, false);
  });

  it('no agent in the shipped roster binds a hook, so no shipped spawn shape changed', () => {
    const skillsDir = join(FORGE_ROOT, 'skills');
    const binders: string[] = [];
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const md = join(skillsDir, entry.name, 'SKILL.md');
      let def: AgentDefinition;
      try {
        def = loadAgentDefinition(md);
      } catch {
        continue;
      }
      if (def.composition.hooks.length > 0) binders.push(`${entry.name}: ${def.composition.hooks.join(', ')}`);
    }
    // Deliberately-green gap pin. EXPIRY CONDITION, stated as required: the
    // moment forge ships an agent with a bound hook, this must be replaced by a
    // spawn-capture fixture update showing the new bag — not deleted.
    assert.deepEqual(binders, [], 'a shipped agent now binds a hook; update the golden spawn-capture fixtures deliberately');
  });
});
