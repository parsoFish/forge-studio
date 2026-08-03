/**
 * story-parity.test.ts — TDD contract for scripts/lib/story-parity.mjs
 * (R7-02-F3, story-beat parity registry). The module under test and its data
 * file (scripts/journeys/story-registry.mjs) do not exist yet — every test
 * here is RED until both land. That is the point: this file is the frozen
 * acceptance contract they must satisfy.
 *
 * Group 1 (below) exercises the pure functions against small synthetic
 * fixtures — one test per documented throw/enforcement rule.
 * Group 2 (bottom of file) is the CI-enforced gate: it runs the real
 * committed registry against the real mockup source and the real journey
 * harness registry, and asserts zero parity errors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMockupStories,
  indexJourneyBeats,
  deriveParity,
  formatParityReport,
} from './lib/story-parity.mjs';
import { STORY_REGISTRY, WAVE5_BATCHES } from './journeys/story-registry.mjs';
import { JOURNEYS, RUN_ORDER } from './journeys/index.mjs';

// =============================================================================
// Group 1 — unit behaviour, SYNTHETIC fixtures only
// =============================================================================

// ── parseMockupStories: happy path ──────────────────────────────────────────

const HAPPY_MOCKUP_SOURCE = `const JOURNEYS = {
  'first-story': {
    title: 'First Story',
    steps: [
      { cap: 'Step one caption.' },
      { cap: 'Step two caption.' },
    ],
  },
  'second-story': {
    title: 'Second Story',
    steps: [
      { cap: 'Only step.' },
    ],
  },
};
Object.assign(window, { JOURNEYS });
`;

test('parseMockupStories: happy path — ids, titles, beat count/cap text, declaration order', () => {
  const stories = parseMockupStories(HAPPY_MOCKUP_SOURCE);
  assert.equal(stories.length, 2);
  assert.deepEqual(stories.map((s) => s.id), ['first-story', 'second-story']);
  assert.equal(stories[0].title, 'First Story');
  assert.equal(stories[1].title, 'Second Story');
  assert.deepEqual(stories[0].beats, [
    { index: 0, cap: 'Step one caption.' },
    { index: 1, cap: 'Step two caption.' },
  ]);
  assert.deepEqual(stories[1].beats, [{ index: 0, cap: 'Only step.' }]);
});

test('parseMockupStories: tolerates the bare `window` reference the real mockup file uses', () => {
  // Exact shape given in the frozen contract — the real file ends with
  // `Object.assign(window, { JOURNEYS });` and `window` is undefined in Node.
  const source =
    "const JOURNEYS = { 'a-story': { title: 'A', steps: [ { cap: 'one' } ] } };\n" +
    'Object.assign(window, { JOURNEYS });';
  const stories = parseMockupStories(source);
  assert.deepEqual(stories, [{ id: 'a-story', title: 'A', beats: [{ index: 0, cap: 'one' }] }]);
});

// ── parseMockupStories: the four documented throws ──────────────────────────

test('parseMockupStories: throws on unparseable source', () => {
  const source = "const JOURNEYS = { totally not valid javascript here ][";
  assert.throws(() => parseMockupStories(source), Error);
});

test('parseMockupStories: throws when JOURNEYS is missing entirely', () => {
  const source = 'const SOMETHING_ELSE = { foo: 1 };\n';
  assert.throws(() => parseMockupStories(source), Error);
});

test('parseMockupStories: throws when JOURNEYS is present but empty', () => {
  const source = 'const JOURNEYS = {};\nObject.assign(window, { JOURNEYS });\n';
  assert.throws(() => parseMockupStories(source), Error);
});

test('parseMockupStories: throws when a story title is not a non-empty string', () => {
  const source = `const JOURNEYS = {
  'story-a': {
    title: '',
    steps: [ { cap: 'x' } ],
  },
};
Object.assign(window, { JOURNEYS });
`;
  assert.throws(() => parseMockupStories(source), Error);
});

test('parseMockupStories: throws when a story\'s steps is not a non-empty array', () => {
  const source = `const JOURNEYS = {
  'story-a': {
    title: 'Story A',
    steps: [],
  },
};
Object.assign(window, { JOURNEYS });
`;
  assert.throws(() => parseMockupStories(source), Error);
});

// ── indexJourneyBeats: happy path ───────────────────────────────────────────

test('indexJourneyBeats: happy path — per-journey title, beatIds, runOrderBeatIds', () => {
  const journeys = [
    {
      id: 'journey-a',
      title: 'Journey A',
      beats: [
        { id: 'beat-1', title: 'Beat One' },
        { id: 'beat-2', title: 'Beat Two' },
      ],
    },
    { id: 'journey-b', title: 'Journey B', beats: [{ id: 'beat-3', title: 'Beat Three' }] },
  ];
  const runOrder: [string, string][] = [
    ['journey-a', 'beat-1'],
    ['journey-a', 'beat-2'],
    ['journey-b', 'beat-3'],
  ];

  const index = indexJourneyBeats(journeys, runOrder);

  assert.equal(index.size, 2);
  const a = index.get('journey-a');
  assert.ok(a);
  assert.equal(a!.title, 'Journey A');
  assert.deepEqual([...a!.beatIds].sort(), ['beat-1', 'beat-2']);
  assert.deepEqual([...a!.runOrderBeatIds].sort(), ['beat-1', 'beat-2']);
  const b = index.get('journey-b');
  assert.ok(b);
  assert.deepEqual([...b!.runOrderBeatIds], ['beat-3']);
});

test('indexJourneyBeats: a beat declared but never run stays out of runOrderBeatIds', () => {
  const journeys = [
    {
      id: 'journey-a',
      title: 'Journey A',
      beats: [
        { id: 'beat-1', title: 'One' },
        { id: 'beat-2', title: 'Two (never run)' },
      ],
    },
  ];
  const runOrder: [string, string][] = [['journey-a', 'beat-1']];

  const index = indexJourneyBeats(journeys, runOrder);

  const a = index.get('journey-a');
  assert.ok(a);
  assert.deepEqual([...a!.beatIds].sort(), ['beat-1', 'beat-2']);
  assert.deepEqual([...a!.runOrderBeatIds], ['beat-1']);
});

// ── indexJourneyBeats: the four documented throws ───────────────────────────

test('indexJourneyBeats: throws when a journey has no string id', () => {
  const journeys = [{ title: 'No id', beats: [{ id: 'b1', title: 'B' }] }];
  // @ts-expect-error — intentional: proving runtime fail-fast on a missing id
  assert.throws(() => indexJourneyBeats(journeys, []), Error);
});

test('indexJourneyBeats: throws on a duplicate journey id', () => {
  const journeys = [
    { id: 'dup', title: 'One', beats: [{ id: 'b1', title: 'B' }] },
    { id: 'dup', title: 'Two', beats: [{ id: 'b2', title: 'B2' }] },
  ];
  assert.throws(() => indexJourneyBeats(journeys, []), Error);
});

test('indexJourneyBeats: throws when a beat has no string id', () => {
  const journeys = [{ id: 'journey-a', title: 'A', beats: [{ title: 'No id beat' }] }];
  // @ts-expect-error — intentional: proving runtime fail-fast on a missing beat id
  assert.throws(() => indexJourneyBeats(journeys, []), Error);
});

test('indexJourneyBeats: throws when runOrder names an unknown journey id', () => {
  const journeys = [{ id: 'journey-a', title: 'A', beats: [{ id: 'b1', title: 'B' }] }];
  const runOrder: [string, string][] = [['journey-ghost', 'b1']];
  assert.throws(() => indexJourneyBeats(journeys, runOrder), Error);
});

// ── deriveParity: shared synthetic fixtures ─────────────────────────────────
//
// Three mockup stories (a: 2 beats, b: 1 beat, c: 1 beat), one journey with
// three beats (jx-1..jx-3), all three run. Fresh copies via factory functions
// so no test can leak mutation into another (immutability discipline).

function cleanMockupStories() {
  return [
    {
      id: 'story-a',
      title: 'Story A',
      beats: [
        { index: 0, cap: 'first' },
        { index: 1, cap: 'second' },
      ],
    },
    { id: 'story-b', title: 'Story B', beats: [{ index: 0, cap: 'only one' }] },
    { id: 'story-c', title: 'Story C', beats: [{ index: 0, cap: 'solo' }] },
  ];
}

function cleanJourneys() {
  return [
    {
      id: 'journey-x',
      title: 'Journey X',
      beats: [
        { id: 'jx-1', title: 'JX One' },
        { id: 'jx-2', title: 'JX Two' },
        { id: 'jx-3', title: 'JX Three' },
      ],
    },
  ];
}

function cleanRunOrder(): [string, string][] {
  return [
    ['journey-x', 'jx-1'],
    ['journey-x', 'jx-2'],
    ['journey-x', 'jx-3'],
  ];
}

/** story-a ported (2 beats), story-b excluded, story-c pending (no port yet). */
function cleanRegistryPendingC() {
  return [
    {
      story: 'story-a',
      batch: 'A' as const,
      port: { journey: 'journey-x', beats: ['jx-1', 'jx-2'] },
      excluded: null,
    },
    {
      story: 'story-b',
      batch: null,
      port: null,
      excluded: { reason: 'superseded by story-a', decision: 'ADR-1' },
    },
    { story: 'story-c', batch: 'B' as const, port: null, excluded: null },
  ];
}

test('deriveParity: clean registry — zero errors, correct derived statuses and counts', () => {
  const parity = deriveParity({
    registry: cleanRegistryPendingC(),
    mockupStories: cleanMockupStories(),
    journeys: cleanJourneys(),
    runOrder: cleanRunOrder(),
  });

  assert.deepEqual(parity.errors, []);
  assert.deepEqual(parity.entries.map((e) => e.story), ['story-a', 'story-b', 'story-c']);
  assert.deepEqual(
    parity.entries.map((e) => e.status),
    ['ported', 'excluded', 'pending'],
  );
  assert.deepEqual(parity.counts, { total: 3, ported: 1, pending: 1, excluded: 1 });
});

test('deriveParity: counts are DERIVED — flipping story-c from pending to ported moves them', () => {
  const baseline = cleanRegistryPendingC();
  // Deep-copy before mutation-based fixture derivation — never mutate the
  // baseline array/objects directly.
  const flipped = structuredClone(baseline);
  const cIndex = flipped.findIndex((e) => e.story === 'story-c');
  flipped[cIndex] = { ...flipped[cIndex], port: { journey: 'journey-x', beats: ['jx-3'] } };

  const parity = deriveParity({
    registry: flipped,
    mockupStories: cleanMockupStories(),
    journeys: cleanJourneys(),
    runOrder: cleanRunOrder(),
  });

  assert.deepEqual(parity.errors, []);
  assert.deepEqual(parity.counts, { total: 3, ported: 2, pending: 0, excluded: 1 });
  // baseline itself must be untouched by the derivation above.
  assert.equal(baseline[cIndex].port, null);
});

test('deriveParity: beat accounting — mixed string + excluded-object BeatRefs on a ported entry', () => {
  const registry = [
    {
      story: 'story-a',
      batch: 'A' as const,
      port: {
        journey: 'journey-x',
        beats: ['jx-1', { excluded: 'cut in the wave-5A backlog trim', decision: 'ADR-999' }],
      },
      excluded: null,
    },
    {
      story: 'story-b',
      batch: null,
      port: null,
      excluded: { reason: 'r', decision: 'd' },
    },
    { story: 'story-c', batch: 'B' as const, port: null, excluded: null },
  ];

  const parity = deriveParity({
    registry,
    mockupStories: cleanMockupStories(),
    journeys: cleanJourneys(),
    runOrder: cleanRunOrder(),
  });

  assert.deepEqual(parity.errors, []);
  const entryA = parity.entries.find((e) => e.story === 'story-a');
  assert.ok(entryA);
  assert.equal(entryA!.status, 'ported');
  assert.equal(entryA!.mockupBeatCount, 2);
  assert.equal(entryA!.portedBeatCount, 1);
  assert.equal(entryA!.excludedBeatCount, 1);
});

// ── deriveParity: the 12 enforcement rules ──────────────────────────────────
//
// A separate, deliberately minimal fixture set: two mockup stories, one
// journey with THREE declared beats but only two ever run (jx-3 is declared
// on the journey yet absent from RUN_ORDER — needed for rule 11).

function enforcementMockupStories() {
  return [
    {
      id: 'story-a',
      title: 'Story A',
      beats: [
        { index: 0, cap: 'first' },
        { index: 1, cap: 'second' },
      ],
    },
    { id: 'story-b', title: 'Story B', beats: [{ index: 0, cap: 'only one' }] },
  ];
}

function enforcementJourneys() {
  return [
    {
      id: 'journey-x',
      title: 'Journey X',
      beats: [
        { id: 'jx-1', title: 'JX One' },
        { id: 'jx-2', title: 'JX Two' },
        { id: 'jx-3', title: 'JX Three (declared, never run)' },
      ],
    },
  ];
}

function enforcementRunOrder(): [string, string][] {
  return [
    ['journey-x', 'jx-1'],
    ['journey-x', 'jx-2'],
  ];
}

/** A registry entry for story-a that produces zero errors on its own. */
function validEntryA() {
  return {
    story: 'story-a',
    batch: 'A' as const,
    port: { journey: 'journey-x', beats: ['jx-1', 'jx-2'] },
    excluded: null,
  };
}

/** A registry entry for story-b that produces zero errors on its own. */
function validEntryB() {
  return {
    story: 'story-b',
    batch: null,
    port: null,
    excluded: { reason: 'superseded', decision: 'ADR-1' },
  };
}

function deriveEnforcement(registry: unknown[]) {
  return deriveParity({
    registry: registry as any,
    mockupStories: enforcementMockupStories(),
    journeys: enforcementJourneys(),
    runOrder: enforcementRunOrder(),
  });
}

test('deriveParity rule 1: a registry entry whose story is not a mockup story id', () => {
  const registry = [
    validEntryA(),
    validEntryB(),
    { story: 'story-ghost', batch: 'A' as const, port: null, excluded: null },
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-ghost')));
});

test('deriveParity rule 2: a mockup story with no registry entry', () => {
  const registry = [validEntryA()]; // story-b's entry is missing
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-b')));
});

test('deriveParity rule 3: duplicate story values in the registry', () => {
  const registry = [
    validEntryA(),
    { ...validEntryA(), port: null, batch: 'B' as const },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 4: an entry with BOTH port and excluded set', () => {
  const registry = [
    { ...validEntryA(), excluded: { reason: 'r', decision: 'd' } },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 5: excluded with a missing/empty reason, or missing/empty decision', () => {
  const emptyReason = deriveEnforcement([
    validEntryA(),
    { ...validEntryB(), excluded: { reason: '', decision: 'ADR-1' } },
  ]);
  assert.ok(emptyReason.errors.length > 0);
  assert.ok(emptyReason.errors.some((e) => e.includes('story-b')));

  const emptyDecision = deriveEnforcement([
    validEntryA(),
    { ...validEntryB(), excluded: { reason: 'superseded', decision: '' } },
  ]);
  assert.ok(emptyDecision.errors.length > 0);
  assert.ok(emptyDecision.errors.some((e) => e.includes('story-b')));
});

test('deriveParity rule 6: a non-excluded entry whose batch is missing or not one of A-F', () => {
  const missingBatch = deriveEnforcement([{ ...validEntryA(), batch: null }, validEntryB()]);
  assert.ok(missingBatch.errors.length > 0);
  assert.ok(missingBatch.errors.some((e) => e.includes('story-a')));

  const badBatch = deriveEnforcement([{ ...validEntryA(), batch: 'Z' as any }, validEntryB()]);
  assert.ok(badBatch.errors.length > 0);
  assert.ok(badBatch.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 7: an excluded entry whose batch is not null', () => {
  const registry = [validEntryA(), { ...validEntryB(), batch: 'A' as const }];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-b')));
});

test('deriveParity rule 8: port.journey names a journey id that does not exist', () => {
  const registry = [
    { ...validEntryA(), port: { journey: 'journey-nonexistent', beats: ['jx-1', 'jx-2'] } },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 9: port.beats.length does not equal the mockup beat count', () => {
  const registry = [
    { ...validEntryA(), port: { journey: 'journey-x', beats: ['jx-1'] } }, // story-a has 2 mockup beats
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 10: a string BeatRef that is not a beat id of port.journey', () => {
  const registry = [
    { ...validEntryA(), port: { journey: 'journey-x', beats: ['jx-1', 'jx-nonexistent'] } },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 11: a string BeatRef is a real journey beat but absent from RUN_ORDER', () => {
  // jx-3 is declared on journey-x's beats but enforcementRunOrder() never runs it.
  const registry = [
    { ...validEntryA(), port: { journey: 'journey-x', beats: ['jx-1', 'jx-3'] } },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0);
  assert.ok(parity.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 12: an object BeatRef with a missing/empty excluded or decision', () => {
  const emptyExcluded = deriveEnforcement([
    { ...validEntryA(), port: { journey: 'journey-x', beats: ['jx-1', { excluded: '', decision: 'ADR-2' }] } },
    validEntryB(),
  ]);
  assert.ok(emptyExcluded.errors.length > 0);
  assert.ok(emptyExcluded.errors.some((e) => e.includes('story-a')));

  const emptyDecision = deriveEnforcement([
    { ...validEntryA(), port: { journey: 'journey-x', beats: ['jx-1', { excluded: 'cut', decision: '' }] } },
    validEntryB(),
  ]);
  assert.ok(emptyDecision.errors.length > 0);
  assert.ok(emptyDecision.errors.some((e) => e.includes('story-a')));
});

test('deriveParity rule 13 (BLOCKER): a repeated real beat id in port.beats is not ported cleanly', () => {
  // Copy-paste typo repro: 2 mockup beats, but the same real beat id twice —
  // mockup beat index 1 has no real counterpart, and jx-2 is never referenced.
  const registry = [
    { ...validEntryA(), port: { journey: 'journey-x', beats: ['jx-1', 'jx-1'] } },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.ok(parity.errors.length > 0, 'a repeated beat ref must produce at least one error');
  assert.ok(parity.errors.some((e) => e.includes('story-a') && e.includes('jx-1')));
  const entryA = parity.entries.find((e) => e.story === 'story-a');
  assert.ok(entryA);
  assert.notEqual(entryA!.status, 'ported');
});

test('deriveParity rule 13 guard: distinct string BeatRefs still pass cleanly (no over-correction)', () => {
  const registry = [validEntryA(), validEntryB()]; // beats: ['jx-1', 'jx-2'] — all distinct
  const parity = deriveEnforcement(registry);
  assert.deepEqual(parity.errors, []);
  const entryA = parity.entries.find((e) => e.story === 'story-a');
  assert.equal(entryA!.status, 'ported');
});

test('deriveParity rule 13 guard: excluded object BeatRefs are exempt from the uniqueness rule', () => {
  const registry = [
    {
      ...validEntryA(),
      port: {
        journey: 'journey-x',
        beats: [
          { excluded: 'cut in trim', decision: 'ADR-1' },
          { excluded: 'cut in trim', decision: 'ADR-1' }, // identical content, twice — legitimate
        ],
      },
    },
    validEntryB(),
  ];
  const parity = deriveEnforcement(registry);
  assert.deepEqual(parity.errors, []);
  const entryA = parity.entries.find((e) => e.story === 'story-a');
  assert.equal(entryA!.status, 'ported');
  assert.equal(entryA!.excludedBeatCount, 2);
  assert.equal(entryA!.portedBeatCount, 0);
});

// ── deriveParity rule 14: port.beats that is not an array ───────────────────
//
// One shared checker: must not throw, must contribute EXACTLY one error
// naming the story id and "not an array", and the entry must read as pending
// with zero ported/excluded beats.

function assertNonArrayBeatsIsOneCleanError(beats: unknown, label: string) {
  const registry = [{ ...validEntryA(), port: { journey: 'journey-x', beats } }, validEntryB()];
  let parity: ReturnType<typeof deriveEnforcement> | undefined;
  assert.doesNotThrow(() => {
    parity = deriveEnforcement(registry);
  }, `port.beats as ${label} must not throw`);
  assert.equal(parity!.errors.length, 1, `port.beats as ${label} must yield exactly one error`);
  assert.ok(parity!.errors[0].includes('story-a'));
  assert.match(parity!.errors[0], /not an array/i);
  const entryA = parity!.entries.find((e) => e.story === 'story-a');
  assert.equal(entryA!.status, 'pending');
  assert.equal(entryA!.portedBeatCount, 0);
  assert.equal(entryA!.excludedBeatCount, 0);
}

test('deriveParity rule 14: port.beats as a plain object', () => {
  assertNonArrayBeatsIsOneCleanError({ 0: 'jx-1', 1: 'jx-2' }, 'a plain object');
});

test('deriveParity rule 14: port.beats as a string', () => {
  assertNonArrayBeatsIsOneCleanError('jx-1jx-2', 'a string');
});

test('deriveParity rule 14: port.beats as a number', () => {
  assertNonArrayBeatsIsOneCleanError(5, 'a number');
});

// ── formatParityReport ───────────────────────────────────────────────────

test('formatParityReport: contains every story id, its status, and the derived counts', () => {
  const parity = {
    entries: [
      {
        story: 'story-a',
        title: 'Story A',
        status: 'ported' as const,
        batch: 'A' as const,
        journey: 'journey-x',
        mockupBeatCount: 2,
        portedBeatCount: 2,
        excludedBeatCount: 0,
        note: undefined,
      },
      {
        story: 'story-b',
        title: 'Story B',
        status: 'excluded' as const,
        batch: null,
        journey: null,
        mockupBeatCount: 1,
        portedBeatCount: 0,
        excludedBeatCount: 1,
        note: 'superseded',
      },
      {
        story: 'story-c',
        title: 'Story C',
        status: 'pending' as const,
        batch: 'B' as const,
        journey: null,
        mockupBeatCount: 1,
        portedBeatCount: 0,
        excludedBeatCount: 0,
        note: undefined,
      },
    ],
    counts: { total: 3, ported: 1, pending: 1, excluded: 1 },
    errors: [],
  };

  const report = formatParityReport(parity);

  assert.match(report, /story-a/);
  assert.match(report, /ported/);
  assert.match(report, /story-b/);
  assert.match(report, /excluded/);
  assert.match(report, /story-c/);
  assert.match(report, /pending/);
  assert.match(report, /3/); // total
});

// =============================================================================
// Group 2 — the REAL committed data (CI-enforced contract)
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = dirname(__filename);
const REPO_ROOT = join(SCRIPTS_DIR, '..');
const MOCKUP_SOURCE_PATH = join(REPO_ROOT, 'mockups', 'studio-endstate-v2', 'journeys-data.jsx');

function realMockupSource(): string {
  return readFileSync(MOCKUP_SOURCE_PATH, 'utf8');
}

test('real mockup source parses to exactly 27 stories', () => {
  const stories = parseMockupStories(realMockupSource());
  assert.equal(stories.length, 27);
});

test('registry <-> mockup is a bijection: identical id sets, no duplicates on either side', () => {
  const stories = parseMockupStories(realMockupSource());
  const mockupIds = stories.map((s) => s.id);
  const registryIds = STORY_REGISTRY.map((e) => e.story);

  const mockupSet = new Set(mockupIds);
  const registrySet = new Set(registryIds);
  assert.equal(mockupSet.size, mockupIds.length, 'mockup story ids must be unique');
  assert.equal(registrySet.size, registryIds.length, 'registry story ids must be unique');

  const missingFromRegistry = mockupIds.filter((id) => !registrySet.has(id));
  const extraInRegistry = registryIds.filter((id) => !mockupSet.has(id));
  assert.deepEqual(missingFromRegistry, [], 'every mockup story must have a registry entry');
  assert.deepEqual(extraInRegistry, [], 'every registry entry must reference a real mockup story');
});

test('deriveParity over the REAL registry/mockup/journeys/runOrder reports zero errors', () => {
  const stories = parseMockupStories(realMockupSource());
  const parity = deriveParity({
    registry: STORY_REGISTRY,
    mockupStories: stories,
    journeys: JOURNEYS,
    runOrder: RUN_ORDER,
  });
  assert.deepEqual(parity.errors, []);
});

test('every real entry has a disposition and counts.total matches the parsed mockup story count', () => {
  const stories = parseMockupStories(realMockupSource());
  const parity = deriveParity({
    registry: STORY_REGISTRY,
    mockupStories: stories,
    journeys: JOURNEYS,
    runOrder: RUN_ORDER,
  });

  for (const entry of parity.entries) {
    assert.ok(
      entry.status === 'ported' || entry.status === 'pending' || entry.status === 'excluded',
      `unexpected status for ${entry.story}: ${entry.status}`,
    );
  }
  assert.equal(parity.counts.total, stories.length);
});

test('every real excluded entry carries a non-empty reason and decision reference', () => {
  for (const entry of STORY_REGISTRY) {
    if (entry.excluded) {
      assert.ok(
        typeof entry.excluded.reason === 'string' && entry.excluded.reason.length > 0,
        `${entry.story}: excluded.reason must be a non-empty string`,
      );
      assert.ok(
        typeof entry.excluded.decision === 'string' && entry.excluded.decision.length > 0,
        `${entry.story}: excluded.decision must be a non-empty string`,
      );
    }
  }
});

test('every real non-excluded entry batch is one of WAVE5_BATCHES', () => {
  for (const entry of STORY_REGISTRY) {
    if (!entry.excluded) {
      assert.ok(
        (WAVE5_BATCHES as readonly string[]).includes(entry.batch as string),
        `${entry.story}: batch ${String(entry.batch)} is not in WAVE5_BATCHES`,
      );
    }
  }
});

test('real counts are derived: ported + pending + excluded === total', () => {
  const stories = parseMockupStories(realMockupSource());
  const parity = deriveParity({
    registry: STORY_REGISTRY,
    mockupStories: stories,
    journeys: JOURNEYS,
    runOrder: RUN_ORDER,
  });
  const { total, ported, pending, excluded } = parity.counts;
  assert.equal(ported + pending + excluded, total);
});

// ── parseMockupStories: must fail fast, not hang ────────────────────────────
//
// Placed LAST and deliberately isolated: against the current implementation
// (vm.runInContext called with no `timeout`), an infinite loop in the source
// hangs the process forever — there is no way for this test itself to time
// out a synchronous, non-yielding V8 loop from JS. Once the implementation
// passes a short `timeout` to vm.runInContext, V8 force-terminates the
// script and this throws promptly; today it hangs, which is the defect.

test('parseMockupStories: an infinite loop in the source throws promptly, it does not hang', () => {
  assert.throws(() => parseMockupStories('while (true) {}'), Error);
});
