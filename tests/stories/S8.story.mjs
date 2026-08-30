/**
 * S8 — install library components from community (1.0.md §3, row S8).
 *
 * Operator flow: the library's fifth shelf is the only one forge did not
 * write. The operator reads where its contents actually come from, refreshes
 * it against those sources, then takes BOTH doors in — by URL and by id —
 * reads the pre-install security scan on the one that is executable code,
 * approves it, and finds it in the palette an agent composes from. Authored
 * 2026-08-30 against `parsoFish/main` d8d9df73, with the operator (H6), in the
 * amended draft-then-review mode. Green expected at M4.
 *
 * THE OPERATOR'S CORRECTION, 2026-08-30, and the beats it added. The first
 * draft went straight from "browse the registry" to installing. The operator
 * ruled that the flow is not complete without the sources themselves:
 *
 *     "we also need to include the community source and refreshing that to be
 *      a full and complete list consuming from the community sources"
 *
 * So beats 3-6 stand between opening the browser and installing anything, and
 * they are the beats that hold this surface to its own promise. Beat 3 pins
 * the BEFORE — nine declared hubs of which FOUR contribute nothing — beat 4
 * refreshes, and beats 5 and 6 are the completeness claim: after a refresh
 * every declared source contributes what it publishes, and no row is still a
 * hand-curated seed. `_1.0/stories/S8.md` records what actually happens.
 *
 * TWO DOORS, AND ONLY ONE IS A PATH. §3's row says "install by id AND by URL
 * — they are different paths". They are, and this lane verified live (probe
 * against a bridge booted from this worktree, the row removed again with `git
 * restore` immediately after) that only one of them ends in an install:
 * `/community/new` accepts an upstream URL, writes a real registry row, and
 * routes to `/community/skill/<id>` — where the install section renders
 * `data-install-action="browse-upstream"`, an outbound link. forge can only
 * install what is already VENDORED in its own repo. Beat 9 is that beat, and
 * it carries no `do`: `[data-action="install-community-item"]` is not on that
 * page at all, so there is nothing honest to press. The act names what the
 * operator came to do and stands.
 *
 * GROUND. `mdtoc` — the one project committed to this repo, so it is the only
 * project a CLEAN CHECKOUT has, and 1.0's exit condition is these stories
 * green on a clean checkout. Nothing in this flow needs the project: the
 * library is forge-wide. `realSpawn` is false and no `budget_usd` is declared
 * — not one beat reaches an agent. The "Refresh registry" button is the
 * deterministic, LLM-free `POST /api/studio/community/refresh`, real outbound
 * calls but no agent turn, so beat 4 costs no money either.
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this lane's own worktree (pid 2560406,
 * `/proc/<pid>/cwd` verified), EXCEPT the post-install states of beats 14-16,
 * which are transcribed from `/hooks/pre-pr-security-review` — a real hook in
 * the same `needs-review` state this install lands in — and from
 * `docs/forge-ui-dom-and-harness.md`'s `data-install-state` vocabulary.
 * Observing the post-install page live would have vendored the package into
 * the tree before the story ever ran it. None is invented. Read live and
 * load-bearing: `/community` reports `data-item-count="20"` across
 * `data-hub-count="9"`, `data-last-refresh="never"` and
 * `data-registry-dirty="false"`; `block-protected-branch-push` is the ONLY
 * hook in the registry and the only item with a pre-install scan
 * (`data-scan-verdict="clean"`, 0 findings, 0 criticals); `dependency-diff-
 * review` and it are the only two items whose install section reads
 * `data-install-action="install"` — every other skill reads `browse-upstream`.
 *
 * WHY BEAT 18 IS GROUNDED ON THE HOOK AND NOT A SKILL. `/agents/brain-ingest`
 * already renders `superpowers-tdd`, `webapp-testing`, `agent-browser` and
 * `output-compress` as `span.catalog-chip[data-kind="skill"]` — every one of
 * them `data-install-state="not-installed"` on `/community`. So a skill
 * assertion here would pass BEFORE the install and prove nothing; it is the
 * declared-data-fails-open shape these stories exist to catch, and
 * `_1.0/stories/S8.md` records it as a finding in its own right. The hook
 * group carries exactly two chips today, neither from the community, so the
 * third one appearing is a real claim about a real install.
 *
 * WHERE A BEAT CANNOT BE EXPRESSED it says so and stands anyway:
 *
 *   - Beat 11 filters with the search box rather than the kind buttons.
 *     `[data-action="filter-kind"]` is carried by FIVE buttons that differ
 *     only on `data-kind`, and `[data-action="filter-hub"]` by nine that
 *     differ only on `data-hub-id`; §3.1's `press` verb names a `data-action`
 *     and nothing else, so it cannot pick one of them. `community-search` is
 *     unique, real, and what an operator hunting one item actually uses.
 *     Recorded as a contract note, not re-filed — it is the neighbourhood of
 *     `forge-8vfn.2.22`.
 *   - Beat 4 asserts `data-refresh-state="refreshed"`. Pressed live from this
 *     worktree it returns `"refused"`: the deterministic refresh reads
 *     `GH_TOKEN` from the orchestrator's own environment and this host has
 *     none — `gh auth status` being logged in is NOT the same thing, by
 *     design (the refusal text says `GH_TOKEN` is deliberately kept off
 *     `AGENT_ENV_ALLOWLIST`). That refusal is the product behaving correctly
 *     about a precondition the ground does not meet, and `_1.0/stories/S8.md`
 *     attributes it to the environment, NOT to `library`. Beat 5's red is the
 *     one that belongs to `library`, and it stands whether or not a token is
 *     ever exported.
 *
 * SWEEP. `sweep.mjs` removes `projects/story-<id>` and
 * `brain/projects/story-<id>` only. Beat 8 writes a row into the repo-tracked
 * `studio/community/registry.yaml`, beat 4 rewrites the same file's
 * `meta.lastRefresh`, and beat 14 vendors a package into `studio/hooks/`.
 * None of the three is swept, so a second run meets a registry that already
 * carries `story-s8-skill` and a hook that is already installed. Bead
 * `forge-8vfn.2.26`, filed by the S4 lane for the same class and hit again by
 * S7; cited, not re-filed. This lane restored the tree by hand between runs.
 */

/** The registry row the operator adds from nothing but an upstream URL. */
const URL_ROW = {
  id: 'story-s8-skill',
  name: 'Story S8 skill',
  desc: 'A skill the operator found in the wild and gave forge the address of, rather than one forge already vendored.',
  category: 'testing',
  sourceUrl: 'https://github.com/parsoFish/forge-studio',
  provenance: 'parsoFish/forge-studio',
  tier: 'sonnet',
  attributedTo: 'parsoFish/forge-studio',
};

/** The one hook the registry carries, and the only item in it with a security scan. */
const HOOK_ID = 'block-protected-branch-push';

/** A hub that is DECLARED and contributes nothing — the completeness claim's own subject. */
const EMPTY_HUB = 'skills-sh';

/** The agent whose palette the installed part must appear in — a real one off the shipped roster. */
const AGENT_ID = 'brain-ingest';

export default {
  id: 'S8',
  ground: { project: 'mdtoc', realSpawn: false },
  docs: { kind: 'how-to', title: 'Install library components from the community' },
  beats: [
    {
      // Fully expressible. `section` and `count` are the same
      // `section.lib-section` element; `page` and `page-ready` are the root's.
      // The count IS pinned here, unlike S7's skills shelf: 20 is the whole
      // declared registry, and a clean checkout ships exactly that list.
      act: 'Open the Library and look at the shelf forge did not write',
      expect: {
        route: '/library',
        data: { page: 'library', 'page-ready': 'true', section: 'community', count: '20' },
      },
      say: 'Four of the Library’s shelves hold parts forge ships. The fifth holds what other people published, and nothing on it is installed — it is a catalogue, not an inventory.',
    },
    {
      // Fully expressible. The Community shelf carries `browse-community` and
      // deliberately no create CTA — an install routes through the pipeline
      // that owns the kind, never through the browser.
      act: 'Press "Browse community"',
      do: [{ press: 'browse-community' }],
      expect: {
        route: '/community',
        data: {
          page: 'community-browser',
          'page-ready': 'true',
          'item-count': '20',
          'hub-count': '9',
          'kind-filter': 'all',
          'last-refresh': 'never',
        },
      },
      say: 'One browser over four kinds — skills, hooks, MCPs and tools. It owns no trust decision at all: everything here either installs through the page that owns it, or says exactly why it cannot.',
    },
    {
      // Fully expressible, and this beat pins the BEFORE. All five keys are
      // the same hub chip. `skills-sh` is a REAL declared source with nothing
      // indexed from it — the honest "declared — nothing indexed" state, never
      // dropped from the strip and never presented as browsable. Three more
      // hubs read the same way today: `mcp-registry`, `smithery`,
      // `cc-templates`. This beat must STAY true until beat 4's refresh
      // happens, exactly as S3's beats 3-4 pin the drift a rebuild removes.
      act: 'Read where the twenty items actually come from',
      expect: {
        route: '/community',
        data: {
          page: 'community-browser',
          'page-ready': 'true',
          'hub-count': '9',
          action: 'filter-hub',
          'hub-id': EMPTY_HUB,
          'hub-item-count': '0',
          'hub-declared-only': 'true',
        },
      },
      say: 'Nine sources are declared and four of them contribute nothing. The count on each chip is derived per request, never claimed — so the strip is forge admitting, in the DOM, that its list of what the community publishes is a hand-curated seed rather than the sources’ own contents.',
    },
    {
      // Fully expressible AS AN ACT — `refresh-community-registry` is a real,
      // unique `data-action`, and it is the ONLY control on this browser that
      // can ever change what it shows. The VERDICT is what fails: pressed live
      // from this worktree it returns `data-refresh-state="refused"` because
      // the orchestrator process carries no `GH_TOKEN`. That is a ground
      // precondition, not a `library` defect, and `_1.0/stories/S8.md` says so.
      act: 'Refresh the registry against those sources',
      do: [{ press: 'refresh-community-registry' }],
      expect: {
        route: '/community',
        data: {
          page: 'community-browser',
          'page-ready': 'true',
          section: 'refresh-result',
          'refresh-state': 'refreshed',
        },
      },
      say: 'forge crawls nothing on its own — a refresh happens exactly when an operator asks for one, and this is the ask. It is deterministic and LLM-free: real outbound calls to the hubs, no agent turn, no verdict step, no spend.',
    },
    {
      // NOT satisfiable today, and this is the beat that owns the operator's
      // correction. A refresh re-verifies rows that already exist; it does not
      // index a hub's contents. The one mechanism that could — the interactive
      // community-refresh session kind — was RETIRED, so no path in the
      // product turns a declared source into a browsable one. Owning package
      // `library`.
      act: 'Check that every declared source now contributes what it publishes',
      expect: {
        route: '/community',
        data: {
          page: 'community-browser',
          'page-ready': 'true',
          'hub-count': '9',
          action: 'filter-hub',
          'hub-id': EMPTY_HUB,
          'hub-declared-only': 'false',
        },
      },
      say: 'This is what "browse the registry" has to mean: the list the operator browses is what the declared sources actually publish, not the subset somebody typed into a yaml file. A source that stays at zero after a refresh is a source forge has never really consumed.',
    },
    {
      // NOT satisfiable today — every card on this page reads
      // `data-freshness="seed"`, the spec-literal "seed — never verified".
      // The badge is the freshness-honesty contract: a null `fetchedAt` NEVER
      // renders a date. So this beat does not accuse the badge of lying; it
      // asserts that after a refresh there is nothing left for it to be
      // honest about.
      act: 'Check that no row is still a hand-curated seed',
      expect: {
        route: '/community',
        data: {
          page: 'community-browser',
          'page-ready': 'true',
          component: 'freshness-badge',
          freshness: 'fresh',
        },
      },
      say: 'Every row currently reads "seed — never verified", which is the truth and is exactly the problem. A registry the operator is about to install executable code from should be able to say when it last checked.',
    },
    {
      // Fully expressible — `add-registry-item` is a real `<a href="/community/new">`
      // in the header slot. This is the FIRST of §3's two doors: the operator
      // has a URL for something the registry does not carry.
      act: 'Take the first door in — press "+ Add item" to install by URL',
      do: [{ press: 'add-registry-item' }],
      expect: {
        route: '/community/new',
        data: { page: 'community-registry-form', 'form-mode': 'add', 'page-ready': 'true' },
      },
      say: 'The registry is a declared list, and this is how the operator declares something into it. Curation is not trust: adding a row says what is browsable, never what is safe to run.',
    },
    {
      // Fully expressible, and the ROUTE is verified live — this lane drove
      // this exact form against its own bridge and the submit landed on
      // `/community/skill/<id>`, then removed the row with `git restore`.
      // `registry-kind` is deliberately NOT filled: it is a DISABLED,
      // read-only "skill" (the CRUD surface admits only skills), so naming it
      // in a `fill` would be asserting a control the operator cannot touch.
      // The five starred fields are the ones `submit-registry-item`'s own
      // `data-disabled-reason` names.
      act: 'Give forge nothing but the upstream URL and what to call it',
      do: [
        { fill: 'registry-id', with: URL_ROW.id },
        { fill: 'registry-name', with: URL_ROW.name },
        { fill: 'registry-desc', with: URL_ROW.desc },
        { fill: 'registry-category', with: URL_ROW.category },
        { fill: 'registry-source-url', with: URL_ROW.sourceUrl },
        { fill: 'registry-provenance', with: URL_ROW.provenance },
        { fill: 'registry-tier', with: URL_ROW.tier },
        { fill: 'registry-attributed-to', with: URL_ROW.attributedTo },
        { press: 'submit-registry-item' },
      ],
      expect: {
        route: `/community/skill/${URL_ROW.id}`,
        data: {
          page: 'community-detail',
          'item-id': URL_ROW.id,
          'page-ready': 'true',
          'item-kind': 'skill',
          'install-state': 'not-installed',
        },
      },
      say: 'Star counts and last-checked dates are not on this form on purpose — they are facts a fetch establishes, not claims an operator types. A row added here reads "seed — never verified" until a refresh actually checks it.',
    },
    {
      // NOT expressible as an act — there is no install control on this page
      // to press. `[data-section="install"]` renders
      // `data-install-action="browse-upstream"` and a single outbound
      // `[data-action="browse-upstream"]` link carrying the URL the operator
      // just typed. Verified live on this exact row before it was removed, and
      // on `superpowers-tdd`, a real registry row that has been there all
      // along. So the beat carries no `do`: naming a press for a button that
      // is structurally absent would be inventing the affordance the story
      // exists to report missing. Owning package `library`.
      act: 'Install the thing that URL names',
      expect: {
        route: `/community/skill/${URL_ROW.id}`,
        data: {
          page: 'community-detail',
          'item-id': URL_ROW.id,
          'page-ready': 'true',
          section: 'install',
          'install-action': 'install',
        },
      },
      say: 'This is where §3’s two paths turn out to be one. forge can install what it has already vendored into its own repo; for everything else the answer is a link to somebody else’s website. Adding a row by URL makes an item browsable and never makes it installable.',
    },
    {
      // Fully expressible. The detail page's breadcrumbs carry a real
      // `<a href="/community">` — read live — so the return needs no `do`.
      // S7's lesson applies: going back is its own act, because a `do` block
      // acts on the page the operator is STANDING on and the search box is
      // not on this one.
      act: 'Go back to the browser',
      expect: {
        route: '/community',
        data: { page: 'community-browser', 'page-ready': 'true' },
      },
      say: 'Back to the catalogue, to take the door that does end in an install.',
    },
    {
      // Fully expressible. `community-search` is the ONE unique handle on this
      // page's filtering — the kind buttons all share `data-action="filter-kind"`
      // and the hub chips all share `data-action="filter-hub"`, so §3.1's
      // `press` verb cannot name a single one of them. The search matches
      // name, desc, id, category, hub label, attribution and upstream URL.
      // The card answers every key the root does not.
      act: 'Find the one item in the registry that is executable code',
      do: [{ fill: 'community-search', with: 'block-protected' }],
      expect: {
        route: '/community',
        data: {
          page: 'community-browser',
          'page-ready': 'true',
          'item-count': '1',
          'card-type': 'community-item',
          'item-id': HOOK_ID,
          'item-kind': 'hook',
          'item-hub': 'forge-seed',
          'install-state': 'not-installed',
        },
      },
      say: 'Twenty items and exactly one of them is a script. Skills, MCP entries and tools are instructions and addresses; a hook is code that will run with the operator’s own credentials, which is why the next two beats exist and the others do not need them.',
    },
    {
      // Fully expressible. `file-count` and `active-file` are the same
      // `[data-component="file-package"]` element — the SAME shared renderer
      // `/skills/[id]` and `/hooks/[id]` use, so the operator reads the
      // package here in the form they will read it after installing.
      act: 'Open it and read every file in the package before trusting any of it',
      expect: {
        route: `/community/hook/${HOOK_ID}`,
        data: {
          page: 'community-detail',
          'item-id': HOOK_ID,
          'page-ready': 'true',
          'item-kind': 'hook',
          'install-state': 'not-installed',
          component: 'file-package',
          'file-count': '2',
          'active-file': 'hook.yaml',
        },
      },
      say: 'Two files: the manifest that declares what it runs on and what it may touch, and the script itself. Both are readable here, before anything is written to disk.',
    },
    {
      // Fully expressible. All four keys sit on the same
      // `[data-section="security-scan"]` element. This is the REAL pre-install
      // scan, run on the vendored bytes while no install exists — distinct
      // from `/hooks/[id]`'s own `scan-report`, computed by the same scanner.
      act: 'Read the security scan that runs before the install exists',
      expect: {
        route: `/community/hook/${HOOK_ID}`,
        data: {
          page: 'community-detail',
          'item-id': HOOK_ID,
          'page-ready': 'true',
          section: 'security-scan',
          'scan-verdict': 'clean',
          'finding-count': '0',
          'critical-count': '0',
        },
      },
      say: 'The order is the whole point: scanned before installed, not installed then scanned. An operator who has to install something to find out whether it is safe has already run it.',
    },
    {
      // Fully expressible — the SECOND of §3's two doors, and the one that
      // works. `install-community-item` carries
      // `data-install-routed-to="hook-needs-approval"` (read live), the
      // browser stating which pipeline owns the trust decision it is refusing
      // to make. The post-install `install-state` is the
      // `docs/forge-ui-dom-and-harness.md` vocabulary token for a hook that
      // has landed and not been approved.
      act: 'Take the second door in — install it by id',
      do: [{ press: 'install-community-item' }],
      expect: {
        route: `/community/hook/${HOOK_ID}`,
        data: {
          page: 'community-detail',
          'item-id': HOOK_ID,
          'page-ready': 'true',
          'install-state': 'needs-review',
          section: 'install',
          'install-action': 'open-owning',
        },
      },
      say: 'Installed, and trusted by nobody. The browser hands the operator straight to the page that owns the decision it deliberately cannot make here.',
    },
    {
      // Fully expressible. Every key is on the page root — transcribed from
      // `/hooks/pre-pr-security-review`, a real hook sitting in exactly this
      // state, rather than observed post-install (which would have vendored
      // the package before the story ran). `hook-event` is read from the
      // package's own `hook.yaml`, which beat 12 has the operator reading.
      act: 'Follow it to the page that owns the trust decision',
      do: [{ press: 'open-owning-page' }],
      expect: {
        route: `/hooks/${HOOK_ID}`,
        data: {
          page: 'hook-detail',
          'hook-id': HOOK_ID,
          'page-ready': 'true',
          'hook-event': 'PreToolUse',
          'hook-trust': 'needs-review',
          'hook-runnable': 'false',
        },
      },
      say: 'A hook that came from a stranger arrives in the same state as one the operator wrote by hand: on disk, described, scanned, and refused permission to run. Provenance buys it nothing.',
    },
    {
      // Fully expressible. `approve-hook` is enabled only when the verdict is
      // not blocked and trust is `needs-review` — approval can never launder a
      // blocked verdict, which is why beat 13 comes first. The ledger stores
      // approvals and revocations only and has no "declined" state
      // (`forge-8vfn.5.2`), so this beat asserts approval rather than a
      // decision either way.
      act: 'Approve it',
      do: [{ press: 'approve-hook' }],
      expect: {
        route: `/hooks/${HOOK_ID}`,
        data: {
          page: 'hook-detail',
          'hook-id': HOOK_ID,
          'page-ready': 'true',
          'hook-trust': 'approved',
          'hook-runnable': 'true',
        },
      },
      say: 'One press, and a file somebody else wrote becomes something forge will execute. That is the whole reason every beat since the search box was about reading rather than clicking.',
    },
    {
      // Fully expressible — `a[data-nav="agents"]` is on every page. The
      // agents index is the only real route from a hook page to a specific
      // agent: `[data-section="carried-by"]` reads
      // `data-carried-by-count="0"` for a freshly approved hook, so it offers
      // no link to follow. `data-agent-count` is deliberately NOT pinned — the
      // roster is 12 today and an agent added later has nothing to do with
      // whether a community install reached the palette.
      act: 'Open the Agents pillar',
      expect: {
        route: '/agents',
        data: { page: 'agents-index', 'page-ready': 'true' },
      },
      say: 'A library part is inert until something composes it. The last question this story asks is whether the thing the operator just approved is now available to build with.',
    },
    {
      // The beat §3's row ends on. `data-id` and `data-kind` are the same
      // `span.catalog-chip`; `page`, `page-ready` and `agent-id` are the
      // root's. Grounded on the HOOK deliberately — see WHY BEAT 18 IS
      // GROUNDED ON THE HOOK in the header: the skill groups already carry
      // community skills nobody installed, so a skill assertion here would be
      // green before beat 14 ever ran and would report a CATALOGUE ENTRY as
      // though it were an INSTALL. The hook group carries two chips today,
      // both forge's own.
      act: 'Find the installed hook in the palette an agent composes from',
      expect: {
        route: `/agents/${AGENT_ID}`,
        data: {
          page: 'agents',
          'page-ready': 'true',
          'agent-id': AGENT_ID,
          id: HOOK_ID,
          kind: 'hook',
        },
      },
      say: 'This is where S8 ends and where a community install becomes real: not when the bytes land, and not when the operator approves them, but when the thing shows up in the bin an agent is built out of. Anything short of that is a download.',
    },
  ],
};
