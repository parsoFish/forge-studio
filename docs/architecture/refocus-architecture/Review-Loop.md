# Review Loop (unifier · demo · review · closure)

> **Intent.** Close an initiative out to `main`: **unify** the per-WI work into one
> cohesive branch, **prove** the initiative's acceptance criteria, generate a **rich
> demo** (the key differentiator from the autonomous loops), open a **PR**, and let the
> operator either send feedback into another cycle or approve — which merges and closes.
>
> **Type:** assisted human-moment (the operator's merge decision is a real, recorded gate).
> **Realized via:** four concrete stages, three of them after the per-WI dev loops.

## The four stages

1. **Unifier** *(inside [Developer-Loop](docs/architecture/refocus-architecture/Developer-Loop.md))* — a final Ralph run on the initiative
   branch ([orchestrator/unifier-invocation.ts](orchestrator/unifier-invocation.ts), the
   one phase already on the `PhaseAgentSpec` seam). Authors one structured
   `demo/<id>/demo.json`, derives DEMO.md/DEMO.html, writes the PR description, and must
   clear a 4-part gate: project gate · demo runs clean · PR self-contained · branch in sync.
2. **Demo** — the **rich, self-contained evidence artifact**. One portable HTML the
   operator opens without a server: before/after screenshots or video for visual changes,
   API before/after for services, harness metrics, test evidence — stamped with cycle id,
   branch, commit SHA, PR URL. Composed from the shared [skills/demo/SKILL.md](skills/demo/SKILL.md).
3. **Review** *([orchestrator/phases/reviewer.ts](orchestrator/phases/reviewer.ts))* — opens
   the GitHub PR from the unifier's description and **stops**. It never authors, never
   waits, never merges, never moves the manifest. The operator reviews from the
   [forge-ui](docs/architecture/refocus-architecture/forge-ui.md) `/review/<id>` screen (structured demo + a named
   approve/send-back verdict) or from the PR itself.
4. **Closure** *([orchestrator/phases/closure.ts](orchestrator/phases/closure.ts))* — the
   **single terminal-move authority**. Confirms `gh pr state == MERGED`, aligns local↔remote,
   prunes the branch, moves the manifest to `done/`, and only then fires reflection.

## Inputs → Outputs

**Consumes:** the delivered initiative branch + WI specs + `.forge/project.json` (demo
shape/command); the operator verdict.
**Produces:** `demo/<id>/` bundle, PR description, a GitHub PR, the merge confirmation,
manifest → `done/` (merged) or `ready-for-review/` (unconfirmed); review/closure events.

## Boundaries (what this is NOT)

- Not an auto-merger — the PR is the operator's merge surface; closure only *confirms*.
- Not a second demo system — there is **one** demo path (`demo.json` → DEMO.html), rendered
  identically in the PR and the UI.
- The reviewer stage is intentionally near-empty (open-PR-and-stop), not a demo author.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[REV-1 · high]** The operator **send-back loop is not wired end-to-end**: the UI verdict
  writes `verdict-response.md` that nothing reads; `unifierFeedbackRef` is never assigned in
  production. Decide: wire UI send-back → auto-requeue (`resume_from: unifier` + feedback),
  **or** delete the dead send-back machinery and make `forge requeue` the documented path.
- **[REV-2 · high]** **Two parallel demo systems** coexist — the live `demo.json` path and a
  ~1500-line Playwright author stack ([cli/demo-script.ts](cli/demo-script.ts) +
  `generateComparisonDemo` + a second `DemoManifest` schema) reachable only via a
  best-effort `forge demo capture` (which uses it just to back-fill PNGs). Cull the second
  system; keep one self-contained-HTML demo path with a thin screenshot-only capture.
- **[REV-3 · med]** Gate inconsistency: the unifier's `pr_self_contained` gate hard-codes
  `body.length >= 300`, the exact synthetic threshold the reviewer doc says was removed.
  Drop it (keep the `## Demo` heading check).
- **[REV-4 · med]** Demo richness gap: the refocus calls demos "the key difference" with
  before/after visual evidence, but the default is notes-first and the heavy capture path is
  orphaned. Make a single self-contained HTML (screenshots/video/API-diff/test-evidence)
  the reliable artifact; package per the research's trace-zip/Allure-single-file shape.
- **[REV-5 · med]** Stale machinery in docs/code: `review-router.ts` referenced but absent;
  `/forge-review` skill referenced but absent; ADR 016 (VHS) fully superseded. Rewrite
  [docs/phases/review-loop.md](docs/phases/review-loop.md), retire ADR 016.
- **[REV-6 · low]** Collapse the now-~30-line `reviewer.ts` into closure (or the end of the
  dev-loop) — one fewer phase boundary; and unify the two `closure→reflector` chains
  (in-cycle vs `finalize-merged`) onto one shared path.
