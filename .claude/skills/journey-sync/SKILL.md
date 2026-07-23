---
name: journey-sync
description: Keep the UI-journey demo harness (scripts/journeys/) in sync with forge-ui changes. Use whenever a change touches forge-ui load-bearing state (data-* attributes, routes, surfaces, flows/agents/skills/KB affordances), when adding or retiring a Studio capability, or before closing any session that modified forge-ui. The journeys are BOTH the demo and the UI regression gate — a UI change without a journey update either breaks the gate or silently rots the demo.
---

# journey-sync — the demo IS the spec

Forge's UI walkthrough (`npm run ui:journey`) is one artifact with two jobs:
the operator-facing demo (tabbed gallery of narrated clips + stills at
`demos/e2e/index.html`) and the DOM-as-metrics regression gate (soft checks,
non-zero exit). Every journey is a user story from the capability diagram;
every beat is a scripted story beat that is simultaneously a demo scene and a
named test case (auto-tagged into `demos/e2e/results.json`).

**The sync contract:** any change to a forge-ui surface a journey drives must
land with the matching journey update in the same PR — beats/checks for the
regression side, narration/captions/clips for the demo side. The gallery's
text (story + narration per beat) is the spec an agent diffs the video/stills
against; if the text no longer describes the surface, update BOTH.

## Where things live

- `scripts/journeys/<journey>.mjs` — one module per user story; `journey` export
  via `defineJourney({ id, title, story, beats })`. Registry + `RUN_ORDER`:
  `scripts/journeys/index.mjs` (contiguous, building-blocks throughline).
- `scripts/lib/journey-runtime.mjs` — Beat/Journey model, PACE, results/gallery.
- `scripts/lib/journey-fixtures.mjs` — grounding constants + seed/cleanup helpers
  (corpus-grounded, provenance comments name the real cycle mirrored).
- `scripts/e2e-journey.mjs` — thin runner: daemon guard, boot, run loop,
  `recordClip`, report/gallery tail. `--list` prints the shape without booting.

## Rules encoded the hard way (violate = re-learn expensively)

1. **Entry-point rule:** every clip shows the END-TO-END user journey — start
   where the user triggers the function (library card, project-page button,
   + New CTA), show the trigger click, the progression, the payoff. Never open
   a clip mid-flow on a session screen.
2. **Honesty rule:** never fake a capability. Seeded/emulated stages (AI
   generation under `FORGE_ARCHITECT_NO_SPAWN=1`) mirror what the real runner
   writes and the narration says so. If the UI can't do a thing (e.g. bare
   gate-nodes, node-id renames), the beat asserts the true state and the
   narration owns the limit. Assertions must assert reality — three "green"
   assertions in S5 history only ever passed against faked state.
3. **State ownership:** a clip must never mutate the canonical seeded
   session/cycle. Read-only re-reads, clip-only session ids
   (`${sid}-clip`), or clip-only project copies; clean both in the beat tail.
4. **Clip mechanics:** fresh ephemeral context per clip (`recordClip`), 5s
   context default timeout (a missed locator otherwise records 30s of dead
   video), bounded waits, `PACE.holdTail` settle at the end, size guard 4M
   (runaway-catch), 1600×1000 default. Palette/zone drops are HTML5
   DataTransfer dispatch; ReactFlow edges are real mouse drags; wait ~800ms
   after canvas node-drops before wiring (auto-fit transition), and wait for
   async starter seeds to land BEFORE clearing a canvas.
5. **Pacing:** every information-reveal gets viewer processing time (READ/WORK
   dwells); load-bearing moments (e.g. artifact-picker choice) get an explicit
   on-screen caption callout + dwell.
6. **Isolation hazards (real money):** commit before running; `ui:journey`
   binds host-global ports 4123/4124; the daemon guard refuses live daemons +
   stray queue manifests; the run strips `releaseProcess` and sandboxes the
   seeded worktree so the bridge's verdict-approve can't run a real finalizer.
   After EVERY run verify: `git log -1` unchanged, `git status` clean,
   no `release-finalize` events in fresh `_logs/`, and the PR state untouched
   (the 2026-07-16 incident self-merged a PR with the operator's token).
7. **Grounding:** seeded cycle data mirrors the real corpus
   (`brain/cycles/_raw/`, archived `_logs/` cycles) with provenance comments.
   New seeds copy a real cycle's shapes, not invented values.

## Checklist for a UI change

1. `node scripts/e2e-journey.mjs --list` — find the affected journey/beats.
2. Update the beat's drive/checks for the new surface (`data-*` first — see
   the forge-ui DOM contract in `docs/forge-ui-dom-and-harness.md`; add/update
   attributes with the UI change itself).
3. Update the narration + captions so the text still describes what's shown;
   re-record the clip if the visible arc changed (entry → progression → payoff).
4. Mark 1-2 `key: true` frames per beat for the gallery.
5. Run the full gate (bare `npm run ui:journey`), then the post-run isolation
   checks (rule 6). Commit journey + UI changes together.
