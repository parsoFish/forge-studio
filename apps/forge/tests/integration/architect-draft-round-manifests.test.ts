/**
 * Bead `forge-8vfn.7.6.17` (T1 rulings 628/629) — a draft ROUND's manifests are
 * the session's manifests, and an id is not a slug.
 *
 * MEASURED FIRST, in two captures of two different projects:
 * `_1.0/evidence/m6-a-S1-run4/queue-pending/` and
 * `_1.0/evidence/m6-c-S10-run7/queue-pending/` each hold FOUR queue entries for
 * TWO initiatives — `INIT-2026-09-11-overlay-grants-lint.md` beside
 * `INIT-2026-09-11-init-2026-09-11-overlay-grants-lint.md`. A's run 3 shows the
 * same shape, so it reproduces across runs.
 *
 * TWO INDEPENDENT DEFECTS produced that, and either duplicates on its own:
 *
 *   1. `runDraftStep` wrote into `manifests/` once per critic round
 *      (`runDraftRounds`, ruling 380's draft → critique → re-draft loop) and
 *      NOTHING cleared the directory between rounds. Identical ids overwrite
 *      and nothing shows; any id difference leaves both files, and
 *      `promoteManifests` faithfully promotes every `*.md` it finds.
 *
 *   2. `buildManifest` mints `INIT-<date>-<slugify(d.slug || d.title)>`, and
 *      `slugify` only lowercases, dash-collapses and slices — it had no opinion
 *      about being handed something that is ALREADY an id. Round 2's prompt
 *      carries the critic's findings, and the critic renders full ids as its
 *      section headers (`architect-critic.ts`), so the agent echoes
 *      `INIT-2026-09-11-overlay-grants-lint` back as its slug and the mint
 *      prefixes it again. Reproduced exactly, without an agent:
 *      `slugify('INIT-2026-09-11-overlay-grants-lint')` →
 *      `init-2026-09-11-overlay-grants-lint`, prefixed →
 *      `INIT-2026-09-11-init-2026-09-11-overlay-grants-lint`, which is
 *      character-for-character the id in A's capture.
 *
 * Both are pinned here through the KIND'S DOOR (`runArchitectTurn`) rather than
 * against the helpers, because the defect is not in either helper's own
 * behaviour: it is in how many times the loop calls one and what the other is
 * handed on the second call. A helper-level test cannot see either.
 *
 * The predicate is the REAL `isCanonicalInitiativeId` the queue guards with
 * (`packages/flows/initiative-id.ts`), injected through the manifest-ports seam
 * exactly as the other manifest functions are — a second copy of "what does a
 * canonical id look like" is how the guard and the mint drift apart (629).
 *
 * THIS FILE LIVES IN `apps/forge` for the reason
 * `architect-runner-integration.test.ts` gives beside it: sessions is rank 4 and
 * may not name flows, and the assembly is the tree that injects these same ports
 * in production. A door test that needs the REAL predicate belongs where the real
 * binding lives, not behind a baseline row bought to keep it elsewhere.
 *
 * RUN: node --experimental-strip-types --test apps/forge/tests/integration/architect-draft-round-manifests.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCanonicalInitiativeId } from '@forge/flows/initiative-id.ts';

import { runArchitectTurn, type ArchitectStatus } from '@forge/sessions/kinds/architect.ts';
import { stubArchitectManifestPorts } from '@forge/sessions/tests/architect-ports-stub.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

/** Today's date part, derived the same way the mint derives it. The doubled id
 *  the product produced embedded the round's own date, so a fixture that
 *  hard-codes 2026-09-11 would stop reproducing tomorrow. */
const TODAY = new Date().toISOString().slice(0, 10);

const initiative = (slug: string, dependsOn: string[] = []) => ({
  slug,
  title: `Initiative ${slug}`,
  iteration_budget: 3,
  cost_budget_usd: 2,
  class: 'code',
  acceptance_criteria: [{ given: 'the repo', when: 'the change lands', then: 'the gate passes' }],
  body: `# ${slug}\n`,
  ...(dependsOn.length > 0 ? { depends_on: dependsOn } : {}),
});

const DRAFT = (slugs: readonly (readonly [string, string[]])[]) => ({
  vision: 'A vision.',
  initiatives: slugs.map(([slug, deps]) => initiative(slug, deps)),
});

const HIGH = { findings: [{ severity: 'high', gap: 'the schema half is not covered.' }] };
const CLEAN = { findings: [] };

function scriptedQueryFn(script: readonly unknown[]): { queryFn: (o: { prompt: string }) => AsyncGenerator<unknown>; prompts: string[] } {
  const prompts: string[] = [];
  const queryFn = (opts: { prompt: string }) => {
    const i = prompts.length;
    prompts.push(opts.prompt);
    if (i >= script.length) throw new Error(`scriptedQueryFn: call ${i + 1} past the end of a ${script.length}-turn script`);
    const scripted = script[i];
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0.01, structured_output: scripted };
    }
    return gen();
  };
  return { queryFn, prompts };
}

function silentLogger(): EventLogger {
  return {
    emit: (entry) => ({ event_id: 'stub', cycle_id: 'stub', started_at: '1970-01-01T00:00:00.000Z', ...entry }) as EventLogEntry,
    cycleId: 'stub',
    logFilePath: '',
  };
}

/** The real predicate rides in beside the stub serialiser: this test asserts
 *  manifest FILENAMES, never manifest content, so the stub format is right for
 *  everything except the one function whose real behaviour is under test. */
function ports() {
  return { ...stubArchitectManifestPorts(), isCanonicalInitiativeId };
}

function plant(): { root: string; projectRoot: string; manifestsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-draft-manifests-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionDir = join(projectRoot, '_architect', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  const status: ArchitectStatus = {
    session_id: 'sess-1',
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'drafting',
    round: 1,
    idea: 'Add an overlay lint that fails the plan when a grant names no module.',
    updated_at: new Date().toISOString(),
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return { root, projectRoot, manifestsDir: join(sessionDir, 'manifests') };
}

const drafted = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.md')).sort();

test('7.6.17: a re-draft that echoes round 1 ids back as slugs leaves ONE manifest per initiative, not four', async () => {
  const { root, projectRoot, manifestsDir } = plant();
  // Exactly what the live architect did: round 2 hands back the ids it was
  // shown by the critic, in `slug` AND in `depends_on`.
  const round1 = DRAFT([['overlay-schema-grants-field', []], ['overlay-grants-lint', ['overlay-schema-grants-field']]]);
  const round2 = DRAFT([
    [`INIT-${TODAY}-overlay-schema-grants-field`, []],
    [`INIT-${TODAY}-overlay-grants-lint`, [`INIT-${TODAY}-overlay-schema-grants-field`]],
  ]);
  try {
    await runArchitectTurn({
      manifestPorts: ports(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root,
      queryFn: scriptedQueryFn([round1, HIGH, round2, CLEAN]).queryFn as never,
      logger: silentLogger(),
    });

    const files = drafted(manifestsDir);
    assert.deepEqual(
      files,
      [`INIT-${TODAY}-overlay-grants-lint.md`, `INIT-${TODAY}-overlay-schema-grants-field.md`],
      'two initiatives must leave two manifests — four files here is four queue entries for two ideas',
    );
    for (const f of files) {
      assert.ok(
        !f.includes('-init-'),
        `"${f}" carries a canonical id INSIDE its own slug — the mint prefixed something that was already an id`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.17: a SHRINKING re-draft leaves no orphan — round 1 initiative that round 2 dropped is gone', async () => {
  const { root, projectRoot, manifestsDir } = plant();
  // No echoed ids at all: this is the half that duplicates even with the mint
  // fixed, and it is why both fixes are needed rather than either.
  const round1 = DRAFT([['keep-this-one', []], ['dropped-on-reflection', []]]);
  const round2 = DRAFT([['keep-this-one', []]]);
  try {
    await runArchitectTurn({
      manifestPorts: ports(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root,
      queryFn: scriptedQueryFn([round1, HIGH, round2, CLEAN]).queryFn as never,
      logger: silentLogger(),
    });

    assert.deepEqual(
      drafted(manifestsDir),
      [`INIT-${TODAY}-keep-this-one.md`],
      'the initiative the architect dropped must not still be queued — the drafts dir is THIS round, not every round',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
