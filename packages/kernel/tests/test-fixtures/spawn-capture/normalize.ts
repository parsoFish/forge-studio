/**
 * Characterization-test support for the PM / reflector spawn-capture tests
 * (orchestrator/pm-spawn-capture.test.ts, orchestrator/phases/reflector-spawn-
 * capture.test.ts). These pin the EXACT `{prompt, options}` object each phase
 * passes into its injected SDK-query function today, so the R4-01 generic-
 * runnable-primitive refactor can prove byte-level no-behavioural-delta.
 *
 * Two small pieces, deliberately minimal:
 *  - `normalizeForSnapshot` replaces genuinely volatile values (absolute
 *    tmp-dir / repo-root paths, live control objects like AbortController)
 *    with fixed placeholders. Everything else — every system-prompt byte,
 *    every option field, tool lists, budgets — passes through unchanged, so
 *    a real behavioural delta anywhere else fails the comparison rather than
 *    being silently absorbed.
 *  - `assertMatchesJsonSnapshot` compares the normalized capture against a
 *    committed JSON fixture, bootstrapping (or regenerating, via
 *    `UPDATE_SNAPSHOT=1`) the fixture when it's missing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import assert from 'node:assert/strict';

export type PathReplacement = { value: string; placeholder: string };

/**
 * Recursively walk a captured `{prompt, options}` value, replacing:
 *  - `AbortController` instances -> a fixed marker string. Identity is never
 *    meaningful (a fresh controller is constructed on every call) and
 *    `JSON.stringify` would otherwise silently collapse it to `{}` — masking
 *    the case where a refactor drops the field entirely (an omitted key and
 *    an empty-object key look identical after `JSON.stringify`, but are NOT
 *    behaviourally identical to the SDK).
 *  - occurrences of each `replacements` entry's absolute path inside string
 *    values -> its placeholder (longest value first, so a tmp dir nested
 *    inside a longer path can't get partially shadowed).
 *
 * Numbers, booleans, null, arrays, and plain objects otherwise pass through
 * unchanged.
 */
export function normalizeForSnapshot(value: unknown, replacements: readonly PathReplacement[]): unknown {
  const ordered = [...replacements].sort((a, b) => b.value.length - a.value.length);

  const replaceInString = (s: string): string => {
    let out = s;
    for (const { value: from, placeholder } of ordered) {
      if (!from) continue;
      out = out.split(from).join(placeholder);
    }
    return out;
  };

  const walk = (v: unknown): unknown => {
    if (typeof AbortController !== 'undefined' && v instanceof AbortController) {
      return '<AbortController>';
    }
    if (typeof v === 'string') return replaceInString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };

  return walk(value);
}

const UPDATE_SNAPSHOT = process.env.UPDATE_SNAPSHOT === '1';

/**
 * Compare `normalized` against the committed JSON fixture at `fixturePath`.
 *
 * Bootstrap / regenerate: when the fixture is missing, OR when
 * `UPDATE_SNAPSHOT=1` is set, the fixture is (re)written from `normalized`
 * instead of asserted against — the standard "capture what the code does
 * today" golden-test workflow. Re-run without the env var afterwards to
 * confirm the assertion path is exercised.
 */
export function assertMatchesJsonSnapshot(fixturePath: string, normalized: unknown): void {
  const serialized = JSON.stringify(normalized, null, 2) + '\n';
  if (UPDATE_SNAPSHOT || !existsSync(fixturePath)) {
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, serialized);
    return;
  }
  const expected = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assert.deepStrictEqual(
    normalized,
    expected,
    `spawn-capture snapshot mismatch for ${fixturePath} — if this is an intentional behaviour ` +
      `change, regenerate with UPDATE_SNAPSHOT=1`,
  );
}
