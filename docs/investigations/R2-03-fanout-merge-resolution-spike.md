# R2-03-F1 Fanout Research Spike — Parallel-Agent Merge Practices vs. Forge's Scheduler-Ordering Model

**Status:** R2-03-F1 research spike (mandatory gate for R2-D1) — report + recommendation only, per Q3-B. No merge-resolution code is designed or written in this document.

---

## Executive summary

**Recommendation: NO-GO on R2-D1 — forge does not need a merge-resolution capability at this time.** Across all six survey angles, not one production merge-queue tool, multi-agent-SWE framework, worktree-fanout pattern, or alternative VCS eliminates the need for *ordering* — every serious system either (a) serializes/batches changes into a candidate branch and re-runs the real test suite as the sole correctness oracle (merge queues), (b) isolates agents into worktrees/branches and pushes integration to ordinary git + human/CI review (production multi-agent tools), or (c) partitions the write-set by file/module ownership before any agent runs (decomposition-first academic and practitioner consensus) — and the frontier of LLM-based semantic conflict *resolution* remains below a 60%-correct ceiling even in 2026's best benchmarked systems, which every mature tool treats as a reason to keep a human or a test-suite gate in the loop rather than trust it unattended. Forge's current scheduler merge-gate — a dependent initiative waits in `_queue/done/` for its prerequisite and branches fresh from post-merge main (ADR 011) — already implements the single most load-bearing invariant every surveyed system converges on: never build on a state your work will not actually land into. This is structurally what GitHub/Trunk/Zuul call a "merge group" and what the academic CAID result (+25.6pt PaperBench / +14.7pt Commit0 over single-agent baselines) formalizes as its best-performing primitive. The gap the survey does surface — true same-wave *siblings* with no dependency edge get no smarter treatment than "hope the roadmap decomposition kept them disjoint" — is a decomposition/detection gap, not a resolution gap, and the cheapest fixes available (a static file-overlap/hub-file preflight check, or a `git merge-tree`-based dry-run) are additive to the existing ordering model, not a merge-resolution capability, and are out of scope for this initiative to design (Q3-B). R2-D1 should close per its own stated re-entry condition: the spike recommends conflict-avoidance-by-decomposition, not "build."

---

## Survey angle 1 — Merge queues (GitHub, Mergify, bors-ng, Zuul, Graphite, Aviator, Trunk)

Every merge queue surveyed solves integration correctness identically: serialize or batch PRs into a speculative combined branch, re-run the real CI/test suite against that combined state, and reject+reorder on failure. None semantically resolve conflicts — "conflict resolution" universally means git's mechanical fast-forward/rebase succeeding cleanly; the actual arbiter of correctness is the project's own test suite run against the actual candidate merge state.

- **GitHub Merge Queue** builds a temporary "merge group" branch (target + every PR ahead in the queue + the new PR) and fires the `merge_group` CI event against it — each PR is tested against the state it will actually land into. Batches (max group size) fail by re-test-and-drop, not bisection ([GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
- **Mergify** layers serial/parallel/batch modes on the same primitive; `batch_size` groups by priority then directory-similarity; on batch failure it *recursively bisects* to isolate the culprit PR(s) ([Mergify merge-queue docs](https://docs.mergify.com/merge-queue/), [batches docs](https://docs.mergify.com/merge-queue/batches/)).
- **bors-ng** — the original "not rocket science" bot — batches queued PRs onto a force-pushed `staging` branch, tests there, and only then fast-forwards `main` ([bors-ng README](https://github.com/bors-ng/bors-ng), [FLOW_EXAMPLE.md](https://github.com/bors-ng/bors-ng/blob/master/FLOW_EXAMPLE.md), [bors.tech](https://bors.tech/)).
- **Zuul** does true speculative parallel execution across the *entire* queue (not just pairs) and even supports cross-project shared queues via `Depends-On:` DAGs — but states outright it "doesn't resolve conflicts — it simply reorders and re-tests changes" ([Zuul gating docs](https://zuul-ci.org/docs/zuul/latest/gating.html)).
- **Graphite** is stack-aware: an entire dependent-PR stack validates once and fast-forwards without a second CI run — an optimization on the identical detect-via-retest pattern ([Graphite merge queue docs](https://graphite.com/docs/graphite-merge-queue)).
- **Aviator** batches with configurable wait time and bisects failed batches; priority PRs are pulled to the front and kept unbatched ([Aviator batching docs](https://docs.aviator.co/mergequeue/concepts/batching)).
- **Trunk** does "predictive testing" against a temporary `trunk-merge/*` branch plus parallel lanes and anti-flake retry-before-eject ([Trunk docs](https://docs.trunk.io/merge-queue/how-does-it-work)).
- Cross-cutting framing: [Mergify's concept overview](https://mergify.com/learn/merge-queue) states the mechanism plainly — re-testing against latest main, not diff inspection, is what catches semantic conflict.

**Read on forge:** forge's "dependent waits in `done/`, branches fresh from post-merge main" is exactly this ecosystem's "merge group = target + ahead-of-queue changes" idea, just applied at initiative granularity instead of PR granularity. None of the seven tools do anything smarter than *git's own merge machinery + re-run the real test suite* for actual conflict handling, which validates verify-cycle / project test suites as forge's correct sole oracle rather than motivating a bespoke resolver.

## Survey angle 2 — Production multi-agent coding tools and academic multi-agent-SWE frameworks

Universal convergent pattern: isolate-then-merge, never live concurrent-edit. Decomposition-to-avoid-conflict is the explicit recommended strategy, not agent-mediated resolution.

- **Claude Code** itself states it directly: "Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files" ([Agent teams docs](https://code.claude.com/docs/en/agent-teams)); its `--worktree` / `isolation: worktree` primitive is pure filesystem isolation with `git worktree lock` during a run ([Worktrees docs](https://code.claude.com/docs/en/worktrees)).
- **Cursor 2.0** supports up to 8 parallel worktree-backed agents but caps practical use at 2-3; a still-open bug (forum #150279) shows parallel agents "do not properly merge back changes" on subfolder edits — even mature commercial tooling has open integration bugs ([Cursor forum](https://forum.cursor.com/t/parallel-agents-do-not-properly-merge-back-changes-when-working-on-subfolders-of-git-repo/150279)).
- **Devin/MultiDevin** runs N independent Devin sessions each in its own VM/branch/PR, coordinated by an orchestrating "team lead" Devin — decomposition by feature/PR area, not concurrent same-file editing; Cognition has argued *against* multi-agent-per-task systems as fragile ([AgentMarketCap coverage](https://agentmarketcap.ai/blog/2026/04/10/devin-parallel-sessions-multi-agent-concurrency)).
- **OpenHands** runs N separate CodeAct sessions on feature branches off a shared rolling integration branch, decomposed via dependency analysis, human-reviewed PRs at merge points; its blog states plainly "agents can usually work through [merge conflicts] easily" — i.e. no dedicated resolver ([OpenHands blog](https://www.openhands.dev/blog/automating-massive-refactors-with-parallel-agents)). A native multi-agent mode remains an *open, unshipped* feature request ([issue #5251](https://github.com/OpenHands/OpenHands/issues/5251)).
- **SWE-agent** is fundamentally single-agent-per-issue (the ACI design); "parallel SWE-agent" means N independent runs in separate containers with no cross-agent merge logic in the framework ([SWE-agent docs](https://swe-agent.com/latest/background/)).
- Academic results validate dependency-aware decomposition as the highest-leverage lever: **CAID** ("Effective Strategies for Asynchronous Software Engineering Agents") — dependency-aware task plan + isolated git-worktree workspaces + test-gated merge — reports **+25.6 absolute points on PaperBench and +14.7 on Commit0** over single-agent baselines ([arXiv:2603.21489](https://arxiv.org/abs/2603.21489)). **MAGIS** and role-decomposition frameworks show similar value from structured division of labor within one change ([arXiv:2403.17927](https://arxiv.org/pdf/2403.17927)).
- **AgenticFlict** (142K+ agent PRs, 59K+ repos) measures the residual conflict rate that survives standard isolate-then-merge: **27.67% overall**, ranging Copilot 15.24% to Codex 31.85%, rising sharply with diff size (~9.9% small vs 32-33% medium) ([arXiv:2604.03551](https://arxiv.org/html/2604.03551v1)).
- General-purpose frameworks (AutoGen/AG2, CrewAI, LangGraph) have **no native git/code-merge primitive at all** — their "conflict resolution" concepts operate on shared conversational/state objects, a materially different problem ([AutoGen/AG2 discussion #7144](https://github.com/microsoft/autogen/discussions/7144), [CrewAI community](https://community.crewai.com/t/running-multi-agents-in-parallel/4177)).

**Read on forge:** forge's dependency-gate is structurally the CAID pattern (the highest-performing result surveyed) — and is *stricter* than what Cursor/OpenHands tolerate (they branch parallel agents off the same starting commit; forge only starts a dependent after its prerequisite is already merged). That means forge already sits on the conservative, lower-conflict end of the spectrum. The one gap this angle surfaces, echoed in angle 4: independent *siblings* within a wave get no smarter treatment anywhere in the surveyed ecosystem either — every tool's answer is "hope the decomposition assigned non-overlapping ownership."

## Survey angle 3 — Worktree-per-agent patterns and stacked-diff tooling (Graphite/Sapling/git-spice/gh-stack)

Worktree-per-agent is the dominant, near-consensus isolation primitive — exactly forge's existing model — but every source is explicit that worktrees solve *file-state* isolation, not the *runtime-resource* problem (ports, DBs, Docker, build caches), and conflicts are deliberately deferred to merge time rather than prevented upfront ([Augment Code guide](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution), [Zylos Research](https://zylos.ai/research/2026-02-22-git-worktree-parallel-ai-development/), [MindStudio playbook](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees)).

- **Augment Code's "Intent"** runs a Coordinator that decomposes a spec into a dependency-ordered DAG and dispatches Implementors in waves — same-level tasks run concurrently, the next wave starts only after the prior wave completes *and merges in dependency order* — architecturally identical to forge's gate.
- **git-spice** is the most directly analogous OSS tool to forge's need: its merge command works bottom-up, "waits for each CR to be ready, merges it, then restacks and updates branches above it" — literally a scheduler gating each dependent's merge on its prerequisite landing, then auto-retargeting dependents onto the new trunk tip ([git-spice docs](https://abhinav.github.io/git-spice/)). **gh-stack** does the same atomic bottom-up cascade for GitHub-native stacks ([gh-stack overview](https://github.github.com/gh-stack/introduction/overview/)).
- **Graphite's** stack-aware merge queue validates a whole stack once and fast-forwards, auto-rebasing onto trunk to reduce conflict surface ([Graphite merge queue docs](https://graphite.com/docs/graphite-merge-queue), [stacked-diffs rationale](https://graphite.com/guides/5-problems-stacked-diffs-address)).
- **Sapling** (Meta, [ezyang's "Parallel Agents ❤️ Sapling"](https://blog.ezyang.com/2026/03/parallel-agents-heart-sapling/)) describes a genuinely different shape: multiple agents at *different depths of one stack* simultaneously (`sl follow`/`sl adopt` to handle rewrites), rather than forge's one-worktree-per-independent-task model — worth naming as a deliberate non-adoption rather than an oversight, since it trades forge's simpler one-worktree/one-branch/one-merge invariant for finer-grained mid-stack concurrency forge does not need today.
- Practical scaling ceiling: worktree management overhead exceeds parallelism benefit past roughly 8-10 concurrent worktrees (Zylos Research) — an upper bound if forge ever widens fanout.
- The **pre-flight `git merge-tree` dry-run** pattern (tool: Clash) surfaces file-overlap conflicts *before* dispatching agents, without touching the repo — a detection layer, not a resolver ([Addy Osmani, "one file, one owner"](https://addyosmani.com/blog/code-agent-orchestra/)).

**Read on forge:** forge's worktree-per-work-item + scheduler-ordering already matches the most rigorous pattern found (Augment Intent's DAG-wave + git-spice/gh-stack's gated bottom-up cascade). The concrete, additive (non-resolution) ideas worth a follow-up ticket if the operator wants them: auto-retarget-on-merge for long-running dependents, and a pre-flight overlap check.

## Survey angle 4 — Conflict-avoidance-by-decomposition vs. conflict-resolution

Practitioner and academic consensus: partition the write-set by file/module ownership *before* dispatch ("one file, one owner"), order what's left by explicit dependency, and keep a resolution/merge-queue backstop only for residual conflicts partitioning can't foresee — pure locking over-serializes, pure optimistic fan-out reliably collides on shared/hub files.

- **Co-Coder** (arXiv:2606.00953) builds a static dependency graph, isolates "structural hub files," and uses community detection to assign non-overlapping work *before* any agent starts — reports up to 2.10x wall-clock speedup, 14% pass-rate improvement, 35% cost reduction, with gains concentrated on the most dependency-dense repos ([arXiv:2606.00953](https://arxiv.org/abs/2606.00953)).
- **CodeTeam** makes ownership an explicit, machine-checkable contract (file ownership + public interfaces + dependency constraints) produced before a dependency-aware scheduler dispatches developers; allocation quality gave a 9.9% relative improvement over generic allocation ([arXiv:2606.22082](https://arxiv.org/abs/2606.22082)).
- Classical build/monorepo tooling enforces ownership as a continuously-checked backstop rather than a one-off split: GitHub CODEOWNERS, and Bazel/Buck2 **visibility** rules that make the module graph a compile-time constraint ([Bazel visibility docs](https://bazel.build/concepts/visibility)).
- **Cognition/Devin** draws the actual boundary condition explicitly: "if Feature B depends on Feature A's interface decisions, running them simultaneously produces a merge conflict at best and an architectural inconsistency at worst" — and even their aggressive orchestrator keeps a resolve-conflicts fallback, i.e. decomposition is primary but resolution is retained as backstop, not either/or ([Devin can now Manage Devins](https://cognition.ai/blog/devin-can-now-manage-devins)).
- **Microsoft Research** sharpens the limit: decomposition-by-file-ownership eliminates *textual* conflicts but is silent on *semantic* conflicts (clean merges that compile but break behavior because of drifted cross-file assumptions) ([MSR blog](https://www.microsoft.com/en-us/research/blog/safe-program-merges-at-scale-a-grand-challenge-for-program-repair-research/)).
- Merge queues (Mergify) are named explicitly as the industrial-scale generalization of forge's own pattern — serialize integration against a moving trunk, re-test automatically ([Mergify monorepo piece](https://articles.mergify.com/mergify-for-monorepos-a-game-changer-feature/)).
- The historical VCS precedent: Perforce's exclusive-checkout locking prevents conflicts by construction (spatial partitioning); Git's optimistic branch-and-merge bets most work is independent enough to merge after the fact. Decomposition-by-ownership is the modern analogue of locking; forge's dependency-ordered scheduling is *temporal* decomposition, not *spatial* — it does not by itself guarantee true parallel siblings won't touch the same files ([Sourcegraph, Git vs Perforce](https://sourcegraph.com/blog/perforce-vs-git)).

**Read on forge:** forge already implements the temporal half of decomposition correctly and re-verifies each dependent against post-merge main (closing the semantic-conflict gap *for declared dependencies*). The gap this angle names precisely: no static-dependency-graph computation over actually-affected files before dispatching a wave, and no explicit interface-contract artifact for same-wave siblings that share a boundary but aren't gated by a wait-dependency — both are decomposition/detection gaps, not evidence that a resolution capability is needed.

## Survey angle 5 — AI/LLM-driven merge-conflict resolution maturity

This angle is the strongest evidence *against* building a merge-resolution capability specifically, independent of whether forge needs one at all: no serious system — academic, benchmark, or shipped product — trusts LLM-based conflict resolution for unattended, unverified use.

- **MergeBERT** (Microsoft, ESEC/FSE'22) reports only 64-69% precision — wrong roughly 1 in 3 times ([arXiv:2109.00084](https://arxiv.org/abs/2109.00084)). **DeepMerge** was JS-only and research-stage ([arXiv:2105.07569](https://arxiv.org/abs/2105.07569)).
- **Merge-Bench** (2026, 7,938 real hunks / 1,439 repos) is the most rigorous current datapoint: even the best model (Gemini 2.5 Pro) resolves **fewer than 60% of conflicts correctly**; the purpose-trained LLMergeJ scores 49% exact-match / 59% source-match ([arXiv:2605.25890](https://arxiv.org/abs/2605.25890), [benchmark repo](https://github.com/benedikt-schesch/Merge-Bench)).
- **CONGRA** finds LLM failure is not uniform or predictable by conflict complexity — a reliability red flag for any gate assuming "simple conflicts are safe to auto-resolve" ([arXiv:2409.14121](https://arxiv.org/abs/2409.14121)).
- A direct **LLM-vs-search-based head-to-head** concludes "neither paradigm is a silver bullet," documents LLM failure modes (truncated/empty resolutions on large inputs, apparent training-data memorization), and recommends hybrid systems over trusting either alone ([arXiv:2605.16646](https://arxiv.org/abs/2605.16646)).
- **Rover** (2026), the most architecturally sophisticated approach (code-property-graph context), beats prior LLM baselines on similarity metrics but is a research prototype with no stated confidence threshold and no real-world deployment ([arXiv:2605.17279](https://arxiv.org/abs/2605.17279)).
- The mature *non-LLM* end of the spectrum is deliberately conservative: **Mergiraf** (AST-aware, 33 languages) "errs on the side of caution and retains conflict markers" when unsure, and ships a `mergiraf review` command specifically so a human double-checks — no formal reliability guarantee beyond that ([mergiraf.org](https://mergiraf.org/), [LWN coverage](https://lwn.net/Articles/1042355/)). GumTree, the AST-diff algorithm underneath most structured merging, has a known semantic-role blind spot ([survey](https://arxiv.org/pdf/2403.05939)).
- Shipped product integrations are explicitly human-in-the-loop: **GitHub Copilot's** "Resolve Merge Conflict with AI" proposes a suggestion the developer must review and accept, still labeled experimental ([VS Code docs](https://code.visualstudio.com/docs/editing/copilot-smart-actions), [InfoWorld coverage](https://www.infoworld.com/article/4075822/visual-studio-code-taps-ai-for-merge-conflict-resolution.html)); JetBrains has an **open, unresolved** feature request for the same ([YouTrack LLM-550](https://youtrack.jetbrains.com/issue/LLM-550/AI-git-merge-conflict-resolution)).
- **LLMinus**, a Linux-kernel RFC pairing historical-conflict embeddings with a build-test verification loop, is explicitly framed as experimental and "not intended to replace or compete with existing integration workflows" — even the most conservative, process-heavy codebase in existence treats this as sandboxed/canary, not trusted ([LWN](https://lwn.net/Articles/1053714/), [lkml RFC](https://lkml.iu.edu/2601.1/06258.html)).
- Empirically, conflict frequency scales with agent autonomy/parallelism: AgenticFlict's 27.67% overall rate, Codex 32.31% down to Copilot 15.43% ([arXiv:2604.03551](https://arxiv.org/html/2604.03551v1), companion study [arXiv:2607.04697](https://arxiv.org/pdf/2607.04697)).
- The sharpest warning: a large operational-safety study of 547 confirmed real-world agent incidents names **"destructive operations"** and **"fabricated success reports"** as dominant, recurring failure categories, occurring during ordinary (non-adversarial) tasks — an agent's own "resolved successfully" self-report must never be the sole signal of a correct merge ([arXiv:2605.30777](https://arxiv.org/abs/2605.30777)).

**Read on forge:** this is the decisive angle for the specific question "should forge build a merge-resolution capability." Even setting aside whether forge needs one structurally, the state of the art isn't safe to trust unattended — under-60%-correct accuracy on realistic hunks, paired with documented self-report-fabrication risk, is disqualifying for an unattended gate by forge's own operating model (fail fast, no silent swallowing, verify before claiming success).

## Survey angle 6 — First-class-conflict VCS models (jj, Pijul/Darcs) and centralized-monorepo models (Sapling, Piper/CitC) vs. plain git + scheduler ordering

Verdict embedded in the research itself: no VCS alternative eliminates the need for merge-*ordering* logic in an orchestrator; they only change where/when resolution happens.

- **Jujutsu (jj)** stores conflicts as a logical representation inside the commit object (not markers) and auto-propagates rebases through unresolved conflicts ([jj conflicts docs](https://docs.jj-vcs.dev/latest/conflicts/), [technical spec](https://github.com/jj-vcs/jj/blob/main/docs/conflicts.md)). The pro-agent argument is qualitative, unbenchmarked ([Slava Kurilyak](https://slavakurilyak.com/posts/use-jujutsu-not-git)). **Direct counter-evidence:** **agentjj**, a purpose-built agent-VCS project, embedded jj and then walked it back out after jj's auto-squash collapsed meaningful agent commit boundaries and its single-writer working-copy model let concurrent subagents inadvertently bundle each other's changes — concluding **"jj solves human problems, and agents have different problems"** ([agentjj](https://github.com/2389-research/agentjj)). A hands-on report of jj workspaces for concurrent Claude-agent development shows real promise but also stale-workspace errors and unexplained hangs — qualitative promise, not a hardened production pattern ([geirsson.com](https://geirsson.com/jj-workspaces)).
- **Pijul/Darcs** patch-theory (commuting/dependent changes, no rebase pain, associativity) is theoretically elegant but appears **nowhere** in the 2026 AI-agent-orchestration conversation and has no GitHub-PR-review-equivalent ecosystem — directly at odds with ADR 006's commitment to `gh` CLI + GitHub Actions ([Pijul manual](https://pijul.org/manual/why_pijul.html), [theory.md](https://github.com/bitemyapp/Pijul/blob/master/theory.md)).
- **Sapling** solves a *different* problem (monorepo commit-graph scale/performance via directory branching), not conflict resolution — branches still merge and still render linearly ([Meta engineering blog](https://engineering.fb.com/2025/10/16/developer-tools/branching-in-a-sapling-monorepo/)).
- **Google Piper/CitC**, the closest real precedent for parallel change integration at extreme scale, wins through *organizational discipline* (trunk-only, feature flags instead of branches, Rosie splitting large changes into small independently-mergeable patches, Tricorder automated static fixes) layered on a conventional centralized VCS — not a smarter merge algorithm ([CACM](https://cacm.acm.org/research/why-google-stores-billions-of-lines-of-code-in-a-single-repository/), [mirror with figures](https://www.extreg.com/blog/2017/02/googles-ultra-large-scale-monolithic-source-code-repository/)).
- The one directly actionable, non-VCS-migration idea: **Clash** ([clash.sh](https://clash.sh/), [GitHub](https://github.com/clash-sh/clash)) uses `git merge-tree` (via `gix`) to simulate three-way merges between every pair of active worktrees, read-only, reporting conflicts before an agent finishes writing — additive to forge's existing worktree pool, no VCS change, detect-only.
- First empirical measurement of concurrent-agent-PR conflict rates: 40.2% of repos had temporally-overlapping agent PR pairs, textual conflicts on replay at 19.8% (same-agent) vs 41.7% (cross-agent) — but **only 0.5%** of co-active pairs involved two *different* agents; most observed "parallelism" today is one agent iterating against itself ([arXiv:2607.04697](https://arxiv.org/abs/2607.04697)).

**Read on forge:** none of the alternative VCS models are warranted given ADR 006's explicit rejection of hand-rolled git tooling and forge's "no new external dependency without justification" bar — and the one project that tried applying a first-class-conflict VCS (jj) to genuine multi-agent concurrency reversed course. Staying on plain git + worktrees + scheduler ordering (ADR 006, ADR 011) is the evidence-backed choice.

---

## Synthesis — mapping the survey onto forge's current scheduler-ordering model

Forge's current mechanism (ADR 006 + ADR 011, R2-03 context notes): a bounded `git worktree` pool per concurrent initiative, a file-based `_queue/` state machine with atomic `mv`-based claims, `gh` CLI for branch/PR/merge, and the standing scheduler rule that **a dependent initiative waits in `done/` for its prerequisite and branches fresh from post-merge main** — conflict-avoidance-by-ordering, no simultaneous same-file edits, zero merge-conflict-resolution code.

**Where ordering already suffices (validated by all six angles):**
- The core invariant — never build on a state your work won't actually land into — is exactly what GitHub/Trunk/Zuul's "merge group" achieves and what git-spice/gh-stack's bottom-up gated cascade achieves (angles 1, 3).
- Forge's temporal decomposition (dependents wait, branch fresh) is structurally the CAID pattern, the highest-performing academic result surveyed (angle 2), and is *stricter* than what Cursor/OpenHands tolerate for parallel agents (angle 2).
- Not one production or academic system does live semantic conflict resolution as its primary path; every one either serializes+retests or decomposes-and-isolates (angles 1, 2, 3). Forge is not an outlier for lacking one.
- The LLM/AI resolution frontier is not yet safe to trust unattended (sub-60%-correct on realistic hunks, documented fabricated-success-report risk) — even if forge wanted a resolver, today's state of the art would not meet forge's own "fail fast, verify before claiming success" bar (angle 5).
- Alternative VCS models don't remove the ordering requirement, and the one attempt to use a first-class-conflict VCS for genuine multi-agent concurrency (jj/agentjj) broke in new ways rather than eliminating the problem (angle 6).

**Where ordering has real gaps — decomposition/detection gaps, not resolution gaps:**
- **Same-wave siblings** (no dependency edge, dispatched together) get no computed independence guarantee anywhere in the surveyed ecosystem, including forge — every tool's answer is "hope the upstream decomposition assigned non-overlapping file/module ownership" (angles 2, 4). Forge's PM/architect decomposition is the only thing standing between two disjoint-on-paper initiatives and a same-wave file collision.
- No **static dependency-graph/hub-file check** exists before dispatching a wave — Co-Coder and CodeTeam both show this is where partitioning quality pays off most, concentrated exactly on dependency-dense areas (angle 4).
- No **pre-flight overlap detection** (Clash's `git merge-tree` pattern) exists across forge's active worktree pool today — a cheap, additive, non-resolution check that several sources converge on independently (angles 3, 6).
- No **auto-retarget-on-merge** for a dependent worktree that's already branched and running when its prerequisite lands mid-flight — git-spice/gh-stack's restack-on-merge pattern would reduce the staleness window (angle 3).

**What R2-03-F2/F4 parallel fanout would actually stress:** F2/F4 generalize *intra-dev-loop* per-WI worktree fanout (already forge's existing model for WIs within one initiative) behind a definition-declared property, and raise `FORGE_DEV_WI_CONCURRENCY` above 1. This is squarely the angle-2/angle-4 "siblings within one wave" shape — multiple WI worktrees branched from the *same* starting commit, running concurrently, each unaware of the others' edits until merge-back. That is exactly the shape AgenticFlict's data says is highest-conflict-risk (diff-size- and concurrency-correlated), and exactly the shape neither forge's current scheduler ordering (which governs *initiative*-level, not *WI*-level, sequencing) nor any surveyed tool's dependency-gate covers by construction — WI-level disjointness today rests entirely on the PM's decomposition quality (per the standing memory note "initiative size = bundle" and "dependent waits, branches fresh from post-merge main" being *cross-initiative*, not *within-dev-loop*, scope). This is the concrete pressure point R2-03-F4's soak period should watch, and the trigger the R2-D1 re-entry condition is written around ("real fanout runs... produce merge conflicts that the current scheduler merge-gate ordering... demonstrably cannot absorb").

---

## Recommendation: R2-D1 go/no-go

**NO-GO.** Do not design or build a merge-resolution capability for forge at this time. Scheduler-ordering (dependent waits in `done/`, branches fresh from post-merge main) remains sufficient, and it already reflects the most rigorous pattern found anywhere in the surveyed ecosystem, production or academic. Per R2-D1's own stated re-entry condition, since this spike recommends conflict-avoidance-by-decomposition rather than "build," **R2-D1 should close as rejected, with this report as rationale.**

**Reasoning, in order of weight:**
1. No merge queue, no production multi-agent coding tool, and no academic multi-agent-SWE framework surveyed does semantic conflict resolution as its primary integration mechanism (angles 1, 2, 3) — building one would make forge an outlier against the entire ecosystem's convergent design, not a follower of best practice.
2. The one rigorous, quantified academic comparison of decomposition-first vs. naive parallelism (CAID) shows decomposition + isolated worktrees + test-gated merge — forge's existing shape — delivering the largest measured gains (angle 2); forge is already implementing the winning pattern.
3. The frontier of LLM-based conflict resolution is not reliable enough to trust unattended (angle 5): sub-60%-correct even on the best 2026 benchmark, non-uniform failure by complexity, and a documented pattern of agents fabricating success reports on exactly this class of task. Building a merge-resolution capability now would mean shipping a component below forge's own bar for unattended trust.
4. Alternative VCS models that structurally change how conflicts are represented (jj, Pijul) don't remove the need for ordering logic, and the one real attempt to lean on one for genuine multi-agent concurrency (jj/agentjj) reversed course (angle 6) — reinforcing that the fix belongs at the scheduling/decomposition layer, where forge already operates, not at the VCS or resolution layer.
5. Q3-B's framing question — "does forge need a merge-resolution capability at all" — is answered no by the survey; the actual residual risk it surfaces is a **decomposition/detection** gap (same-wave siblings with no computed independence guarantee), which is a different, smaller, and already-partially-addressed problem (PM decomposition + "bundle-not-split" initiative sizing).

**Preconditions that would flip this to a future GO** (per R2-D1's own re-entry condition — all three must hold, not any one):
1. **R2-03-F4 ships and soaks** with `FORGE_DEV_WI_CONCURRENCY` raised above 1 in real dev-loop cycles, and forge's own telemetry shows same-wave WI-worktree merge conflicts occurring at a rate the current scheduler-ordering model cannot absorb by construction (i.e., conflicts between true siblings, not between a dependent and a stale base — the latter is already prevented).
2. **Cheaper, non-resolution mitigations are tried first and shown insufficient** — specifically a static file/module-overlap or hub-file preflight check across a wave's WIs (Co-Coder/CodeTeam-style) and/or a `git merge-tree`-based dry-run across the active worktree pool (Clash-style). Angle 4 and angle 6 both name these as the correct next lever *before* resolution; if they close the observed gap, GO is not warranted even if conflicts are observed pre-mitigation.
3. **If resolution is still warranted after (1) and (2), any capability built must be verification-gated, never self-report-gated** — a conservative structured/AST-aware first pass that defaults to preserving conflict markers on doubt (Mergiraf's posture), with any LLM-assisted step required to pass the project's real test suite plus a diff-sanity check before being trusted, exactly mirroring the operational-safety literature's warning against trusting an agent's "resolved successfully" claim as sufficient evidence (angle 5).

Two candidate follow-up tickets fall out of this survey that are **additive to ordering, not merge-resolution, and are flagged for operator consideration rather than decided here** (Q3-B scopes this initiative to report+recommendation only): (a) a pre-wave static overlap/hub-file check during PM decomposition, and (b) a `git merge-tree`-based preflight across the active worktree pool. Neither should be read as part of this spike's recommendation — they are decomposition/detection enhancements the operator may want to route to a separate initiative.

---

## Sources

1. GitHub Docs — Managing a merge queue — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
2. Mergify — Merge Queue docs — https://docs.mergify.com/merge-queue/
3. Mergify — Merge Queue Batches docs — https://docs.mergify.com/merge-queue/batches/
4. bors-ng README (GitHub) — https://github.com/bors-ng/bors-ng
5. bors-ng FLOW_EXAMPLE.md — https://github.com/bors-ng/bors-ng/blob/master/FLOW_EXAMPLE.md
6. bors.tech — https://bors.tech/
7. Zuul documentation — Project Gating — https://zuul-ci.org/docs/zuul/latest/gating.html
8. Graphite — Merge Queue docs — https://graphite.com/docs/graphite-merge-queue
9. Graphite — 5 problems stacked diffs address — https://graphite.com/guides/5-problems-stacked-diffs-address
10. Aviator Documentation — Batching — https://docs.aviator.co/mergequeue/concepts/batching
11. Aviator Blog — Merge Queues for Large Monorepos — https://www.aviator.co/blog/merge-queues-for-large-monorepos/
12. Trunk docs — How does a merge queue work? — https://docs.trunk.io/merge-queue/how-does-it-work
13. Mergify — What Is a Merge Queue? (concept overview) — https://mergify.com/learn/merge-queue
14. Mergify — Managing Monorepos with a Merge Queue — https://articles.mergify.com/mergify-for-monorepos-a-game-changer-feature/
15. Claude Code Docs — Run parallel sessions with worktrees — https://code.claude.com/docs/en/worktrees
16. Claude Code Docs — Orchestrate teams of Claude Code sessions (agent teams) — https://code.claude.com/docs/en/agent-teams
17. OpenHands Blog — Automating Massive Refactors with Parallel Agents — https://www.openhands.dev/blog/automating-massive-refactors-with-parallel-agents
18. OpenHands/OpenHands GitHub Issue #5251 — Enable Multi-Agent System (MAS) — https://github.com/OpenHands/OpenHands/issues/5251
19. OpenHands: An Open Platform for AI Software Developers (arXiv:2407.16741) — https://arxiv.org/pdf/2407.16741
20. SWE-agent documentation / background — https://swe-agent.com/latest/background/
21. Cursor Forum — Parallel agents do not properly merge back changes (#150279) — https://forum.cursor.com/t/parallel-agents-do-not-properly-merge-back-changes-when-working-on-subfolders-of-git-repo/150279
22. AgentMarketCap — The Multi-Agent February (Devin/MultiDevin) — https://agentmarketcap.ai/blog/2026/04/10/devin-parallel-sessions-multi-agent-concurrency
23. Cognition — Devin can now Manage Devins — https://cognition.ai/blog/devin-can-now-manage-devins
24. MAGIS: LLM-Based Multi-Agent Framework for GitHub Issue Resolution (arXiv:2403.17927) — https://arxiv.org/pdf/2403.17927
25. Effective Strategies for Asynchronous Software Engineering Agents / CAID (arXiv:2603.21489) — https://arxiv.org/abs/2603.21489
26. AgenticFlict: A Large-Scale Dataset of Merge Conflicts in AI Coding Agent PRs (arXiv:2604.03551) — https://arxiv.org/html/2604.03551v1
27. Dissecting the SWE-Bench Leaderboards (arXiv:2506.17208) — https://arxiv.org/pdf/2506.17208
28. AutoGen/AG2 GitHub Discussion #7144 — https://github.com/microsoft/autogen/discussions/7144
29. CrewAI Community — Running multi agents in parallel — https://community.crewai.com/t/running-multi-agents-in-parallel/4177
30. Parallel Agents ❤️ Sapling (ezyang's blog) — https://blog.ezyang.com/2026/03/parallel-agents-heart-sapling/
31. Augment Code — How to Use Git Worktrees for Parallel AI Agent Execution — https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution
32. Augment Code — How to Build a Multi-Agent AI System for Code Development — https://www.augmentcode.com/guides/multi-agent-ai-system-code-development
33. Zylos Research — Git Worktree Isolation Patterns for Parallel AI Agent Development — https://zylos.ai/research/2026-02-22-git-worktree-parallel-ai-development/
34. MindStudio — Parallel Agentic Development With Git Worktrees — https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees
35. MindStudio — Git Worktrees for AI Coding: How to Run Multiple Agents Without Conflicts — https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents
36. git-spice — https://abhinav.github.io/git-spice/
37. GitHub Stacked PRs (gh-stack) — Overview & Workflows — https://github.github.com/gh-stack/introduction/overview/
38. Addy Osmani — The Code Agent Orchestra — https://addyosmani.com/blog/code-agent-orchestra/
39. Parallel Code blog — Git Worktree Isolation Patterns for Parallel AI Agents — https://parallelcode.app/blog/parallel-ai-agents/
40. When Parallelism Pays Off: Cohesion-Aware Task Partitioning / Co-Coder (arXiv:2606.00953) — https://arxiv.org/abs/2606.00953
41. CodeTeam: An LLM-Powered Multi-Agent Framework for Repository-Level Code Generation (arXiv:2606.22082) — https://arxiv.org/abs/2606.22082
42. MASAI: Modular Architecture for Software-engineering AI Agents (arXiv:2406.11638) — https://arxiv.org/abs/2406.11638
43. Bazel — Visibility — https://bazel.build/concepts/visibility
44. Safe program merges at scale (Microsoft Research) — https://www.microsoft.com/en-us/research/blog/safe-program-merges-at-scale-a-grand-challenge-for-program-repair-research/
45. Sourcegraph — Git vs Perforce: Key Differences and When to Use Each — https://sourcegraph.com/blog/perforce-vs-git
46. MergeBERT: Program Merge Conflict Resolution via Neural Transformers (arXiv:2109.00084) — https://arxiv.org/abs/2109.00084
47. DeepMerge: Learning to Merge Programs (arXiv:2105.07569) — https://arxiv.org/abs/2105.07569
48. Merge-Bench: Resolve Merge Conflicts with Large Language Models (arXiv:2605.25890) — https://arxiv.org/abs/2605.25890
49. benedikt-schesch/Merge-Bench (GitHub) — https://github.com/benedikt-schesch/Merge-Bench
50. CONGRA: Benchmarking Automatic Conflict Resolution (arXiv:2409.14121) — https://arxiv.org/abs/2409.14121
51. LLM-based vs. Search-based Merge Conflict Resolution (arXiv:2605.16646) — https://arxiv.org/abs/2605.16646
52. Rover: Context-aware Conflict Resolution with LLM (arXiv:2605.17279) — https://arxiv.org/abs/2605.17279
53. Mergiraf — Introduction — https://mergiraf.org/
54. Mergiraf: syntax-aware merging for Git [LWN.net] — https://lwn.net/Articles/1042355/
55. A Novel Refactoring and Semantic Aware AST Differencing Tool (GumTree context) — https://arxiv.org/pdf/2403.05939
56. Pointers on abstract syntax tree differencing algorithms and tools — https://www.monperrus.net/martin/tree-differencing
57. jj/docs — Conflicts (Jujutsu docs site) — https://docs.jj-vcs.dev/latest/conflicts/
58. jj-vcs/jj — docs/conflicts.md (GitHub) — https://github.com/jj-vcs/jj/blob/main/docs/conflicts.md
59. Slava Kurilyak — Use Jujutsu, Not Git — https://slavakurilyak.com/posts/use-jujutsu-not-git
60. agentjj — Version Control for AI Agents (2389-research/agentjj) — https://github.com/2389-research/agentjj
61. geirsson.com — Operate a local autonomous GitHub with jj workspaces — https://geirsson.com/jj-workspaces
62. Engineering at Meta — Branching in a Sapling Monorepo — https://engineering.fb.com/2025/10/16/developer-tools/branching-in-a-sapling-monorepo/
63. Pijul Manual — Why Pijul — https://pijul.org/manual/why_pijul.html
64. Theory of the Pijul Version Control System (theory.md) — https://github.com/bitemyapp/Pijul/blob/master/theory.md
65. CACM — Why Google Stores Billions of Lines of Code in a Single Repository — https://cacm.acm.org/research/why-google-stores-billions-of-lines-of-code-in-a-single-repository/
66. extreg.com mirror — Google's ultra-large-scale monolithic source code repository — https://www.extreg.com/blog/2017/02/googles-ultra-large-scale-monolithic-source-code-repository/
67. Clash — https://clash.sh/
68. clash-sh/clash (GitHub) — https://github.com/clash-sh/clash
69. AI Agent Pull Requests on GitHub: Frequency, Structure, and Merge Conflict Rates (arXiv:2607.04697) — https://arxiv.org/abs/2607.04697
70. What Breaks When LLMs Code? Characterizing Operational Safety Failures (arXiv:2605.30777) — https://arxiv.org/abs/2605.30777
71. VS Code docs — AI smart actions (Copilot merge-conflict resolution) — https://code.visualstudio.com/docs/editing/copilot-smart-actions
72. InfoWorld — Visual Studio Code taps AI for merge conflict resolution — https://www.infoworld.com/article/4075822/visual-studio-code-taps-ai-for-merge-conflict-resolution.html
73. JetBrains YouTrack — AI git merge conflict resolution (LLM-550) — https://youtrack.jetbrains.com/issue/LLM-550/AI-git-merge-conflict-resolution
74. LWN.net — LLMinus: LLM-Assisted Merge Conflict Resolution — https://lwn.net/Articles/1053714/
75. lkml — [RFC v2 0/7] LLMinus — https://lkml.iu.edu/2601.1/06258.html
76. dortort.com — Monorepo vs Multi-Repo: Why AI Agents Tip the Scale — https://dortort.com/posts/monorepo-vs-multi-repo-why-ai-agents-tip-the-scale/

**Forge-internal references (not external sources, cited for grounding):**
- ADR 006 — gh CLI + git worktrees + GitHub Actions — `docs/decisions/006-gh-cli-and-worktrees.md`
- ADR 011 — Unattended scheduler with file-based initiative queue and worktree pool — `docs/decisions/011-unattended-scheduler.md`
- R2-03 Fanout capability + R2-D1 deferred placeholder — `docs/roadmaps/R2-runnable-componentry.md`
