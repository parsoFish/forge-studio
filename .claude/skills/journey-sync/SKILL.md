---
name: journey-sync
description: Keep the story suite (tests/stories/) in sync with forge-ui changes. Use whenever a change touches forge-ui load-bearing state (data-* attributes, routes, surfaces, flows/agents/skills/KB affordances), when adding or retiring a Studio capability, or before closing any session that modified forge-ui. The stories are BOTH the demo and the UI regression gate — a UI change without a story update either breaks the gate or silently rots the demo.
---

# journey-sync — the demo IS the spec

**The name is historical.** This skill served `scripts/journeys/`, which
7.6.131 retired; operator item 66 ruled "Retarget to stories", so the referent
is now the story beat. The directory keeps its name because `CLAUDE.md` invokes
the skill by it; renaming is a follow-up for whoever edits that line.

The story suite (`npm run stories`) is one artifact with **three** jobs — one
more than the journeys had. The operator-facing demo (narrated clips + stills,
gathered at `demos/stories/index.html`), the DOM-as-metrics regression gate
(per-beat verdicts in `demos/stories/<id>/story.json`), and a how-to document
emitted from the same run. Every story is a user story; every beat is
simultaneously a demo scene, a named test case, and a documented step.

**The sync contract:** any change to a forge-ui surface a story drives must
land with the matching story update in the same PR — beats/checks for the
regression side, narration/captions/clips for the demo side, and the doc
fragment follows from the beats rather than being written separately. The
gallery's text is the spec an agent diffs the video/stills against; if the text
no longer describes the surface, update BOTH.

## Where things live

- `tests/stories/<id>.story.mjs` — one module per user story: `id`, `docs`,
  `ground` (project, `realSpawn`, `budget_usd`) and `beats`.
- `scripts/stories/story-file.mjs` — `loadStory` / `validateStory`: the beat
  schema, `expect.data` nested resolution, `expect.among` rules, route binding.
- `scripts/stories/run.mjs` — the runner. `--list` prints the shape without
  booting; `--story <id>`, `--costless-only`, `--ceiling`, `--approve-spend`.
- `scripts/stories/gallery.mjs` — `storyRowFrom` / `renderGalleryIndex` /
  `regenerateGallery`, and the committed-state readers the index door uses.
- `scripts/stories/docs-fragment.mjs` — `renderDocFragment` and `docPathFor`.

**Never hardcode a doc path.** `docPathFor(story, root)` resolves it — some
stories live under `docs/tutorials/`, others under `docs/how-to/`, and a
hardcoded `docs/how-to/` is wrong for four of ten. That mistake has been made
twice in this repo, both times by someone reasoning from the common case.

## Rules encoded the hard way (violate = re-learn expensively)

1. **Entry-point rule:** every clip shows the END-TO-END user journey — start
   where the user triggers the function (library card, project-page button,
   + New CTA), show the trigger click, the progression, the payoff. Never open
   a clip mid-flow on a session screen.
2. **Honesty rule:** never fake a capability. Seeded/emulated stages (AI
   generation under `FORGE_ARCHITECT_NO_SPAWN=1`) mirror what the real runner
   writes and the narration says so. If the UI can't do a thing, the beat
   asserts the true state and the narration owns the limit. Assertions must
   assert reality — three "green" assertions in S5 history only ever passed
   against faked state.
3. **State ownership:** a beat must never mutate the canonical seeded
   session/cycle. Read-only re-reads, clip-only session ids (`${sid}-clip`), or
   clip-only project copies; clean both in the beat tail. A story's OWN ground
   is cleared for it — `ground-clear.mjs` captures then removes the sessions the
   run minted, and the run goes red if one survives.
4. **Clip mechanics:** fresh ephemeral context per clip, 5s context default
   timeout (a missed locator otherwise records 30s of dead video), bounded
   waits, settle at the end, size guard 4M, 1600×1000 default. Palette/zone
   drops are HTML5 DataTransfer dispatch; ReactFlow edges are real mouse drags;
   wait ~800ms after canvas node-drops before wiring (auto-fit transition), and
   wait for async starter seeds to land BEFORE clearing a canvas.
5. **Pacing:** every information-reveal gets viewer processing time; load-
   bearing moments (e.g. artifact-picker choice) get an explicit on-screen
   caption callout + dwell.
6. **Isolation hazards (real money):** commit before running; the suite binds
   host-global ports 4123/4124; the daemon guard refuses live daemons + stray
   queue manifests; the run sandboxes the seeded worktree so the bridge's
   verdict-approve can't run a real finalizer. After EVERY run verify:
   `git log -1` unchanged, `git status` clean, no `release-finalize` events in
   fresh `_logs/`, and the PR state untouched (the 2026-07-16 incident
   self-merged a PR with the operator's token).
   **And the lane running the suite HOLDS STILL: `gh` mutations go before it
   or after it, never beside it (§15.441).** The run-lock protects the ports
   and the ground; it does not protect the PR namespace, and the post-run
   boundary compares PR state across the whole run. Measured 2026-09-12: a
   `gh pr create` fired 27 s after the suite took the run-lock, and the lane's
   own new PR came back as a boundary violation against its own run —
   "I hold the lock" is not "I may do anything else in parallel".
7. **Grounding:** seeded cycle data mirrors the real corpus
   (`brain/cycles/_raw/`, archived `_logs/` cycles) with provenance comments.
   New seeds copy a real cycle's shapes, not invented values. The live captures
   under `tests/fixtures/live-capture/` are real and are read by contract tests;
   they are data, not harness, and outlive whatever captured them.
8. **A costed story spends.** `ground.budget_usd` and `realSpawn` are declared
   in the story file — read them before running anything, never a list of ids
   kept elsewhere. A story with a non-zero budget needs an explicit funding
   ruling; `--costless-only` is the safe default when you just want the shape.

## Checklist for a UI change

1. `npm run stories -- --list` — find the affected story/beats without booting.
2. Update the beat's drive/checks for the new surface (`data-*` first — see
   `docs/reference/studio-dom-contract.md`; add/update attributes with the UI
   change itself).
3. Update the narration + captions so the text still describes what's shown;
   re-record the clip if the visible arc changed (entry → progression → payoff).
4. Mark 1-2 `key: true` frames per beat for the gallery.
5. Re-run the affected story (costless ones are free: `npm run stories --
   --story proof`), then the post-run isolation checks (rule 6). Commit the
   story, the UI change and the regenerated artifacts together.
6. **If the run regenerates `demos/stories/index.html`, commit it.** The index
   is derived from every `story.json` and is pinned by no manifest, so nothing
   else will notice it drifting — `gallery-index-agrees.test.ts` reds when the
   committed index stops matching the committed inputs, which is how S9 was
   caught claiming `red 4/14` against its own artifact's `green 16/16`.
