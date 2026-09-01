/**
 * Direct unit tests for `resolveProjectIdForRepo` (packages/projects/project-config.ts)
 * — a repo→project identity resolver: matches a webhook payload's `owner/repo`
 * string against each discovered project's declared `.forge/project.json`
 * `repo` field, returning the project's ENUMERATION id (never the raw
 * payload string, never a directory-name guess) and failing closed (`null`)
 * on anything short of exactly one match.
 *
 * `resolveProjectIdForRepo` is exported by this package but was, until now,
 * exercised ONLY indirectly through `orchestrator/project-event-resolve.test.ts`
 * — every one of that file's 6 cases drives it through
 * `stageFlowRunRequest`/`drainFlowRunRequests` (`@forge/flows/flow-run-requests.ts`).
 * That file is leaving for `packages/flows` (a `packages/projects` (rank 2)
 * → `packages/flows` (rank 5) import is a boundary violation — flows is
 * allowed to import projects, not the reverse), so this package would
 * otherwise lose ALL direct coverage of its own export. This file closes
 * that gap: no flows import, no staging — just `resolveProjectIdForRepo`
 * called directly against real (temp) `.forge/project.json` fixtures.
 *
 * Behaviour pinned here mirrors the F3 #3/#4/#6/#7 cases in the retiring
 * file (see its header for the full "IDENTITY match, fails closed, no
 * auto-discover, no name-matching fallback" ruling); #5's "no auto-discover"
 * half is subsumed by the undeclared-repo case below (same resolve() shape,
 * minus the staging assertion), and #8's "ENUMERATION id, never the payload
 * string" is folded into the first case rather than duplicated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProjectIdForRepo } from '../../project-config.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Write a minimal, always-VALID `.forge/project.json` under `<projectsDir>/<dirName>`. */
function writeProject(projectsDir: string, dirName: string, extra: Record<string, unknown> = {}): void {
  const dir = join(projectsDir, dirName, '.forge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, ...extra }),
  );
}

test('resolveProjectIdForRepo: a declared repo resolves to the declaring project\'s ENUMERATION id (the dir name), never the raw payload repo string — kills an implementation that echoes the payload back instead of looking up the enumeration', () => {
  const forgeRoot = tmp('pcr-crux-');
  try {
    // Mixed-case + underscore dir name: under the W7-A4 id rule the
    // enumeration id IS the directory name verbatim (no normalization
    // applied to an already rule-shaped name) — a wrong implementation that
    // lowercases, slugifies, or otherwise transforms the id would fail this.
    writeProject(join(forgeRoot, 'projects'), 'My_Project', { repo: 'acme/my-project' });

    const result = resolveProjectIdForRepo(forgeRoot, 'acme/my-project');

    assert.equal(result, 'My_Project', 'expected the enumeration id (case-preserving directory name)');
    assert.notEqual(result, 'acme/my-project', 'must never be the raw payload repo string');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveProjectIdForRepo: an undeclared repo resolves to null even when the directory name matches the payload\'s tail — kills an implementation that falls back to directory-name/tail matching instead of requiring an explicit repo: declaration', () => {
  const forgeRoot = tmp('pcr-undeclared-');
  try {
    // 'gitpulse' exists and is a real, valid project, but declares NO repo:
    // field. Its directory name matches the payload repo's tail exactly —
    // the one scenario a name-matching fallback would (wrongly) resolve.
    writeProject(join(forgeRoot, 'projects'), 'gitpulse');

    const result = resolveProjectIdForRepo(forgeRoot, 'someorg/gitpulse');

    assert.equal(result, null, `kills "fall back to name matching" for an undeclared repo — got ${JSON.stringify(result)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveProjectIdForRepo: two projects declaring the SAME repo fail closed (null) — kills an implementation that arbitrarily picks the first/last match (e.g. Array.find/reduce) instead of failing closed on ambiguity', () => {
  const forgeRoot = tmp('pcr-ambiguous-');
  try {
    const projectsDir = join(forgeRoot, 'projects');
    writeProject(projectsDir, 'proj-a', { repo: 'acme/dup' });
    writeProject(projectsDir, 'proj-b', { repo: 'acme/dup' });

    const result = resolveProjectIdForRepo(forgeRoot, 'acme/dup');

    assert.equal(
      result,
      null,
      `kills an implementation that arbitrarily picks one of two ambiguous matches instead of failing closed — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveProjectIdForRepo: malformed repo shapes never resolve — kills an implementation that treats the repo string as a filesystem path (traversal/absolute) or compares case-insensitively instead of validating against REPO_RE + an exact-string match BEFORE any directory scan', () => {
  const forgeRoot = tmp('pcr-containment-');
  try {
    // One real, legitimately-declaring project — the thing a malicious
    // shape must never accidentally land on or be confused with.
    writeProject(join(forgeRoot, 'projects'), 'gitpulse', { repo: 'acme/gitpulse' });

    const malicious: Array<{ label: string; repo: string }> = [
      // Two slashes — fails REPO_RE's single-"owner/name" shape before any scan.
      { label: 'relative path traversal', repo: '../../etc/passwd' },
      // Leading slash — fails REPO_RE (empty owner segment).
      { label: 'absolute path', repo: '/etc/passwd' },
      // Empty string — fails REPO_RE (both segments required non-empty).
      { label: 'empty string', repo: '' },
      // Passes REPO_RE's shape check, but must fail the exact-string
      // identity comparison against the declared (lowercase) repo — kills
      // an implementation that lowercases/uppercases before comparing.
      { label: 'case-only difference from the declared repo', repo: 'ACME/GITPULSE' },
    ];

    for (const { label, repo } of malicious) {
      const result = resolveProjectIdForRepo(forgeRoot, repo);
      assert.equal(result, null, `[${label}] must never resolve — got ${JSON.stringify(result)}`);
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('resolveProjectIdForRepo: a malformed sibling project\'s config does not break resolution for a different, validly-declaring project — kills an implementation that lets one bad project.json throw out of the whole scan (or silently null the correct match)', () => {
  const forgeRoot = tmp('pcr-malformed-sibling-');
  try {
    const projectsDir = join(forgeRoot, 'projects');
    // A sibling with an unparseable .forge/project.json (bypasses the
    // writeProject helper, which always writes valid JSON).
    const brokenForgeDir = join(projectsDir, 'broken', '.forge');
    mkdirSync(brokenForgeDir, { recursive: true });
    writeFileSync(join(brokenForgeDir, 'project.json'), '{ not valid json');
    // The real, validly-declaring project resolution must still find.
    writeProject(projectsDir, 'valid-one', { repo: 'acme/valid' });

    const result = resolveProjectIdForRepo(forgeRoot, 'acme/valid');

    assert.equal(result, 'valid-one', `a malformed sibling must be skipped, not crash or block resolution — got ${JSON.stringify(result)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
