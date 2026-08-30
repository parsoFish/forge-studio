/**
 * The bridge port has ONE definition, and this test proves it structurally.
 *
 * HISTORY, because the change matters more than the test. This file used to be
 * a SOURCE-TEXT pin: it read `cli/forge-watch.ts` as a string and matched a
 * `const DEFAULT_BRIDGE_PORT = 4123;` declaration against forge-ui's own
 * literal, because — in that file's words — "the two live in different npm
 * workspaces and can't share a single TS import cleanly". It detected drift
 * after the fact and could not prevent it.
 *
 * `@forge/contracts` removes the constraint that forced the text pin: both
 * sides now import one constant, so the two CANNOT drift. The test changes
 * shape accordingly — from "do the two literals still agree?" to "is there
 * still only one literal?" — which is a strictly stronger question.
 *
 * It is deliberately NOT deleted. The failure mode it guarded is now
 * structural rather than arithmetic, but it is still reachable: anyone can
 * reintroduce a local literal in either file and the values would agree on the
 * day they did it. That is what the last two assertions catch.
 *
 * RUN: npx vitest run lib/bridge-port-parity.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEFAULT_BRIDGE_PORT as CONTRACT_PORT } from '@forge/contracts';
import { DEFAULT_BRIDGE_PORT as UI_PORT } from './bridge-port.ts';

const FORGE_WATCH_PATH = resolve(__dirname, '../../cli/forge-watch.ts');
const UI_BRIDGE_PORT_PATH = resolve(__dirname, './bridge-port.ts');

test('forge-ui serves the contracts constant itself, not a copy of its value', () => {
  expect(UI_PORT).toBe(CONTRACT_PORT);
  expect(CONTRACT_PORT).toBe(4123);
});

test('cli/forge-watch.ts holds no local port literal — it imports the contract', () => {
  const source = readFileSync(FORGE_WATCH_PATH, 'utf8');
  expect(
    /const\s+DEFAULT_BRIDGE_PORT\s*=/.test(source),
    'cli/forge-watch.ts re-declared DEFAULT_BRIDGE_PORT locally — the two can drift again; import it from @forge/contracts',
  ).toBe(false);
  expect(
    /DEFAULT_BRIDGE_PORT\s*}\s*from\s*'\.\.\/orchestrator\/_pkg\/contracts\.ts'/.test(source),
    'cli/forge-watch.ts must reach the contract through the orchestrator/_pkg shim (1.0.md §0)',
  ).toBe(true);
});

test('forge-ui/lib/bridge-port.ts holds no local port literal either', () => {
  const source = readFileSync(UI_BRIDGE_PORT_PATH, 'utf8');
  expect(
    /const\s+DEFAULT_BRIDGE_PORT\s*=/.test(source),
    'forge-ui re-declared DEFAULT_BRIDGE_PORT locally — re-export it from @forge/contracts instead',
  ).toBe(false);
});
