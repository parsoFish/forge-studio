/**
 * ignored-born — the ground's own toolchain output, classified, on a COSTLESS
 * run. `forge-8vfn.7.6.52`, A's ruling 797, T1 873, C's 612 ack (option b).
 *
 * WHAT THIS EXISTS TO END. `IGNORED-BY-GROUND` has only ever rendered a TRUE
 * ZERO over an EMPTY case. S1 run 9 printed `0 path(s)` because that run's demo
 * builder happened not to invoke pytest, so no toolchain files were ever born —
 * and whether an agent runs a toolchain is the AGENT'S choice, which makes
 * buying costed S1 runs to reach the non-empty case a coin flip. Until this
 * story, every door that exercised the classification passed it a STUB
 * (`isIgnored: () => true`), so the real git-backed classifier had never
 * produced a non-zero count through the code that consumes it.
 *
 * ITS OWN STORY RATHER THAN A BEAT BOLTED ONTO `proof` (C's call, and right):
 * proof's header names the three things it exists to prove and ground
 * classification is none of them. A story that quietly becomes about two
 * subjects is worse than a second gallery entry.
 *
 * COSTLESS BY CONSTRUCTION — `realSpawn: false`, `budget_usd: 0` — so CI runs it
 * on every push and the classification is exercised continuously rather than
 * whenever an agent happens to run pytest.
 *
 * THE SEEDS ARE THE POINT AND THE RUNNER REFUSES BAD ONES. `seedIgnoredBorn`
 * creates these AFTER the pre-run hash, so they read as drift born during the
 * run, and it REFUSES any path `mdtoc`'s own `.gitignore` does not actually
 * ignore. That refusal is what stops this story asserting against rules it
 * invented — an unignored seed would land in UNDECLARED and red the run as a
 * containment failure the story caused itself. The three below match `dist/`,
 * `coverage/` and `*.tsbuildinfo`, all real rules in the real ground.
 *
 * THE OTHER HALF IS A DOOR, NOT A BEAT. A DELETED TRACKED file must be
 * UNDECLARED and must never be downgraded to ignored (§15.435) — but the
 * runner reds on any undeclared path, so proving it here would make this story
 * permanently red and its gallery entry meaningless. It lives in
 * `scripts/stories/ground-ignore-live.test.ts`, where the red IS the assertion.
 */
export default {
  id: 'ignored-born',
  ground: {
    project: 'mdtoc',
    realSpawn: false,
    budget_usd: 0,
    seedIgnoredBorn: ['dist/bundle.js', 'coverage/lcov.info', 'build.tsbuildinfo'],
  },
  docs: { kind: 'how-to', title: 'Read a ground\'s own toolchain output in a run report' },
  beats: [
    {
      act: 'Open Studio on the Projects pillar',
      expect: {
        route: '/projects',
        data: { page: 'projects-index' },
      },
      say: 'A run reports what changed in the project it stood on. Some of that is the project\'s OWN build output — a bundle, a coverage file, a TypeScript build stamp — which the project\'s .gitignore already calls disposable. Forge names those separately from a real containment failure, and names the rule that made the call, so an operator can tell "the toolchain ran" from "something wrote where it should not have".',
    },
  ],
};
