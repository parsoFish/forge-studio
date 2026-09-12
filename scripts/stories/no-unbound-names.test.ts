/**
 * NO STORY-HARNESS MODULE MAY REFERENCE A NAME THAT DOES NOT EXIST — bead
 * `forge-91cr`.
 *
 * WHAT THIS IS FOR. `run.mjs:504` read `if (v.breached)` for two merges while
 * `v` was bound nowhere in that function: the `forge-rzrs` split moved the
 * ceiling verdict into `spendSoFar` and left the three references behind. Every
 * COSTED run would have thrown `ReferenceError` at its first beat boundary,
 * escaped a `try` with no `catch`, and skipped the reap that kills the agents it
 * had started. The enforced ceiling had never once compared a number.
 *
 * WHY NOTHING SAW IT. `npm run lint` is markdownlint over `docs/**` and `*.md`;
 * `tsconfig.json` sets no `allowJs`, so the `.mjs` harness is read by no
 * checker at all. The beat loop itself has no unit door because it drives a
 * browser. §15.500: both halves were right — `spendSoFar` has doors, the old
 * inline block worked — and the seam between them was tested by nothing.
 *
 * WHAT IT IS NOT. This is NOT a typecheck of the harness, and it must not grow
 * into one: `--checkJs` over these 27 modules also reports ~20 JSDoc drifts
 * (`TS2339` and friends) that are real but are a different piece of work. This
 * door reads exactly two codes — `TS2304` (cannot find name) and `TS2552` (did
 * you mean) — the codes that mean the identifier does not resolve. Everything
 * else tsc says is ignored ON PURPOSE, and the door says so rather than
 * pretending the harness typechecks.
 *
 * THE FIRST TEST IS THE INSTRUMENT'S OWN DOOR (§15.507). A scanner that
 * reports nothing is indistinguishable from a scanner that cannot see, and this
 * campaign has already shipped one green that meant "the case did not run". So
 * the meta-door plants the defect in a throwaway module and requires the
 * scanner to find it before the real sweep's silence is worth anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const TSC = join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * Every "this name does not resolve" diagnostic tsc reports for `files`.
 *
 * A SCAN THAT COULD NOT RUN IS NOT A CLEAN SCAN (§15.504). Three states, not
 * two: findings, none, and unknown — and unknown throws here rather than
 * returning the empty array that a passing assertion cannot tell apart from a
 * real all-clear.
 */
function unresolvedNames(files: readonly string[]): string[] {
  if (!existsSync(TSC)) {
    throw new Error(`UNKNOWN, not clean: no tsc at ${TSC} — this door cannot report on what it could not read`);
  }
  const r = spawnSync(
    process.execPath,
    [TSC, '--noEmit', '--allowJs', '--checkJs', '--skipLibCheck',
      '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext',
      ...files],
    { encoding: 'utf8', cwd: REPO },
  );
  if (r.error !== undefined) throw new Error(`UNKNOWN, not clean: tsc did not run — ${String(r.error)}`);
  if (r.status === null) throw new Error(`UNKNOWN, not clean: tsc was killed by ${String(r.signal)}`);
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => /error TS(2304|2552):/.test(l));
}

test('forge-91cr (meta): the scanner FINDS an unbound name — a silent scanner proves nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unbound-names-meta-'));
  const planted = join(dir, 'planted.mjs');
  // The shape of the real defect: a guard reading a verdict off a name the
  // refactor stopped binding.
  writeFileSync(planted, 'export function halt() {\n  if (v.breached) return true;\n  return false;\n}\n');

  const found = unresolvedNames([planted]);
  assert.equal(found.length, 1, `expected exactly one unresolved name, got:\n${found.join('\n')}`);
  assert.match(found[0]!, /Cannot find name 'v'/);
});

test('forge-91cr: no module under scripts/stories references a name that does not exist', () => {
  const dir = join(REPO, 'scripts', 'stories');
  const modules = readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => join(dir, f));
  assert.ok(modules.length > 0, 'the sweep found no modules to read, which is not the same as finding no defects');

  const found = unresolvedNames(modules);
  assert.deepEqual(
    found, [],
    `a story-harness module references a name bound nowhere — this is the ${'`'}forge-91cr${'`'} class, ` +
    `and at a beat boundary it throws rather than failing a check:\n${found.join('\n')}`,
  );
});
