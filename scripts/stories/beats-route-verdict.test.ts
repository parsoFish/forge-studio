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
import { routeMatches } from './beats-page.mjs';
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
// A route is never compared to `null`, to a `typeof` string, or to a NUMBER.
// The numeric case is what a line like
// `!routeMatches(page.url(), declared) && (await locator.count()) === 0`
// needs: it mentions a route AND compares a count, and a line-based scan cannot
// tell those apart without saying what a route is never equal to.
const NOT_A_ROUTE = /^\s*(?:null|undefined|-?\d+|'[a-z]+'|"[a-z]+")\s*$/;

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

// ── 534: the query is compared as PARAMETERS, never as a raw string ─────────

/**
 * T1 ruling 534, from the S10 amendment's own routes. The navigation beats
 * before beats 10 and 12 must declare `/artifact?run=<runId>&type=verdict&
 * mode=gate`, because `PhaseDrawer.tsx:749` builds every artifact chip that way
 * and a develop run therefore renders several links sharing the `/artifact`
 * pathname and differing only in their query — 7.5.3's ambiguity refusal,
 * working exactly as designed, which 514 exists to let a beat resolve.
 *
 * That makes the string compare load-bearing, and it was wrong in two ways:
 *
 *   ENCODING. The product builds those hrefs with `encodeURIComponent(cycleId)`.
 *   A run id carrying a character that percent-encodes arrives as `%3A` in the
 *   href while a story author writes the readable id in the beat. A string
 *   compare calls those two different destinations. They are the same one.
 *
 *   ORDER. `?a=1&b=2` and `?b=2&a=1` are the same request to every server; only
 *   a string compare disagrees. A beat should not have to guess the order a
 *   component happens to build its href in, and a component reordering its own
 *   parameters is not a story defect.
 *
 * Still EXACT on content — same key set, same decoded value per key — because a
 * declared query is a beat naming WHICH destination it means, and "close
 * enough" is the tie-break 7.5.3 forbids.
 */
test('534: a declared query matches an encodeURIComponent-built href with the same values', () => {
  // The real shape: a cycle id with a `:` in it, as the story author writes it
  // and as the product encodes it.
  const declared = '/artifact?run=2026-09-08T05:08:49_INIT-x&type=verdict&mode=gate';
  const href = `/artifact?run=${encodeURIComponent('2026-09-08T05:08:49_INIT-x')}&type=verdict&mode=gate`;

  assert.notEqual(href, declared, 'the fixture is only meaningful while the two strings genuinely differ');
  assert.ok(routeMatches(href, declared), `an encoded value is the same value. href=${href}`);
});

test('534: parameter ORDER does not decide a route', () => {
  assert.ok(routeMatches('/artifact?mode=gate&type=verdict&run=r1', '/artifact?run=r1&type=verdict&mode=gate'));
});

test('534 (positive control) a different VALUE is still a mismatch', () => {
  assert.equal(routeMatches('/artifact?run=r1&type=demo&mode=gate', '/artifact?run=r1&type=verdict&mode=gate'), false);
});

test('534 (positive control) an EXTRA parameter on either side is still a mismatch', () => {
  // A declared query names which of several destinations the beat means. A
  // link carrying one more parameter is a different destination, and a rule
  // that shrugged at extras would re-open the ambiguity 7.5.3 refuses.
  assert.equal(routeMatches('/artifact?run=r1&type=verdict&mode=gate&x=1', '/artifact?run=r1&type=verdict&mode=gate'), false);
  assert.equal(routeMatches('/artifact?run=r1&type=verdict', '/artifact?run=r1&type=verdict&mode=gate'), false);
});

test('534 (positive control) a REPEATED key compares every value, not just the first', () => {
  // `get` would call these equal on `tag=a` alone; `getAll` does not.
  assert.equal(routeMatches('/knowledge?tag=a', '/knowledge?tag=a&tag=b'), false);
  assert.ok(routeMatches('/knowledge?tag=a&tag=b', '/knowledge?tag=a&tag=b'));
});

test('534 (positive control) a beat that declares NO query still matches any query', () => {
  // 514's original case, unchanged: the product stays free to add `?project=…`.
  assert.ok(routeMatches('/architect/new?project=gitpulse', '/architect/new'));
});

// ── 546: an href that names no path is not a navigation ────────────────────

/**
 * T1 ruling 546, bought by A's funded S9 run — **8/15, with seven of the seven
 * reds from this one line.**
 *
 * `SkipLink.tsx` renders `href="#main-content"` on **every page** of the app.
 * Ruling 527 moved the link filter into `routeMatches`, which resolves an href
 * against a synthetic origin, and:
 *
 *     new URL('#main-content', 'http://forge.invalid').pathname === '/'
 *
 * So the skip link became a candidate for every `route: '/'` beat, and each one
 * refused with `2 links share that pathname and differ only in their query —
 * #main-content , /`. The refusal was correct about what it was shown. It was
 * shown a fragment.
 *
 * A QUERY-ONLY href is the same defect — `?tab=x` also resolves to pathname `/`
 * — and is fixed with it. Neither names a path, so neither can satisfy a route.
 *
 * Blast radius, measured: beats declaring `route: '/'`, which is S9 and `smoke`.
 * S10 declares no `/` route and was never affected.
 */
test('546 (RED) a fragment-only href is no match — the skip link is on every page', () => {
  assert.equal(routeMatches('#main-content', '/'), false);
  assert.equal(routeMatches('#anything', '/knowledge'), false);
});

test('546 (RED) a query-only href is the same defect and is no match either', () => {
  assert.equal(routeMatches('?tab=x', '/'), false);
});

test('546 (positive control) a real path is still a match, fragment or not', () => {
  // The fix must not reach past hrefs that name no path. An href WITH a path
  // that also carries a fragment is a navigation to that path.
  assert.ok(routeMatches('/', '/'));
  assert.ok(routeMatches('/knowledge#section', '/knowledge'));
  assert.ok(routeMatches('/knowledge?id=x', '/knowledge'));
});

test('546 (positive control) the primary caller is untouched — a full page URL still matches', () => {
  // `routeMatches(page.url(), target)` is the call this predicate exists for,
  // and it is handed a real `http://localhost:4124/…`. A host-based guard would
  // have broken exactly this, which is why the fix is about the PATH being
  // named and not about the origin.
  assert.ok(routeMatches('http://localhost:4124/knowledge', '/knowledge'));
  assert.ok(routeMatches('http://localhost:4124/', '/'));
});

test('546: with the skip link on the page, a `/` beat has exactly ONE candidate', () => {
  // The end-to-end shape S9 actually hit: a page offering the app-wide skip
  // link and one real link home. Before the fix this was "2 links share that
  // pathname"; after it, one candidate and the beat can navigate.
  const hrefs = ['#main-content', '/'];
  const candidates = hrefs.filter((h) => routeMatches(h, '/'));
  assert.deepEqual(candidates, ['/'], 'the skip link is not a way to reach the home route');
});

// ── 553: a predicate that throws must fail LOUDLY, never silently ──────────

/**
 * T1 ruling 553, bought by 546's own CI red.
 *
 * Both `waitForURL` call sites wrote `.catch(() => {})`, and that catch is
 * deliberate — a press that did not navigate is reported by the nav resolution,
 * not by an exception. But it also swallowed **the predicate throwing**.
 *
 * When 546 added `url.startsWith('#')` to `routeMatches`, playwright handed the
 * predicate a URL **object**, `.startsWith` was not a function, the predicate
 * threw, the catch ate it, and **no arrival wait happened at all**. Every
 * real-nav beat then read its page before the navigation committed, and the
 * `proof` story failed with beat 2 reporting `expected "/projects/gitpulse",
 * got "/projects"` and beat 3 the exact inverse. That reads like a routing
 * defect. It was a TypeError with its mouth taped shut.
 *
 * The two outcomes are now separate: **the URL never matched** is still quiet,
 * because the beat's own verdict says it better; **the predicate blew up** is
 * loud, because a runner defect must never be renderable as a fact about the
 * page.
 */
test('553 (RED) a throwing route predicate reds the beat and names the runner, not the page', async () => {
  // A page whose `waitForURL` calls the predicate with a value that cannot be
  // stringified — the shape of the real bug, where the argument was not what
  // the predicate assumed.
  const hostile = { toString() { throw new TypeError('url is not a string'); } };
  const page = {
    url: () => 'http://localhost:4124/projects',
    goto: async () => {},
    locator: (sel: string): any => ({
      first: () => page.locator(sel),
      evaluateAll: async (fn: any, arg: any) => fn([{ getAttribute: () => '/projects/gitpulse' }], arg),
      count: async () => 1,
      async click() {},
      async evaluate(fn: (n: any) => unknown) {
        return fn({ tagName: 'A', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
      },
    }),
    waitForURL: async (pred: (u: unknown) => boolean) => { pred(hostile); },
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: { page: 'projects', 'page-ready': 'true' },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };

  const verdict = await driveBeat(
    page as never,
    {
      act: 'Click the first project card',
      expect: { route: '/projects/gitpulse', data: { page: 'projects', 'page-ready': 'true' } },
      say: 'The operator opens a project.',
    },
    1,
    'http://localhost:4124',
  );

  assert.equal(verdict.status, 'red');
  const said = verdict.failures.join(' | ');
  assert.match(said, /predicate threw/, `it must name the predicate. Got: ${said}`);
  assert.match(said, /defect in the RUNNER/, 'and say whose defect it is');
  assert.match(said, /no arrival wait happened/, 'and what that cost, so the reader does not trust what follows');
});

test('553 (positive control) a URL that simply never matches stays QUIET', async () => {
  // The deliberate catch survives for the case it was written for: a press that
  // did not navigate is reported by the beat's own verdict, in the beat's own
  // terms, and must not be dressed up as a runner defect.
  const page = {
    url: () => 'http://localhost:4124/projects',
    goto: async () => {},
    locator: (sel: string): any => ({
      first: () => page.locator(sel),
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
      count: async () => 0,
      async click() {},
      async evaluate(fn: (n: any) => unknown) {
        return fn({ tagName: 'A', textContent: '', type: '', value: '', querySelector: () => null, disabled: false, title: '', getAttribute: () => null });
      },
    }),
    waitForURL: async (pred: (u: unknown) => boolean, o: { timeout: number }) => {
      pred('http://localhost:4124/projects');
      throw new Error(`Timeout ${o.timeout}ms exceeded`);
    },
    waitForSelector: () => Promise.resolve(),
    evaluate: async () => ({
      data: { page: 'projects-index', 'page-ready': 'true' },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };

  const verdict = await driveBeat(
    page as never,
    {
      act: 'Click the first project card',
      expect: { route: '/projects/gitpulse', data: { page: 'projects', 'page-ready': 'true' } },
      say: 'The operator opens a project.',
    },
    1,
    'http://localhost:4124',
  );

  assert.equal(verdict.status, 'red', 'it still fails — it just fails as a page fact');
  assert.doesNotMatch(
    verdict.failures.join(' | '),
    /predicate threw|defect in the RUNNER/,
    'a URL that never arrived is not a runner defect and must not be reported as one',
  );
});
