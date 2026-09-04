/**
 * STRUCTURAL CONTROL for the G1 P1: every agent the bridge can spawn reaches
 * `cmdAgentRun` WITH the dispatch deps.
 *
 * The defect this closes was not a typo, it was a class. `SPAWN_AGENT_SPECS`
 * gives each spawnable agent an `argvPrefix`; two of them are `agent run <id>`
 * and reach the `case 'agent'` arm, which forwarded deps. The other four are
 * legacy verbs whose `cmd<X>Run` delegate called `cmdAgentRun(argv, FORGE_ROOT)`
 * with the third argument omitted. Only architect consumed `manifestPorts`, so
 * only architect failed — `POST /api/architect/start` always took the unwired
 * entry and `architect-ports.ts` refused. The other three were the same defect
 * waiting for a consumer.
 *
 * WHY EVERY EXISTING TEST PASSED. `architect-runner-integration` builds the
 * turn and hands it the ports directly, so no test ever drove the argv path the
 * bridge actually spawns. A behavioural test of the architect turn cannot see
 * this; only a test of the WIRING can, which is why this one reads the source.
 *
 * It asserts over the SPAWN SPECS rather than a hand-written list of verbs, so
 * a seventh spawnable agent added tomorrow is covered without editing this file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { SPAWN_AGENT_SPECS } from './ui-bridge.ts';

const CLI_SRC = readFileSync(join(FORGE_ROOT, 'apps', 'forge', 'cli.ts'), 'utf8');
const DEPS_SRC = readFileSync(join(FORGE_ROOT, 'apps', 'forge', 'session-kind-deps.ts'), 'utf8');

/** The delegate a legacy `<verb> run` prefix lands in, e.g. `demo-builder` →
 *  `cmdDemoBuilderRun`. */
function delegateName(verb: string): string {
  const camel = verb.split('-').map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  return `cmd${camel}Run`;
}

test('every SPAWN_AGENT_SPECS entry reaches cmdAgentRun WITH the dispatch deps', () => {
  const missing: string[] = [];
  for (const [id, spec] of Object.entries(SPAWN_AGENT_SPECS)) {
    const [head, second] = spec.argvPrefix;
    if (head === 'agent' && second === 'run') {
      // the generic arm: `case 'agent'` must forward the shared deps object
      assert.match(CLI_SRC, /case .agent.:\s*\n\s*return await cmdAgent\([^;]*AGENT_DISPATCH_DEPS\)/,
        `the 'agent' dispatch arm must forward AGENT_DISPATCH_DEPS (needed by ${id})`);
      continue;
    }
    // a legacy verb: its delegate must pass the deps through to cmdAgentRun
    const fn = delegateName(head!);
    const body = new RegExp(`async function ${fn}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(CLI_SRC);
    assert.ok(body, `${fn} not found — SPAWN_AGENT_SPECS.${id} names '${head} ${second}'`);
    if (!/cmdAgentRun\([^;]*AGENT_DISPATCH_DEPS\)/.test(body[1]!)) missing.push(`${id} → ${fn}`);
  }
  assert.deepEqual(missing, [],
    'these spawnable agents reach cmdAgentRun with NO deps, so any port they need is unwired at spawn time:\n  ' +
    missing.join('\n  '));
});

test('CONTROL: the assertion REJECTS a delegate that drops the deps', () => {
  // The same check against a body with the third argument omitted — the exact
  // shape `cmdArchitectRun` had. If this control passes silently, the test
  // above cannot tell a wired delegate from an unwired one.
  const unwired = "  return cmdAgentRun(['architect', ...rest], FORGE_ROOT);";
  assert.ok(!/cmdAgentRun\([^;]*AGENT_DISPATCH_DEPS\)/.test(unwired),
    'a delegate omitting the deps argument must NOT satisfy the parity check');
});

test('the deps object is defined ONCE, so the arms cannot drift apart', () => {
  // It lives beside the ports it carries (`session-kind-deps.ts`), not in the
  // CLI: the CLI is at its 999-line ceiling and a definition there would have
  // to be paid for in prose someone later trims.
  const defs = (CLI_SRC + DEPS_SRC).match(/^export const AGENT_DISPATCH_DEPS\b/gm) ?? [];
  assert.equal(defs.length, 1,
    'AGENT_DISPATCH_DEPS must have exactly one definition — two would let the generic arm and the legacy ' +
    'delegates be wired differently again, which is the defect this file exists to close.');
});
