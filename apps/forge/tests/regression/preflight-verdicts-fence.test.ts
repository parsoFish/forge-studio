/**
 * Row 212 follow-up (bead forge-8vfn.8.5.48) — the test-side fence's own
 * contract.
 *
 * The subject is `apps/forge/tests/test-fixtures/preflight-verdicts-fence.ts`
 * — see that module's doc for why a test-side snapshot/restore replaces a
 * product-side `FORGE_LOGS_DIR` env override, and what each of the three
 * states (`absent`/`dir-only`/`file`) means. Every case here drives
 * `snapshotPreflightVerdicts`/`restorePreflightVerdicts`/
 * `withPreflightVerdictsFence` against a throwaway `mkdtempSync` directory —
 * never the real `_logs/preflight/` — so this file cannot itself create the
 * residue `cli-own-tree.test.ts` (D1) and `cli-preflight-deps.test.ts` use
 * this fence to avoid.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  snapshotPreflightVerdicts,
  restorePreflightVerdicts,
  withPreflightVerdictsFence,
  PREFLIGHT_VERDICTS_FILENAME,
} from '../test-fixtures/preflight-verdicts-fence.ts';

function withTmpRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'preflight-verdicts-fence-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('snapshotPreflightVerdicts', () => {
  test('absent: the preflight dir does not exist', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      assert.deepEqual(snapshotPreflightVerdicts(preflightDir), { kind: 'absent' });
    });
  });

  test('dir-only: the preflight dir exists but verdicts.jsonl does not', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      mkdirSync(preflightDir, { recursive: true });
      assert.deepEqual(snapshotPreflightVerdicts(preflightDir), { kind: 'dir-only' });
    });
  });

  test('file: verdicts.jsonl exists — its byte length is recorded', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      mkdirSync(preflightDir, { recursive: true });
      const body = '{"event_type":"preflight.verdict","ok":true}\n';
      writeFileSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME), body);
      assert.deepEqual(snapshotPreflightVerdicts(preflightDir), { kind: 'file', length: Buffer.byteLength(body) });
    });
  });
});

describe('restorePreflightVerdicts', () => {
  test('absent: removes the directory a spawn created from nothing', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      // Simulate the spawn: the dir + file now exist where neither did before.
      mkdirSync(preflightDir, { recursive: true });
      writeFileSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME), '{"ok":false}\n');
      restorePreflightVerdicts(preflightDir, { kind: 'absent' });
      assert.equal(existsSync(preflightDir), false, 'the whole directory must be gone — nothing of the operator\'s was there to protect');
    });
  });

  test('dir-only: removes only the file a spawn appended, leaving the directory', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      mkdirSync(preflightDir, { recursive: true });
      writeFileSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME), '{"ok":false}\n');
      restorePreflightVerdicts(preflightDir, { kind: 'dir-only' });
      assert.equal(existsSync(preflightDir), true, 'the pre-existing directory must survive');
      assert.equal(existsSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME)), false, 'the file the spawn created must be gone');
    });
  });

  test('file: truncates verdicts.jsonl back to its recorded length — real operator lines kept, only the spawn\'s appended lines dropped', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      mkdirSync(preflightDir, { recursive: true });
      const operatorLine = '{"event_type":"preflight.verdict","project_name":"realproj","ok":true}\n';
      const file = join(preflightDir, PREFLIGHT_VERDICTS_FILENAME);
      writeFileSync(file, operatorLine);
      const snapshot = snapshotPreflightVerdicts(preflightDir);
      // Simulate the spawn APPENDING its own line, exactly as `cmdPreflight`'s
      // `appendFileSync` does — never overwriting the operator's own.
      writeFileSync(file, operatorLine + '{"event_type":"preflight.verdict","project_name":"testproj","ok":false}\n');
      restorePreflightVerdicts(preflightDir, snapshot);
      assert.equal(readFileSync(file, 'utf8'), operatorLine, 'only the operator\'s original line must remain, byte-identical');
    });
  });
});

describe('withPreflightVerdictsFence', () => {
  test('restores the absent state after fn() writes, and propagates fn()\'s return value', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      const result = withPreflightVerdictsFence(preflightDir, () => {
        mkdirSync(preflightDir, { recursive: true });
        writeFileSync(join(preflightDir, PREFLIGHT_VERDICTS_FILENAME), '{"ok":false}\n');
        return 42;
      });
      assert.equal(result, 42);
      assert.equal(existsSync(preflightDir), false);
    });
  });

  test('restores a pre-existing file to its original bytes even when fn() throws — the finally runs regardless', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      mkdirSync(preflightDir, { recursive: true });
      const operatorLine = '{"event_type":"preflight.verdict","ok":true}\n';
      const file = join(preflightDir, PREFLIGHT_VERDICTS_FILENAME);
      writeFileSync(file, operatorLine);
      assert.throws(() => {
        withPreflightVerdictsFence(preflightDir, () => {
          writeFileSync(file, operatorLine + '{"ok":false}\n');
          throw new Error('spawn-shaped failure');
        });
      }, /spawn-shaped failure/);
      assert.equal(readFileSync(file, 'utf8'), operatorLine, 'the fence must restore even when fn() throws');
    });
  });

  test('a pre-existing verdicts.jsonl keeps its ORIGINAL bytes after the fence, proven by a before/after copy of the content — not merely the same length', () => {
    withTmpRoot((root) => {
      const preflightDir = join(root, 'preflight');
      mkdirSync(preflightDir, { recursive: true });
      const file = join(preflightDir, PREFLIGHT_VERDICTS_FILENAME);
      const before = [
        '{"event_type":"preflight.verdict","project_name":"alpha","ok":true}\n',
        '{"event_type":"preflight.verdict","project_name":"beta","ok":false}\n',
      ].join('');
      writeFileSync(file, before);
      const beforeCopy = readFileSync(file, 'utf8');
      withPreflightVerdictsFence(preflightDir, () => {
        // A spawn appending several lines, not just one.
        writeFileSync(file, before + '{"event_type":"preflight.verdict","project_name":"gamma-test","ok":false}\n{"event_type":"preflight.verdict","project_name":"delta-test","ok":false}\n');
      });
      const afterCopy = readFileSync(file, 'utf8');
      assert.equal(afterCopy, beforeCopy, 'the pre-existing content must be byte-identical after the fence restores it');
    });
  });
});

// Row 212b (bead forge-8vfn.8.5.52) — the fence above only works without
// cross-talk if `_logs/preflight/` already exists in the real checkout. If the
// CLI tests' spawn creates it and the fence removes it, the directory is a
// TRANSIENT top-level `_logs` entry, and any test file running in parallel
// whose residue-guard window overlaps reads it as its own residue (measured:
// instructions-start-read-guard.test.ts went red naming `preflight`). The
// checkout tracks the directory, so it never appears or disappears.
describe('the real checkout keeps _logs/preflight/', () => {
  test('_logs/preflight/.gitkeep is tracked, so the directory never appears mid-run', () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
    const tracked = execFileSync('git', ['ls-files', '--', '_logs/preflight/.gitkeep'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    assert.equal(tracked, '_logs/preflight/.gitkeep', 'the checkout must track _logs/preflight/.gitkeep');
  });
});
