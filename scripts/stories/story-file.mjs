/**
 * story-file.mjs — loading and validating a story.
 *
 * A story file is external input: authored with the operator in a separate
 * session (park point H6), by someone who is not reading this module. So it is
 * validated at the boundary, fails fast, and names the offending field with
 * its dotted path.
 *
 * Nothing is defaulted. A story that forgot to declare `budget_usd` is an
 * error, never a costless story — silently defaulting it is how an unapproved
 * real spawn reaches the SDK.
 */

const DOC_KINDS = ['tutorial', 'how-to'];

function fail(field, why) {
  throw new Error(`story is invalid — ${field}: ${why}`);
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
}

/**
 * Validate a raw story object and return a deep-frozen structural copy.
 * Never returns, and never mutates, the input.
 */
export function validateStory(raw) {
  if (raw === null || typeof raw !== 'object') fail('story', 'expected an object');

  requireNonEmptyString(raw.id, 'id');
  // The id is interpolated into paths that are later removed recursively, and
  // it names the generated doc and demo dir. Validate its shape HERE, with the
  // field named, rather than letting the sweep's own guard abort the whole
  // batch from inside a loop that is not per-story.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.id) || raw.id.includes('..')) {
    fail('id', `expected a single path segment of [A-Za-z0-9._-], got ${JSON.stringify(raw.id)}`);
  }

  const g = raw.ground;
  if (g === null || typeof g !== 'object') fail('ground', 'expected an object');
  requireNonEmptyString(g.project, 'ground.project');
  if (typeof g.realSpawn !== 'boolean') {
    fail('ground.realSpawn', `expected a boolean, got ${JSON.stringify(g.realSpawn)}`);
  }
  if (typeof g.budget_usd !== 'number' || !Number.isFinite(g.budget_usd) || g.budget_usd < 0) {
    fail('ground.budget_usd', `expected a finite number >= 0, got ${JSON.stringify(g.budget_usd)}`);
  }

  const d = raw.docs;
  if (d === null || typeof d !== 'object') fail('docs', 'expected an object');
  if (!DOC_KINDS.includes(d.kind)) {
    fail('docs.kind', `expected one of ${DOC_KINDS.join(' | ')}, got ${JSON.stringify(d.kind)}`);
  }
  requireNonEmptyString(d.title, 'docs.title');

  if (!Array.isArray(raw.beats) || raw.beats.length === 0) {
    fail('beats', 'expected a non-empty array');
  }

  const beats = raw.beats.map((b, i) => {
    const at = `beats[${i}]`;
    if (b === null || typeof b !== 'object') fail(at, 'expected an object');
    requireNonEmptyString(b.act, `${at}.act`);
    requireNonEmptyString(b.say, `${at}.say`);

    const e = b.expect;
    if (e === null || typeof e !== 'object') fail(`${at}.expect`, 'expected an object');
    if (typeof e.route !== 'string' || !e.route.startsWith('/')) {
      fail(`${at}.expect.route`, `expected a path-absolute route, got ${JSON.stringify(e.route)}`);
    }
    if (e.data === null || typeof e.data !== 'object' || Object.keys(e.data).length === 0) {
      // A beat asserting nothing can never be red. A story of such beats is
      // green by construction.
      fail(`${at}.expect.data`, 'expected at least one data-* expectation');
    }

    return Object.freeze({
      act: b.act,
      say: b.say,
      expect: Object.freeze({ route: e.route, data: Object.freeze({ ...e.data }) }),
    });
  });

  return Object.freeze({
    id: raw.id,
    ground: Object.freeze({ project: g.project, realSpawn: g.realSpawn, budget_usd: g.budget_usd }),
    docs: Object.freeze({ kind: d.kind, title: d.title }),
    beats: Object.freeze(beats),
  });
}

/** Load a story module from disk and validate it. */
export async function loadStory(absPath) {
  const mod = await import(absPath);
  if (mod.default === undefined) {
    fail('story', `${absPath} has no default export`);
  }
  return validateStory(mod.default);
}
