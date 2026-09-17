/**
 * proof — the form-driven proof story (M1-F, bead `forge-8vfn.2.17`).
 *
 * The smoke story proves the triple output on a flow made entirely of links.
 * This one proves the three things §3.1's beat schema could not express, found
 * when S1 ran `red — 0/10` with not one red beat a product gap:
 *
 *   1. a beat PRESSES a control and FILLS fields — beat 5 presses
 *      `[data-action="onboard-project"]`, verified live as `tag=BUTTON`,
 *      `href=null`, `disabled` until the fields are filled. No link reaches
 *      `/projects/story-proof` before that press;
 *   2. `expect.data` resolves NESTED `data-*` — `card-type`/`card-id` live on
 *      the project card and `section` on the onboard panel, never on
 *      `main[data-page]`, and `docs/reference/studio-dom-contract.md` says nested
 *      `data-*` IS the contract;
 *   3. a beat BINDS a route segment a prior beat produced — beat 1 binds
 *      `<someProjectId>` from whatever the product discovered on disk, and
 *      beat 2 navigates to it. The story never writes that id.
 *
 * WHY BEAT 1 SAYS `among: { 'card-id': 'tracked-projects' }` (`forge-8vfn.26`).
 * Beat 1 used to take whichever card came first, and "first" is a property of
 * the RUNNING CHECKOUT's `projects/` directory, not of the product: one lane
 * holds `gitpulse` and `mdtoc`, CI holds `mdtoc` alone, and the committed
 * `story.json` recorded `gitweave` from a third lane. Every lane that ran the
 * mandatory costless step rewrote the artifact to its own listing, so the file
 * never converged — whoever committed last won.
 *
 * The fix is a RULE, never an id. Naming the project here would converge the
 * artifact and destroy mechanism 3 above: a placeholder is bind-or-assert, never
 * both, so the moment this beat states which card it wants, `<someProjectId>`
 * has nothing left to bind and this story stops proving the one thing only it
 * proves. Sorting the cards would keep the binding and NOT converge — still
 * `gitpulse` here and `mdtoc` in CI.
 *
 * Restricting the candidates to projects git TRACKS gets both: the product is
 * still what answers, the story still writes no id, and the answer is identical
 * in every checkout and in CI because that is what tracked means. The rule is
 * resolved once at LOAD (`story-file.mjs`), so a tree where it cannot be
 * answered refuses by name instead of reaching this beat and reding as though
 * the product had rendered no cards.
 *
 * COSTLESS BY CONSTRUCTION: no `realSpawn`, no budget, so CI runs it. That is
 * why it proves route binding on `/projects/<id>` rather than S1's
 * `/sessions/<kind>/<sessionId>` — minting a session means dispatching an
 * Agent, and a permanently costed proof story would refuse to start without
 * `--approve-spend` and so never run in CI. The mechanism is the same one; the
 * session case is proven end-to-end by S1 against the real product.
 *
 * THE FIXTURE. Beat 5 scaffolds a real project. It is named `story-proof` —
 * `story-<id>`, the reserved fixture namespace `sweep.mjs` owns — so the
 * crash-safe leading sweep removes it however a run dies.
 */
export default {
  id: 'proof',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to', title: 'Onboard a project from the Projects pillar' },
  beats: [
    {
      act: 'Open Studio on the Projects pillar',
      expect: {
        route: '/projects',
        data: {
          page: 'projects-index',
          'page-ready': 'true',
          'card-type': 'project',
          'card-id': '<someProjectId>',
        },
        // The binding is answered by a card for a project this REPOSITORY
        // carries, not by whichever card the running checkout happens to render
        // first. See the header: a rule, never an id.
        among: { 'card-id': 'tracked-projects' },
      },
      say: 'The Projects pillar lists every project forge manages. Each card carries the project it stands for, so the operator can pick one without reading the page.',
    },
    {
      act: 'Click the card for a project this repository carries',
      expect: { route: '/projects/<someProjectId>', data: { page: 'projects', 'page-ready': 'true' } },
      say: 'The card is a real link to that project’s own page — the route is the project the previous beat found, not one written down in advance. The story names a rule for which card may answer, never the project itself.',
    },
    {
      act: 'Go back to the Projects pillar',
      expect: { route: '/projects', data: { page: 'projects-index', 'page-ready': 'true' } },
      say: 'The Projects pillar is one click away from anywhere in Studio.',
    },
    {
      act: 'Click "Onboard a project"',
      expect: {
        route: '/projects/new',
        data: { page: 'projects', 'project-id': 'new', 'page-ready': 'true', section: 'project-onboard' },
      },
      say: 'Onboarding asks for the few things a Factory needs before it can build a repo: what to call it, the quality gate that judges its work, and the north star that tells a planner what it is for.',
    },
    {
      act: 'Fill in the name, the quality gate and the north star — and under Advanced, the repo path — then press "Onboard project →"',
      do: [
        { fill: 'project-name', with: 'story-proof' },
        { fill: 'quality-gate', with: 'npm test' },
        { fill: 'north-star', with: 'A throwaway project proving the story runner can fill a form and press a button.' },
        { press: 'toggle-onboard-advanced' },
        { fill: 'repo-path', with: 'projects/story-proof' },
        { press: 'onboard-project' },
      ],
      expect: {
        route: '/projects/story-proof',
        data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' },
      },
      say: 'Registering the project lands the operator on its page. Nothing linked here a moment ago — the route exists because the button was pressed, which is how every one of forge’s operator flows works.',
    },
  ],
};
