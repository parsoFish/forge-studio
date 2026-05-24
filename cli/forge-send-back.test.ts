/**
 * Tests for cli/forge-send-back.ts — F2.I6.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSendBack } from './forge-send-back.ts';
import { parseVerdictResponse } from '../orchestrator/file-verdict.ts';

function setupForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-sendback-'));
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(root, '_queue', d), { recursive: true });
  }
  return root;
}

const MANIFEST = `---
initiative_id: INIT-2026-05-24-sb-test
project: testproj
features:
  - feature_id: FEAT-1
    title: t
---

body
`;

const FEEDBACK = `# Address the missing test substrate

The PR is missing tests for the gates schema. Please add:

- GIVEN the gates schema is in place WHEN the test suite runs THEN there is a roundtrip test covering pre_deployment_gates
- GIVEN the flatten code path runs WHEN given a non-existent gate THEN it returns nil without panicking
`;

test('runSendBack: writes verdict-response.md in ready-for-review/ with parseable shape', () => {
  const root = setupForgeRoot();
  try {
    writeFileSync(join(root, '_queue', 'ready-for-review', 'INIT-2026-05-24-sb-test.md'), MANIFEST);
    const fbPath = join(root, 'fb.md');
    writeFileSync(fbPath, FEEDBACK);

    const r = runSendBack('INIT-2026-05-24-sb-test', fbPath, { forgeRoot: root });
    assert.equal(r.initiativeId, 'INIT-2026-05-24-sb-test');
    assert.equal(r.queueDir, 'ready-for-review');
    assert.equal(r.acCount, 2);
    assert.ok(existsSync(r.verdictPath));

    // The file must be parseable by the existing file-verdict reader.
    const parsed = parseVerdictResponse(readFileSync(r.verdictPath, 'utf8'));
    assert.equal(parsed.kind, 'send-back');
    if (parsed.kind === 'send-back') {
      assert.equal(parsed.feedback.length, 2);
      assert.match(parsed.rationale, /missing test substrate/i);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runSendBack: prefers in-flight/ over ready-for-review/ when both have the manifest', () => {
  const root = setupForgeRoot();
  try {
    writeFileSync(join(root, '_queue', 'in-flight', 'INIT-2026-05-24-sb-test.md'), MANIFEST);
    writeFileSync(join(root, '_queue', 'ready-for-review', 'INIT-2026-05-24-sb-test.md'), MANIFEST);
    const fbPath = join(root, 'fb.md');
    writeFileSync(fbPath, FEEDBACK);

    const r = runSendBack('INIT-2026-05-24-sb-test', fbPath, { forgeRoot: root });
    assert.equal(r.queueDir, 'in-flight');
    assert.ok(r.verdictPath.includes('in-flight'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runSendBack: throws when feedback file has no acceptance criteria', () => {
  const root = setupForgeRoot();
  try {
    writeFileSync(join(root, '_queue', 'ready-for-review', 'INIT-2026-05-24-sb-test.md'), MANIFEST);
    const fbPath = join(root, 'fb.md');
    writeFileSync(fbPath, '# Just a header\n\nNo ACs here.\n');

    assert.throws(
      () => runSendBack('INIT-2026-05-24-sb-test', fbPath, { forgeRoot: root }),
      /no acceptance criteria/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runSendBack: throws when manifest is not in in-flight or ready-for-review', () => {
  const root = setupForgeRoot();
  try {
    writeFileSync(join(root, '_queue', 'failed', 'INIT-2026-05-24-sb-test.md'), MANIFEST);
    const fbPath = join(root, 'fb.md');
    writeFileSync(fbPath, FEEDBACK);

    assert.throws(
      () => runSendBack('INIT-2026-05-24-sb-test', fbPath, { forgeRoot: root }),
      /no in-flight or ready-for-review manifest/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
