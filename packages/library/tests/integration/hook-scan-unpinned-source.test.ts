/**
 * forge-8vfn.8.3.6 (M7-C PKG follow-up, coordinator security review) —
 * `scanUnpinnedSource` (hook-scan.ts).
 *
 * WHY A SEPARATE FILE from hook-scan.test.ts, not a describe block added
 * there: that file carries a grandfathered file-size exemption
 * (`scripts/baselines/file-size.json`, 1330 lines, currently at 1318) with
 * no headroom for a new describe block — "an exemption is a ceiling, not a
 * licence" (check-file-size.mjs). Mirrors hook-runtime-toctou.test.ts's own
 * precedent for the sibling module. `DENY_ALL` fixture is self-contained
 * (not imported: the sibling file does not export it).
 *
 * WHAT THIS PINS: `hook-runtime.ts`'s whole-package private copy (M7-C PKG)
 * only protects a sibling reference rooted at `$0` — `cwd` stays the REAL
 * hook directory (a shipped hook needs a real repo cwd for bare `git`), so
 * `. ./lib.sh` / `source lib.sh` still resolve against the mutable original
 * at RUNTIME even though the whole-package fingerprint was checked at
 * approval time. This scanner catches the gap at approval time instead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { scanHookScript, type HookScanFinding } from '../../studio/hook-scan.ts';
import type { HookPermissionManifest } from '../../studio/hook-library.ts';

const DENY_ALL: HookPermissionManifest = { env: [], read: [], network: false };

describe('unpinned-source: a sibling sourced by a cwd-relative path', () => {
  it('`. ./lib.sh` is flagged — relative, not rooted at $0', () => {
    const body = '#!/usr/bin/env bash\n. ./lib.sh\nhelper_main\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    const finding = report.findings.find((f: HookScanFinding) => f.category === 'unpinned-source');
    assert.ok(finding, 'expected an unpinned-source finding');
    assert.equal(finding!.severity, 'critical');
    assert.match(finding!.message, /line 2/);
    assert.match(finding!.message, /\$\(dirname "\$0"\)/);
  });

  it('`source lib.sh` (bare, no directory prefix at all) is flagged the same way', () => {
    const body = '#!/usr/bin/env bash\nsource lib.sh\nhelper_main\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    const finding = report.findings.find((f: HookScanFinding) => f.category === 'unpinned-source');
    assert.ok(finding, 'expected an unpinned-source finding');
    assert.equal(finding!.severity, 'critical');
  });

  it('`. "$(dirname "$0")/lib.sh"` (PIN D idiom) is NOT flagged — rooted at $0', () => {
    const body = '#!/usr/bin/env bash\n. "$(dirname "$0")/lib.sh"\nhelper_main\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    assert.equal(
      report.findings.some((f: HookScanFinding) => f.category === 'unpinned-source'),
      false,
      'a properly $0-rooted source must never be flagged',
    );
  });

  it('`. "${0%/*}/lib.sh"` (the POSIX alternative form) is also NOT flagged', () => {
    const body = '#!/usr/bin/env bash\n. "${0%/*}/lib.sh"\nhelper_main\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    assert.equal(report.findings.some((f: HookScanFinding) => f.category === 'unpinned-source'), false);
  });

  it('an absolute path is NOT flagged — it never resolves against cwd', () => {
    const body = '#!/usr/bin/env bash\n. /opt/forge/lib.sh\nhelper_main\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    assert.equal(report.findings.some((f: HookScanFinding) => f.category === 'unpinned-source'), false);
  });

  it('a cwd-relative source is CRITICAL and blocks the verdict on its own, same class as obfuscation/file-read', () => {
    const body = '#!/usr/bin/env bash\n. ./lib.sh\nhelper_main\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    assert.equal(report.verdict, 'blocked', 'an unpinned sibling source defeats the whole-package fingerprint and must gate approval like any other critical finding');
  });

  it('a bare git call with no source line at all is unaffected — this scanner is additive, not a general cwd ban', () => {
    const body = '#!/usr/bin/env bash\ngit status --porcelain\n';
    const report = scanHookScript({ body, permissions: DENY_ALL });
    assert.equal(report.findings.some((f: HookScanFinding) => f.category === 'unpinned-source'), false);
    assert.equal(report.verdict, 'clean');
  });
});
