/**
 * Bead forge-8vfn.6.6 item 2 (coordinator follow-up on item 5) —
 * `FinalizerId`/`FINALIZERS` widened to cover `promoteToQueue` (architect's
 * real finalize step: `promoteManifests` + `mintAndPersistManifestCycleId`
 * over `<sessionDir>/manifests/`, `@forge/flows` — injected via
 * `FinalizerContext.manifestPorts` since flows (rank 5) is ABOVE this
 * package (rank 4), mirrors kinds/architect-ports.ts's own precedent) and
 * `commitToCentralBrain` (project-brain's real commit step:
 * `commitProjectBrain`, `@forge/knowledge` — rank 2, imported directly).
 *
 * Both CALL the real product functions rather than re-implementing them —
 * promoteToQueue through the injected ports, commitToCentralBrain by
 * importing `commitProjectBrain` straight from `@forge/knowledge`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FINALIZERS,
  resolveFinalizer,
  promoteToQueue,
  commitToCentralBrain,
  type QueuePorts,
} from '../../interactive-finalizers.ts';

function scratch(prefix: string) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const forgeRoot = join(base, 'forge');
  mkdirSync(forgeRoot, { recursive: true });
  return { base, forgeRoot };
}

// ---------------------------------------------------------------------------
// promoteToQueue
// ---------------------------------------------------------------------------

test('resolveFinalizer("promoteToQueue") resolves to the exported promoteToQueue function', () => {
  assert.equal(resolveFinalizer('promoteToQueue'), promoteToQueue);
  assert.ok(FINALIZERS.some((row) => row.id === 'promoteToQueue'), 'FINALIZERS must carry a promoteToQueue row');
});

test('POSITIVE CONTROL: promoteToQueue CALLS the injected manifestPorts.promoteManifests over <sessionDir>/manifests + <forgeRoot>/_queue, then mints a cycle id per written manifest', async () => {
  const { forgeRoot } = scratch('finalizer-promote-queue-');
  const sessionDir = join(forgeRoot, '_architect-like', 'sess-001');
  mkdirSync(join(sessionDir, 'manifests'), { recursive: true });

  const promoteCalls: { manifestsDir: string; queueRoot: string }[] = [];
  const mintCalls: { manifestPath: string; initiativeId: string }[] = [];
  const manifestPorts: QueuePorts = {
    promoteManifests: (manifestsDir, opts) => {
      promoteCalls.push({ manifestsDir, queueRoot: opts.queueRoot });
      return { writtenManifestPaths: ['/fake/_queue/pending/init-1.md'], writtenInitiativeIds: ['init-1'] };
    },
    mintAndPersistManifestCycleId: (manifestPath, initiativeId) => {
      mintCalls.push({ manifestPath, initiativeId });
      return 'cycle-marker-7c21';
    },
  };

  const wrote = await promoteToQueue({ sessionDir, forgeRoot, libraryRoot: forgeRoot, manifestPorts });

  assert.deepEqual(wrote, ['/fake/_queue/pending/init-1.md'], 'must return the ports\' own writtenManifestPaths verbatim');
  assert.equal(promoteCalls.length, 1, 'promoteManifests must be called exactly once');
  assert.equal(promoteCalls[0].manifestsDir, join(sessionDir, 'manifests'), 'must read from <sessionDir>/manifests — the real architect convention');
  assert.equal(promoteCalls[0].queueRoot, join(forgeRoot, '_queue'), 'must target <forgeRoot>/_queue — the _queue/_logs/_interactive-library sibling convention');
  assert.deepEqual(mintCalls, [{ manifestPath: '/fake/_queue/pending/init-1.md', initiativeId: 'init-1' }], 'must mint a cycle id for each written manifest, by its own written path + initiative id');
});

test('promoteToQueue refuses loudly when FinalizerContext.manifestPorts is absent (no silent no-op)', async () => {
  const { forgeRoot } = scratch('finalizer-promote-queue-missing-');
  const sessionDir = join(forgeRoot, '_architect-like', 'sess-001');
  mkdirSync(join(sessionDir, 'manifests'), { recursive: true });

  let error: Error | null = null;
  try {
    await promoteToQueue({ sessionDir, forgeRoot, libraryRoot: forgeRoot });
  } catch (err) {
    error = err as Error;
  }
  assert.ok(error, 'must throw/reject, not silently promote nothing');
  assert.equal(error!.name, 'InteractiveFinalizerError', 'must throw the deliberately named error class');
  assert.ok(error!.message.includes('manifestPorts'), 'message must name the missing field');
});

test('promoteToQueue wraps a promoteManifests throw (e.g. an invalid manifest) in InteractiveFinalizerError, naming the real reason', async () => {
  const { forgeRoot } = scratch('finalizer-promote-queue-throws-');
  const sessionDir = join(forgeRoot, '_architect-like', 'sess-001');
  mkdirSync(join(sessionDir, 'manifests'), { recursive: true });
  const manifestPorts: QueuePorts = {
    promoteManifests: () => { throw new Error('manifest-marker-e91a invalid'); },
    mintAndPersistManifestCycleId: () => 'unused',
  };

  let error: Error | null = null;
  try {
    await promoteToQueue({ sessionDir, forgeRoot, libraryRoot: forgeRoot, manifestPorts });
  } catch (err) {
    error = err as Error;
  }
  assert.ok(error, 'must throw/reject');
  assert.equal(error!.name, 'InteractiveFinalizerError');
  assert.ok(error!.message.includes('manifest-marker-e91a'), 'must carry the real underlying reason, not swallow it');
});

// ---------------------------------------------------------------------------
// commitToCentralBrain
// ---------------------------------------------------------------------------

test('resolveFinalizer("commitToCentralBrain") resolves to the exported commitToCentralBrain function', () => {
  assert.equal(resolveFinalizer('commitToCentralBrain'), commitToCentralBrain);
  assert.ok(FINALIZERS.some((row) => row.id === 'commitToCentralBrain'), 'FINALIZERS must carry a commitToCentralBrain row');
});

test('POSITIVE CONTROL: commitToCentralBrain CALLS the real commitProjectBrain — a staged theme lands under <forgeRoot>/brain/projects/<project>/themes/', async () => {
  const { forgeRoot } = scratch('finalizer-commit-brain-');
  const projectRoot = join(forgeRoot, 'proj-root');
  const sessionId = 'sess-001';
  const themesDir = join(projectRoot, '_project-brain', sessionId, 'themes');
  mkdirSync(themesDir, { recursive: true });
  writeFileSync(join(themesDir, 'patterns.md'), '# Patterns\ncontent-marker-9f1c\n');

  const wrote = await commitToCentralBrain({
    sessionDir: join(projectRoot, '_project-brain', sessionId),
    forgeRoot,
    libraryRoot: forgeRoot,
    projectRoot,
    sessionId,
    project: 'fixture-project',
  });

  assert.ok(Array.isArray(wrote) && wrote.length > 0, 'must report at least one written path');
  const dest = join(forgeRoot, 'brain', 'projects', 'fixture-project', 'themes', 'patterns.md');
  assert.ok(existsSync(dest), 'the staged theme must land under brain/projects/<project>/themes/ — commitProjectBrain\'s own real layout');
  assert.equal(readFileSync(dest, 'utf8'), '# Patterns\ncontent-marker-9f1c\n');
});

test('commitToCentralBrain refuses loudly when project/projectRoot/sessionId are absent', async () => {
  const { forgeRoot } = scratch('finalizer-commit-brain-missing-');
  let error: Error | null = null;
  try {
    await commitToCentralBrain({ sessionDir: forgeRoot, forgeRoot, libraryRoot: forgeRoot });
  } catch (err) {
    error = err as Error;
  }
  assert.ok(error, 'must throw/reject, not silently commit nothing');
  assert.equal(error!.name, 'InteractiveFinalizerError');
  assert.ok(error!.message.includes('project'), 'message must name the missing field(s)');
});
