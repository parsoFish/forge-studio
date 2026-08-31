/**
 * Structural teeth for R3-07's founding constraint: "this initiative owns
 * ZERO trust decisions" (`_wave5/specs/R3-07.md`, D2). Mirrors
 * `cli/connections-no-authoring.test.ts`'s role for R3-04's D1 — that file
 * proved the "no authoring" AC three independent ways (page-absence,
 * bridge-export-surface, client-export-surface) so a future PR cannot
 * reintroduce the forbidden capability by a side door. This file does the
 * same for R3-07's specific negative AC, at T3's explicitly requested
 * strength: SOURCE TEXT, not just export surface — a file that IMPORTS a
 * trust-mutating function and calls it internally (without ever re-exporting
 * it) would pass an export-surface check but must still fail this one.
 *
 * The forbidden set — the five functions that can turn a quarantined draft
 * into a trusted, palette-visible or runnable object:
 *   - approveSkillDraft            (orchestrator/studio/skill-library.ts)
 *   - approveHook                  (orchestrator/studio/hook-scan.ts)
 *   - overrideHookBlock            (orchestrator/studio/hook-scan.ts)
 *   - writeHookApprovalLedgerEntry (orchestrator/studio/hook-scan.ts)
 *   - repinSkillPackage            (orchestrator/studio/skill-library.ts)
 *
 * None of the seven community-surface files below may reference any of
 * these five identifiers, anywhere in their source text — not as an import,
 * not as a call, not even inside a comment (STATED TRADEOFF: an
 * explanatory comment describing this constraint must phrase it without
 * spelling the literal identifier, e.g. "never calls the skill-approval
 * function" rather than naming `approveSkillDraft` — the same blunt-regex
 * tradeoff `connections-no-authoring.test.ts`'s `WRITE_VERB_RE` already
 * accepts for its own check).
 *
 * "A negative AC that passes because the file is missing is worthless" — so
 * every check below asserts the file EXISTS (and is non-empty) before
 * scanning it. Until R3-07 lands, every one of these tests fails RED on the
 * existence assertion, which is the correct, non-vacuous red (never a
 * silently-green "found nothing because there was nothing to search").
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const FORBIDDEN_NAMES = ['approveSkillDraft', 'approveHook', 'overrideHookBlock', 'writeHookApprovalLedgerEntry', 'repinSkillPackage'];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_NAMES.join('|')})\\b`, 'g');

const COMMUNITY_SURFACE_FILES = [
  'cli/bridge-studio-community.ts',
  'orchestrator/studio/community-index.ts',
  'orchestrator/studio/community-install.ts',
  'apps/studio/lib/community-client.ts',
  'apps/studio/lib/community-view.ts',
  'apps/studio/app/community/page.tsx',
  'apps/studio/app/community/[kind]/[id]/page.tsx',
];

function assertNoTrustMutatingReference(relPath: string): void {
  const absPath = resolve(REPO_ROOT, relPath);
  assert.equal(existsSync(absPath), true, `expected ${relPath} to exist — a negative AC that passes because the file is missing is worthless`);
  const text = readFileSync(absPath, 'utf8');
  assert.ok(text.trim().length > 0, `expected ${relPath} to be non-empty`);
  const hits = [...text.matchAll(FORBIDDEN_RE)].map((m) => m[0]);
  assert.deepEqual(
    hits,
    [],
    `${relPath} must NEVER reference a trust-mutating function (approveSkillDraft/approveHook/overrideHookBlock/writeHookApprovalLedgerEntry/repinSkillPackage) — the community browser routes to the owning pipeline's install action only, never its approval/override/re-pin actions. Found: ${JSON.stringify(hits)}`,
  );
}

for (const relPath of COMMUNITY_SURFACE_FILES) {
  test(`${relPath} never references a trust-mutating function anywhere in its source text (D2)`, () => {
    assertNoTrustMutatingReference(relPath);
  });
}

// ---------------------------------------------------------------------------
// Sanity check on the technique itself (mirrors `WRITE_VERB_RE`'s own
// self-test convention loosely): the forbidden-name regex must actually be
// ABLE to catch a hit, so this file's own protection is not a silent no-op
// against, say, a typo'd identifier list. Run against a real file already
// known to reference one of the five names.
// ---------------------------------------------------------------------------

test('sanity: the forbidden-reference technique actually detects a real reference (against orchestrator/studio/skill-library.ts, which legitimately defines approveSkillDraft)', () => {
  const text = readFileSync(resolve(REPO_ROOT, 'orchestrator/studio/skill-library.ts'), 'utf8');
  const hits = [...text.matchAll(FORBIDDEN_RE)].map((m) => m[0]);
  assert.ok(hits.includes('approveSkillDraft'), 'the regex must be capable of matching a real occurrence — proves the check is not vacuously toothless');
});
