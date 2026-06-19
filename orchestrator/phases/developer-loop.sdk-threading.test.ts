/**
 * SDK-threading regression (WS-C / C1, ADR 029).
 *
 * `deriveAgentSpec` now carries the SKILL.md `runtime.sdk` through to the
 * PhaseAgentSpec, and the dev-loop resolves it through `resolveSdkId` before
 * spawning. This test pins the two ends of that thread:
 *
 *   1. Stock SKILL.md defs (developer-ralph / developer-unifier) carry
 *      `sdk: 'claude'` and resolve to the live 'claude' adapter.
 *   2. A def declaring `runtime.sdk: gemini` (registered but unavailable in CI)
 *      resolves back to 'claude' AND fires the `sdk.unavailable-fallback`
 *      callback — and `resolveSdkId` NEVER throws (the gate that stops a
 *      free-text/unavailable sdk from reaching getAdapter, which would throw).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { deriveAgentSpec } from '../studio/derive.ts';
import { resolveSdkId } from '../../loops/_adapters/registry.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = resolve(__dirname, '..', '..');

/** Write a minimal studio SKILL.md into a tmp dir and return its absolute path. */
function writeTmpSkill(dir: string, frontmatter: string): string {
  const skillDir = mkdtempSync(join(dir, 'skill-'));
  const skillPath = join(skillDir, 'SKILL.md');
  writeFileSync(skillPath, `---\n${frontmatter}\n---\n\n# Body\n`);
  return skillPath;
}

function fixtureFrontmatter(sdk: string): string {
  return `name: sdk-threading-test
description: A test agent.
phase: developer-loop
surface: unattended
purpose: Test sdk threading.
composition:
  skills: []
  tools: []
  mcps: []
  hooks: []
brainAccess: advisory
interactivity: Fully autonomous.
allowed-tools: [Read, Write, Edit, Bash]
disallowed-tools: [NotebookEdit]
budgets: {}
runtime:
  sdk: ${sdk}
  strategy: fixed
  model: claude-sonnet-4-6`;
}

// ---------------------------------------------------------------------------
// 1. Stock SKILL.md → sdk: 'claude', resolves to the live adapter
// ---------------------------------------------------------------------------

test('stock developer-ralph SKILL.md carries sdk:claude and resolves to claude', () => {
  const spec = deriveAgentSpec('skills/developer-ralph/SKILL.md', FORGE_ROOT);
  assert.equal(spec.sdk, 'claude', 'derived spec carries runtime.sdk');
  assert.equal(resolveSdkId(spec.sdk), 'claude', 'resolves to the live claude adapter');
});

test('stock developer-unifier SKILL.md carries sdk:claude and resolves to claude', () => {
  const spec = deriveAgentSpec('skills/developer-unifier/SKILL.md', FORGE_ROOT);
  assert.equal(spec.sdk, 'claude', 'derived spec carries runtime.sdk');
  assert.equal(resolveSdkId(spec.sdk), 'claude', 'resolves to the live claude adapter');
});

// ---------------------------------------------------------------------------
// 2. An unavailable runtime.sdk (gemini in CI) logs the fallback, resolves to
//    claude, and NEVER throws.
// ---------------------------------------------------------------------------

test('a def with runtime.sdk:gemini (unavailable in CI) falls back to claude — logs, never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-threading-'));
  try {
    const skillPath = writeTmpSkill(dir, fixtureFrontmatter('gemini'));
    const spec = deriveAgentSpec(skillPath, '/');
    assert.equal(spec.sdk, 'gemini', 'derived spec carries the requested (unavailable) sdk');

    const logged: Array<{ type: string; sdk?: string }> = [];
    let resolved = '';
    assert.doesNotThrow(() => {
      resolved = resolveSdkId(spec.sdk, (e) => logged.push(e));
    }, 'resolveSdkId must never throw on an unavailable sdk');

    assert.equal(resolved, 'claude', 'unavailable gemini falls back to claude');
    assert.equal(logged.length, 1, 'the fallback is logged exactly once');
    assert.equal(logged[0].type, 'sdk.unavailable-fallback', 'logs the fallback event type');
    assert.equal(logged[0].sdk, 'gemini', 'records the requested sdk in the event');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unset runtime.sdk path resolves to claude without logging a fallback', () => {
  // The default-fallback path (undefined/empty) is the "no sdk declared" case —
  // it must NOT log a fallback (that event means "you asked for X, you got
  // claude"), and must never throw.
  const logged: Array<{ type: string; sdk?: string }> = [];
  let resolved = '';
  assert.doesNotThrow(() => {
    resolved = resolveSdkId(undefined, (e) => logged.push(e));
  });
  assert.equal(resolved, 'claude');
  assert.equal(logged.length, 0, 'no fallback event for an unset sdk');
});
