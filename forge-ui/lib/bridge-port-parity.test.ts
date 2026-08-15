/**
 * bridge-port-parity.test.ts — W6-P4: pins that `lib/bridge-port.ts`'s
 * `DEFAULT_BRIDGE_PORT` (the build-time literal `app/layout.tsx` inlines,
 * and `lib/bridge-client.ts`'s `resolveBridgeUrl` falls back to) stays in
 * lockstep with `cli/forge-watch.ts`'s OWN `DEFAULT_BRIDGE_PORT` — the
 * actual default the bridge process binds to (CLAUDE.md's fixed-port
 * convention: bridge 4123).
 *
 * A SOURCE-TEXT pin, not a live import: `cli/forge-watch.ts` is a CLI entry
 * file (transitively pulls in `./ui-bridge.ts`, which starts real
 * processes/servers) — unlike a pure logic module such as
 * `orchestrator/work-item.ts` (safely imported directly by
 * `./wi-status-parity.test.ts`), importing it here would risk executing
 * real startup side effects just to read one constant. Reading the literal
 * out of the source text is the same technique
 * `./knowledge-page-tabs.test.ts` and its siblings already use for
 * page.tsx, applied cross-workspace instead of cross-file.
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-port-parity.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BRIDGE_PORT } from './bridge-port.ts';

const FORGE_WATCH_PATH = resolve(__dirname, '../../cli/forge-watch.ts');

test('lib/bridge-port.ts DEFAULT_BRIDGE_PORT matches cli/forge-watch.ts DEFAULT_BRIDGE_PORT — the two must never drift', () => {
  const source = readFileSync(FORGE_WATCH_PATH, 'utf8');
  const match = source.match(/const DEFAULT_BRIDGE_PORT\s*=\s*(\d+)\s*;/);
  expect(match, 'cli/forge-watch.ts DEFAULT_BRIDGE_PORT declaration not found — parity check cannot run').not.toBeNull();
  const cliDefault = Number(match![1]);
  expect(DEFAULT_BRIDGE_PORT).toBe(cliDefault);
});
