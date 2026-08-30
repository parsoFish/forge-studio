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
 * panel, transcribed from `docs/forge-ui-dom-and-harness.md` (observing an
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
      // Fully expressible AS AN ACT — all three handles are real
      // (`authoring-launcher-project` is an <input>, not a select). The ROUTE
      // is what fails: `start-authoring` POSTs and pushes straight to
      // `/sessions/authoring/<sid>`, so the id is never rendered as a `data-*`
      // an earlier beat could observe. Bead `forge-8vfn.5.10`.
      act: 'Describe the skill to the creation agent instead of writing the package by hand',
      do: [
        { fill: 'authoring-launcher-project', with: 'mdtoc' },
        { fill: 'authoring-launcher-prompt', with: SKILL_BRIEF },
        { press: 'start-authoring' },
      ],
      // Not in §3.1's schema, and dropped by `validateStory` — see THE FORK
      // above. Both doors on this page must reach the same approved package;
      // a story that proves one of two proves the door, not the promise.
      fork: { over: 'authoring-door', cases: DOORS },
      expect: {
        route: '/sessions/authoring/<authoringSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'authoring',
          'session-phase': 'working',
        },
      },
      say: 'This is the fork in the road, and both branches are real: the operator can type the package into the form beside this one, or describe what they want and let the creation agent draft it. Same library, same scan, same approval — different amount of typing.',
    },
    {
      // NOT expressible — the same unbound segment as beat 3.
      // `session-package-id` is the ONE field the retired bespoke authoring
      // panel left behind, and `verdict-approve` is the generic panel's
      // action; both are transcribed from `docs/forge-ui-dom-and-harness.md`
      // rather than observed, because observing them costs a creation-agent
      // spawn. The route it lands on is the skill's own detail page — the
      // panel navigates there on a package-shaped approve.
      act: 'Read what it drafted, give the package its directory name, and approve it',
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
          'skill-trust': 'ready',
        },
      },
      say: 'The agent drafts; the operator names and approves. Nothing an agent wrote enters the library on the agent’s own say-so, and the id the operator types is the directory it lands in.',
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
      act: 'Write the hook by hand: what it runs on, what it matches, what it does, and what it may touch',
      do: [
        { fill: 'hook-name', with: 'story S7 hook' },
        { fill: 'hook-description', with: 'Note that a session ended, so the ledger has something to show.' },
        { fill: 'hook-on', with: HOOK_EVENT },
        { fill: 'hook-matcher', with: '*' },
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
      act: 'Press "+ New template" and write the template the hook’s output is filed into',
      do: [
        { press: 'new-template' },
        { fill: 'template-category', with: 'studio/artifact-templates' },
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
      // NOT expressible — `<instructionsSessionId>` is another of
      // `forge-8vfn.5.10`'s mint-then-navigate sites. The kickoff form's own
      // handles ARE real, so the act is honest; only the route it lands on
      // cannot be bound. No ceiling is set here and none is invented: unlike
      // the architect kickoff, this form declares no `cost-ceiling-usd` field
      // at all — read live — so the run takes the policy default.
      act: 'Draft the project’s own working instructions, so the parts have a house style to follow',
      do: [
        { fill: 'kickoff-project', with: 'mdtoc' },
        { press: 'start-session' },
      ],
      expect: {
        route: '/sessions/instructions/<instructionsSessionId>',
        data: {
          page: 'session',
          'page-ready': 'true',
          'session-kind': 'instructions',
        },
      },
      say: 'Instructions are the fourth kind of component and the only one that is about the project rather than about forge: the AGENTS.md every agent dispatched at this repo reads before it does anything.',
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
