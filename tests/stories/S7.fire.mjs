/**
 * S7's closing act — bind the hook to an agent, run it, and read the firing.
 *
 * SPLIT, NEVER BASELINE (ruling 492, T1 1326). `S7.story.mjs` reached 845
 * lines when 6gv.8.1's test-fire beat and the real-firing ending landed, over
 * the 800-line cap. Same move as `S1.act3.mjs` / `S10.act2.mjs`: the comments
 * that record WHY a beat asserts what it asserts are most of the weight, and
 * they are the part worth keeping.
 *
 * The cut is the story's own last movement: every part is made and approved
 * by beat 19, and these seven beats (20–26) take the approved hook to a worker
 * and prove it fired. They are spread into `beats` at the position they
 * already occupied, so order and numbering are unchanged — every beat is
 * byte-identical to its pre-split text.
 */
export const BIND_AND_FIRE = [
    {
      // AMEND-4 (T1 ruling 668), NAVIGATION (504) — amend-3's shape, one hop
      // further on, and the same class of miss.
      //
      // MEASURED in run 2. The runner's own words are the whole diagnosis:
      //
      //   05:08:59.402  ✓ 19. Open the instructions session it just started
      //   05:08:59.461  ✗ 20. Open an agent from the Agents pillar and bind the hook to it
      //       no real-nav path to "/agents/brain-ingest" from
      //       "/sessions/instructions/2026-09-11T05-08-59-34e16588": no
      //       [data-nav] pillar and no link whose PATHNAME is that route
      //
      // **59 ms.** The next beat never waited for anything, because there was
      // nothing on the session page to wait for — and its own `act` says "from
      // the Agents pillar", describing an operator this story had never sent
      // there. The hop was missing, not the assertion.
      //
      // WHY THE PILLAR IS NOT THE PROBLEM, since the runner's message reads as
      // if it were. `beats-drive.mjs:308` collects every `[data-nav][href],
      // a[href]` on the page and `:318` keeps only those matching the TARGET,
      // so "no [data-nav] pillar" means no pillar matched THAT route — not
      // that the page has none. `/agents/brain-ingest` is a DETAIL route and
      // no pillar carries it; the pillar carries `/agents`. The session page
      // renders the pillar throughout: this page mounts `StudioArchitectShell`
      // (`app/sessions/[kind]/[sessionId]/page.tsx:390`), which mounts
      // `<StudioNav/>` (`StudioArchitectShell.tsx:50`), which stamps
      // `data-nav="agents"` with `href="/agents"` (`StudioNav.tsx:94`). So the
      // index is reachable from here where the detail was not, and the beat
      // below is the hop that makes the next one's first act possible.
      //
      // Same assertions as the retired Agents-pillar hop's arrival here, deliberately:
      // route plus `page` and `page-ready`, and nothing else. No judgement
      // content, which is what 504's class allows to be authored without going
      // back to the operator.
      act: 'Head back to the Agents pillar',
      expect: {
        route: '/agents',
        data: { page: 'agents-index', 'page-ready': 'true' },
      },
      say: 'The parts are all made now — a skill, a hook, a template, a house style. None of them does anything yet. Binding happens on a worker\u2019s own page, and the way back to a worker is the Agents pillar.',
    },
    {
      // THE HOP BEAT, added after S7 run 4 (T1 ruling 799(1)).
      //
      // Run 4 red beats 22 and 23 (run-4 numbering; 21 and 22 since the T1-1275 amend and the 6gv.8.1 test-fire beat) identically — *"standing on the wrong page:
      // `/agents` is not `/agents/brain-ingest`"*. The beat below declared that
      // route as where it ENDS and was read as where it STOOD, but **a `do`
      // acts where the browser stands**, and beat 20 leaves it on `/agents`
      // (`:667`). A route in an `expect` is a post-condition, never a hop.
      //
      // A NAVIGATE, NOT A PRESS, measured: `handleFor`
      // (`beats-repeat.mjs:41-45`) resolves `press` to exactly
      // `[data-action="<key>"]`, and the card that links here
      // (`LibraryCard.tsx:179-186`) is a `Link` carrying `data-card-type` and
      // `data-card-id` and NO `data-action`. Reported, not fixed here: a handle
      // is a DOM-contract change and this is a story amendment.
      //
      // AND WHY IT SUCCEEDS WHERE AMEND-4'S DID NOT. A no-`do` beat never
      // `page.goto`s — `beats-drive.mjs:372-386` needs `[data-nav][href]` or
      // `a[href]` for the target ON THIS PAGE and refuses otherwise. Run 2 hit
      // that refusal for this same target from the SESSION page (recorded
      // above). From `/agents` the roster renders one `<a href="/agents/<id>">`
      // per agent, so the runner arrives by CLICKING THE CARD. Amend-4 made the
      // link reachable and stopped one hop short of using it.
      //
      // 504: no `do` skips the step phase and navigates. Assertions are the
      // three the detail page stamps (`app/agents/[id]/page.tsx:591-593`), read
      // from source: `data-page="agents"`, `page-ready`, `agent-id`.
      act: 'Open brain-ingest from the roster',
      expect: {
        route: '/agents/brain-ingest',
        data: { page: 'agents', 'page-ready': 'true', 'agent-id': 'brain-ingest' },
      },
      say: 'The roster is a list of workers; binding happens on one worker\u2019s own page. This is the hop the operator makes without thinking about it, and the one the story forgot to write down.',
    },
    {
      // THIS COMMENT USED TO SAY "NOT expressible — no `data-action`, so no
      // `do` verb can name it". **It became false on 2026-09-04 and stayed in
      // the file.** `CatalogPalette.tsx:111` has carried
      // `data-action={`add-${g.kind}-${item.id}`}` since `4de6e5e4` (bead
      // 5.15), documented at `studio-dom-contract.md:2213`, and its own comment
      // says the kind is in the name ON PURPOSE — "adding a skill and adding a
      // tool are different acts on the same widget".
      //
      // §15.418: A COMMENT ASSERTING WHAT THE PRODUCT CANNOT DO CARRIES AN
      // EXPIRY DATE NOBODY SETS. It was true when written, the product grew the
      // handle, and nothing re-read the claim — so under 504 this beat
      // NAVIGATED and then asserted the post-condition of a click it never
      // made. The hook zone honestly read `count=0` (`hooks: []` in the
      // definition preview, D's read) and S7 run 3 went 21/22 on a bind that
      // never happened. The together-rule was right throughout; there is no
      // scoping defect here.
      //
      // NO `toggle-advanced` PRESS, and this is deliberate (T1 729). The five
      // drop zones sit inside a collapsed `<details>` (`app/agents/[id]/
      // page.tsx:720-770`) — but `CatalogPalette` renders at `:608`, a
      // DIFFERENT COLUMN of the three-column workbench, so the chip is visible
      // and clickable with the block shut. And this beat reads ATTRIBUTES, not
      // pixels: `DropZone.tsx:131-132` renders `data-accepts`/`data-count`
      // unconditionally, and a closed `<details>` hides its children from
      // LAYOUT while keeping them in the DOM.
      //
      // S7 run 4 is the execution proof. If the press does not bind through the
      // closed block this reds at `count: '0'` and the remedy is one line —
      // and that red is INFORMATIVE, where pressing `toggle-advanced` first
      // would make the run unable to tell "the press binds" from "the press
      // binds only because we opened the block".
      //
      // `accepts` and `count` are the same zone, so one element answers both.
      // The guard and hook zones are DISTINCT by design and must never merge,
      // which is why this beat names the hook zone specifically.
      // THE SAVE IS NOT OPTIONAL, and D caught that it was missing from this
      // beat's first draft. `addToZone` (`app/agents/[id]/page.tsx:231-238`) is
      // `setState` + `markDirty()` — nothing more. So the zone reads `count=1`
      // from LOCAL STATE the instant the chip is clicked, while the agent still
      // RUNS from what was last saved. Without `save-agent` (`:779`, outside the
      // `<details>`), beat 22 would dispatch an agent that never received the
      // hook, and this beat would assert a binding that exists only in the
      // browser.
      //
      // That is the fail-open shape S7 exists to catch, one surface over: a
      // parsed-and-surfaced value enforced nowhere. Asserting `count: '1'` off
      // unsaved state would have been this story telling itself the truth about
      // a screen and a lie about the system.
      act: 'Bind the hook to the agent, and save it',
      do: [{ press: 'add-hook-story-s7-hook' }, { press: 'save-agent' }],
      expect: {
        route: '/agents/brain-ingest',
        data: { page: 'agents', 'agent-id': 'brain-ingest', accepts: 'hook', count: '1' },
      },
      say: 'A hook is inert until an agent carries it. Binding is the act that makes a library part part of a worker, and it is the reason the hook’s own page counts how many agents carry it.',
    },
    {
      // AMENDED 2026-09-25 (T1 1316, forge-6gv.8.1 / 8vfn.5.16). This beat
      // used to END the story on a claim the product could not make: "the hook
      // fired". It now only starts the run; the three beats below read the
      // firing where the product records it. Asserting `carried-by-count` here
      // would report a BINDING as if it were an EXECUTION — the fail-open
      // shape this story exists to catch.
      act: 'Run the agent',
      do: [{ press: 'run-agent' }],
      expect: {
        route: '/agents/brain-ingest',
        data: {
          page: 'agents',
          'agent-id': 'brain-ingest',
          'run-status': 'running',
          'run-id': '<hookRunId>',
        },
      },
      say: 'The hook is bound, so this run is the first time anything other than the operator can set it off. It fires on the session ending — so the story waits for the ending.',
    },
    {
      // AMENDED 2026-09-25 (T1 1316) — ACT CHANGE, new beat. The hook fires on
      // `SessionEnd` (HOOK_EVENT), so the firing cannot exist until this run
      // ends, and the hook page reads its fire record once, at load. The S5
      // pattern (S5's final beat): stay on the agent page under a declared
      // agent bound until `run-status` reads `done`, on the SAME run the press
      // minted (`<hookRunId>`, bound by the previous beat). 300 s is S5's bound
      // for the same kind of standalone agent turn.
      act: 'Wait for the run to end',
      wait: { for: 'agent', upTo: 300_000 },
      expect: {
        route: '/agents/brain-ingest',
        data: {
          page: 'agents',
          'agent-id': 'brain-ingest',
          'run-status': 'done',
          'run-id': '<hookRunId>',
        },
      },
      say: 'A session that ends is the event this hook was written for. Until the run finishes there is nothing to fire on.',
    },
    {
      // AMENDED 2026-09-25 (T1 1316) — ACT CHANGE, the hop back. Pure
      // navigation: the agent page does not link to a hook, so the operator
      // walks the Library pillar to the Hooks shelf, whose card links to the
      // hook page (`LibraryHub.tsx` `data-card-type="hook"`). Same shape as
      // this story's other Library returns.
      act: 'Back to the Library',
      expect: {
        route: '/library',
        data: { page: 'library', 'page-ready': 'true', section: 'hooks' },
      },
      say: 'The record of what a hook did lives with the hook, not with whichever agent happened to trigger it.',
    },
    {
      // AMENDED 2026-09-25 (T1 1316) — the beat this story now ENDS on, and the
      // claim it used to only narrate. Dispatch firings are the `hook.fire`
      // events `packages/agents/studio/hook-dispatch.ts` emits into a run's
      // events.jsonl; the hook page folds them (`hook-fire-summary.ts`) into
      // `data-hook-last-fire-at` / `-outcome` on its root — ABSENT, never
      // fabricated, for a hook that has never fired. Test-fires (beat 13) are
      // a separate log and never feed these two attributes, so this reads the
      // DISPATCH firing, not the operator's rehearsal.
      //
      // `-at` is a placeholder (a timestamp); `-outcome` is `ran` because
      // HOOK_SCRIPT exits 0. HONEST LIMIT: the fire scan is a window over
      // recent cycle dirs and `_logs/` is not the sweep's (`forge-8vfn.2.26`),
      // so a re-run on an unswept host could read an EARLIER run's firing. On
      // the fixture ground (M7-D) that residue does not exist.
      act: 'Open the hook, and see the session ending fire it',
      expect: {
        route: '/hooks/story-s7-hook',
        data: {
          page: 'hook-detail',
          'hook-id': 'story-s7-hook',
          'carried-by-count': '1',
          'hook-last-fire-at': '<hookLastFireAt>',
          'hook-last-fire-outcome': 'ran',
        },
      },
      say: 'This is where S7 ends: the hook the operator wrote, scanned, approved and bound actually ran, and its own page says when and how it ended. A hook nobody can prove fired is a hook nobody should trust — this one has a record.',
    },
];
