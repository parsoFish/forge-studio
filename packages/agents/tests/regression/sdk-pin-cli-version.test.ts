/**
 * forge-8vfn.7.6.117 — the SDK pin carries a CLI new enough for the models forge requests.
 *
 * The SDK ships its own Claude Code binary, so the SDK version forge pins decides
 * which CLI a spawn runs when nothing overrides it. 0.1.77 froze at CLI 2.0.77 while
 * the models moved on; `claude-opus-5-5` refuses any CLI older than 2.1.280
 * ("version 2.1.280 or newer is required", measured 2026-09-25). This door fails
 * when the installed pin's bundled CLI falls below that floor again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const MIN_BUNDLED_CLI = [2, 1, 280] as const;

function parse(v: string): number[] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  assert.ok(m, `not a semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function atLeast(v: number[], floor: readonly number[]): boolean {
  for (let i = 0; i < floor.length; i++) {
    if (v[i] !== floor[i]) return v[i] > floor[i];
  }
  return true;
}

test('the pinned SDK bundles a Claude Code CLI at or above the model floor', () => {
  const require = createRequire(import.meta.url);
  // `./package.json` is not an exported subpath, so find the package root from its entry.
  let dir = dirname(require.resolve('@anthropic-ai/claude-agent-sdk'));
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; claudeCodeVersion?: string };
  assert.ok(pkg.claudeCodeVersion, `SDK ${pkg.version} declares no bundled claudeCodeVersion`);
  assert.ok(
    atLeast(parse(pkg.claudeCodeVersion), MIN_BUNDLED_CLI),
    `SDK ${pkg.version} bundles CLI ${pkg.claudeCodeVersion} < ${MIN_BUNDLED_CLI.join('.')}`,
  );
});
