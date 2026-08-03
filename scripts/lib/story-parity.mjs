/**
 * story-parity — R7-02-F3 story-beat parity derivation.
 *
 * Why this exists: the studio end-state mockup
 * (mockups/studio-endstate-v2/journeys-data.jsx) declares 27 scripted user
 * stories, each a stand-in for what the real product should demonstrate.
 * Real UI journeys live in scripts/journeys/ (JOURNEYS + RUN_ORDER). A
 * committed registry (scripts/journeys/story-registry.mjs, another WI's
 * deliverable) maps each mockup story to a disposition: ported to a real
 * journey beat-for-beat, or deliberately excluded with a decision reference.
 *
 * This module derives the parity view from those three real sources —
 * nothing here is hand-maintained. No stored counts, no stored status: every
 * number in the output is computed from the registry + mockup + journey
 * harness each time it runs, so the view can never silently drift from
 * reality. All functions are pure: none mutate their inputs, and importing
 * this module has no side effects.
 *
 * Exports: {@link parseMockupStories}, {@link indexJourneyBeats},
 * {@link deriveParity}, {@link formatParityReport}.
 */
import vm from 'node:vm';

const VALID_BATCHES = new Set(['A', 'B', 'C', 'D', 'E', 'F']);

/**
 * @typedef {{ index: number, cap: string }} MockupBeat
 * @typedef {{ id: string, title: string, beats: MockupBeat[] }} MockupStory
 * @typedef {{ id: string, title: string, beatIds: Set<string>, runOrderBeatIds: Set<string> }} JourneyIndexEntry
 * @typedef {string | { excluded: string, decision: string }} BeatRef
 * @typedef {{
 *   story: string,
 *   batch: 'A'|'B'|'C'|'D'|'E'|'F'|null,
 *   port: { journey: string, beats: BeatRef[] } | null,
 *   excluded: { reason: string, decision: string } | null,
 *   note?: string,
 * }} RegistryEntry
 * @typedef {{
 *   story: string, title: string, status: 'ported'|'pending'|'excluded',
 *   batch: 'A'|'B'|'C'|'D'|'E'|'F'|null, journey: string|null,
 *   mockupBeatCount: number, portedBeatCount: number, excludedBeatCount: number,
 *   note: string|null,
 * }} ParityEntry
 * @typedef {{ entries: ParityEntry[], counts: { total: number, ported: number, pending: number, excluded: number }, errors: string[] }} Parity
 */

/**
 * Parse the mockup source (mockups/studio-endstate-v2/journeys-data.jsx) into
 * a normalized array of stories, in declaration order.
 *
 * The real file declares `const JOURNEYS = { ... };` as a lexical binding
 * (not a global) and ends with `Object.assign(window, { JOURNEYS });`,
 * referencing a bare `window` that does not exist under Node. We evaluate the
 * source in a fresh `vm` context seeded with a `window` stub object, then
 * append a capture statement (`window.__STORY_PARITY_CAPTURE__ = JOURNEYS;`)
 * so the lexical binding is recoverable even though it never becomes a
 * context global itself.
 *
 * @param {string} source raw file contents
 * @returns {MockupStory[]}
 */
export function parseMockupStories(source) {
  const context = { window: {} };
  vm.createContext(context);
  const script = `${source}\nwindow.__STORY_PARITY_CAPTURE__ = JOURNEYS;\n`;
  try {
    vm.runInContext(script, context, { filename: 'journeys-data.jsx' });
  } catch (err) {
    throw new Error(`parseMockupStories: source failed to evaluate: ${err.message}`);
  }

  const journeys = context.window.__STORY_PARITY_CAPTURE__;
  if (journeys === undefined || journeys === null || typeof journeys !== 'object' || Array.isArray(journeys)) {
    throw new Error('parseMockupStories: JOURNEYS is missing or not a plain object');
  }

  const ids = Object.keys(journeys);
  if (ids.length === 0) {
    throw new Error('parseMockupStories: JOURNEYS has zero stories');
  }

  return ids.map((id) => {
    const raw = journeys[id];
    if (typeof raw?.title !== 'string' || raw.title.length === 0) {
      throw new Error(`parseMockupStories: story "${id}" has no non-empty title`);
    }
    if (!Array.isArray(raw?.steps) || raw.steps.length === 0) {
      throw new Error(`parseMockupStories: story "${id}" has no non-empty steps array`);
    }
    // `raw.steps` is an array from the vm context's OWN realm (its own Array
    // intrinsics), not this module's. Array.prototype.map on it would create
    // its result via that foreign Array constructor too (species creation
    // reads the source array's own .constructor) — invisible under `typeof`
    // but caught hard by assert.deepStrictEqual as a cross-realm mismatch.
    // `Array.from` called on THIS realm's Array global always builds a
    // same-realm array regardless of the source's realm, so use that instead
    // of `raw.steps.map(...)`.
    const beats = Array.from(raw.steps, (step, index) => ({
      index,
      cap: typeof step?.cap === 'string' ? step.cap : '',
    }));
    return { id, title: raw.title, beats };
  });
}

/**
 * Index the real journey harness (JOURNEYS + RUN_ORDER from
 * scripts/journeys/index.mjs) into a lookup by journey id, recording which
 * beats are declared and which actually execute.
 *
 * @param {{ id: string, title: string, beats: { id: string, title: string }[] }[]} journeys
 * @param {[string, string][]} runOrder flat [journeyId, beatId] execution sequence
 * @returns {Map<string, JourneyIndexEntry>}
 */
export function indexJourneyBeats(journeys, runOrder) {
  const index = new Map();
  for (const journey of journeys) {
    if (typeof journey?.id !== 'string' || journey.id.length === 0) {
      throw new Error('indexJourneyBeats: a journey has no string id');
    }
    if (index.has(journey.id)) {
      throw new Error(`indexJourneyBeats: duplicate journey id "${journey.id}"`);
    }
    const beatIds = new Set();
    for (const beat of journey.beats ?? []) {
      if (typeof beat?.id !== 'string' || beat.id.length === 0) {
        throw new Error(`indexJourneyBeats: journey "${journey.id}" has a beat with no string id`);
      }
      beatIds.add(beat.id);
    }
    index.set(journey.id, {
      title: journey.title,
      beatIds,
      runOrderBeatIds: new Set(),
    });
  }

  for (const [journeyId, beatId] of runOrder) {
    const entry = index.get(journeyId);
    if (!entry) {
      throw new Error(`indexJourneyBeats: runOrder names unknown journey id "${journeyId}"`);
    }
    entry.runOrderBeatIds.add(beatId);
  }

  return index;
}

/**
 * Validate a single registry entry against a mockup story + the journey
 * index, per the 12 enforcement rules. Returns `{ errors, portedBeatCount,
 * excludedBeatCount }` — never throws for content problems (only the
 * caller's inputs — bad mockupStories/journeys/runOrder shape — throw,
 * upstream in parseMockupStories/indexJourneyBeats).
 *
 * @param {RegistryEntry} entry
 * @param {MockupStory} story
 * @param {Map<string, JourneyIndexEntry>} journeyIndex
 * @returns {{ errors: string[], portedBeatCount: number, excludedBeatCount: number }}
 */
function validateEntry(entry, story, journeyIndex) {
  const errors = [];
  const storyId = entry.story;
  const port = entry.port ?? null;
  const excluded = entry.excluded ?? null;
  const batch = entry.batch ?? null;

  // Rule 4: both port and excluded set.
  if (port && excluded) {
    errors.push(`story "${storyId}": has BOTH port and excluded set — pick one`);
  }

  // Rule 5: excluded reason/decision.
  if (excluded) {
    if (typeof excluded.reason !== 'string' || excluded.reason.length === 0) {
      errors.push(`story "${storyId}": excluded.reason is missing or empty`);
    }
    if (typeof excluded.decision !== 'string' || excluded.decision.length === 0) {
      errors.push(`story "${storyId}": excluded.decision is missing or empty`);
    }
  }

  // Rules 6/7: batch discipline.
  if (excluded) {
    // Rule 7: excluded entry's batch must be null.
    if (batch !== null) {
      errors.push(`story "${storyId}": excluded entry must have batch:null, got "${batch}"`);
    }
  } else if (batch === null || !VALID_BATCHES.has(batch)) {
    // Rule 6: non-excluded entry (ported or pending) must carry a valid batch.
    errors.push(`story "${storyId}": non-excluded entry has invalid batch "${batch}" (must be one of A-F)`);
  }

  let portedBeatCount = 0;
  let excludedBeatCount = 0;

  if (port && !excluded) {
    const journeyEntry = journeyIndex.get(port.journey);
    // Rule 8: port.journey must exist.
    if (!journeyEntry) {
      errors.push(`story "${storyId}": port.journey "${port.journey}" does not exist`);
    } else {
      const mockupBeatCount = story.beats.length;
      // Rule 9: one BeatRef per mockup beat.
      if (!Array.isArray(port.beats) || port.beats.length !== mockupBeatCount) {
        errors.push(
          `story "${storyId}": port.beats has ${Array.isArray(port.beats) ? port.beats.length : 'non-array'} ` +
            `entries, expected ${mockupBeatCount} (one per mockup beat)`,
        );
      }
      for (const ref of port.beats ?? []) {
        if (typeof ref === 'string') {
          // Rule 10: string BeatRef must be a real beat of that journey.
          if (!journeyEntry.beatIds.has(ref)) {
            errors.push(`story "${storyId}": beat "${ref}" is not a beat of journey "${port.journey}"`);
            continue;
          }
          // Rule 11: must actually run.
          if (!journeyEntry.runOrderBeatIds.has(ref)) {
            errors.push(
              `story "${storyId}": beat "${ref}" is declared on journey "${port.journey}" but never runs (absent from RUN_ORDER)`,
            );
            continue;
          }
          portedBeatCount += 1;
        } else if (ref && typeof ref === 'object') {
          // Rule 12: object BeatRef must carry non-empty excluded + decision.
          const hasExcluded = typeof ref.excluded === 'string' && ref.excluded.length > 0;
          const hasDecision = typeof ref.decision === 'string' && ref.decision.length > 0;
          if (!hasExcluded || !hasDecision) {
            errors.push(`story "${storyId}": an excluded BeatRef is missing a non-empty excluded/decision field`);
            continue;
          }
          excludedBeatCount += 1;
        } else {
          errors.push(`story "${storyId}": port.beats contains an invalid BeatRef`);
        }
      }
    }
  }

  return { errors, portedBeatCount, excludedBeatCount };
}

/**
 * Derive the full parity view from the four real sources. Never mutates any
 * input. Throws only when `indexJourneyBeats` (or malformed `mockupStories`)
 * would throw; all registry-content problems are reported as entries in
 * `errors` instead.
 *
 * @param {{ registry: RegistryEntry[], mockupStories: MockupStory[], journeys: object[], runOrder: [string, string][] }} params
 * @returns {Parity}
 */
export function deriveParity({ registry, mockupStories, journeys, runOrder }) {
  const journeyIndex = indexJourneyBeats(journeys, runOrder);
  const errors = [];

  // Rule 3: duplicate story values in the registry.
  const seenStoryIds = new Set();
  const duplicateStoryIds = new Set();
  for (const entry of registry) {
    if (seenStoryIds.has(entry.story)) duplicateStoryIds.add(entry.story);
    seenStoryIds.add(entry.story);
  }
  for (const id of duplicateStoryIds) {
    errors.push(`registry: duplicate entry for story "${id}"`);
  }

  const mockupIds = new Set(mockupStories.map((s) => s.id));

  // Rule 1: registry story not a mockup story id.
  for (const entry of registry) {
    if (!mockupIds.has(entry.story)) {
      errors.push(`registry: story "${entry.story}" is not a mockup story id`);
    }
  }

  // Build a first-entry-wins lookup (duplicates already reported above).
  const registryByStory = new Map();
  for (const entry of registry) {
    if (!registryByStory.has(entry.story)) registryByStory.set(entry.story, entry);
  }

  const entries = mockupStories.map((story) => {
    const entry = registryByStory.get(story.id);

    // Rule 2: mockup story with no registry entry.
    if (!entry) {
      errors.push(`mockup story "${story.id}" has no registry entry`);
      return {
        story: story.id,
        title: story.title,
        status: /** @type {'pending'} */ ('pending'),
        batch: null,
        journey: null,
        mockupBeatCount: story.beats.length,
        portedBeatCount: 0,
        excludedBeatCount: 0,
        note: null,
      };
    }

    const { errors: entryErrors, portedBeatCount, excludedBeatCount } = validateEntry(entry, story, journeyIndex);
    errors.push(...entryErrors);

    const isExcluded = Boolean(entry.excluded);
    const isPorted = Boolean(entry.port) && !isExcluded && entryErrors.length === 0;
    const status = isExcluded ? 'excluded' : isPorted ? 'ported' : 'pending';

    return {
      story: story.id,
      title: story.title,
      status,
      batch: entry.batch ?? null,
      journey: isPorted ? entry.port.journey : null,
      mockupBeatCount: story.beats.length,
      portedBeatCount,
      excludedBeatCount,
      note: entry.note ?? null,
    };
  });

  const counts = entries.reduce(
    (acc, e) => {
      acc.total += 1;
      acc[e.status] += 1;
      return acc;
    },
    { total: 0, ported: 0, pending: 0, excluded: 0 },
  );

  return { entries, counts, errors };
}

/**
 * Render a human-readable parity report. Contains every story id, its
 * derived status, and the derived counts; error lines when present. No
 * colour codes.
 * @param {Parity} parity
 * @returns {string}
 */
export function formatParityReport(parity) {
  const { entries, counts, errors } = parity;
  const lines = [];
  lines.push('Story-beat parity report');
  lines.push('=========================');
  for (const e of entries) {
    const journeyPart = e.journey ? ` -> ${e.journey}` : '';
    const batchPart = e.batch ? ` [batch ${e.batch}]` : '';
    const beatPart = ` (${e.portedBeatCount}/${e.mockupBeatCount} ported, ${e.excludedBeatCount} excluded)`;
    const notePart = e.note ? ` note: ${e.note}` : '';
    lines.push(`  ${e.story}: ${e.status}${batchPart}${journeyPart}${beatPart}${notePart}`);
  }
  lines.push('');
  lines.push(
    `Counts: total=${counts.total} ported=${counts.ported} pending=${counts.pending} excluded=${counts.excluded}`,
  );
  if (errors.length > 0) {
    lines.push('');
    lines.push(`Errors (${errors.length}):`);
    for (const err of errors) lines.push(`  - ${err}`);
  }
  return lines.join('\n');
}
