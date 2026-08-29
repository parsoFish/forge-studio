/**
 * S1 — onboard an existing project (1.0.md §3, row S1).
 *
 * Operator flow: a code repo already sits on disk with no `.forge/`; the
 * operator brings it under forge and gets to a first approved architect plan.
 * Authored interactively with the operator (H6) on 2026-08-29 against
 * `parsoFish/main` a592b1f3. Green expected at M5.
 *
 * GROUND. `projects/gitweave` is a clone of `parsoFish/GitWeave` (Python) with
 * **no `.forge/` directory**. That absence is the starting state, not a fault:
 * Studio already discovers the repo and reports it as
 * `health="attention"` / "no .forge/project.json — onboarding is unfinished".
 * The story never creates `.forge/` by hand — the point is that forge creates
 * it. The flow ends at an approved architect plan, which is a real Agent
 * spawn, so `realSpawn` is true and `budget_usd` is declared: the runner
 * refuses to start without `--approve-spend` (H2).
 *
 * ON THE `data-*` KEYS. Every key and value below was copied from the live DOM
 * of a bridge booted from this worktree — none is invented. Some of them sit
 * on nested elements (the project card, the onboard section) rather than on
 * `main[data-page]`, and today's runner reads only `main`'s own attributes.
 * That is deliberate, and it is the operator's ruling of 2026-08-29: a beat
 * records what the operator observes, and the story outlives the runner.
 * Narrowing these assertions to fit today's harness would be bending the story
 * to the product one layer down. Where this story goes red on a harness limit
 * rather than a product gap, `_1.0/stories/S1.md` says so and names the owner.
 */
export default {
  id: 'S1',
  ground: { project: 'gitweave', realSpawn: true, budget_usd: 15 },
  docs: { kind: 'tutorial', title: 'Onboard an existing project' },
  beats: [
    {
      act: 'Open Studio on the Projects pillar',
      expect: {
        route: '/projects',
        data: {
          page: 'projects-index',
          'page-ready': 'true',
          'card-id': 'gitweave',
          health: 'attention',
        },
      },
      say: 'The Projects pillar lists every project forge manages. GitWeave is already discovered from disk, but it needs attention: it has no contract yet, so no Flow can be pointed at it.',
    },
    {
      act: 'Click "Onboard a project"',
      expect: {
        route: '/projects/new',
        data: {
          page: 'projects',
          'project-id': 'new',
          'page-ready': 'true',
          section: 'project-onboard',
        },
      },
      say: 'Onboarding asks for the few things a Factory needs before it can build a repo: what to call it, the quality gate that judges its work, and the north star that tells a planner what the project is for.',
    },
  ],
};
