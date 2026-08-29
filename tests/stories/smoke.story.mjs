/**
 * smoke — the harness proof story (1.0.md §3, row S0). Not a gate.
 *
 * It exists to prove the triple output: one script yields a per-beat verdict,
 * a clip plus frames, and a usage-doc fragment. Two beats, no seeded state, no
 * spawn, no money — so a failure here is a defect in the RUNNER, never in a
 * product flow.
 *
 * The `data-*` keys are taken from the contract in
 * `docs/forge-ui-dom-and-harness.md`: Home is
 * `main[data-page="home"][data-page-ready]`, the projects index is
 * `[data-page="projects-index"][data-page-ready][data-project-count]`.
 *
 * `data-project-count` is deliberately NOT asserted to a value: it is a true
 * figure that depends on which projects the checkout has, and a story that
 * pins it would be asserting the fixture rather than the product.
 */
export default {
  id: 'smoke',
  ground: { project: 'mdtoc', realSpawn: false, budget_usd: 0 },
  docs: { kind: 'how-to', title: 'Find a project from Home' },
  beats: [
    {
      act: 'Open Studio on Home',
      expect: { route: '/', data: { page: 'home', 'page-ready': 'true' } },
      say: 'Studio opens on Home — the operator pulse across every project, flow, agent and KB.',
    },
    {
      act: 'Click through to the Projects pillar',
      expect: { route: '/projects', data: { page: 'projects-index', 'page-ready': 'true' } },
      say: 'The Projects pillar lists every project forge manages, with its health and activity.',
    },
  ],
};
