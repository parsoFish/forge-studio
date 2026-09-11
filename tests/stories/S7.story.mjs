/**
 * S7 — create library components (1.0.md §3, row S7).
 *
 * Operator flow: the library is the parts bin every agent and Flow composes
 * from. The operator adds four kinds of part to it — a skill, a hook, a
 * template and a project's instructions — reads the security scan on the one
 * that is executable code, approves it, binds it to an agent, and then runs
 * that agent and watches the hook fire. Authored 2026-08-30 against
 * `parsoFish/main` 6889f080, with the operator (H6), in the amended
 * draft-then-review mode. Green expected at M4.
 *
 * AMEND-1 (M6, operator-confirmed in the attended sitting of 2026-09-08;
 * `_1.0/gate-manifests/M1-C-S7.amend-1.md`; rulings 396/406/409 + 483, 460,
 * 415, 484, 503). Four beats, no product change — every product half either
 * merged earlier in M6 or was already on main. The story goes from 15 beats to
 * 17 (beats 3 and 13 each split in two).
 *
 * The through-line: S7 asserted four different things the product does not do,
 * and IN EACH CASE THE PRODUCT WAS RIGHT. A hook matcher on a tool-less event,
 * a route the beat's own press mints, a field belonging to the next phase, and
 * a category filled with a directory path. Four reds, four story defects, zero
 * product defects. Each beat carries its own measurement.
 *
 * AMEND-2 (M6, T1 rulings 618/619; `_1.0/gate-manifests/M1-C-S7.amend-2.md`).
 * ONE beat splits in two, no product change, 19 beats to 20. Beat 5 asserted
 * `skill-trust: ready` and its own `do` could never produce it: finishing an
 * authoring session INSTALLS the package as a draft, and the library's own
 * approval is a second, deliberate act on a second surface. The story asserted
 * the end of a two-gate sequence as if one press did it, so it reported the
 * trust gate as free — and paid its whole 300 000 ms bound each run waiting for
 * a value that could never move. Beat 5 now asserts what its own act produces
 * (`draft`); new beat 5a performs the library approval and asserts `ready`.
 * Same shape as S6's 11a/11b split.
 *
 * AMEND-3 (M6, T1 ruling 638; `_1.0/gate-manifests/M1-C-S7.amend-3.md`). ONE
 * pure navigation beat, no product change, 20 beats to 21. Amend-1 made the
 * instructions launcher reachable and stopped one hop short: its navigation
 * beats land on `/sessions`, the page that LINKS to the launcher, while the
 * next beat's first act is a `fill` for a field that only exists ON the
 * launcher. Run 1 measured the consequence — the wait armed 5 ms after the
 * previous beat went green and spent its full 14 999 ms bound with nothing
 * navigating. The beat below carries the trace and the reason a navigation
 * beat, rather than a longer wait, is the fix.
 *
 * A THIRD DEFECT IN BEAT 13, and the reason this story gains TWO more beats
 * than the split alone needs. Beat 13 could not be REACHED: the runner reaches
 * a beat's route by clicking a link on the CURRENT page whose pathname matches
 * it and never falls back to `page.goto`, and nothing on a template page links
 * to the instructions launcher. Invisible until the split, because route
 * resolution failed FIRST on every run and the `do` steps never ran — the same
 * shape as beat 3's unreachable phase, one beat along. T1 ruling 504 put a
 * PURE navigation beat inside the split's scope; it took two, and why it took
 * two is itself the finding below.
 *
 * AN IA FINDING, RECORDED NOT FILED. `/sessions/instructions/new` is linked
 * from exactly ONE place in the product — the Sessions index's kickoff row —
 * and `/sessions` is not one of `StudioNav`'s seven pillars. So the shortest
 * path an operator can walk from the parts bin to the launcher for a component
 * kind the parts bin itself offers is THREE hops. The story now shows that,
 * because it is true. Whether it should stay true is the operator's call.
 *
 * THE FORK — TWO DOORS, AND THE OPERATOR'S RULING. §3's row says "via the
 * authoring session", and every one of `/skills/new`, `/hooks/new` and
 * `/templates/new` carries TWO doors: a manual form where the operator types
 * the package, and an `AuthoringLauncher` where they describe it to the
 * creation agent instead. Asked which is the true flow, the operator ruled on
 * 2026-08-30:
 *
 *     "showcase both as a fork in the road — showing both the fact they can be
 *      authored manually and with agents is ideal"
 *
 * So this story walks BOTH: the skill goes through the creation agent (beats
 * 3-4), the hook and the template go through the manual forms (beats 6-7 and
 * 10). Beat 3 additionally DECLARES a `fork` over the two doors, so the
 * requirement that each door works for each kind stands in the pinned artifact
 * even though §3.1's `beats[]` is flat and `validateStory` — which keeps only
 * the fields it knows — drops it. Same shape as S2 beat 3's fork over the
 * three starters; bead `forge-8vfn.2.22`. Recorded in `_1.0/stories/S7.md`:
 * today S7 covers 1 of 2 declared doors per kind.
 *
 * H2 — THIS STORY IS COSTED, AND ITS BRIEF SAID IT WOULD NOT BE. The brief
 * `_1.0/briefs/M1-C-S7.md` records "costed (H2): no — no real spawn", written
 * before the flow was authored. §3's own ground routes authoring through the
 * creation agent, which is a real dispatch. The brief names that exact case as
 * a park — "if authoring reveals it needs a real spawn, that is a park: state
 * the ceiling and wait" — and the operator ruled on 2026-08-30 that the story
 * declares the spawn rather than pretending otherwise. So `realSpawn` is true
 * and `budget_usd` is declared ($25, approved for the S5/S6/S7 batch).
 *
 * GROUND. `mdtoc` — the one project committed to this repo, so it is the only
 * project a CLEAN CHECKOUT has, and 1.0's exit condition is these stories
 * green on a clean checkout. It is also the project the creation agent and the
 * instructions agent are pointed at.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's own worktree, EXCEPT beat 4's session
 * panel, transcribed from `docs/reference/studio-dom-contract.md` (observing an
 * authoring session live costs a real creation-agent spawn). None is invented.
 * Read live and load-bearing: `/hooks` reports `data-hook-count="3"` with
 * `data-needs-review-count="1"`; `post-merge-brain-ingest` is
 * `trust="approved" runnable="true"`, `pre-pr-security-review` is
 * `trust="needs-review" runnable="false"`; the hook ledger records approvals
 * and revocations only and has NO declined state (`forge-8vfn.5.2`), which is
 * why beat 9 asserts approval rather than a decision either way.
 *
 * WHERE A BEAT CANNOT BE EXPRESSED it says so and stands anyway:
 *
 *   - Beats 4 and 11 route to session ids no earlier beat can bind. The
 *     authoring launcher's `start-authoring` POST returns the id straight into
 *     a `router.push`, as does the instructions kickoff — two of the six
 *     surviving mint-then-navigate sites in `forge-8vfn.5.10`. Cited, not
 *     re-diagnosed here.
 *   - The bind beat carries the hook to an agent, and binding means clicking a
 *     `.catalog-chip[data-id][data-kind]` in the agent builder — no
 *     `data-action`, so no `do` verb can name it. That is S5's finding, on the
 *     same surface, and `_1.0/stories/S5.md` carries it. The agent is
 *     `brain-ingest`, a real one off the shipped roster, NOT the agent S5
 *     creates: §3.1 allows no seeded state except what a PRIOR BEAT OF THIS
 *     STORY made, and reaching across stories would make S7 pass or fail on
 *     whether S5 ran first.
 *   - Beat 13 is the one §3's row ends on, and it has no attribute at all.
 *     Every `data-*` in `forge-ui` naming a hook is `data-hook-count`,
 *     `-event`, `-id`, `-runnable`, `-trust`, `-url`, `-verdict` and
 *     `-carried-by-count`: definition, trust and binding. NOTHING names a hook
 *     EXECUTION. So "the hook fires" is named in the beat's narration and
 *     recorded as a surface the library lane must build.
 *
 * SWEEP. `sweep.mjs` removes `projects/story-<id>` and
 * `brain/projects/story-<id>` only. The skill, hook, template and agent this
 * story creates live under `skills/`, `studio/hooks/` and
 * `studio/artifact-templates/`, none of which is swept, so a second run meets
 * packages that already exist. Bead `forge-8vfn.2.26`, filed by the S4 lane
 * for the same class; cited, not re-filed.
 */

/** The two doors every authoring page offers. Beat 3 forks over them; the runner walks CASES[0]. */
const DOORS = ['creation-agent', 'manual-form'];

/** What the operator asks the creation agent to build. */
const SKILL_BRIEF =
  'A skill that checks every relative link in a markdown file resolves to a real path in the repo, and reports the ones that do not with their line numbers.';

/** The hook: what it runs on, what it matches, and what it does. */
const HOOK_EVENT = 'SessionEnd';
const HOOK_SCRIPT = '#!/usr/bin/env bash\nset -euo pipefail\necho "story-s7: session ended" >&2\n';

export default {
  id: 'S7',
  ground: { project: 'mdtoc', realSpawn: true, budget_usd: 25 },
  docs: { kind: 'how-to', title: 'Create library components' },
  beats: [
    {
      // Fully expressible. Deliberately NO `data-count` on the shelf: the
      // library ships 25 skills and 17 templates today, and pinning either
      // would fail this story on a different checkout for a reason that has
      // nothing to do with authoring a component.
      act: 'Open the Library',
      expect: {
        route: '/library',
        data: { page: 'library', 'page-ready': 'true', section: 'skills' },
      },
      say: 'The Library is the parts bin: skills, hooks, connections, templates, and what the community has published. It is not a dashboard — every shelf on it is something an agent composes.',
    },
    {
      // Fully expressible. `new-skill` is the Skills shelf's own create CTA,
      // the same `data-action` the full `/skills` page uses.
      act: 'Press "+ New skill"',
      do: [{ press: 'new-skill' }],
      expect: {
        route: '/skills/new',
        data: { page: 'skill-builder', 'page-ready': 'true', section: 'skill-new' },
      },
      say: 'A skill is a reusable instruction packet — the unit an agent composes to know how to do something. This page offers two ways to make one, and the operator is about to take the one that does not involve typing markdown.',
    },
    {
      // AMEND-1, beat 3a of a split (rulings 396/406/409, class-stated by 483).
      // The beat declared the SESSION's route and tried to bind
      // `<authoringSessionId>` from it — but the runner resolves a route from
      // PRIOR beats' bindings BEFORE performing any `do` step
      // (`scripts/stories/beats-drive.mjs`), and this beat's own press is what
      // mints the id. Unbound on every run; no product change moves a red at
      // route resolution.
      //
      // The product half has since landed (`37e42ae2`): the launcher publishes
      // `data-minted-session-id` from first paint and stops navigating by
      // itself (`apps/studio/components/AuthoringLauncher.tsx`). So the
      // operator stays where they are, and the id is on the page they are
      // standing on.
      act: 'Describe the skill to the creation agent instead of writing the package by hand',
      do: [
        { fill: 'authoring-launcher-project', with: 'mdtoc' },
        { fill: 'authoring-launcher-prompt', with: SKILL_BRIEF },
        { press: 'start-authoring' },
      ],
      // Not in §3.1's schema, and dropped by `validateStory` — see THE FORK
      // above. Both doors on this page must reach the same approved package;
      // a story that proves one of two proves the door, not the promise.
      // It stays on the MINTING half: the fork is over which door starts the
      // work, not over how the operator reaches what it started.
      fork: { over: 'authoring-door', cases: DOORS },
      expect: {
        route: '/skills/new',
        data: { 'minted-session-id': '<authoringSessionId>' },
      },
      say: 'This is the fork in the road, and both branches are real: the operator can type the package into the form beside this one, or describe what they want and let the creation agent draft it. Same library, same scan, same approval — different amount of typing.',
    },
    {
      // AMEND-1, beat 3b — the navigation half. `open-minted-session` is a real
      // `<a href>` (`AuthoringLauncher.tsx`), which is what the runner needs:
      // it resolves a route only through `[data-nav][href]` or `a[href]` and
      // never drives a click and hopes.
      //
      // `session-phase` CORRECTED, not carried over. The unsplit beat asserted
      // `working`, which is a `data-lifecycle-state` token and NOT a phase of
      // this kind: authoring's table is `analyzing` -> `awaiting-review` ->
      // `committing` -> `committed`/`rejected` (`studio/session-kinds.yaml`),
      // and the mint is written at `analyzing`
      // (`packages/sessions/bridge-studio-kickoff.ts`). §15.240 is the lesson
      // lane A bought on S9 beat 7 for the same value; T1's ruling 503 swept
      // every `session-phase` assertion in S1–S9 and found it at exactly three
      // sites, this being one. The route never resolved, so this assertion had
      // never once been judged — it was simply the next red.
      act: 'Open the authoring session it just started',
      do: [{ press: 'open-minted-session' }],
      expect: {
        route: '/sessions/authoring/<authoringSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'authoring',
          'session-phase': 'analyzing',
        },
      },
      say: 'Forge mints the session and says so on the page the operator is already standing on, rather than moving them somewhere they did not ask to go. Reaching it is the operator\u2019s own next act.',
    },
    {
      // AMEND-1 (ruling 460). This beat's red was filed as a MISSING HANDLE and
      // it is not one. `SessionInteractivePanel.tsx` renders
      // `session-package-id`, gated generically on `affordance.meta.requires`,
      // and authoring's `awaiting-review` row is the one that declares it
      // (`requires: [id]`). The kind's phases are `analyzing` — where the agent
      // runs and writes `staging/` — then `awaiting-review`, where the operator
      // reviews. The field belongs to the SECOND. The beat filled it while the
      // agent was still in the first, and `performSteps` runs a `fill` BEFORE
      // any consequence wait, so it timed out against a control that had not
      // rendered YET — which is what the runner's own words said and what was
      // read as "not at all" (§15.251).
      //
      // So the beat declares the wait its act implies: the operator does not
      // type into a draft that does not exist yet. And it asserts the phase it
      // waited for, so a red here says "the agent never finished" rather than
      // "a field timed out" — the operator chose the stronger form at the
      // sitting.
      //
      // Consequence: bead `forge-8vfn.7.3.1` is NOT lane A's product work.
      // Nothing is owed by A here.
      //
      // AMEND-2 (T1 ruling 619, from 618's static trace). This beat asserted
      // `skill-trust: 'ready'` and its own `do` could never cause it. There are
      // TWO approvals here and they are different acts on different surfaces:
      //
      //   1. the SESSION's `verdict-approve`, below — finalises the authoring
      //      session and INSTALLS the package, as a DRAFT;
      //   2. the LIBRARY's own `Approve` on `/skills/<id>`, beat 5a — runs
      //      `approveSkillDraft`, the only thing that deletes `status: draft`
      //      and therefore the only thing that makes trust read `ready`.
      //
      // `draft` here is DETERMINISTIC, not this run's luck. The finalize lands
      // the package in `_interactive-library/<id>/` and then INSTALLS it —
      // `bridge-studio-authoring.ts:383` -> `finalizeSkillFromLanded` ->
      // `installSkillPackage`, and `skill-install.ts:195-196` writes
      // `status: draft` + `library: false` UNCONDITIONALLY, whatever the
      // authoring agent typed into its frontmatter (a drafted `library: true`
      // is quarantined by D4). Pinned end to end through the live route at
      // `bridge-studio-authoring-finalize.test.ts:350-365`. So no agent output
      // can make this beat read `ready`, and none can make 5a's control absent.
      //
      // The second gate is deliberate product truth, not an accident: it is the
      // same trust gate the operator ruled S8 beat 9 behind. So the beat now
      // asserts the state its OWN act produces — `draft` — and beat 5a performs
      // the second act and asserts `ready`. 504's class, S6 11a/11b's split.
      //
      // The trace that settled it, recorded because it also resolves an
      // apparent contradiction in run 1's capture: the fill IS honoured end to
      // end (`bridge-studio-authoring.ts:496` reads the body's `id`, `:303`
      // writes `package_id`, `interactive-agent-step.ts:350` reads it into
      // `FinalizerContext.packageId`), and the authoring kind has NO
      // `step: finalize` phase, so the agent cannot install under a name of its
      // own. Run 1's frame showed the title `md-link-checker` while the
      // `skill-id` assertion PASSED because `app/skills/[id]/page.tsx:182`
      // renders the frontmatter NAME and `:174` sets `data-skill-id` from the
      // DIRECTORY. Both were true of the same instant.
      act: 'Read what it drafted, give the package its directory name, and approve it',
      wait: { for: 'agent', upTo: 300_000 },
      do: [
        { fill: 'session-package-id', with: 'story-s7-skill' },
        { press: 'verdict-approve' },
      ],
      expect: {
        route: '/skills/story-s7-skill',
        data: {
          page: 'skill-detail',
          'skill-id': 'story-s7-skill',
          'page-ready': 'true',
          // The honest state the session's approve produces. An installed
          // package is a DRAFT: quarantined, not palette-visible, not runnable.
          'skill-trust': 'draft',
        },
      },
      say: 'The agent drafts; the operator names and approves. Nothing an agent wrote enters the library on the agent’s own say-so, and the id the operator types is the directory it lands in — as a draft, which is not the same as trusted.',
    },
    {
      // AMEND-2 (ruling 619) — beat 5a, the SECOND approval, and the reason the
      // split exists rather than a looser assertion on beat 5. Finishing the
      // authoring session installs the package; it does not trust it. The
      // library’s own approval gate is a separate, deliberate act on a separate
      // surface, and a story that skipped it would report the trust gate as
      // free.
      act: 'Trust it: approve the draft in the library',
      do: [{ press: 'approve-skill' }],
      expect: {
        route: '/skills/story-s7-skill',
        data: {
          page: 'skill-detail',
          'skill-id': 'story-s7-skill',
          'page-ready': 'true',
          'skill-trust': 'ready',
        },
      },
      say: 'Two approvals, because they answer different questions. The first says the draft is finished; this one says you trust it enough to let an agent load it. Until this press the package is installed, quarantined and invisible to every palette — which is what a trust gate is for.',
    },
    {
      // AMENDED after the first run (2026-08-30, same authoring session,
      // re-pinned). The first draft folded "go back to the Library" and "press
      // + New hook" into one beat, and the runner was right to red it: `do`
      // acts on the page the operator is STANDING on, and the hook CTA is not
      // on the skill page. Going back to the parts bin is its own act. NOT ONE
      // ASSERTION CHANGED — the story got truer, not easier.
      act: 'Go back to the Library',
      expect: {
        route: '/library',
        data: { page: 'library', 'page-ready': 'true', section: 'hooks' },
      },
      say: 'The Library is where the operator returns between kinds. Each shelf is a different sort of part, and the next one is the only sort that is executable code.',
    },
    {
      // Fully expressible — the Hooks shelf's own create CTA.
      act: 'Press "+ New hook"',
      do: [{ press: 'new-hook' }],
      expect: {
        route: '/hooks/new',
        data: { page: 'hook-builder', 'page-ready': 'true', section: 'hook-new' },
      },
      say: 'A hook is the other kind of part: not instructions but a script, run on an agent’s lifecycle event. It is the only thing in the library that is executable code, which is why it is the only thing with a security gate in front of it.',
    },
    {
      // Fully expressible — every field on this form declares a real
      // `data-field`, and this is the MANUAL door, the other case of beat 3's
      // fork. A hook this small is exactly the kind an operator writes by hand
      // rather than paying an agent to draft.
      //
      // AMEND-1 (ruling 415): the `hook-matcher` fill is REMOVED, and the
      // product was right to refuse it. A matcher is a tool-NAME pattern, so
      // `hook-library.ts` rejects one on an event that carries no tool
      // (`TOOL_SCOPED_HOOK_EVENTS` is `['PreToolUse','PostToolUse']`), and a
      // door test already pins the identical payload. At measurement time the
      // form still OFFERED the field, the create came back 400, the page
      // stayed on `/hooks/new`, and beats 7, 8, 9 and 10 all failed behind it
      // on `no real-nav path to "/hooks/story-s7-hook"`.
      //
      // The product half has since landed on main and names this beat as its
      // measurement: `/hooks/new` now renders the matcher input only when
      // `eventCarriesTool(on)`, and a `[data-section="hook-matcher-unavailable"]`
      // note in its place otherwise. So for `SessionEnd` the field does not
      // exist at all, and this story's remaining defect is entirely its own
      // — a `fill` against a control the page correctly does not render.
      //
      // Removing the line is what the beat already meant. Its own `say` is
      // about the PERMISSIONS fields and never mentions the matcher, and
      // `SessionEnd` has to stay because the last beat of this story is "watch
      // the hook fire on the session ending". The act's words lose "what it
      // matches" for the same reason.
      act: 'Write the hook by hand: what it runs on, what it does, and what it may touch',
      do: [
        { fill: 'hook-name', with: 'story S7 hook' },
        { fill: 'hook-description', with: 'Note that a session ended, so the ledger has something to show.' },
        { fill: 'hook-on', with: HOOK_EVENT },
        { fill: 'hook-script-body', with: HOOK_SCRIPT },
        { fill: 'hook-permissions-env', with: '' },
        { fill: 'hook-permissions-read', with: '' },
        { fill: 'hook-permissions-network', with: '' },
        { press: 'create-hook' },
      ],
      expect: {
        route: '/hooks/story-s7-hook',
        data: {
          page: 'hook-detail',
          'hook-id': 'story-s7-hook',
          'page-ready': 'true',
          'hook-event': HOOK_EVENT,
        },
      },
      say: 'The permissions fields are the operator declaring, up front, what this script is allowed to reach. They are also what the scanner checks the script against — a behaviour the manifest declares is still counted, because the declaration is written by whoever wrote the script.',
    },
    {
      // Fully expressible. All three scan keys are the same
      // `[data-section="scan-report"]` element. `clean` with zero findings is
      // the target for a script this small; a `blocked` verdict here would be
      // the scanner working, not the story failing.
      act: 'Read the security scan before trusting it',
      expect: {
        route: '/hooks/story-s7-hook',
        data: {
          page: 'hook-detail',
          'hook-id': 'story-s7-hook',
          'scan-verdict': 'clean',
          'finding-count': '0',
          'critical-count': '0',
        },
      },
      say: 'This is the gate that exists because a hook runs with the operator’s own credentials. The scan is static, it is shown before the approval and not after, and a declared behaviour is downgraded but still counted — never hidden.',
    },
    {
      // Fully expressible as an assertion. `package-file-count` and
      // `package-hash` are what the operator is actually approving: the WHOLE
      // package, every file with its own hash, not just the entry script.
      // `package-file-count` sits on the section, `package-hash` on the page
      // root, so the root's own key resolves there and the section answers the
      // other.
      act: 'Check what is actually in the package — every file, and the fingerprint over all of them',
      expect: {
        route: '/hooks/story-s7-hook',
        data: {
          page: 'hook-detail',
          'hook-id': 'story-s7-hook',
          'package-hash': '<hookPackageHash>',
          'package-file-count': '2',
        },
      },
      say: 'Approving bytes you were never shown is not approving. The page lists every file in the package with its own hash and the fingerprint over the set, so a sibling script the entry point quietly sources cannot ride along unseen.',
    },
    {
      // Fully expressible. `approve-hook` is enabled only when the verdict is
      // not blocked and trust is `needs-review` — approval can never launder a
      // blocked verdict, which is why beat 7 comes first. `hook-trust` and
      // `hook-runnable` are both on the page root. There is no "declined"
      // state in the ledger (`forge-8vfn.5.2`): the inverse act is a REVOKE
      // after the fact, recorded, never a silent erase.
      act: 'Approve the hook',
      do: [{ press: 'approve-hook' }],
      expect: {
        route: '/hooks/story-s7-hook',
        data: {
          page: 'hook-detail',
          'hook-id': 'story-s7-hook',
          'hook-trust': 'approved',
          'hook-runnable': 'true',
        },
      },
      say: 'Trust and verdict are two different axes, and this is the trust one. Approved and runnable is the state that lets an agent carry it; until the operator pressed this, the hook was a file on disk that nothing would ever execute.',
    },
    {
      // Fully expressible — the manual door again, and every field declares a
      // real `data-field`. `/templates/new` is reached from the Library's own
      // Templates shelf CTA.
      act: 'Go back to the Library once more',
      expect: {
        route: '/library',
        data: { page: 'library', 'page-ready': 'true', section: 'templates' },
      },
      say: 'Third kind, same parts bin.',
    },
    {
      // Fully expressible — the Templates shelf's create CTA, then the form,
      // every field of which declares a real `data-field`.
      //
      // AMEND-1 (ruling 484, no choice to make): `template-category` is a
      // `<select>` offering exactly `planning` and `demo-output`, and
      // `apps/studio/app/templates/new/page.tsx` says in its own comment that
      // `planning` IS the category written to `studio/artifact-templates/<id>.md`.
      // The beat had been filling the DIRECTORY where the category goes. The
      // product is right; this is a transcription error in the story.
      act: 'Press "+ New template" and write the template the hook’s output is filed into',
      do: [
        { press: 'new-template' },
        { fill: 'template-category', with: 'planning' },
        { fill: 'template-id', with: 'story-s7-template' },
        { press: 'create-template' },
      ],
      expect: {
        route: '/templates/story-s7-template',
        data: { page: 'template-detail', 'page-ready': 'true' },
      },
      say: 'A template is one markdown definition file — the shape an artifact comes out in. It is the least dramatic thing in the library and the one that decides whether two runs produce comparable output.',
    },
    {
      // AMEND-1, NAVIGATION (ruling 504). Route and readiness only: no `do`,
      // no fill, no press, no product claim. The runner reaches a beat's route
      // by clicking a link on the CURRENT page whose pathname matches it, so a
      // beat declaring a route the operator can actually walk to IS the act —
      // this is the runner's own model, not an invention.
      //
      // WHY THREE HOPS, AND WHY THAT IS A FINDING. `/sessions/instructions/new`
      // is linked from exactly ONE place in the whole product —
      // `SessionsIndex`'s kickoff row (`KICKOFF_ENTRIES`,
      // `apps/studio/lib/session-kind-meta.ts`) — and `/sessions` is NOT one of
      // `StudioNav`'s seven pillars (Home / Monitor / Projects / Flows /
      // Agents / Library / Knowledge). So from a template page the shortest
      // real path an operator can walk is: a pillar to Agents, its
      // `sessions-secondary` entry to Sessions, then the kickoff link. Three
      // hops to reach the launcher for a component kind the library itself
      // offers. Recorded as an IA finding in
      // `_1.0/gate-manifests/M1-C-S7.amend-1.md`, not filed as a story defect.
      //
      // Agents rather than Home: `AgentsIndexView` calls its link "this kind's
      // secondary-nav entry point" in its own comment, and beat 14 goes to an
      // agent anyway, so this is the operator's own direction of travel.
      act: 'Head for the Agents pillar',
      expect: {
        route: '/agents',
        data: { page: 'agents-index', 'page-ready': 'true' },
      },
      say: 'Instructions are the fourth kind of part, and the only door to them is through Sessions — which is not a pillar. Getting there is three clicks from the parts bin.',
    },
    {
      // AMEND-1, NAVIGATION (504). Same shape.
      act: 'Follow the Sessions entry',
      expect: {
        route: '/sessions',
        data: { page: 'sessions-index', 'page-ready': 'true' },
      },
      say: 'Every session forge has ever run is here, and so is the only list of the kinds it can start.',
    },
    {
      // AMEND-3 (T1 ruling 638) — THE HOP AMEND-1 STOPPED ONE SHORT OF.
      //
      // Amend-1 added the two navigation beats above to make the instructions
      // launcher REACHABLE, and they land the operator on `/sessions` — the
      // page that LINKS to the launcher. They never land on the launcher
      // itself, and the next beat's first act is a `fill` for a field that
      // only exists there.
      //
      // MEASURED in run 1, and the timestamps are the whole finding:
      //
      //   04:15:06.202  ✓ 15. Follow the Sessions entry
      //   04:15:06.207  while waiting on [data-field="kickoff-project"]: no element carries that handle yet
      //   04:15:21.252  ✗ 16. … Timeout 14999ms exceeded
      //
      // The wait armed FIVE MILLISECONDS after the previous beat went green and
      // spent the full DOM bound. **Nothing navigated in between.** It was not
      // racing a transition — it was waiting on a page that never had the
      // field and never would.
      //
      // WHY A PURE NAVIGATION BEAT IS THE FIX, and not a longer wait or a
      // harness change: `driveBeat` runs `performSteps`
      // (`beats-drive.mjs:182`) BEFORE route resolution (`:245`) and before the
      // navigation section (`:374`). That is ruling 504 working exactly as
      // written — a beat's `do` acts on the page the operator is STANDING on.
      // A beat with no `do` skips the step phase entirely and reaches the
      // navigation section, which is why this shape works where a `fill` does
      // not. Same instrument as beats 3b and 13b.
      //
      // The assertions are measured, not assumed: a walk of this route (no
      // agent, no spend) read `data-page="session-kickoff"` with
      // `data-page-ready="true"` 250 ms after the click, and `/sessions`
      // carries exactly ONE link to `/sessions/instructions/new` — the
      // Sessions index's kickoff row, which is the IA finding amend-1 already
      // recorded.
      act: 'Open the instructions launcher',
      expect: {
        route: '/sessions/instructions/new',
        data: { page: 'session-kickoff', 'page-ready': 'true' },
      },
      say: 'Three hops from the parts bin to the door for the fourth kind of part, and this is the third: the launcher itself. The story walks it rather than teleporting, because an operator cannot teleport.',
    },
    {
      // AMEND-1, beat 13a of a split — the same class as beat 3 (rulings
      // 396/406/409, class-stated by 483). `<instructionsSessionId>` was
      // unbindable for the same reason: this beat's own press mints it, and
      // the runner resolves a route before performing any `do` step.
      //
      // Confirmed live on this kind's own launcher: `/sessions/instructions/new`
      // publishes `data-minted-session-id` from first paint and carries
      // `data-action="start-session"`; `open-minted-session` appears only once
      // a session exists, which is the deliberate shape — absence and "not
      // known yet" must not be the same reading.
      //
      // No ceiling is set here and none is invented: unlike the architect
      // kickoff, this form declares no `cost-ceiling-usd` field at all — read
      // live — so the run takes the policy default.
      //
      // A THIRD DEFECT IN THIS BEAT, and the three beats above are its fix
      // (T1 ruling 504: a PURE navigation beat is inside the split's scope).
      // The beat could not be REACHED. `do` acts on the page the operator is
      // standing on, the previous beat leaves them on
      // `/templates/story-s7-template`, and the runner reaches a beat's route
      // by clicking a link on the CURRENT page whose pathname is that route —
      // it never falls back to `page.goto` (`scripts/stories/beats-drive.mjs`).
      // Nothing on a template page links to this launcher, so the `fill` had
      // nowhere to land. Invisible until the split, because route resolution
      // failed FIRST on every run and the `do` steps never ran.
      act: 'Draft the project’s own working instructions, so the parts have a house style to follow',
      do: [
        { fill: 'kickoff-project', with: 'mdtoc' },
        { press: 'start-session' },
      ],
      expect: {
        route: '/sessions/instructions/new',
        data: { 'minted-session-id': '<instructionsSessionId>' },
      },
      say: 'Instructions are the fourth kind of component and the only one that is about the project rather than about forge: the AGENTS.md every agent dispatched at this repo reads before it does anything.',
    },
    {
      // AMEND-1, beat 13b — the navigation half, the same shape as 3b.
      // Deliberately asserts NO `session-phase`: the unsplit beat never
      // asserted one, and inventing one here would be adding a claim the
      // sitting did not confirm. `page-ready` and the kind are what the beat
      // always said.
      act: 'Open the instructions session it just started',
      do: [{ press: 'open-minted-session' }],
      expect: {
        route: '/sessions/instructions/<instructionsSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'instructions',
        },
      },
      say: 'Same shape as the skill: forge mints the session and says so where the operator already is, and reaching it is their own next act.',
    },
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
      // Same assertions as beat 15's arrival at this route, deliberately:
      // route plus `page` and `page-ready`, and nothing else. No judgement
      // content, which is what 504's class allows to be authored without going
      // back to the operator.
      act: 'Head back to the Agents pillar',
      expect: {
        route: '/agents',
        data: { page: 'agents-index', 'page-ready': 'true' },
      },
      say: 'The parts are all made now — a skill, a hook, a template, a house style. None of them does anything yet. Binding happens on a worker\u2019s own page, and the only way back to a worker is the pillar the operator started from.',
    },
    {
      // NOT expressible. Binding a hook to an agent means adding it to the
      // builder's `[data-accepts="hook"]` drop zone, and the only way to do
      // that is to click a `.catalog-chip[data-id="story-s7-hook"]
      // [data-kind="hook"]` — no `data-action`, so no `do` verb can name it.
      // This is S5's finding on the same surface. `accepts` and `count` are
      // the same zone, so one element answers both. The guard and hook zones
      // are DISTINCT by design and must never merge, which is why this beat
      // names the hook zone specifically.
      act: 'Open an agent from the Agents pillar and bind the hook to it',
      expect: {
        route: '/agents/brain-ingest',
        data: { page: 'agents', 'agent-id': 'brain-ingest', accepts: 'hook', count: '1' },
      },
      say: 'A hook is inert until an agent carries it. Binding is the act that makes a library part part of a worker, and it is the reason the hook’s own page counts how many agents carry it.',
    },
    {
      // NOT expressible, and this is the beat §3's row ends on. NOTHING in
      // `forge-ui` names a hook EXECUTION — the whole declared hook
      // vocabulary is `data-hook-count`, `-event`, `-id`, `-runnable`,
      // `-trust`, `-url`, `-verdict`, `-carried-by-count`, every one of them a
      // fact about the DEFINITION or its TRUST, none about a run. So the beat
      // asserts the dispatch it can see and names the firing it cannot, and
      // `_1.0/stories/S7.md` records the missing surface. Asserting
      // `carried-by-count` here instead would be reporting a BINDING as if it
      // were an EXECUTION, which is the fail-open shape this story exists to
      // catch.
      act: 'Run the agent, and watch the hook fire on the session ending',
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
      say: 'This is where S7 ends, and it ends on a claim the product does not yet make: that the hook the operator wrote, scanned, approved and bound actually RAN. A hook nobody can prove fired is a hook nobody should trust, and the whole gate in front of it — the scan, the package fingerprint, the approval — is spent guarding an event with no record.',
    },
  ],
};
