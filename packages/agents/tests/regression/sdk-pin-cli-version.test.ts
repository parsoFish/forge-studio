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
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
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
  // Read the installed manifest as a FILE, never resolve the module: a module
  // reference outside pinned-sdk-query.ts is what pinned-sdk-query.enforce.test.ts
  // refuses, and this door needs the bytes on disk, not the SDK.
  const pkgPath = join(REPO_ROOT, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');
  assert.ok(existsSync(pkgPath), `SDK not installed at ${pkgPath}`);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; claudeCodeVersion?: string };
  assert.ok(pkg.claudeCodeVersion, `SDK ${pkg.version} declares no bundled claudeCodeVersion`);
  assert.ok(
    atLeast(parse(pkg.claudeCodeVersion), MIN_BUNDLED_CLI),
    `SDK ${pkg.version} bundles CLI ${pkg.claudeCodeVersion} < ${MIN_BUNDLED_CLI.join('.')}`,
  );
});
