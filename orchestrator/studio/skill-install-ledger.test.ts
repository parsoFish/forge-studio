/**
 * W8-B4 (library-35) — removeInstallLedgerEntry: the inverse of
 * writeInstallLedgerEntry that never existed. Contract:
 *
 *   - Removes the id's row from the `installed` ledger list, if present.
 *   - Idempotent / tolerant: removing an id with no row is a silent no-op,
 *     never a throw (a hand-authored skill deleted from the library was
 *     never installed through installSkillPackage — the common case).
 *   - Leaves every OTHER id's row untouched.
 *   - readInstallLedger (the runtime authority skillTrustDetail cross-checks
 *     against) genuinely no longer returns a row for the removed id.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { readInstallLedger, writeInstallLedgerEntry, removeInstallLedgerEntry, type InstalledSkillLedgerEntry } from './skill-install-ledger.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-install-ledger-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function entry(id: string): InstalledSkillLedgerEntry {
  return { id, source: 'https://example.com', contentHash: `sha256:${id}`, installedAt: new Date().toISOString() };
}

test('removeInstallLedgerEntry is a silent no-op when there is no row for the id — never throws, never creates the file', () => {
  assert.doesNotThrow(() => removeInstallLedgerEntry(root, 'never-installed'));
  assert.equal(existsSync(join(root, 'studio', 'installed-skills.yaml')), false, 'a no-op prune must not fabricate a ledger file that never existed');
});

test('removeInstallLedgerEntry removes exactly the named row, leaving every other id untouched', () => {
  writeInstallLedgerEntry(root, entry('skill-a'));
  writeInstallLedgerEntry(root, entry('skill-b'));
  writeInstallLedgerEntry(root, entry('skill-c'));

  removeInstallLedgerEntry(root, 'skill-b');

  const ledger = readInstallLedger(root);
  assert.equal(ledger.has('skill-a'), true, 'unrelated row skill-a survives');
  assert.equal(ledger.has('skill-b'), false, 'the removed row is genuinely gone from the runtime-authority reader');
  assert.equal(ledger.has('skill-c'), true, 'unrelated row skill-c survives');

  // ARTIFACT assertion — the file itself, not just the in-memory Map.
  const raw = yaml.load(readFileSync(join(root, 'studio', 'installed-skills.yaml'), 'utf8')) as { installed: Array<{ id: string }> };
  assert.deepEqual(
    raw.installed.map((e) => e.id).sort(),
    ['skill-a', 'skill-c'],
    'the on-disk ledger document itself carries no row for the removed id',
  );
});

test('removeInstallLedgerEntry on an id with no row leaves an existing ledger byte-for-byte equivalent (still no throw, still tolerant)', () => {
  writeInstallLedgerEntry(root, entry('skill-a'));
  const before = readFileSync(join(root, 'studio', 'installed-skills.yaml'), 'utf8');

  assert.doesNotThrow(() => removeInstallLedgerEntry(root, 'not-in-the-ledger'));

  const after = readFileSync(join(root, 'studio', 'installed-skills.yaml'), 'utf8');
  assert.equal(after, before, 'a no-op prune must not rewrite the file at all');
});
