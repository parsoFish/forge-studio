/**
 * forge-ler4 — shared by every `runReflector` test file that reaches the
 * REAL brain-write lease: `reflector.test.ts`, `reflector-write-lease.test.ts`
 * and `reflector-spawn-capture.test.ts`.
 *
 * `runReflector` resolves its OWN `forgeRoot` from `import.meta.dirname`
 * (deliberately not injectable — see `reflector-spawn-capture.test.ts`'s own
 * header for why), so every one of those files' calls targets the SAME real
 * repo `brain/` tree. `node --test` runs each test FILE as its own child
 * process (verified: distinct `process.pid` per file), so within one file
 * every call is already sequential and safe — the risk is only CROSS-file:
 * two of those processes racing to acquire the one real lock at the same
 * time. Reproduced pre-fix: the three files run together in one
 * `node --test` invocation, 8/10 reds, `'failed' !== 'closed'`
 * (brain-write-lease-contention).
 *
 * The fix is `acquireBrainWriteLease`'s `lockfilePath` option
 * (`packages/knowledge/brain-write-lease.ts`): it relocates the PHYSICAL
 * lock file while still validating the same conceptual forgeRoot/brain
 * target. `LEASE_LOCK_PATH` below is computed once per module load — since
 * each test file is its own process, that's once per FILE, giving each file
 * a private physical lock nothing else in that 3-file contending set can
 * ever touch. `acquireIsolatedReflectorLease` is what each file wires into
 * `deps.acquireBrainWriteLease` (or calls directly, to hold the SAME lease
 * externally for a contention test).
 *
 * Why this can't be proven by holding two concurrent leases in ONE process
 * instead (e.g. as a single self-contained unit test): `proper-lockfile`'s
 * `lock()`/`unlock()` bookkeeping (`lib/lockfile.js`'s module-level `locks`
 * map) is keyed by the canonical TARGET path only, one entry per process — a
 * second successful acquire against the same target (even with a different
 * `lockfilePath`) overwrites the first's bookkeeping entry and breaks its
 * later `release()`. See `packages/knowledge/tests/unit/brain-write-lease.test.ts`
 * for the disk-level proof of the mechanism instead (custom path used,
 * default path left untouched) — this fixture relies on the SAME mechanism
 * across real OS processes, where that same-process collision never arises.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireBrainWriteLease } from '@forge/knowledge';

const LEASE_LOCK_PATH = join(
  mkdtempSync(join(tmpdir(), 'reflector-test-lease-lock-')),
  'brain-write.lock',
);

export function acquireIsolatedReflectorLease(
  forgeRoot: string,
): ReturnType<typeof acquireBrainWriteLease> {
  return acquireBrainWriteLease(forgeRoot, { lockfilePath: LEASE_LOCK_PATH });
}
