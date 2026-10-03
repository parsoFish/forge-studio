/**
 * logs-residue-guard.test.ts — proof that the `_logs/` residue guards'
 * decision logic (forge-8vfn.8.1.10's `INIT-*` shape, forge-8vfn.8.5.48 row
 * 212's `_bridge-*` shape, and row 212's follow-up generalised
 * any-new-top-level-entry ratchet) actually flips.
 *
 * Drives `listInitDirs`/`listBridgeDirs`/`listTopLevelEntries`/`newInitDirs`
 * (`./test-preload/logs-residue-guard-core.mjs`) against a throwaway
 * `mkdtempSync` root — never this repo's own `_logs/` — so this file cannot
 * itself create the exact residue it is proving the guard catches. The
 * preload wiring (`./test-preload/logs-residue-guard.mjs`) that points the
 * SAME functions at the real repo root is exercised separately: the
 * row-212 RED proof ran the two real offender test files (before their fix)
 * against this preload and captured its non-zero exit + `_bridge-*` report;
 * the follow-up RED proof did the same for `cli-own-tree.test.ts` /
 * `cli-preflight-deps.test.ts` / the demo-builder runner suite (before THEIR
 * fix) and captured the generic `newOther` report — not duplicated here,
 * because doing so from inside this process would mean writing into the real
 * `_logs/` from a unit test, exactly what this guard exists to catch
 * elsewhere.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listInitDirs, listBridgeDirs, listTopLevelEntries, newInitDirs } from './test-preload/logs-residue-guard-core.mjs';

function withTmpRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'logs-residue-guard-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('listInitDirs', () => {
  test('a logs root that does not exist yet lists as empty, not a throw', () => {
    withTmpRoot((root) => {
      const missing = join(root, 'never-created');
      assert.deepEqual(listInitDirs(missing), new Set());
    });
  });

  test('an empty logs root lists as empty', () => {
    withTmpRoot((root) => {
      assert.deepEqual(listInitDirs(root), new Set());
    });
  });

  test('lists only INIT-* directories, ignoring other dirs and files', () => {
    withTmpRoot((root) => {
      mkdirSync(join(root, 'INIT-2026-05-20-pm-decomp-test'));
      mkdirSync(join(root, '_agent-onboarding-agent'));
      mkdirSync(join(root, 'TEST-cycle-decomp'));
      writeFileSync(join(root, 'INIT-not-a-dir'), 'a file, not a dir — must not count');
      assert.deepEqual(listInitDirs(root), new Set(['INIT-2026-05-20-pm-decomp-test']));
    });
  });
});

describe('listBridgeDirs', () => {
  test('a logs root that does not exist yet lists as empty, not a throw', () => {
    withTmpRoot((root) => {
      const missing = join(root, 'never-created');
      assert.deepEqual(listBridgeDirs(missing), new Set());
    });
  });

  test('an empty logs root lists as empty', () => {
    withTmpRoot((root) => {
      assert.deepEqual(listBridgeDirs(root), new Set());
    });
  });

  test('lists only _bridge-* directories, ignoring INIT-*, other dirs and files', () => {
    withTmpRoot((root) => {
      mkdirSync(join(root, '_bridge-2026-10-03T14-53-56-117-va70c625'));
      mkdirSync(join(root, 'INIT-2026-05-20-pm-decomp-test'));
      mkdirSync(join(root, '_agent-onboarding-agent'));
      writeFileSync(join(root, '_bridge-not-a-dir'), 'a file, not a dir — must not count');
      assert.deepEqual(listBridgeDirs(root), new Set(['_bridge-2026-10-03T14-53-56-117-va70c625']));
    });
  });
});

describe('listTopLevelEntries', () => {
  test('a logs root that does not exist yet lists as empty, not a throw', () => {
    withTmpRoot((root) => {
      const missing = join(root, 'never-created');
      assert.deepEqual(listTopLevelEntries(missing), new Set());
    });
  });

  test('an empty logs root lists as empty', () => {
    withTmpRoot((root) => {
      assert.deepEqual(listTopLevelEntries(root), new Set());
    });
  });

  test('lists EVERY top-level entry — INIT-*, _bridge-*, an unrelated dir name, AND a top-level file — unlike the prefix-scoped listers above', () => {
    withTmpRoot((root) => {
      mkdirSync(join(root, 'INIT-2026-05-20-pm-decomp-test'));
      mkdirSync(join(root, '_bridge-2026-10-03T14-53-56-117-va70c625'));
      // The two row-212-follow-up shapes neither named guard had a prefix
      // for: a demo-builder fixture's `_demo-<sid>/` dir, and a CLI test's
      // `preflight/` dir (itself holding a file, but the TOP-LEVEL entry is
      // the directory).
      mkdirSync(join(root, '_demo-2026-06-24T11-00-00'));
      mkdirSync(join(root, 'preflight'));
      // A top-level FILE, not a directory — `listInitDirs`/`listBridgeDirs`
      // would never count this; the generalised ratchet must.
      writeFileSync(join(root, '.gitkeep'), '');
      assert.deepEqual(
        listTopLevelEntries(root),
        new Set(['INIT-2026-05-20-pm-decomp-test', '_bridge-2026-10-03T14-53-56-117-va70c625', '_demo-2026-06-24T11-00-00', 'preflight', '.gitkeep']),
      );
    });
  });
});

describe('newInitDirs', () => {
  test('identical before/after → no new dirs (the clean-run case)', () => {
    const before = new Set(['INIT-existing-from-a-real-run']);
    const after = new Set(['INIT-existing-from-a-real-run']);
    assert.deepEqual(newInitDirs(before, after), []);
  });

  test('an after-only entry is reported as new — the exact residue shape this guard exists for', () => {
    const before = new Set<string>();
    const after = new Set(['INIT-2026-05-20-pm-decomp-test']);
    assert.deepEqual(newInitDirs(before, after), ['INIT-2026-05-20-pm-decomp-test']);
  });

  test('sorted, for a deterministic report, when several appear at once', () => {
    const before = new Set<string>();
    const after = new Set(['INIT-zzz', 'INIT-aaa', 'INIT-mmm']);
    assert.deepEqual(newInitDirs(before, after), ['INIT-aaa', 'INIT-mmm', 'INIT-zzz']);
  });

  test('a dir removed between before and after is not "new" — only appearances are reported', () => {
    const before = new Set(['INIT-torn-down']);
    const after = new Set<string>();
    assert.deepEqual(newInitDirs(before, after), []);
  });
});

describe('listInitDirs + newInitDirs, end to end against a temp root (the guard\'s own before/after shape)', () => {
  test('fails (reports a new dir) when a test-shaped write lands under the watched root after the before-snapshot', () => {
    withTmpRoot((root) => {
      const before = listInitDirs(root);
      // The exact shape the defect produced: a cycle-style runId directory
      // appearing under the watched root after the snapshot was taken.
      mkdirSync(join(root, 'INIT-2026-05-20-pm-decomp-test'));
      writeFileSync(join(root, 'INIT-2026-05-20-pm-decomp-test', 'agent-run.marker'), 'RUN-TOKEN-1\n');
      const after = listInitDirs(root);
      assert.deepEqual(newInitDirs(before, after), ['INIT-2026-05-20-pm-decomp-test']);
    });
  });

  test('passes (reports nothing) when nothing new appears under the watched root', () => {
    withTmpRoot((root) => {
      // A pre-existing real run's directory — legitimate residue from BEFORE
      // this run started, which must never trip the guard.
      mkdirSync(join(root, 'INIT-a-real-forge-run-from-yesterday'));
      const before = listInitDirs(root);
      // Some unrelated, non-INIT activity under the same root during the run.
      mkdirSync(join(root, '_agent-unrelated-standalone-dispatch'));
      const after = listInitDirs(root);
      assert.deepEqual(newInitDirs(before, after), []);
    });
  });
});

describe('listBridgeDirs + newInitDirs, end to end against a temp root (row 212\'s `_bridge-*` shape, the SAME diff logic as the `INIT-*` guard above)', () => {
  test('fails (reports a new dir) when a startBridge()-shaped run dir lands under the watched root after the before-snapshot — the exact shape ui-bridge-cost-ceiling-enforceable.test.ts and bridge-studio-agent-capability.test.ts produced before their row-212 fix', () => {
    withTmpRoot((root) => {
      const before = listBridgeDirs(root);
      mkdirSync(join(root, '_bridge-2026-10-03T14-53-56-117-va70c625'));
      writeFileSync(
        join(root, '_bridge-2026-10-03T14-53-56-117-va70c625', 'events.jsonl'),
        '{"message":"forge-ref-guard.already-present"}\n',
      );
      const after = listBridgeDirs(root);
      assert.deepEqual(newInitDirs(before, after), ['_bridge-2026-10-03T14-53-56-117-va70c625']);
    });
  });

  test('passes (reports nothing) when nothing new appears under the watched root — a healthy `forge studio` left running nearby is not residue', () => {
    withTmpRoot((root) => {
      // A pre-existing bridge run's directory — legitimate residue from
      // BEFORE this test run started (a `forge studio` another lane left up).
      mkdirSync(join(root, '_bridge-2026-10-01T00-00-00-000-preexisting'));
      const before = listBridgeDirs(root);
      // Some unrelated, non-bridge activity under the same root during the run.
      mkdirSync(join(root, 'INIT-unrelated-cycle-run'));
      const after = listBridgeDirs(root);
      assert.deepEqual(newInitDirs(before, after), []);
    });
  });
});

describe('listTopLevelEntries + newInitDirs, end to end against a temp root (row 212 FOLLOW-UP\'s generalised ratchet — catches a shape with NO known prefix at all)', () => {
  test('fails (reports a new entry) for a demo-builder-shaped `_demo-<sid>/` dir — a shape neither listInitDirs nor listBridgeDirs would ever name', () => {
    withTmpRoot((root) => {
      const before = listTopLevelEntries(root);
      // The exact shape found at 887dc58da: a demo-builder runner fixture
      // defaulting its logsRoot from a real forgeRoot.
      mkdirSync(join(root, '_demo-2026-06-24T11-00-00'));
      writeFileSync(join(root, '_demo-2026-06-24T11-00-00', '.heartbeat'), new Date().toISOString());
      const after = listTopLevelEntries(root);
      assert.deepEqual(newInitDirs(before, after), ['_demo-2026-06-24T11-00-00']);
    });
  });

  test('fails (reports a new entry) for a CLI-command-shaped `preflight/` dir — the other shape found at 887dc58da, from `apps/forge/cli.ts`\'s `cmdPreflight` hard-coding FORGE_ROOT', () => {
    withTmpRoot((root) => {
      const before = listTopLevelEntries(root);
      mkdirSync(join(root, 'preflight'));
      writeFileSync(join(root, 'preflight', 'verdicts.jsonl'), '{"event_type":"preflight.verdict"}\n');
      const after = listTopLevelEntries(root);
      assert.deepEqual(newInitDirs(before, after), ['preflight']);
    });
  });

  test('fails (reports a new entry) for a stray top-level FILE too — not only directories', () => {
    withTmpRoot((root) => {
      const before = listTopLevelEntries(root);
      writeFileSync(join(root, 'some-stray-top-level-file.jsonl'), '{}\n');
      const after = listTopLevelEntries(root);
      assert.deepEqual(newInitDirs(before, after), ['some-stray-top-level-file.jsonl']);
    });
  });

  test('passes (reports nothing) when nothing new appears under the watched root, INIT-*/`_bridge-*` residue included — those are the two NAMED guards\' job, not this one\'s to re-report', () => {
    withTmpRoot((root) => {
      mkdirSync(join(root, 'INIT-a-real-forge-run-from-yesterday'));
      const before = listTopLevelEntries(root);
      // No NEW entry of any shape appears during the run.
      const after = listTopLevelEntries(root);
      assert.deepEqual(newInitDirs(before, after), []);
    });
  });
});
