#!/usr/bin/env node
/**
 * check-request-path-sinks-callers.mjs — the CALLER-COUNT DIMENSION of the
 * request-path-sinks ratchet, split out of check-request-path-sinks.mjs
 * under the 800-line cap (no behaviour change; every export/name is
 * unchanged, only the file it lives in).
 *
 * CALLER-COUNT DIMENSION (SEC-04, bd forge-ebj step 2).
 *
 * The raw-sink ratchet in check-request-path-sinks.mjs keys on (file,
 * RAW-SINK, count). That leaves a systemic hole: a NEW file that only *calls*
 * an already-unguarded shared function defined in a DIFFERENT module — e.g.
 * `readSessionStatus(join(root, reqProject, sid))` — introduces the exact
 * request-derived-path defect while emitting ZERO raw-sink rows of its own,
 * so the raw-sink ratchet stays green. This dimension closes that hole: it
 * counts callers of a fixed, checked-in list of functions that resolve a
 * session dir with NO containment of their own, and fails the moment a NEW
 * reachable caller appears (or an existing file's caller count grows).
 *
 * Keys are the function names; each value records the def module + WHY the
 * function is unguarded — kept a literal a reader can audit in one glance,
 * the same discipline as SINK_NAMES in the sibling file. The def-module note
 * is documentation only; the def file is DETECTED per-file at count time
 * (see countDesignatedCallers), so this dimension works unchanged against a
 * synthetic fixture tree whose def module lives at a different path than the
 * real repo's.
 *
 * Contract for a designated function: it takes a caller-supplied session dir
 * (or bare-joins request-derived segments into one) and performs NO
 * per-segment identity / charset / symlink containment. Every caller must
 * instead route the request-derived project + sessionId through
 * resolveSafeSessionDir(projectsRoot, project, kindDirName, sessionId)
 * (packages/sessions/bridge-studio-sessions.ts → resolveGuardedPath) and hand
 * the GUARDED dir to the reader/writer — never a bare join.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Crude line-based comment filter, kept LOCAL rather than imported from
 *  check-request-path-sinks.mjs to avoid a circular import between the two
 *  (that file imports countDesignatedCallers/DESIGNATED_UNGUARDED_FUNCTIONS
 *  from here). Identical to the sibling copy; see that file's header for the
 *  documented limitation (line-based, not a real parser). */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

export const DESIGNATED_UNGUARDED_FUNCTIONS = {
  readSessionStatus: {
    defModule: 'orchestrator/interactive-session.ts',
    why: 'Reads status.json from a caller-supplied sessionDir; no containment of its own — the dir it is handed must already be resolveSafeSessionDir-guarded.',
  },
  writeSessionStatus: {
    defModule: 'orchestrator/interactive-session.ts',
    why: 'Writes status.json into a caller-supplied sessionDir; same contract as readSessionStatus — the dir must already be guarded.',
  },
  architectSessionDir: {
    defModule: 'apps/forge/ui-bridge.ts',
    why: 'Bare join of projectsRoot + request-derived project + "_architect" + request-derived sessionId; folds untrusted segments into a path with no guard.',
  },
  instructionsSessionDir: {
    defModule: 'packages/sessions/kinds/instructions.ts',
    why: 'Bare join of projectRoot + "_instructions" + request-derived sessionId; no per-segment containment.',
  },
  projectBrainSessionDir: {
    defModule: 'packages/sessions/kinds/project-brain.ts',
    why: 'Bare join of projectRoot + "_project-brain" + request-derived sessionId; no per-segment containment.',
  },
  demoSessionDir: {
    defModule: 'packages/sessions/kinds/demo-builder.ts',
    why: 'Bare join of projectRoot + "_demo" + request-derived sessionId; no per-segment containment.',
  },
  // SEC-04 completeness (bd forge-arch): the architect module was systematically
  // missed by the first pass — three consumers reached architect session dirs
  // through its OWN bespoke reader/builders with no containment. Designating
  // them closes that blind spot: a future reachable caller of any of these now
  // trips the ratchet unless it first routes the request-derived project +
  // sessionId through resolveGuardedPath (per-segment identity + charset +
  // symlink; refuse/skip on ANY escape) and hands the GUARDED dir to the reader.
  readStatus: {
    defModule: 'packages/sessions/kinds/architect.ts',
    why: 'Reads status.json from a caller-supplied architect sessionDir; no containment of its own — the dir it is handed must already be resolveGuardedPath-guarded (GET /api/architect/sessions disclosed an out-of-root status.json through this + a symlinked _architect).',
  },
  sessionPaths: {
    defModule: 'packages/sessions/kinds/architect-plan.ts',
    why: 'Bare resolve(projectRoot, "_architect", sessionId) — folds a request-derived sessionId into a session-dir path with no per-segment containment; callers must guard "_architect" + sessionId as their own segments before reading through it (the architect runner leg read an out-of-root status.json through this).',
  },
  _architectSessionDir: {
    defModule: 'packages/flows/bridge-studio-runs.ts',
    why: 'Bare join of projectsRoot + request-derived project + "_architect" + request-derived sessionId (the plan-verdict routes\' private copy); folds untrusted segments into a path with no guard — a valid-charset project+sessionId still resolves through a symlinked _architect (AT-47).',
  },
  _readStatus: {
    defModule: 'packages/flows/bridge-studio-runs.ts',
    why: 'Reads (and its sibling _writeStatus mutates) status.json from a caller-supplied architect sessionDir (the plan-verdict routes\' private copy); no containment of its own — the dir must already be guarded.',
  },
};

/** Sink-token suffix that namespaces a caller-count row so it flows through
 *  compareBaseline / formatBaseline / parseBaseline unchanged (the token is a
 *  single `\\S+` field, no spaces). */
export const CALLER_SINK_SUFFIX = '@caller';

/** Per designated function: `defRe` matches its DEFINITION (`function F(` /
 *  `function F<` — covers `export function F`). A file that matches `defRe` is
 *  that fn's own def file and is SKIPPED for that fn, because the definition
 *  line itself matches the call patterns and would otherwise self-count.
 *  Detection is per-file so a synthetic fixture whose def module differs from
 *  the real repo works too.
 *
 *  THERE IS NO PRECOMPILED CALL REGEX HERE, deliberately. It used to carry a
 *  `callRe` for the bare name; 7.6.68 moved call matching into
 *  `callRegexesFor` below, which must be built PER FILE because the set of
 *  names a call site may use — aliases, namespace imports — is a property of
 *  that file's imports, not of the designated function. Leaving a dead
 *  `callRe` here would be §15.534's own shape one level along: a live-looking
 *  regex with an explanatory comment, describing matching that no longer
 *  happens (C's review of 7.6.68). */
const DESIGNATED_MATCHERS = Object.keys(DESIGNATED_UNGUARDED_FUNCTIONS).map((name) => ({
  name,
  defRe: new RegExp(`(?<![.\\w$])function\\s+${name}\\s*[<(]`),
}));

/** Caller-count enumeration. Returns a sorted array of { file, sink, count }
 *  rows — one per (reachable file, designated fn) pair with count > 0 — where
 *  sink is `${fnName}@caller`. Skips each fn's own def file. Comment lines are
 *  filtered by the same crude line-based filter as the raw-sink pass; the
 *  def-file detection runs over the whole file text (a `function F(` inside a
 *  block comment would falsely mark a file as a def file and under-count its
 *  callers — the same crude-comment-filter limitation the header documents).
 *
 *  These rows are DELIBERATELY NOT merged into countSinks/analyze output: the
 *  raw-sink `rows` must stay caller-free so a new pure-caller file emits no
 *  per-file raw-sink row. They are combined with the sink rows only inside
 *  runCheck, for the baseline write and the compareBaseline comparison. */
/**
 * Every NAME a file can call `fn` by — `forge-8vfn.7.6.68`, T1 ruling 987.
 *
 * THE MATCHER MATCHES THE CALL SITE, AND AN IMPORT RENAMES THE CALL SITE.
 * Measured, all three forms, against this very check:
 *
 *     writeSessionStatus(dir, …)                        FAIL rc=1   caught
 *     import { writeSessionStatus as X }; X(dir, …)      rc=0        EVADED
 *     import * as NS; NS.writeSessionStatus(dir, …)      rc=0        EVADED
 *
 * Neither evasion needs intent. `import { X as Y }` is what people write to
 * resolve a name collision, and a namespace import is an ordinary style — and
 * `(?<![.\w$])` excludes dotted calls BY DESIGN, so the namespace form is
 * doubly invisible. §15.534: a guard that matches a call-site name is evaded by
 * a rename, and renames happen for unrelated reasons.
 *
 * OVER-MATCHING IS THE SAFE DIRECTION AND IS DELIBERATE. Any import binding the
 * designated name counts, without checking the specifier resolves to the
 * declaring module: a same-named export from elsewhere would raise a row that a
 * human then dismisses. For a containment ratchet a false positive is a
 * conversation and a false negative is a hole.
 */
function localNamesFor(text, name) {
  const locals = new Set([name]);
  // `import { a, writeSessionStatus as w } from '…'` / `export { … } from '…'`
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s*\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const [imported, local] = part.split(/\s+as\s+/).map((x) => x.trim());
      if (imported === name && local) locals.add(local);
    }
  }
  return [...locals];
}

function namespaceLocals(text) {
  return [...text.matchAll(/(?:^|\n)\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)].map((m) => m[1]);
}

/** Call-site regexes for one designated name in one file: the bare name, every
 *  alias it was imported under, and `<ns>.<name>` for every namespace import. */
function callRegexesFor(text, name) {
  const res = localNamesFor(text, name).map((local) => new RegExp(`(?<![.\\w$])${local}\\s*\\(`, 'g'));
  for (const ns of namespaceLocals(text)) {
    res.push(new RegExp(`(?<![.\\w$])${ns}\\.${name}\\s*\\(`, 'g'));
  }
  return res;
}

export function countDesignatedCallers(root, reachableFiles) {
  const rows = [];
  for (const relFile of reachableFiles) {
    const absFile = join(root, relFile);
    if (!existsSync(absFile)) continue;
    const text = readFileSync(absFile, 'utf8');
    const lines = text.split('\n');
    for (const { name, defRe } of DESIGNATED_MATCHERS) {
      if (defRe.test(text)) continue; // this fn's own def file — skip (self-match guard)
      const regexes = callRegexesFor(text, name);
      let n = 0;
      for (const line of lines) {
        if (isCommentLine(line)) continue;
        for (const re of regexes) {
          re.lastIndex = 0;
          while (re.exec(line)) n += 1;
        }
      }
      if (n > 0) rows.push({ file: relFile, sink: `${name}${CALLER_SINK_SUFFIX}`, count: n });
    }
  }
  rows.sort((a, b) => (a.file === b.file ? a.sink.localeCompare(b.sink) : a.file.localeCompare(b.file)));
  return rows;
}
