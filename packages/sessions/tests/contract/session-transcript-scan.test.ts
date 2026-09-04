import { fixtureFinding, kbCleanupDescriptor, writeCleanupPlanFile } from './test-fixtures/cleanup-plan-fixtures.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveSessionTranscript, deriveSessionArtifact } from '../../studio/session-transcript.ts';

import { architectDescriptor, authoringDescriptor, instructionsDescriptor, makeTmpDir, okTurns, parseManifest, projectBrainDescriptor, writeJson } from './test-fixtures/transcript-test-helpers.ts';

// ===========================================================================
// R4-19-F2, cleanupScan (ORCHESTRATOR RULING) — the positive control for
// 'cleared'. The block immediately above (R4-19-F2-fix) correctly proved
// 'cleared' is UNREACHABLE under `deriveCleanupPlan`'s old 3-argument shape
// (sessionDir, label, cleanupFindings) and pinned every unmatched target to
// 'unknown' — right, because absence from cleanupFindings is not evidence of
// a genuine scan without also knowing what region the scan covered. That
// correctly leaves a hole: 'cleared' must become reachable, or the product
// can never show an operator that an approved repair actually landed.
//
// `deriveSessionArtifact` gains one ADDITIVE-OPTIONAL field (mirrors
// `contractStages`'s own disclose-not-park threading, ADR 042):
//
//   cleanupScan?: { readonly forgeRoot: string; readonly brainDir: string }
//
// `forgeRoot` is the absolute path repo-relative action targets resolve
// against; `brainDir` is the absolute directory the caller's
// `cleanupFindings` were actually scanned from (cli/bridge-studio-
// sessions.ts resolves this via `resolveKbBrainDir`). Derived semantics:
//
//   'open'    — a live finding matches the action (kind + target, both
//               normalized to absolute).
//   'cleared' — no live finding matches, cleanupScan IS supplied, AND the
//               action's normalized target lies INSIDE brainDir. Absence is
//               then real evidence: the region was scanned and came back
//               clean.
//   'unknown' — no live finding matches and coverage cannot be established:
//               cleanupScan absent, OR the target resolves OUTSIDE
//               brainDir.
//
// This block does not touch (weaken/delete/renumber) any test in the block
// above — those 6 reds belong to the implementer landing `cleanupScan`
// end-to-end; every test below is a NEW, separate red proving the positive
// path once that lands.
// ===========================================================================

describe('deriveSessionArtifact — cleanup-plan cleared reachability (R4-19-F2, cleanupScan scanned-domain signal — ORCHESTRATOR RULING)', () => {
  const CLEARED_TARGET_RELATIVE = 'brain/forge-dev/themes/foo.md';

  /** Builds a real `forgeRoot`/`brainDir` on disk (`<forgeRoot>/brain/
   *  forge-dev`, containing the real target file at
   *  `themes/foo.md`) plus a session dir whose plan has ONE action targeting
   *  it, repo-relative. Used by SCAN-1, SCAN-2, and SCAN-5 so their content
   *  is identical — only the tmp-dir paths themselves (arbitrary
   *  infrastructure `mkdtempSync` hands out) legitimately differ between
   *  calls. */
  function buildClearedFixture(): { sessionDir: string; forgeRoot: string; brainDir: string } {
    const forgeRoot = makeTmpDir('cleanupplan-scan-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'themes', 'foo.md'), '# foo\n', 'utf8');
    const sessionDir = makeTmpDir('cleanupplan-scan-session-');
    writeCleanupPlanFile(sessionDir, `- [edge.dangling] ${CLEARED_TARGET_RELATIVE} — repoint the related_themes entry.\n`);
    return { sessionDir, forgeRoot, brainDir };
  }

  it('R4-19-F2 SCAN-1 (POSITIVE CONTROL — "cleared" IS reachable): a target inside brainDir, cleanupScan supplied, and NO matching finding reports "cleared"', () => {
    const { sessionDir, forgeRoot, brainDir } = buildClearedFixture();
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'cleared',
      'a target inside the scanned brainDir with NO matching live finding must report "cleared" — this is the repair-landed story: an implementation that leaves "cleared" permanently unreachable (e.g. never widening the join past open|unknown even once cleanupScan is threaded through) fails here',
    );
    assert.equal(artifact.openFindingCount, 0, 'a "cleared" action must never be counted by openFindingCount');
  });

  it('R4-19-F2 SCAN-2 ("cleared" requires coverage): byte-identical inputs to SCAN-1 but with cleanupScan OMITTED report "unknown", never "cleared"', () => {
    const { sessionDir } = buildClearedFixture();
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      // cleanupScan deliberately OMITTED — everything else matches SCAN-1's fixture verbatim.
    }) as { actions: Array<{ target: string; state: string }> };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'unknown',
      'omitting cleanupScan must fall back to "unknown" — an implementation that treats an unmatched action as "repair landed" whenever cleanupScan simply happens to be missing (never actually gating on its presence) is exactly the fail-open shortcut this kills',
    );
  });

  it('R4-19-F2 SCAN-3 (outside the scanned region): cleanupScan IS supplied, but the action targets a file OUTSIDE brainDir (another KB\'s brain dir) with no matching finding — reports "unknown", not "cleared"', () => {
    const forgeRoot = makeTmpDir('cleanupplan-scan3-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    const otherKbTarget = 'brain/cycles/themes/bar.md';
    mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'bar.md'), '# bar\n', 'utf8');

    const sessionDir = makeTmpDir('cleanupplan-scan3-session-');
    writeCleanupPlanFile(sessionDir, `- [theme.duplicate] ${otherKbTarget} — merge into baz.md, the richer survivor.\n`);

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      cleanupScan: { forgeRoot, brainDir }, // this call only scanned brain/forge-dev, NOT brain/cycles
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
    };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'unknown',
      'a target outside the scanned brainDir must stay "unknown" even though cleanupScan was supplied — an implementation that treats cleanupScan\'s mere PRESENCE as "the whole repo was scanned" (a "supplied means scanned" shortcut that ignores brainDir containment entirely) fails here, wrongly reporting "cleared" for a region the lint never walked',
    );
  });

  it('R4-19-F2 SCAN-4 (mixed plan, all three states in one call): one action open (has a matching finding), one cleared (inside brainDir, no match), one unknown (outside brainDir, no match) — openFindingCount counts ONLY the open one', () => {
    const forgeRoot = makeTmpDir('cleanupplan-scan4-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'themes', 'open-target.md'), '# open\n', 'utf8');
    writeFileSync(join(brainDir, 'themes', 'cleared-target.md'), '# cleared\n', 'utf8');
    mkdirSync(join(forgeRoot, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(forgeRoot, 'brain', 'cycles', 'themes', 'unknown-target.md'), '# unknown\n', 'utf8');

    const OPEN_TARGET = 'brain/forge-dev/themes/open-target.md';
    const CLEARED_TARGET = 'brain/forge-dev/themes/cleared-target.md';
    const UNKNOWN_TARGET = 'brain/cycles/themes/unknown-target.md';

    const sessionDir = makeTmpDir('cleanupplan-scan4-session-');
    writeCleanupPlanFile(
      sessionDir,
      [
        `- [edge.dangling] ${OPEN_TARGET} — fix the dangling edge.`,
        `- [edge.dangling] ${CLEARED_TARGET} — fix the dangling edge.`,
        `- [theme.duplicate] ${UNKNOWN_TARGET} — merge into baz.md, the richer survivor.`,
        '',
      ].join('\n'),
    );

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [fixtureFinding('edge.dangling', join(forgeRoot, OPEN_TARGET))],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 3);
    const byTarget = new Map(artifact.actions.map((a) => [a.target, a.state]));
    assert.equal(byTarget.get(OPEN_TARGET), 'open', 'the action WITH a matching live finding must be open');
    assert.equal(byTarget.get(CLEARED_TARGET), 'cleared', 'the sibling action inside brainDir with NO matching finding must be cleared');
    assert.equal(byTarget.get(UNKNOWN_TARGET), 'unknown', 'the sibling action outside brainDir with NO matching finding must be unknown');
    assert.equal(
      artifact.openFindingCount,
      1,
      'openFindingCount must count ONLY the state==="open" action — an implementation that collapses the three states, or computes the count as "not cleared" (which would wrongly include the unknown action too, giving 2), fails this',
    );
  });

  it('R4-19-F2 SCAN-5 ("cleared" never overrides a real match): an action inside brainDir WITH a matching live finding stays "open" even though cleanupScan is supplied', () => {
    const { sessionDir, forgeRoot, brainDir } = buildClearedFixture();
    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [fixtureFinding('edge.dangling', join(forgeRoot, CLEARED_TARGET_RELATIVE))],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
      openFindingCount: number;
    };

    assert.equal(artifact.actions.length, 1);
    assert.equal(
      artifact.actions[0]!.state,
      'open',
      'a genuine match must win over the "cleared" derivation — an implementation with a precedence inversion (e.g. checking cleanupScan/brainDir-containment BEFORE checking for a matching finding, so "inside the scanned region" short-circuits straight to "cleared") would wrongly report "cleared" here',
    );
    assert.equal(artifact.openFindingCount, 1);
  });

  it('R4-19-F2 SCAN-6 (containment sanity on brainDir — the repo\'s recurring escape shape): a target that textually starts with the brainDir STRING but does not actually resolve inside it must NOT be treated as inside — neither via a literal ".." escape nor a sibling-directory prefix collision', () => {
    const forgeRoot = makeTmpDir('cleanupplan-scan6-root-');
    const brainDir = join(forgeRoot, 'brain', 'forge-dev');
    mkdirSync(brainDir, { recursive: true });

    // Shape 1: `<brainDir>/../elsewhere/x.md` — an ALREADY-ABSOLUTE target
    // (mirrors NORM-2's already-absolute branch, above) whose RAW string
    // textually starts with brainDir, but whose ".." segment, once resolved,
    // lands one level OUTSIDE brainDir (in a sibling "elsewhere" directory
    // under the same parent, brainDir's own ".." — never itself a symlink;
    // this is pure "..''-in-the-string" escape, distinct from AT-6's
    // symlink-escape concern).
    const elsewhereDir = join(forgeRoot, 'brain', 'elsewhere');
    mkdirSync(elsewhereDir, { recursive: true });
    writeFileSync(join(elsewhereDir, 'x.md'), '# elsewhere\n', 'utf8');
    const dotDotEscapeTarget = `${brainDir}/../elsewhere/x.md`;
    assert.ok(
      dotDotEscapeTarget.startsWith(brainDir),
      'arrange: the RAW target must textually start with brainDir — that raw prefix match is exactly what makes a naive (unresolved) containment check wrong',
    );

    // Shape 2: `<brainDir>-sibling/x.md` — a genuinely SIBLING directory
    // (same parent as brainDir, name collision on the prefix only: "…
    // forge-dev-sibling" textually starts with "…forge-dev") that is never
    // nested inside brainDir.
    const siblingDir = `${brainDir}-sibling`;
    mkdirSync(siblingDir, { recursive: true });
    writeFileSync(join(siblingDir, 'x.md'), '# sibling\n', 'utf8');
    const siblingCollisionTarget = `${siblingDir}/x.md`;
    assert.ok(
      siblingCollisionTarget.startsWith(brainDir),
      'arrange: the RAW target must textually start with brainDir — a bare `startsWith(brainDir)` with no trailing-separator guard would wrongly match this sibling-directory collision',
    );

    const sessionDir = makeTmpDir('cleanupplan-scan6-session-');
    writeCleanupPlanFile(
      sessionDir,
      [
        `- [edge.dangling] ${dotDotEscapeTarget} — fix the dangling edge.`,
        `- [edge.dangling] ${siblingCollisionTarget} — fix the dangling edge.`,
        '',
      ].join('\n'),
    );

    const artifact = deriveSessionArtifact({ parseManifest,
      descriptor: kbCleanupDescriptor(),
      sessionDir,
      cleanupFindings: [],
      cleanupScan: { forgeRoot, brainDir },
    } as Parameters<typeof deriveSessionArtifact>[0] & { cleanupScan: { forgeRoot: string; brainDir: string } }) as {
      actions: Array<{ target: string; state: string }>;
    };

    assert.equal(artifact.actions.length, 2);
    const byTarget = new Map(artifact.actions.map((a) => [a.target, a.state]));
    assert.equal(
      byTarget.get(dotDotEscapeTarget),
      'unknown',
      'the ".."-escaping target must be "unknown", not "cleared" — a `target.startsWith(brainDir)` check performed on the UNRESOLVED raw string (never normalizing/resolving the ".." segment first) would wrongly treat this as inside brainDir',
    );
    assert.equal(
      byTarget.get(siblingCollisionTarget),
      'unknown',
      'the sibling-directory target must be "unknown", not "cleared" — a `startsWith(brainDir)` check with no trailing-separator guard (i.e. not `startsWith(brainDir + sep)`, mirroring this very module\'s own safeReadFileInSession containment idiom) would wrongly treat this string-prefix collision as inside brainDir',
    );
  });
});

// ===========================================================================
// W7-C2 (sessions-kinds-29) — verdicts.json: the durable rationale record.
// Every operator verdict (approve/reject/revise) appends {at, verdict,
// notes?} to the session dir's verdicts.json (written by the generic
// affordance write route, cli/bridge-studio-affordances.ts, only after a
// 2xx); deriveSessionTranscript renders each record as an OPERATOR turn so a
// reject is never invisible in the record. Fail-closed like answers.json: a
// malformed verdicts.json errors, never fabricates or drops turns silently.
// W7-C2 T1 review (P0-2): a revise record now carries its OWN `feedback`
// words, because feedback.md is transient (each revise overwrites it, and the
// consuming turn deletes it) and could therefore only ever hold the NEWEST
// round. Records are ordered by their `at` stamp (A13).
// ===========================================================================

describe('W7-C2 — verdicts.json renders operator verdict turns', () => {
  it('C2-V1: a reject record with notes renders one operator turn carrying the verdict AND the rationale', () => {
    const sessionDir = makeTmpDir('c2-verdicts-1-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'reject', notes: 'Too broad — split the roadmap first.' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'rejected' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(verdictTurns.length, 1);
    assert.equal(verdictTurns[0].role, 'operator');
    assert.match(verdictTurns[0].text, /reject/i);
    assert.match(verdictTurns[0].text, /Too broad — split the roadmap first\./);
  });

  it('C2-V2: a revise record renders the decision turn WITHOUT duplicating feedback.md (whose own turn still renders)', () => {
    const sessionDir = makeTmpDir('c2-verdicts-2-');
    writeFileSync(join(sessionDir, 'feedback.md'), 'Tighten the intro section.');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'revise' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'drafting' }));
    const feedbackTurns = turns.filter((t) => t.source === 'feedback.md');
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(feedbackTurns.length, 1, 'feedback.md keeps its own turn');
    assert.equal(verdictTurns.length, 1);
    assert.match(verdictTurns[0].text, /revise/i);
    assert.ok(!verdictTurns[0].text.includes('Tighten the intro section.'), 'the revise record must not duplicate the feedback text');
  });

  it('C2-V3: approve without notes renders the bare decision', () => {
    const sessionDir = makeTmpDir('c2-verdicts-3-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'approve' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(verdictTurns.length, 1);
    assert.match(verdictTurns[0].text, /approve/i);
  });

  it('C2-V4: a malformed verdicts.json (non-array) fails CLOSED — {ok:false} naming the file, never fabricated turns', () => {
    const sessionDir = makeTmpDir('c2-verdicts-4-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify({ verdict: 'approve' }));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /verdicts\.json/);
  });

  it('C2-V5: a record whose "verdict" is not a string fails CLOSED', () => {
    const sessionDir = makeTmpDir('c2-verdicts-5-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([{ at: 'x', verdict: 42 }]));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /verdicts\.json/);
  });

  // W7-C2 T1 review (P0-2 / F1) — the multi-round case the shipped suite
  // could not see: C2-V1..V5 only ever write ONE record. A revise
  // OVERWRITES feedback.md, so once round 2 lands, round 1's rationale is
  // recoverable from nowhere unless the record itself carries it.
  it('C2-V6: TWO revise rounds each render their OWN words — round 1\'s rationale is still in the transcript after round 2 overwrote feedback.md', () => {
    const sessionDir = makeTmpDir('c2-verdicts-6-');
    writeFileSync(join(sessionDir, 'feedback.md'), 'Actually make it red.');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T10:00:00.000Z', verdict: 'revise', feedback: 'Make the button blue.' },
      { at: '2026-08-21T11:00:00.000Z', verdict: 'revise', feedback: 'Actually make it red.' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'drafting' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.equal(verdictTurns.length, 2);
    assert.ok(verdictTurns[0].text.includes('Make the button blue.'), `round 1's words must survive: ${verdictTurns[0].text}`);
    assert.ok(verdictTurns[1].text.includes('Actually make it red.'), `round 2's words must render: ${verdictTurns[1].text}`);
  });

  // W7-C2 T1 review (A13) — `at` was stamped by the writer and read by
  // nobody, so records rendered in write order no matter when the decisions
  // were made.
  it('C2-V7: verdict turns are ordered by `at`, not by position in the file', () => {
    const sessionDir = makeTmpDir('c2-verdicts-7-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([
      { at: '2026-08-21T12:00:00.000Z', verdict: 'approve', notes: 'later' },
      { at: '2026-08-21T09:00:00.000Z', verdict: 'revise', notes: 'earlier' },
    ]));
    const turns = okTurns(deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }));
    const verdictTurns = turns.filter((t) => t.source.startsWith('verdicts.json'));
    assert.ok(verdictTurns[0].text.includes('earlier'), `the 09:00 decision must render first: ${JSON.stringify(verdictTurns.map((t) => t.text))}`);
    assert.ok(verdictTurns[1].text.includes('later'));
    assert.equal(verdictTurns[0].source, 'verdicts.json#2', 'source names the record\'s position IN THE FILE, so a reader can go find it');
  });

  it('C2-V8: a record with no `at` fails CLOSED — the ordering key is required, never defaulted to write order', () => {
    const sessionDir = makeTmpDir('c2-verdicts-8-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([{ verdict: 'approve' }]));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'committed' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /"at"/);
  });

  it('C2-V9: a non-string `feedback` fails CLOSED (same discipline as `notes`)', () => {
    const sessionDir = makeTmpDir('c2-verdicts-9-');
    writeFileSync(join(sessionDir, 'verdicts.json'), JSON.stringify([{ at: '2026-08-21T10:00:00.000Z', verdict: 'revise', feedback: 42 }]));
    const result = deriveSessionTranscript({ descriptor: instructionsDescriptor(), sessionDir, phase: 'drafting' }) as { ok: boolean; error?: { message: string } };
    assert.equal(result.ok, false);
    assert.match(result.error!.message, /feedback/);
  });
});

// ===========================================================================
// W8-B3 (operator note ON-5) — `sourcesFound`, and the blank-opener rule.
//
// The wire used to carry `transcript: descriptor.turnSpec === undefined`
// (packages/sessions/bridge-studio-sessions.ts) as a per-kind proxy for "does this kind
// record turns". It was a stored copy of a fact this module already knows, and
// it was WRONG for `authoring` — that kind declares a `turnSpec`, yet its start
// route (`writeAuthoringSession`, apps/forge/ui-bridge.ts) writes `prompt.md` before
// the generic spine ever runs, so the proxy claimed "no turns" for a kind that
// has one from second zero. `sourcesFound` replaces it with the derived fact.
// ===========================================================================

describe('deriveSessionTranscript — W8-B3 sourcesFound + blank-opener rule (ON-5)', () => {
  it('W8-B3: sourcesFound reports exactly the candidate sources that EXIST, in scan order — never the whole scanned list', () => {
    const dir = makeTmpDir('b3-sources-found');
    writeFileSync(join(dir, 'idea.md'), 'ship the thing');
    writeJson(dir, 'verdicts.json', [{ at: '2026-08-23T00:00:00.000Z', verdict: 'approve' }]);

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir: dir, phase: 'awaiting-verdict' });
    assert.ok(result.ok);
    assert.deepEqual([...result.sourcesFound], ['idea.md', 'verdicts.json']);
    // The scanned list is unchanged and still names everything looked for, so
    // "scanned 6, found 2" stays a readable, honest report.
    assert.ok(result.sourcesScanned.length > result.sourcesFound.length);
    for (const found of result.sourcesFound) assert.ok(result.sourcesScanned.includes(found));
  });

    it('W8-B3: sourcesFound is [] for a session dir holding none of the candidates — the kb-cleanup shape before any verdict', () => {
    const dir = makeTmpDir('b3-sources-none');
    writeFileSync(join(dir, 'status.json'), '{"phase":"drafting"}');
    const result = deriveSessionTranscript({ descriptor: authoringDescriptor(), sessionDir: dir, phase: 'drafting' });
    assert.ok(result.ok);
    assert.deepEqual([...result.sourcesFound], []);
    assert.equal(result.turns.length, 0);
  });

    it('W8-B3: a BLANK prompt.md produces NO turn (never an empty operator bubble), while still being reported as a source that exists', () => {
    // Live shape, not invented: `/api/project-brain/brief`, `/api/instructions/
    // brief` and `/api/demo-builder/brief` all write `body.brief ?? ''`, so an
    // operator who skips the optional brief lands a zero-byte prompt.md.
    for (const body of ['', '   \n\t  \n']) {
      const dir = makeTmpDir('b3-blank-prompt');
      writeFileSync(join(dir, 'prompt.md'), body);
      const result = deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir: dir, phase: 'analyzing' });
      assert.ok(result.ok);
      assert.equal(result.turns.length, 0, `blank prompt.md (${JSON.stringify(body)}) must not manufacture a turn`);
      assert.deepEqual([...result.sourcesFound], ['prompt.md'], 'the file really is there — presence is not the same as content');
    }
  });

    it('W8-B3: a prompt.md with real content still produces exactly one operator turn (the blank rule must not swallow real briefs)', () => {
    const dir = makeTmpDir('b3-real-prompt');
    writeFileSync(join(dir, 'prompt.md'), 'emphasise the build/test conventions');
    const result = deriveSessionTranscript({ descriptor: projectBrainDescriptor(), sessionDir: dir, phase: 'analyzing' });
    assert.ok(result.ok);
    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].role, 'operator');
    assert.equal(result.turns[0].source, 'prompt.md');
    assert.equal(result.turns[0].text, 'emphasise the build/test conventions');
  });
});

describe('deriveSessionTranscript — W8-B3 revise de-duplication (sessions-kinds-R05)', () => {
  // Live repro from the wave-7 re-gate, on a real authoring session: Request
  // changes -> feedback "Add a short \"Examples\" section with one echo
  // example." -> Send for revision. The transcript then read OPERATOR "Add a
  // short …" followed by OPERATOR "Verdict: revise Add a short …" — the same
  // instruction twice, because the ONE write appends the durable verdicts.json
  // record AND leaves the transient feedback.md the next turn will consume.
  const FEEDBACK = 'Add a short "Examples" section with one echo example.';

  it('R05: a revise whose feedback is carried by its verdict record renders ONCE — as the verdict, with the words as its body', () => {
    const dir = makeTmpDir('b3-revise-dedup');
    writeFileSync(join(dir, 'feedback.md'), FEEDBACK);
    writeJson(dir, 'verdicts.json', [{ at: '2026-08-23T10:00:00.000Z', verdict: 'revise', feedback: FEEDBACK }]);

    const result = deriveSessionTranscript({ descriptor: authoringDescriptor(), sessionDir: dir, phase: 'analyzing' });
    assert.ok(result.ok);
    const operatorTurns = result.turns.filter((t) => t.role === 'operator');
    assert.equal(operatorTurns.length, 1, `expected ONE turn, got ${operatorTurns.length}: ${JSON.stringify(operatorTurns.map((t) => t.source))}`);
    assert.equal(operatorTurns[0].source, 'verdicts.json#1');
    assert.match(operatorTurns[0].text, /Verdict: revise/);
    // The operator's words are NOT lost — they are the verdict turn's body.
    assert.ok(operatorTurns[0].text.includes(FEEDBACK));
  });

  it('R05: TWO revise rounds each render exactly once, with their own words', () => {
    const dir = makeTmpDir('b3-revise-dedup-2');
    writeFileSync(join(dir, 'feedback.md'), 'second round words');
    writeJson(dir, 'verdicts.json', [
      { at: '2026-08-23T10:00:00.000Z', verdict: 'revise', feedback: 'first round words' },
      { at: '2026-08-23T11:00:00.000Z', verdict: 'revise', feedback: 'second round words' },
    ]);
    const result = deriveSessionTranscript({ descriptor: authoringDescriptor(), sessionDir: dir, phase: 'analyzing' });
    assert.ok(result.ok);
    assert.equal(result.turns.length, 2);
    assert.equal(result.turns.filter((t) => t.text.includes('second round words')).length, 1);
    assert.equal(result.turns.filter((t) => t.text.includes('first round words')).length, 1);
  });

  it('R05: feedback.md that NO verdict record carries still renders — de-duplication must never lose the operator\'s words', () => {
    const dir = makeTmpDir('b3-revise-orphan');
    writeFileSync(join(dir, 'feedback.md'), 'a note no verdict recorded');
    writeJson(dir, 'verdicts.json', [{ at: '2026-08-23T10:00:00.000Z', verdict: 'revise', feedback: 'something else entirely' }]);
    const result = deriveSessionTranscript({ descriptor: authoringDescriptor(), sessionDir: dir, phase: 'analyzing' });
    assert.ok(result.ok);
    assert.equal(result.turns.length, 2);
    assert.ok(result.turns.some((t) => t.source === 'feedback.md' && t.text === 'a note no verdict recorded'));
  });

  it('R05: feedback.md with NO verdicts.json at all still renders (the architect shape — feedback with no verdict record)', () => {
    const dir = makeTmpDir('b3-revise-nofile');
    writeFileSync(join(dir, 'feedback.md'), 'tighten the scope');
    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir: dir, phase: 'awaiting-verdict' });
    assert.ok(result.ok);
    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].source, 'feedback.md');
  });
});

describe('deriveSessionTranscript — W8-B3 turn INDEX contract holds across the reorder', () => {
  // `data-turn-index` is part of the DOM contract (docs/forge-ui-dom-and-
  // harness.md) and two live journeys assert on index 0 specifically
  // (flows-run's idea.md pin, stand-up-create's questions.json pin). Reading
  // verdicts.json before PUSHING the feedback turn must not renumber anything.
  it('W8-B3: indices stay 0..n-1 in push order — opener, answers, questions, feedback, verdicts', () => {
    const dir = makeTmpDir('b3-index-contract');
    writeFileSync(join(dir, 'idea.md'), 'the idea');
    writeJson(dir, 'answers.json', [{ round: 1, answers: [{ question: 'q1?', answer: 'a1' }] }]);
    writeJson(dir, 'questions.json', [{ question: 'pending?' }]);
    writeFileSync(join(dir, 'feedback.md'), 'a note no verdict carries');
    writeJson(dir, 'verdicts.json', [{ at: '2026-08-23T10:00:00.000Z', verdict: 'reject', notes: 'not this one' }]);

    const result = deriveSessionTranscript({ descriptor: architectDescriptor(), sessionDir: dir, phase: 'awaiting-answers' });
    assert.ok(result.ok);
    assert.deepEqual(result.turns.map((t) => t.index), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(result.turns.map((t) => t.source), [
      'idea.md',
      'answers.json#round-1',
      'answers.json#round-1',
      'questions.json',
      'feedback.md',
      'verdicts.json#1',
    ]);
    // A reject WITH notes and an unrelated feedback.md must keep BOTH — the
    // de-duplication may only fire on an exact text match.
    assert.ok(result.turns.some((t) => t.text === 'a note no verdict carries'));
    assert.ok(result.turns.some((t) => t.text.includes('not this one')));
  });
});
