/**
 * ACCEPTANCE TESTS (T3, R2-08-F3 #2) — `.forge/project.json` gains an
 * OPTIONAL `repo: "owner/name"` field: the repo→project mapping declaration
 * that R2-08-F3's project-event resolution (`pr-merged` / `issue-raised`)
 * reads. Per the ruling brief:
 *
 *   - `repo` is optional; absent is legal (that project can never match a
 *     project-event trigger — fail-closed, pinned separately in
 *     orchestrator/project-event-resolve.test.ts).
 *   - `repo` MUST be validated against `REPO_RE` (orchestrator/trigger-payload.ts)
 *     — the SAME charset the webhook `sources` allowlist already uses. A
 *     second, hand-copied regex is explicitly forbidden ("a duplicated
 *     charset is a divergence defect this initiative already closed once").
 *
 * RED against 631154a1 — `ProjectConfig` has no `repo` field at all today
 * (grepped; confirmed absent from orchestrator/project-config.ts).
 *
 * Kept as its own small file (not appended to the already-1025-line
 * orchestrator/project-config.test.ts) per the global small-focused-files rule.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadProjectConfig } from '../../project-config.ts';
import { REPO_RE } from '@forge/flows/trigger-payload.ts';

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'forge-project-config-repo-test-'));
}

function writeConfig(projectRoot: string, contents: Record<string, unknown>): void {
  const dir = join(projectRoot, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project.json'), JSON.stringify(contents));
}

/** Every fixture needs a valid testProcess.local.cmd (existing, unrelated required field). */
const BASE = { testProcess: { local: { cmd: ['true'] } } };

/** Runtime-only accessor for the not-yet-typed `repo` field on ProjectConfig. */
function repoOf(cfg: unknown): string | undefined {
  return (cfg as { repo?: string }).repo;
}

// ---------------------------------------------------------------------------
// (2a/2b) repo parses; absent is legal.
// ---------------------------------------------------------------------------

test('(RED) [F3 #2a] repo: absent is legal — parses to undefined, no throw', () => {
  const root = newTempDir();
  try {
    writeConfig(root, { ...BASE });
    const cfg = loadProjectConfig(root);
    assert.ok(cfg, 'a config with no repo: field must still load successfully');
    assert.equal(repoOf(cfg), undefined, 'kills defaulting an absent repo to some non-undefined sentinel');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [F3 #2b] a well-formed repo: "owner/name" parses through onto the loaded config', () => {
  const root = newTempDir();
  try {
    writeConfig(root, { ...BASE, repo: 'acme/widgets' });
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.equal(repoOf(cfg), 'acme/widgets');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (2c) malformed repo rejected by REPO_RE.
// ---------------------------------------------------------------------------

test('(RED) [F3 #2c] a malformed repo (no slash) is rejected — fails loud at load, mirroring every other project.json field', () => {
  const root = newTempDir();
  try {
    writeConfig(root, { ...BASE, repo: 'no-slash-here' });
    assert.throws(
      () => loadProjectConfig(root),
      /repo/i,
      'expected loadProjectConfig to throw an error naming "repo" for a value REPO_RE rejects — kills silently ignoring/coercing a malformed repo instead of failing closed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [F3 #2c-empty] an empty-string repo is rejected (REPO_RE requires ≥1 char on each side of the slash)', () => {
  const root = newTempDir();
  try {
    writeConfig(root, { ...BASE, repo: '' });
    assert.throws(() => loadProjectConfig(root), /repo/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (2d) anti-duplication pin — the SAME REPO_RE object must be invoked, not an
// equivalent-looking copy. Proven by instrumenting the exported singleton
// itself: an equivalent-looking hand-copied regex literal would never call
// through this object, so the spy would never fire.
// ---------------------------------------------------------------------------

test('(RED) [F3 #2d — anti-duplication pin] repo validation invokes the SAME REPO_RE.test, not an equivalent-looking copy', () => {
  const originalTest = REPO_RE.test;
  let called = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (REPO_RE as any).test = function (this: RegExp, ...args: [string]) {
    called = true;
    return originalTest.apply(this, args);
  };
  const root = newTempDir();
  try {
    writeConfig(root, { ...BASE, repo: 'acme/widgets' });
    loadProjectConfig(root);
    assert.equal(
      called,
      true,
      'expected project-config.ts\'s repo validation to call trigger-payload.ts\'s exported REPO_RE.test directly — a hand-copied "equivalent-looking" regex literal would never invoke this exact object, so this spy would never fire. This is the divergence defect the brief says this initiative already closed once; a second regex here would reopen it.',
    );
  } finally {
    REPO_RE.test = originalTest;
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (2e) charset differentiator — belt-and-suspenders on top of 2d: a value
// that only the FULL REPO_RE charset (\w . -) accepts must be accepted, so a
// narrower hand-copied regex (e.g. missing dot/underscore support) is caught
// even if 2d's spy technique were somehow defeated.
// ---------------------------------------------------------------------------

test('(RED) [F3 #2e — charset differentiator] a repo value using dots AND underscores AND hyphens on both sides is accepted — kills a narrower hand-copied regex', () => {
  const root = newTempDir();
  try {
    const value = 'my.org-name/repo.name_2';
    // Sanity: the differentiator only works if REPO_RE itself accepts this.
    assert.equal(REPO_RE.test(value), true, 'sanity check on REPO_RE itself');
    writeConfig(root, { ...BASE, repo: value });
    const cfg = loadProjectConfig(root);
    assert.ok(cfg);
    assert.equal(repoOf(cfg), value, 'kills a repo validator using a narrower charset (e.g. missing "." or "_") than REPO_RE');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
