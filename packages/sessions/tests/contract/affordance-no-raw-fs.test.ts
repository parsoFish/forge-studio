/**
 * STRUCT-1, carried across the M4 row-37 carve: the generic session-affordance
 * WRITE path makes ZERO raw fs sink calls. Every read and write goes through a
 * guarded primitive — `guardedRead/WriteSessionStatus` or
 * `guardedReadFile`/`guardedWriteFile`/`resolveGuardedPath` — so adding a raw
 * sink has to be a deliberate, reviewed decision that touches this file.
 *
 * It used to read ONE host file. The carve spread that code across six modules,
 * and a lock that kept naming the old path would have passed against nothing
 * (§15.93). Two of the six are shared kind modules whose TURN logic legitimately
 * uses raw fs, so those are scanned only from their affordance-arm banner down —
 * the region the carve appended — and the banner's presence is asserted, so a
 * renamed banner fails loudly instead of silently scanning zero lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The banner the carve wrote above the arms it appended to a kind module. */
const ARMS_BANNER = 'The generic session-affordance WRITE arms for this kind';

/** file → whether the WHOLE file is affordance code, or only its arms region. */
const SUBJECTS: ReadonlyArray<{ readonly rel: string; readonly whole: boolean }> = [
  { rel: 'bridge-studio-sessions-affordances.ts', whole: true },
  { rel: 'bridge-studio-sessions-affordance-shell.ts', whole: true },
  { rel: 'kinds/kb-cleanup.ts', whole: true },
  { rel: 'kinds/authoring.ts', whole: true },
  { rel: 'kinds/instructions.ts', whole: false },
  { rel: 'kinds/demo-builder.ts', whole: false },
];

const RAW_FS_SINKS = [
  'writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'rmdirSync', 'unlinkSync',
  'renameSync', 'copyFileSync', 'cpSync', 'openSync', 'readFileSync', 'readdirSync',
  'existsSync', 'statSync', 'lstatSync', 'realpathSync', 'symlinkSync',
];

function codeOf(rel: string, whole: boolean): string {
  const abs = join(PKG_ROOT, rel);
  assert.ok(existsSync(abs), `${rel} no longer exists — this lock is pointing at nothing`);
  const src = readFileSync(abs, 'utf8');
  let body = src;
  if (!whole) {
    const at = src.indexOf(ARMS_BANNER);
    assert.ok(at > 0, `${rel}: the affordance-arms banner is gone — the lock cannot find the region it guards`);
    body = src.slice(at);
  }
  return body
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

test('the affordance dispatch, its shell and all four kind arms make ZERO raw fs sink calls', () => {
  const sinkRe = new RegExp(`(?<![.\\w$])(${RAW_FS_SINKS.join('|')})\\s*\\(([^)]*)\\)`, 'g');
  const offenders: string[] = [];
  for (const { rel, whole } of SUBJECTS) {
    const code = codeOf(rel, whole);
    let m: RegExpExecArray | null;
    while ((m = sinkRe.exec(code))) {
      offenders.push(`${rel}: ${m[0]}`);
      // The original assertion's other half: even a reviewed raw sink may never
      // take a request-derived route segment directly.
      assert.doesNotMatch(m[2], /\bkind\b/, `${rel}: raw fs sink "${m[1]}" must never take "kind" directly: ${m[0]}`);
      assert.doesNotMatch(m[2], /\baffordanceId\b/, `${rel}: raw fs sink "${m[1]}" must never take "affordanceId" directly: ${m[0]}`);
    }
    sinkRe.lastIndex = 0;
  }
  assert.deepEqual(offenders, [], 'every affordance read/write must go through a guarded primitive');
});

test('the lock names six live subjects and actually scanned them — a census, so a carve cannot shrink it in silence', () => {
  assert.equal(SUBJECTS.length, 6);
  let scanned = 0;
  for (const { rel, whole } of SUBJECTS) {
    const code = codeOf(rel, whole);
    assert.ok(code.length > 200, `${rel}: scanned region is implausibly small (${code.length} chars)`);
    scanned += 1;
  }
  assert.equal(scanned, SUBJECTS.length);
});
