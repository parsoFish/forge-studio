/**
 * The verdict's own route compare, and the static close on all of them.
 *
 * T1 ruling 527, bought by the aborted G1/S10 run. Beat 2 red at 36 s:
 *
 *   route: expected "/architect/new", got "/architect/new?project=gitpulse"
 *
 * `beats.mjs`'s `beatVerdict` compared routes with `!==`, and ruling 514 had
 * made `observed.route` carry the query. So every beat standing on a page the
 * product mounts with `?project=` reds ON ARRIVAL — the same three live sites
 * `7.5.3` went query-blind for in the first place.
 *
 * WHY THIS IS THE THIRD TIME. 514 replaced five hand-rolled compares with
 * `routeMatches` (the two `waitForURL` races, the arrival check, the
 * already-arrived short circuit, the link filter). 518 replaced a sixth —
 * `stopReasonFor`'s scope check — found while building something else. Neither
 * touched `beatVerdict`, which is the compare that WRITES THE VERDICT. §15.285
 * is the rule that a predicate introduced to end a class of drift must be
 * applied to every compare in its blast radius in the same PR; it was written
 * after 518 and it fired anyway, on a funded run, because the rule was carried
 * in prose and prose does not grep.
 *
 * SO THE CLOSE IS A TEST, not another rule. `no module compares two routes with
 * === or !==` is checkable, and the check below is what makes the next omission
 * impossible rather than unlikely — the same argument `module-wiring.test.ts`
 * makes about a name that does not resolve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatVerdict } from './beats.mjs';
import { driveBeat } from './beats-drive.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── the defect itself ───────────────────────────────────────────────────────

const architectBeat = {
  act: 'Press "Architect →"',
  do: [{ press: 'start-work-architect' }],
  expect: { route: '/architect/new', data: { page: 'architect-new', 'page-ready': 'true' } },
  say: 'The operator starts an architect session on this project.',
};

test('527 (RED) a beat that declares no query is green on a route the product mounted with one', () => {
  // S10 beat 2, verbatim: the beat says `/architect/new`, the product mounts
  // `/architect/new?project=gitpulse`, and `readObserved` has reported
  // `pathname + search` since 514.
  const verdict = beatVerdict(architectBeat, {
    route: '/architect/new?project=gitpulse',
    data: { page: 'architect-new', 'page-ready': 'true' },
    nested: [],
  });

  assert.equal(
    verdict.status,
    'green',
    `a beat that names no query must not be reded by the product's own parameter. Got: ${verdict.failures.join(' | ')}`,
  );
});

test('527 (positive control) a beat that DECLARES a query still reds on the wrong one', () => {
  // Without this, "ignore the query" would pass — and that is exactly the
  // tie-break 7.5.3 forbids and 514 exists to make declarable.
  const queried = { ...architectBeat, expect: { ...architectBeat.expect, route: '/knowledge?id=story-s6' } };
  const verdict = beatVerdict(queried, {
    route: '/knowledge?id=story-s2',
    data: { page: 'architect-new', 'page-ready': 'true' },
    nested: [],
  });

  assert.equal(verdict.status, 'red', 'a beat that names WHICH destination it means is judged on it');
  assert.match(verdict.failures.join(' | '), /route: expected "\/knowledge\?id=story-s6", got "\/knowledge\?id=story-s2"/);
});

test('527 (positive control) a different PATHNAME is still red, query or no query', () => {
  const verdict = beatVerdict(architectBeat, {
    route: '/projects/gitpulse?project=gitpulse',
    data: { page: 'architect-new', 'page-ready': 'true' },
    nested: [],
  });
  assert.equal(verdict.status, 'red');
  assert.match(verdict.failures.join(' | '), /route: expected/);
});

// ── the same thing, driven end to end through a page ────────────────────────

/** A page that mounts its route with the product's own `?project=` parameter. */
function fakeStudioWithProjectQuery(target: string, query: string) {
  let route = '/projects/gitpulse';
  const url = () => `http://localhost:4124${route}${route === target ? query : ''}`;
  const locator = (sel: string): any => ({
    first: () => locator(sel),
    evaluateAll: async (fn: any, arg: any) => fn([{ getAttribute: () => `${target}${query}` }], arg),
    count: async () => (sel.includes('start-work-architect') ? 1 : 0),
    async click() { route = target; },
    async evaluate(fn: (n: any) => unknown) {
      return fn({ tagName: 'BUTTON', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
    },
  });
  return {
    url,
    goto: async (u: string) => { route = new URL(u).pathname; },
    locator,
    waitForURL: (pred: (u: string) => boolean, o: { timeout: number }) =>
      new Promise<void>((resolve, reject) => {
        const began = Date.now();
        const tick = () => {
          if (pred(url())) return resolve();
          if (Date.now() - began >= o.timeout) return reject(new Error('Timeout exceeded waiting for the URL'));
          setTimeout(tick, 5);
        };
        tick();
      }),
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: route === target
        ? { page: 'architect-new', 'page-ready': 'true' }
        : { page: 'project-detail', 'page-ready': 'true' },
      nested: [],
      lifecycle: null,
      lifecycleError: null,
      sessionPhase: null,
    }),
  };
}

test('527 (RED) S10 beat 2, end to end: the press lands on ?project= and the beat is GREEN', async () => {
  const page = fakeStudioWithProjectQuery('/architect/new', '?project=gitpulse');
  const verdict = await driveBeat(page as never, architectBeat, 1, 'http://localhost:4124');

  assert.equal(
    verdict.status,
    'green',
    `this is the beat that aborted the funded G1 run at 36 s. Got: ${verdict.failures.join(' | ')}`,
  );
});

// ── the static close (§15.285) ──────────────────────────────────────────────

/**
 * The lines of `routeMatches`' own body — the ONE place two routes are
 * legitimately compared with `!==`, because it IS the comparison. Found by
 * brace matching rather than a hardcoded range, so the exemption follows the
 * function if it moves or grows.
 */
function routeMatchesBody(source: string): [number, number] | null {
  const at = source.indexOf('export function routeMatches(');
  if (at === -1) return null;
  let depth = 0;
  let i = source.indexOf('{', at);
  const from = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) break; }
  }
  const line = (idx: number) => source.slice(0, idx).split('\n').length;
  return [line(from), line(i)];
}

/** Expressions that carry a ROUTE. A comparison with one of these on either
 *  side is a route comparison, whatever it is called locally. */
const ROUTE_BEARING = /\b(?:route|pathname|href|search)\b|\bpage\.url\(\)/;

/** Operands that make a comparison a GUARD rather than a route compare: a
 *  presence check, or the result of `typeof`. */
const NOT_A_ROUTE = /^\s*(?:null|undefined|'[a-z]+'|"[a-z]+")\s*$/;

test('527: no module under scripts/stories compares two routes with === or !==', () => {
  const modules = readdirSync(HERE).filter((f) => f.endsWith('.mjs')).sort();
  assert.ok(modules.length > 10, `expected the story runner's modules, found ${modules.length}`);

  const offences: string[] = [];
  for (const file of modules) {
    const source = readFileSync(join(HERE, file), 'utf8');
    const exempt = routeMatchesBody(source);
    const lines = source.split('\n');
    lines.forEach((line, idx) => {
      const no = idx + 1;
      if (exempt !== null && no >= exempt[0] && no <= exempt[1]) return;
      if (/^\s*(\*|\/\/)/.test(line)) return;
      const m = /(.+?)\s*(===|!==)\s*(.+?)\s*(?:\)|;|\?|&&|\|\||$)/.exec(line);
      if (m === null) return;
      const [, left, op, right] = m;
      if (!ROUTE_BEARING.test(left) && !ROUTE_BEARING.test(right)) return;
      if (NOT_A_ROUTE.test(left) || NOT_A_ROUTE.test(right)) return;
      offences.push(`${file}:${no}: ${left.trim()} ${op} ${right.trim()}`);
    });
  }

  assert.deepEqual(
    offences,
    [],
    'A route is compared through `routeMatches` and nowhere else: pathname always, query only when the beat ' +
      'DECLARED one. This test exists because the rule was carried in prose for two PRs and prose does not ' +
      'grep — `beatVerdict` kept its `!==` through 514 and 518 and aborted a funded run on it. If a compare ' +
      'here is genuinely not about a route, name the operand something that is not a route. Offences:\n  ' +
      offences.join('\n  '),
  );
});
