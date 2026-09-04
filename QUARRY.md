# QUARRY — every production file, its owner package, and how it moves

This file is **load-bearing**, not a planning note: `scripts/check-owner.mjs` reads it
and fails CI when a production file has no row, has two, or names an owner or a
disposition outside the vocabularies below. A file that changes owner changes this
file in the same PR.

**Scope.** Every production file under `orchestrator/`, `cli/`, `loops/`,
`skills/`, `packages/` and `apps/forge/` — code (`.ts .tsx .mjs .js .cjs`) plus the `SKILL.md` agent definitions,
which are production artifacts ([ADR 024](docs/decisions/024-phases-as-subagents-invoking-skills.md):
the `SKILL.md` **is** the agent). Test files and fixtures are excluded — a test
travels with the module it tests.

**Owner** is one of the nine packages plus the two apps named by
[`docs/roadmaps/1.0.md`](docs/roadmaps/1.0.md) §0 and §4 M2, and described in the
blueprint spec
[§3](docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md). ADR 046
ratifies that layout and is **proposed, not yet accepted** — it is parked at the
operator gate H5 (`1.0.md` §5), so this file cites the roadmap and the spec,
which are on `main`, rather than an ADR that is not. **Disposition** is how the
file reaches its package at M3:

| disposition | meaning | count |
|---|---|---|
| `verbatim` | moves unchanged | 222 |
| `pruned` | moves, with a part that belongs elsewhere dropped on the way | 5 |
| `rewritten` | **cannot** move without a behaviour change; stays where it is until rewritten | 14 |
| `deleted` | not carried forward | 8 |

## Per-package LOC caps

Spec §8: "Per-package LOC cap (starting values from the QUARRY.md targets)". A
package that would exceed its cap parks; the fix is a cull, a split, or an
operator-ratified new cap — never a silent raise.

| package | files | quarried LOC | cap | note |
|---|---|---|---|---|
| `contracts` | 2 | 750 | **1,110** | the spec targets ~0.3k. The single quarried file is 738 lines and must be pruned to types + constants; the cap is the ceiling it must come under, not a licence to stay at 738. **Re-seeded 1,000 → 1,110 (M4-flows, T1 ruling 97), priced on the measured 1,107.** +197 re-attribution: ruling 81's manifest-type lift from flows (#341); +55 lift structure/re-exports (#341, #266). Prune-to-~0.3k target unmet → M5. |
| `kernel` | 13 | 3,803 | **5,500** | quarried lines only. The spec's separate "~3k of new logic" cap governs anything WRITTEN into kernel rather than moved; the two are counted apart. |
| `library` | 33 | 12,070 | **15,071** | **Re-seeded 12,500 → 13,500 → 14,500 (M4-library, two operator rulings).** Ledger 2026-09-02: "library cap RATIFIED at 13,500" (measured projection 13,104; six object kinds against one; equals `sessions`' peer cap), then ledger 2026-09-02: "library cap RATIFIED at 14,500". The second raise was asked for with the by-kind carve re-derived SYMBOL BY SYMBOL rather than from the plan's stale ranges — 1,021 lines in (registry 521 + validate 217 + studio-lint 168 + 15 shared-helper + ~100 headers), floor 754, ceiling 1,071, against a measured base of 12,964. The lane recommended 14,500 over the next-500 rule's 14,000 because 14,000 sat BELOW its own measured ceiling of 14,035, and ratifying a number your own upper bound already exceeds is how the same park fires twice mid-PR. Base 12,964 is `check-owner`'s `productionFiles()` filter; the exit-row command reads 20 lines higher because it counts `package.json` and `tsconfig.json`. **Cap cell only** — the per-package columns are still hand-seeded and bead `forge-8vfn.5.18` owns their recomputation. **Re-seeded 14,500 → 15,000 (ruling 48), recorded as RE-ATTRIBUTION, NOT GROWTH.** The route-residue carve took `packages/library` to 14,577 against 14,500, and the lane measured the cause before asking: the change moved **+89 / −352 = net −263** across tracked files plus a **365**-line new module, so **the repository grew 102 lines while `packages/library` grew 403** — the other 301 already existed in `apps/forge/bridge-studio-writes.ts` and only changed owner, which is what "carved" means. This row's own seed (12,070) is a PRE-CARVE quarry total, taken when library's routes, loaders and validators still lived in `cli/` and `orchestrator/`; a cap seeded before the carve is breached by every carve BY CONSTRUCTION, which is why this package needed three raises in one milestone while the tree it lives in barely moved. **This is the last raise of its kind:** ruling 48 writes the fix into bead `forge-8vfn.5.18` (flows, blocking) — the cap guard measures a carve-in NET OF THE SOURCE FILE'S SHRINK and recomputes caps post-carve. Trimming the preserved W8-B5/W7-B3 security rationale to fit the old number was considered and REJECTED: every automated gate passed at 14,577, and cutting reasoning to satisfy a hand-tracked ledger figure is the wrong trade. **Re-seeded 15,000 → 15,055 (M4-library s3, 6d, ruling 128) — RE-ATTRIBUTION plus one module's structure, both named, no growth.** The last library route still dispatched by the bridge — `GET /api/studio/catalog` — moved into `packages/library/bridge-studio-catalog.ts`. It could not travel with the other 34 in the s2 carve because it reconciles catalog SDKs against the LIVE adapter registry and `isSdkAvailable` belongs to `@forge/agents` (rank 3): a REAL rank violation, proven then by planting a probe and watching `check-boundaries` fail. PR #389's `libraryRoutes(deps)` factory is what unblocked it, and the answer now arrives injected as library's own `SdkAvailabilityFn`, bound at `apps/forge/routes.ts`. Measured on the PR's own tree against main `67cc8ed6`: **`packages/library` 14,980 → 15,055 (+75)** and **`apps/forge` 7,428 → 7,377 (−51)**, repo total 114,716 → 114,740. **+51 is the exact host delta** — the 46-line arm plus the six imports that served only it, less the one import the assembly gains to bind the port — a transfer named as a transfer. **+4 is the new module's structure**, against ruling 90's ceiling of 40, and it is only 4 because the module was trimmed from 82 lines to 61 BEFORE a number was quoted: its rationale lives in `design.md` §"The palette is scanned, not declared", which the cap formula does not count. The ask being 4 over `cap + host delta` (15,051) is the honest arithmetic and was ratified as such rather than rounded. **Raised 15,055 → 15,071 (M4-library s3, PR E, ruling 135) — STRUCTURE, one named line-item.** `studio/authoring-session.ts` declares the `AuthoringSessionPort` that closes handoffs L1–L4: **16 measured structure lines** (non-blank, non-comment) against ruling 90's ceiling of 40, and the module imports nothing — it is four member signatures and two type aliases. The rationale lives in `design.md` §"The authoring turn arrives by injection", which the cap formula does not count. |
| `knowledge` | 26 | 11,157 | **12,072** | seeded from the quarried total, rounded up to the next 500; **re-seeded 11,500 → 12,000 (M4, operator ruling: "knowledge cap RATIFIED at 12,000").** The cap was seeded before the 800-line per-file cap forced the package's three largest files apart (`brain-lint.ts` 1,744 → six, `bridge-studio-kbs.ts` 2,068 → five, `bridge-studio-kb-drain.ts` 1,456 → three); a split adds module headers, import blocks and re-exported signatures without adding behaviour, so the two caps are in tension by construction. The named cause of the breach that forced the ruling is the ruling-31 public-door `index.ts` (+62). This row's own rule applied to the measured total (11,538 on main at `c323dc04`) rounds up to 12,000. **Raised 12,000 → 12,072 (M4-sessions s6, PR B4, T1 ruling 118) — the EXACT measured +73, not a rounded 12,100.** Ruling-99 port structure in knowledge: two generic types (`GuardedReadSessionStatusFn`, `GuardedWriteSessionStatusFn`) plus the `SessionStatusIoPort` pair that carries them · three threaded parameters (`approveKbCleanup`'s opts field, `mintKbCleanupDraftSession`'s and `mintProjectBrainSeedingSession`'s writer) · one `KbDrainOpts` field · one `KbCreateDeps` field · the shared `requireSessionStatusIo` refusal. **Why it could not be absorbed:** knowledge measured **11,999 against 12,000 on `1271da86` — one line of headroom** — so any implementation of the ruled port breaches. **Paid down twice before the ask, 88 → 76 → 73:** the port's 20-line rationale moved into `packages/knowledge/design.md` (prose is never overhead, so it moves rather than being charged), and three inline refusal blocks became the one shared helper, which also means the refusal wording cannot drift between three copies. What remains carries no prose. The edge this buys is the point: K5 and K6 are CLOSED BY REMOVAL, not re-keyed — `packages/knowledge` now has no import of `@forge/sessions` anywhere in the package, and the two boundary rows are deleted rather than pointed somewhere new. |
| `projects` | 22 | 7,820 | **8,500** | seeded from the quarried total, rounded up to the next 500. **Re-seeded 8,000 → 8,500 (M4-flows, T1 ruling 98)**, priced on 8,463 at `b3f728c0`: entry 4,208 + 1,558 transfer (#292 routes carve, #285) + 829 ratified S3 reset scope (#289/#295) + 1,868 unpriced growth recorded as a §2.6 finding; #292's +1,190 net carve = M5-A cull target. Operator may reverse at the M4 gate. |
| `agents` | 30 | 8,798 | **12,400** | **Re-seeded 11,548 → 12,400 (M4-agents s3, T1 ruling 88), priced on a measurement rather than a projection.** Line-items: **11,548** is the transfer-priced cap (9,000 + 233 registry + 242 band-agent-run + 109 agents-md-compose + the routes carve's 1,948 host delta — `apps/forge/ui-bridge.ts` −1,430, `apps/forge/bridge-studio-writes.ts` −483, `apps/forge/bridge-studio.ts` −35). On top of it, **785** is boundary-forced: the `BandAgentDeps` / `AgentsRouteDeps` / `AgentHistoryDeps` / `AgentRunStateDeps` / `AgentStudioRouteDeps` declarations a rank-3 package must state rather than import, the eight `RouteEntry` rows, the seam headers recording each carve's findings, and the ruling-31 public door (`index.ts` 11 → 81). The s2 P0 fixes (`spawn-marker.ts`, `dispatch-terminal.ts`) sit inside the earlier 202 of that. **67 is margin for s4's 5.22 and rofi edits.** **The cull is why this is a raise and not a debt:** 215 exported names across the package's production files, **zero** with any reference beyond their own declaration — s1's cull (KEEP 94 / CUT 42) already took the dead code, so no cut exists that is not a port, a guard, or the door itself, which is the case ruling 76's residual rule anticipated. **Growth beyond 12,400 PARKS**; the operator may reverse this at the gate. Per-FILE discipline is unaffected and improved: two `check-file-size` exemptions were RETIRED this session (`apps/forge/bridge-studio-writes.ts` 1,093 → 610 and `packages/agents/agent-run.ts` 886 → 386), deleted from the baseline rather than re-keyed. |
| `sessions` | 20 | 13,078 | **18,993** | **Re-seeded 13,500 → 16,400 (M4-sessions s2, T1 ruling 72).** PURE RE-ATTRIBUTION, not a growth grant: the routes carve (#326) moved 34 route handlers out of `cli/ui-bridge.ts` (6,600 → 3,704, −2,896) into this package, so a cap set before that transfer measures a different package. 16,400 = 13,500 + the 2,896 transferred, rounded. The package's OWN growth over M4 entry (+1,110 — module headers carrying the carve's seam findings, per-family imports and structurally-declared context types, six new module docs) sits inside the headroom the entry cap already gave (13,500 − 11,758 = 1,742); no growth ruling was sought or granted. s3's runner ports are expected to take it well below this as the four legacy runners' duplicated turn/transcript/lifecycle plumbing dissolves. The M4 exit reports sessions prod against entry with the transfer as a named line-item, never as growth. **Re-seeded again 16,400 → 17,300 (M4-sessions s3, T1 ruling 77/80).** Also pure re-attribution, priced at factory's delta: `architect-plan.ts` (862) was MISQUARRIED to `factory` — measured by module specifier, its only importers were `packages/sessions/kinds/architect.ts` and its own test, and nothing in `packages/factory`, `packages/flows`, `apps/`, `cli/` or `orchestrator/` used it. A module whose only consumers are the architect kind belongs to the architect kind, so it re-homes here and the cap carries its lines across: 17,300 = 16,400 + 862, rounded. The four runner ports meanwhile took the package DOWN — 16,266 at s3 open to 16,204 after the architect port — so the only growth in this cell is the two transfers, each named with its exact line count.  **Raised 17,300 → 17,340 (M4-sessions s4, T1 ruling 90) — SPLIT OVERHEAD, a named line-item, not growth.** Ruling 90 prices the structural cost of creating a module once: a header, its imports and — when the split requires one — a port type, capped at 40 lines per new module and ratified per PR on the measured number. This raise is **1 module × 33 measured**: `studio/roadmap-draft.ts`, the split ruling 83 REQUIRED as the condition on `studio/session-transcript.ts`'s own +9 re-key (that condition is now discharged — the file is 1,298, below even its pre-3b 1,359). Prose is never overhead and was not charged here: 64 of the original 72 lines were my own commentary and were paid down before the raise was requested — the rationale moved into `packages/sessions/design.md`, the module header from ~60 lines to 10, the re-export note from 11 to 3. Each later row-5 split raises by its own measured structure the same way, and the ruling-87 affordance carve re-seeds the cap from its host delta with these allowances folded in as line-items. **Re-seeded 17,340 → 18,689 (M4-sessions s5, ruling 87 clause 3) — the affordance carve, priced on this PR's final head.** Pre-approved method: `17,340 + the exact host delta`. Measured with the ruled formula (`node _1.0/prod-lines.mjs`, ruling 94 = `check-owner.mjs:49` NOT_PRODUCTION): `cli` **6,514 → 5,185 = −1,329**, so re-attribution alone gives **18,669**. The package landed at **18,689 = 20 over that**, and the 20 is covered by ruling 90's split allowance — **4 new production modules × measured structure = 55** (`bridge-studio-sessions-affordance-shell.ts` 19 · `kinds/demo-session-store.ts` 15 · `kinds/authoring.ts` 11 · `kinds/kb-cleanup.ts` 10), each well under the 40-line ceiling. Only 20 of that 55 is asked for, because 35 was paid back in the same PR: the carved dispatch's header went **154 → 70 lines** with the resolution chain, the no-oracle 404 discipline and the SYNC INVARIANT moved into `design.md`, and the duplicated `MAX_ANSWER_FIELD_BYTES` (plus the source-reading test that existed only to keep the duplicate honest) is gone now that both enforcement points import `session-answer-limits.ts`. **Repo-net is +50 lines** (113,914 → 113,964) against a package-net of +1,376 — the difference is the transfer, file for file, in the PR body. **Raised 18,689 → 18,705 (M4-sessions s5, ruling 102) — CONTAINMENT, +16 measured, its own named line-item.** `kinds/archive-plan.ts`'s `archiveSessionDir` interpolated a raw `sessionId` into two paths and drove `existsSync`/`mkdirSync`/`renameSync` behind them; the only thing making that safe was `resolveGuardedPath` three call frames upstream, in whichever runner happened to be on the stack. Both paths now resolve through the guard with `sessionId` as its own segment. Surfaced by the row-5 split (862 → 348 let `check-raw-fs-guarded`'s sweep finish the file and eight sinks appeared that had reported clean all campaign — the split un-blinded a scanner, it did not add a sink). Ruling 102 rejected the allowlist route outright: a residual list that grows exactly when a split makes a real gap visible is the declared-data-fails-open shape. The adversarial containment review of the diff then found the fix re-entered a DERIVED root (`archived.realPath`) as a trusted one with a `mkdirSync` in between — the guard runs no identity check on its own root, so `_archived` was verified before the mkdir and unverified after it, and a symlink planted in that window would have been adopted. The target now walks all three segments from `projectRoot`. The file's own ceiling moves 862 → 878 for the sixteen lines. **Raised 18,705 → 18,833 (M4-sessions s6, exit row 5 PR B1, rulings 90/96) — SPLIT STRUCTURE, eight named line-items, no growth.** Four production files came under the 800-line per-file cap by splitting along the one seam each had, each verified ONE-WAY by a cycle probe on the real tree before the move: `bridge-studio-sessions.ts` 1,100 → 664 + `session-resolution.ts` 466 · `kinds/architect-plan.ts` 878 → 364 + `kinds/architect-plan-html.ts` 529 · `interactive-runner.ts` 883 → 291 + `interactive-agent-step.ts` 627 · `studio/session-transcript.ts` 1,298 → 635 + `studio/session-artifact-derivers.ts` 711. Measured structure per NEW module — its header, its import block and the `export` keywords a cross-module call needs — each far under ruling 90's 40-line ceiling: **21 + 14 + 21 + 21 = 77**. The remaining **51** is parent-side: a one-way seam means each parent names what it imports back, and four import blocks is what that costs (9 + 1 + 14 + 27). 77 + 51 = **128 = 18,833 − 18,705**, so every line of this raise is accounted for. The arithmetic is re-derived against 18,705, NOT carried from the pre-#362 body: `kinds/architect-plan.ts` enters this split at 878 rather than 862 because the ruling-102 containment fix added sixteen lines to it, and those sixteen are already inside the 18,705 base — charging them again here would double-count a raise the campaign has already granted. Per-split conservation is asserted, not assumed: `kept + moved = original` holds exactly for all four (664+445−9, 364+515−1, 291+606−14, 635+690−27), and every symbol the parent dropped is present in its new module. Four `file-size.json` rows were DELETED, never re-keyed (sessions rows 14 → 10). **Raised 18,833 → 18,875 (M4-sessions s6, exit row 5 PR B2, rulings 90/96) — SPLIT STRUCTURE, +42, and 7 of it paid back in the same PR.** `studio/session-kinds.ts` 1,389 → **580** + `studio/session-kinds-validate.ts` **706** + `studio/session-kinds-affordances.ts` **148**. The seam is one-way in all THREE directions and was proven so before the move: a cycle probe with comments stripped reports ZERO references parent→leaf, validator→affordances and affordances→validator. The raw grep reported 3 + 1 + 3 and every one of them was prose inside a docstring, which is why the probe strips comments before it counts. Measured structure per NEW module, both under ruling 90's 40-line ceiling: **38 + 11 = 49**. Against that, **7 came back**: −4 where the parent no longer imports `existsSync`, `basename`, `sep`, `matter`, `Finding` or `@forge/agents/skill-path.ts` (the code that used them left), and −3 across the repointed consumers. 49 − 7 = **42 = 18,875 − 18,833**. FOUR module-private names travelled with their only consumer rather than being EXPORTED so the leaf could reach them — `err`, `allowedIdsSummary`, `discoverRuntimeAgentIds` and `DISPATCHABLE_FINALIZER_IDS`. Leaving them behind would have added four public names to a door ruling 31 governs, purely to serve a split. One `file-size.json` row DELETED, never re-keyed (sessions rows 10 → 9); neither leaf mints one. `apps/studio/…/SessionInteractivePanel.test.ts` sat at exactly 800 and the repoint's extra import line took it to 801: PAID DOWN to 797 by trimming archaeology about a kind retired in W8-B5b WI-3, not by minting an exemption (§15.65). **Raised 18,875 → 18,953 (M4-sessions s6, exit row 5 PR B3, rulings 96/90/114) — a THREE-WAY split, three named line-items, +78.** `kinds/architect.ts` 1,584 → **502** + `kinds/architect-session.ts` **370** + `kinds/architect-steps.ts` **707** + `kinds/architect-manifest.ts` **83**. Ruling 96 applies because there is no two-way seam: `runDraftStep` builds a manifest and `runFinalizeStep` calls `runDraftStep`, so any cut between draft and finalize severs a cycle rather than a dependency. Manifest construction becomes the leaf both halves stand on. Measured structure per NEW module, each under ruling 90's 40-line ceiling after §15.111 was applied to the steps' import block (41 → 39 by merging five same-module value/type pairs the file already writes inline elsewhere): **36 + 39 + 17 = 92**, less **14** of parent-side import lines the departing code made unnecessary. 92 − 14 = **78 = 18,953 − 18,875**. THE RANGES ALONE WOULD HAVE TRADED ONE CYCLE FOR TWO: the comment-stripped probe found `architectAgentSpec` (parent-declared, used 4× by the steps) making `steps → parent`, and `DraftInitiative` (steps-declared, used by the manifest builder) making `manifest → steps`. Both moved to `architect-session.ts`, and the four modules now form a DAG — **session ← manifest ← steps ← parent**, zero back-edges. `readStatus`/`writeStatus` STAYED in the parent under ruling 114: moving them with the rest of the status IO was built and measured, and it made `check-raw-fs-guarded` stop flagging three byte-identical sinks (residuals 91 → 88, three allowlist entries STALE), so the split changed the analyser's view rather than the code. The seam gives up 15 lines of tidiness to keep the analysis. One `file-size.json` row DELETED, never re-keyed (sessions rows 9 → 8); no leaf mints one. **Raised 18,953 → 18,956 (M4-sessions s6, exit row 5 PR B4, rulings 90/99/114) — +3, the smallest raise of the four splits and the only one where the paydown nearly cancels the structure.** `interactive-session.ts` 993 → **799** + `session-status-io.ts` **224**. Measured structure **29** (the leaf header and its two import lines), less **26** of imports the departing code made unnecessary across the parent and the eighteen repointed consumers, plus **5** where `kinds/kb-cleanup.ts` supplies the port to `approveKbCleanup` — sessions owns those functions, so the kind that calls into knowledge is what binds them. 29 − 26 + 5 = **8**. **Raised 18,961 → 18,964 (M4-sessions s6, exit row 1) — +3, and it BUYS a boundary row rather than costing one.** `bridge-studio-session-cancel.ts` was the last PRODUCTION file in this package reaching into the assembly: it imported the host's `readJson`, and the file's own comment named that import as the only thing holding its legacy row open. The body now arrives through `ctx.readBody()` — the same closure `familyContext` has always supplied, reached through the route envelope instead of an import (T1 ruling 30; body POLICY stays the host's). +8/−5 in that file, +1/−1 in `routes.ts`. The row is **DELETED, not re-keyed** — boundaries N 209 → 208, `boundary-share.mjs sessions` 9 → 8 — and after it **every remaining sessions boundary row is a TEST**, none production. TWO THINGS DELIBERATELY DID NOT TRAVEL, both because the seam is worth less than what moving them costs. `makeHeartbeatWriter` was the only thing in the moved half reading `HEARTBEAT_THROTTLE_MS`, which the parent's streaming loops also read: moving it would have left a leaf importing a constant from its own parent, and moving the constant too would have repointed its other consumer for nothing — so it stays, and the cycle probe reports EMPTY from the leaf back to the parent. `readSessionStatus`/`writeSessionStatus` stay under **ruling 114 applied a second time**: moving them turned three allowlist entries STALE while the source lines were byte-identical, so the split would have changed the analyser's view rather than the code. Residuals are **94 on both sides**, zero stale, zero unguarded. **K5 and K6 CLOSED in this PR (ruling 99), not re-keyed:** `packages/knowledge` now has NO import of `@forge/sessions` anywhere — the guarded status IO arrives as `SessionStatusIoPort`, declared in knowledge's own vocabulary and bound at `apps/forge`, with the type parameters carried through so the one generic read site needs no cast. Boundary rows **307 → 305**, the two removed being exactly K5 and K6. One `file-size.json` row DELETED (`interactive-session.ts`) and two more TIGHTENED rather than left slack (`demo-builder-skill-prompt.test.ts` retired at 800, `demo-builder-runner.test.ts` 864 → 859): sessions rows **8 → 6**. **DECREASE 18,964 → 18,950 (s6, ruling 129).** The architect kind's raw `readStatus`/`writeStatus` pair was DELETED, not renamed: an unguarded join-then-writeFileSync onto the `status.json` leaf with ZERO production callers, superseded by the SEC-04 guarded pair and kept alive only by three test fixtures. The cap is lowered to the exact measured figure, not left slack (§15.65). **RAISE 18,950 → 18,988 (s6 door, +38 exact).** `index.ts` went from `export {}` (11 lines) to the package's real public door (49 lines) — 34 value exports and 15 types across 18 module paths, plus the header stating what is deliberately NOT exported. The whole delta is that one file: `README.md` and `contract.test.ts` are not production files under the ruling-94 formula. Within ruling 90's 40-line structural allowance. **Raised 18,988 → 18,993 (M4-library s3, PR E, ruling 137) — +5 measured, the BINDING side of library's L1–L4 port, not growth.** Library declares `AuthoringSessionPort`; the instance is constructed at `apps/forge/library-authoring-session.ts` (uncapped assembly, the `session-kind-deps.ts` pattern) and reaches `kinds/authoring.ts` through the deps this package already threads. The five lines are exactly that thread: two type imports, two field declarations (`SessionsRouteDeps`, `AffordanceRouteContext`) and one spread. A 33-line binding module inside this package was built first and REJECTED under ruling 137 as duplicating what the assembly already does for every other kind dependency. |
| `flows` | 62 | 21,327 | **22,500** | seeded from the quarried total, rounded up to the next 500. |
| `factory` | 37 | 13,004 | **13,500** | **Re-seeded 12,500 → 13,500 (M2-B, operator ruling).** Two effects landed together: M2-B quarried `orchestrator/phases/executor-{deps,table}.ts` (960 lines) here, where the six phases they wire already live — a `flows`-owned table importing those phases would be a `flows → factory` edge the allow-graph forbids; and the per-package columns in this table, hand-seeded and never recomputed, are now DERIVED from the rows below, which showed `factory` at 12,044 before those two files rather than the figure its cap was seeded from. The new cap applies this row's own stated rule — the measured total (13,004) rounded up to the next 500 — to a total that is now measured rather than asserted. The full column recomputation, and teaching `check-owner.mjs` to enforce it, is bead `forge-8vfn.5.18`. |
| `apps/forge` | 4 | 10,089 | **800** | the spec states "CLI router + bridge host (≤800 lines)". The quarried total is 10,089 — a 9,289-line debt, all four files marked pruned or rewritten. This cap is a TARGET the move must reach, not a baseline. |
| `apps/studio` | 0 | 0 | — | the `git mv` of `forge-ui`; it quarries nothing from these four trees. |
| **total** | **241** | **103,166** | | |

## Three numbers that are findings, not targets

1. **`apps/forge` is 9,289 lines over its stated cap.** The spec fixes the router and
   bridge host at ≤800 lines; the four files that land there quarry 10,089, of which
   `apps/forge/ui-bridge.ts` alone is 6,602. Three of the four are marked `rewritten` and one
   `pruned` for exactly this reason: the host is a monolith that mixes generic
   plumbing with route handlers belonging to five packages. Reaching 800 is the
   single largest piece of M3/M4 work this quarry surfaces.
2. **`contracts` quarries one file, 738 lines, against a ~0.3k target.**
   `orchestrator/studio/types.ts` is the only file in the tree that is purely types
   with no runtime behaviour. It moves `verbatim` and is then pruned to what
   `apps/studio` actually imports.
3. **Eleven files are `rewritten` and therefore do NOT move at M3.** Each straddles two or
   more packages, and rewriting one here would be a behaviour change smuggled into a
   move. They are listed together below so the M4 lanes inherit them explicitly.

### The `rewritten` set — files that stay put until their package rewrites them

| path | owner | LOC | why it cannot move as-is |
|---|---|---|---|
| ~~`cli/bridge-studio-affordances.ts`~~ | `sessions` | 1,313 | **CARVED (M4-sessions s5, ruling 87).** The dispatch is `packages/sessions/bridge-studio-sessions-affordances.ts`; the per-kind arms it inlined went to their own kinds (`kinds/{instructions,demo-builder,kb-cleanup,authoring}.ts`, the last two minted identity-only by ruling 87) and the shared shell to `bridge-studio-sessions-affordance-shell.ts`. The route is table entry 37 in `packages/sessions/routes.ts`, after cancel. |
| `apps/forge/bridge-studio-writes.ts` | `projects` | 2,482 | one route file writing agent SKILL.md, community entries, project scaffolding and flow.yaml |
| `apps/forge/bridge-studio.ts` | `apps/forge` | 1,750 | generic CSRF/origin/JSON plumbing interleaved with flows and library GET routes |
| `cli/dry-bridge.ts` | `kernel` | 453 | one static table classifying routes owned by flows, agents and library alike |
| `apps/forge/studio-lint.ts` | `apps/forge` | 805 | validates agent, flow, catalog and community definitions in a single pass. **Owner corrected `kernel` → `apps/forge` (ruling 55, M4-knowledge s5): the `kernel` cell was unsatisfiable.** This file imports `@forge/flows` (rank 5), `@forge/sessions` (4), `@forge/agents` (3), five `@forge/library` modules — and `orchestrator/studio/{registry,validate}.ts` directly. Rule 1 ("packages never import legacy") has no rank exception, so no package at ANY rank can host it, kernel least of all; and it is a live CLI entry point (`apps/forge/cli.ts:471` backs `forge studio lint`). `apps/forge` is the one tree `classify()` gives no rule. Cell only — the two knowledge rows into it go to the host carve. |
| `packages/kernel/provenance.ts` | `kernel` | 54 | a 54-line pure mapping whose ONLY test is a 642-line bridge integration test that imports `ui-bridge.ts`; the test cannot follow it into a package without dragging the bridge across the boundary, and a kernel module with no package-level test is the shape this campaign exists to stop. Needs its pure-mapping test extracted from the integration test first. **MOVED 2026-09-03 (M4-knowledge s5): `cli/studio-provenance.ts` → `packages/kernel/provenance.ts`, with that precondition met in the same PR** — AT-3a's mapping cases are now `packages/kernel/provenance.test.ts` beside the module, and the bridge test keeps only what is genuinely about a route's response. The move closed the `package-to-legacy` row from `packages/knowledge/bridge-studio-kbs.ts` into this file: knowledge had to reach into `cli/` for a mapping that is "a fact every package needs and none of them owns" — kernel's own charter. |
| `apps/forge/ui-bridge.ts` | `apps/forge` | 6,602 | the 6,602-line host: agent spawn, session index and authoring routes in one file |
| `orchestrator/band-agent-run.ts` | `agents` | 242 | generic band dispatch that hardcodes two `orchestrator/phases/` imports — the port must exist first. **MOVED 2026-09-03 (M4-agents s3): `packages/agents/band-agent-run.ts`.** The port could not be `PhaseExecutor` — that returns `CycleOutcome` (`'merged'\|'pr-open'\|'ready-for-review'`), while what crosses this seam is a PIPELINE status the run's terminal `end` event and the CLI summary both read — so `BandAgentDeps` is declared in the package (ruling 59's shape) and bound at `apps/forge/band-agent-deps.ts`. The queue/manifest reads (`@forge/flows`, rank 6) ride the same object. Every guard stayed (COMMON §15.47). |
| `packages/flows/flow-runner.ts` | `flows` | 615 | M2-B replaced its ten phase imports with the `PhaseExecutor` port; the table it shed is `phases/executor-{table,deps}.ts` |
| `packages/sessions/kinds/project-brain.ts` | `sessions` | 186 | **PORTED 2026-09-03 (M4-sessions s3, ruling 60).** Was `orchestrator/project-brain-builder-runner.ts`. The brain half — `buildAnalyzePlan`, `commitProjectBrain`, `listStagedThemes`, `PROJECT_BRAIN_KIND_DIR` — left first as `packages/knowledge/project-brain-build.ts` (M4-knowledge s5, ruling 56). The 296-line residue was the SHED PLUMBING, and this port sheds it: containment preamble, guarded status read/write, logger/sink/heartbeat/thinking construction and the start/end events are now `kinds/kind-turn.ts`'s, shared by every ported kind. What is left here is the kind's IDENTITY — its phase set, its agent spec, and the two steps that do work. Its `AGENT_RUNNERS` row moved to `kinds/registry.ts` beside it; the old file is deleted. Owner cell now `sessions`, as the knowledge row predicted it would become. |
| `orchestrator/studio/registry.ts` | `kernel` | 1,180 | one loader for Agent, Flow, KB, Catalog, Community, Template and Project — five packages in one file. **DELETED 2026-09-04 (M4-library s3, ruling 113 as amended by 126/130).** Each kind left for the package that owns it across M3 and M4 — Agent to `@forge/agents/studio/agent-registry.ts`, Flow to `@forge/flows/studio/flow-registry.ts`, KB to `@forge/knowledge/studio/kb-descriptor.ts`, Skill/Template/Catalog/Community to `@forge/library/studio/*-registry.ts`, project discovery to `@forge/kernel` — leaving a 123-line re-export hub with 36 importers and nothing defined in it. Annotated rather than removed, matching the `band-agent-run.ts` and `project-brain.ts` rows above: this table records what the quarry FOUND and what became of it. |
| `orchestrator/studio/validate.ts` | `kernel` | 1,066 | the same five-way split on the validation side |

### `pruned` and `deleted`

| path | owner | disposition | LOC | what is dropped |
|---|---|---|---|---|
| `packages/projects/preflight.ts` | `projects` | `pruned` | 1,135 | M2-B moved its four pure report types (`ClauseId`, `ClauseResult`, `PreflightReport`, `PreflightOptions`) to `packages/kernel/project-contract.ts`, because the `ProjectGate` port declares them and flows may not import this file (SPEC.md §6); the module re-exports them |
| `orchestrator/brain-paths.ts` | `knowledge` | `pruned` | 141 | the project-side `.forge/` artifact-root read goes to `projects` |
| `orchestrator/cli.ts` | `apps/forge` | `pruned` | 998 | every subcommand body goes to the package that owns it; only the router stays |
| `orchestrator/flow-artifacts.ts` | `flows` | `pruned` | 437 | the develop-flow-specific artifact schemas go to `factory` |
| `orchestrator/init.ts` | `kernel` | `pruned` | 144 | the `forge init` command shell goes to `apps/forge`; the layout constants stay |
| `orchestrator/_pkg/contracts.ts` | `contracts` | `deleted` | 12 | the one greppable shim through which legacy reaches `@forge/contracts` (§0); deleted at cutover, and `grep -rl "_pkg/contracts"` is the exact list of legacy files still depending on the package |
| `orchestrator/phases/demo-fanin-honesty.ts` | `factory` | `deleted` | 183 | dead: its only production caller was the retired unifier gate; knip and grep agree nothing reaches it |
| `orchestrator/phases/developer-loop.ts` | `factory` | `pruned` | 1,941 | the per-work-item queue and recovery bookkeeping goes to `flows` (spec §3.1: "queue/recovery → flows") |

## Every production file

| path | owner | disposition | loc |
|---|---|---|---|
| packages/agents/agent-run.ts | agents | verbatim | 386 |
| packages/sessions/kinds/architect-plan.ts | sessions | verbatim | 348 |
| packages/sessions/kinds/architect-plan-html.ts | sessions | rewritten | 529 |
| packages/knowledge/brain-fix-auto.ts | knowledge | verbatim | 255 |
| packages/knowledge/brain-index.ts | knowledge | verbatim | 369 |
| packages/knowledge/brain-lint-checks-filing.ts | knowledge | verbatim | 326 |
| packages/knowledge/brain-lint-checks-graph.ts | knowledge | verbatim | 247 |
| packages/knowledge/brain-lint-checks-integrity.ts | knowledge | verbatim | 484 |
| packages/knowledge/brain-lint-theme-paths.ts | knowledge | verbatim | 146 |
| packages/knowledge/brain-lint-types.ts | knowledge | verbatim | 54 |
| packages/knowledge/brain-lint.ts | knowledge | verbatim | 646 |
| packages/flows/bridge-hooks.ts | flows | verbatim | 397 |
| packages/flows/bridge-recovery.ts | flows | verbatim | 258 |
| packages/sessions/bridge-studio-sessions-affordance-shell.ts | sessions | rewritten | 272 |
| packages/sessions/bridge-studio-sessions-affordances.ts | sessions | rewritten | 496 |
| packages/sessions/bridge-studio-agent-capability.ts | sessions | verbatim | 117 |
| packages/library/bridge-studio-authoring-hook.ts | library | verbatim | 275 |
| packages/library/bridge-studio-authoring-skill.ts | library | verbatim | 64 |
| packages/library/bridge-studio-authoring-template.ts | library | verbatim | 132 |
| packages/library/bridge-studio-authoring-types.ts | library | verbatim | 24 |
| packages/library/bridge-studio-authoring.ts | library | verbatim | 517 |
| packages/library/bridge-studio-community-crud.ts | library | verbatim | 365 |
| packages/library/bridge-studio-community-hook-preinstall.ts | library | verbatim | 105 |
| packages/library/bridge-studio-community-wire.ts | library | verbatim | 213 |
| packages/library/bridge-studio-community.ts | library | verbatim | 545 |
| packages/library/bridge-studio-connections.ts | library | verbatim | 225 |
| packages/library/bridge-studio-hooks-decline.ts | library | verbatim | 61 |
| packages/library/bridge-studio-hooks.ts | library | verbatim | 727 |
| packages/library/bridge-studio-instructions.ts | library | verbatim | 149 |
| packages/knowledge/bridge-studio-kb-consolidate.ts | knowledge | verbatim | 376 |
| packages/knowledge/bridge-studio-kb-drain.ts | knowledge | verbatim | 753 |
| packages/knowledge/bridge-studio-kb-routes-lifecycle.ts | knowledge | verbatim | 538 |
| packages/knowledge/bridge-studio-kb-routes-maintenance.ts | knowledge | verbatim | 546 |
| packages/knowledge/bridge-studio-kb-routes-read.ts | knowledge | verbatim | 308 |
| packages/knowledge/bridge-studio-kbs.ts | knowledge | verbatim | 720 |
| packages/sessions/bridge-studio-lifecycle.ts | sessions | verbatim | 424 |
| packages/flows/bridge-studio-runs.ts | flows | verbatim | 440 |
| packages/flows/bridge-studio-runs-review.ts | flows | verbatim | 517 |
| packages/sessions/bridge-studio-session-cancel.ts | sessions | verbatim | 206 |
| packages/sessions/bridge-studio-sessions.ts | sessions | verbatim | 664 **Ceiling re-keyed +4 (M4-sessions s3 3b, T1 ruling 83):** the ruled manifest seam (ruling 81) threads an injected port through this file — three `package-layer-order` rows closed for it. Paid down as far as the file allows before the re-key: the ports contract was extracted to `kinds/architect-ports.ts` (which returned `kinds/architect.ts` to exactly 1,584, no raise), every added comment tightened, and stale runner paths corrected. Not a licence — the next edit measures against the new number. |
| packages/sessions/session-resolution.ts | sessions | rewritten | 466 |
| packages/library/bridge-studio-skills.ts | library | verbatim | 578 |
| packages/library/bridge-studio-templates.ts | library | verbatim | 348 |
| apps/forge/bridge-studio-writes.ts | projects | rewritten | 2482 |
| apps/forge/bridge-studio.ts | apps/forge | rewritten | 1750 |
| packages/library/community-refresh-cmd.ts | library | verbatim | 104 |
| packages/library/community-refresh-run.ts | library | verbatim | 454 |
| packages/library/community-registry-lock.ts | library | verbatim | 126 |
| packages/projects/contract-compliance-loop.ts | projects | verbatim | 167 |
| packages/projects/contract-stages.ts | projects | verbatim | 324 |
| packages/factory/cycle-recap.ts | factory | verbatim | 395 |
| packages/knowledge/cycle-retention.ts | knowledge | verbatim | 204 |
| packages/factory/demo-capture.ts | factory | verbatim | 48 |
| packages/factory/demo-model.ts | factory | verbatim | 744 |
| packages/factory/demo-runtime.ts | factory | verbatim | 184 |
| packages/factory/demo-types.ts | factory | verbatim | 59 |
| packages/factory/demo.ts | factory | verbatim | 232 |
| apps/forge/library-flow-source.ts | apps/forge | rewritten | 14 |
| apps/forge/library-authoring-session.ts | apps/forge | rewritten | 30 |
| apps/forge/library-agent-facts.ts | apps/forge | rewritten | 58 |
| apps/forge/dry-bridge.ts | kernel | rewritten | 428 |
| packages/flows/flow-band-vocab.ts | flows | verbatim | 67 |
| packages/flows/forge-metrics.ts | flows | verbatim | 782 |
| packages/flows/forge-requeue.ts | flows | verbatim | 273 |
| apps/forge/forge-watch.ts | apps/forge | verbatim | 739 |
| packages/knowledge/kb-drain-edit-soundness.ts | knowledge | verbatim | 747 |
| packages/knowledge/kb-drain-structural.ts | knowledge | verbatim | 230 |
| packages/knowledge/kb-job-state.ts | knowledge | verbatim | 208 |
| packages/knowledge/kb-drain-routes.ts | knowledge | verbatim | 395 |
| packages/knowledge/kb-drain-model.ts | knowledge | verbatim | 381 |
| packages/knowledge/kb-drain-store.ts | knowledge | verbatim | 434 |
| packages/knowledge/routes.ts | knowledge | verbatim | 153 |
| packages/library/routes.ts | library | verbatim | 401 |
| packages/knowledge/kb-lint-summary.ts | knowledge | verbatim | 545 |
| packages/knowledge/kb-read-policy.ts | knowledge | verbatim | 91 |
| packages/knowledge/kb-sites.ts | knowledge | verbatim | 110 |
| packages/flows/manifest-path-guard.ts | flows | verbatim | 344 |
| packages/agents/materials-staging.ts | agents | verbatim | 269 |
| packages/flows/metrics.ts | flows | verbatim | 142 |
| packages/projects/preflight-fix-auto.ts | projects | verbatim | 171 |
| packages/projects/preflight-resolve.ts | projects | verbatim | 67 |
| packages/projects/preflight.ts | projects | pruned | 281 |
| packages/projects/preflight-build.ts | projects | verbatim | 142 |
| packages/projects/preflight-demo.ts | projects | verbatim | 159 |
| packages/projects/preflight-gate.ts | projects | verbatim | 278 |
| packages/projects/preflight-instructions.ts | projects | verbatim | 138 |
| packages/projects/preflight-release.ts | projects | verbatim | 74 |
| packages/projects/preflight-repo.ts | projects | verbatim | 218 |
| packages/projects/preflight-skills.ts | projects | verbatim | 76 |
| packages/projects/preflight-deps.ts | projects | verbatim | 158 |
| packages/projects/project-migrate.ts | projects | verbatim | 197 |
| packages/factory/reflect-reconcile.ts | factory | verbatim | 167 |
| packages/factory/reflection-doc.ts | factory | verbatim | 354 |
| packages/flows/run-list-cache.ts | flows | verbatim | 397 |
| packages/sessions/session-model-tier.ts | sessions | verbatim | 49 |
| packages/sessions/bridge-studio-instructions.ts | sessions | verbatim | 444 |
| packages/sessions/session-answer-limits.ts | sessions | verbatim | 12 |
| packages/sessions/bridge-studio-project-brain.ts | sessions | verbatim | 238 |
| packages/sessions/bridge-studio-kickoff.ts | sessions | verbatim | 702 |
| packages/sessions/bridge-studio-demo.ts | sessions | verbatim | 795 |
| packages/sessions/bridge-studio-session-index.ts | sessions | verbatim | 381 |
| packages/sessions/bridge-studio-architect.ts | sessions | verbatim | 394 |
| packages/sessions/bridge-studio-session-helpers.ts | sessions | verbatim | 541 |
| packages/sessions/routes.ts | sessions | verbatim | 478 |
| packages/sessions/session-phases.ts | sessions | verbatim | 74 |
| packages/sessions/session-readability.ts | sessions | verbatim | 207 |
| packages/library/skill-path.ts | library | verbatim | 91 |
| packages/library/skill-staging.ts | library | verbatim | 136 |
| packages/library/studio-lint-library-passes.ts | library | verbatim | 239 |
| packages/library/studio-lint-tool-fence.ts | library | verbatim | 149 |
| apps/forge/studio-lint.ts | kernel | rewritten | 662 |
| packages/kernel/provenance.ts | kernel | rewritten | 54 |
| packages/kernel/dry-bridge.ts | kernel | rewritten | 86 |
| packages/kernel/log-cycles.ts | kernel | rewritten | 44 |
| packages/knowledge/theme-frontmatter.ts | knowledge | verbatim | 116 |
| apps/forge/ui-bridge.ts | apps/forge | rewritten | 2265 |
| packages/agents/_adapters/aider/index.ts | agents | verbatim | 485 |
| packages/agents/_adapters/claude/index.ts | agents | verbatim | 29 |
| packages/agents/_adapters/conformance.ts | agents | verbatim | 203 |
| packages/agents/_adapters/example/index.ts | agents | verbatim | 111 |
| packages/agents/_adapters/gemini/index.ts | agents | verbatim | 553 |
| packages/agents/_adapters/registry.ts | agents | verbatim | 107 |
| packages/agents/_adapters/types.ts | agents | verbatim | 56 |
| packages/agents/ralph/claude-agent.ts | agents | verbatim | 553 |
| packages/agents/ralph/runner.ts | agents | verbatim | 435 |
| packages/agents/ralph/stop-conditions.ts | agents | verbatim | 685 |
| packages/agents/agent-bands.ts | agents | verbatim | 86 |
| packages/agents/agent-dispatch.ts | agents | verbatim | 365 |
| packages/agents/dispatch-terminal.ts | agents | verbatim | 194 |
| packages/agents/band-agent-run.ts | agents | rewritten | 368 |
| packages/agents/routes.ts | agents | rewritten | 100 |
| packages/agents/bridge-agents-run-state.ts | agents | rewritten | 403 |
| packages/agents/bridge-agents-history-rows.ts | agents | rewritten | 458 |
| packages/agents/bridge-agents-runs.ts | agents | rewritten | 243 |
| packages/agents/bridge-agents-slug.ts | agents | rewritten | 564 |
| packages/agents/bridge-agents-studio.ts | agents | rewritten | 614 |
| packages/agents/agent-dispatch-cmd.ts | agents | rewritten | 497 |
| packages/agents/find-session-project.ts | agents | verbatim | 52 |
| packages/agents/agents-md-compose.ts | agents | verbatim | 116 |
| apps/forge/band-agent-deps.ts | apps/forge | verbatim | 39 |
| packages/sessions/kinds/architect.ts | sessions | verbatim | 502 |
| packages/sessions/kinds/architect-session.ts | sessions | rewritten | 370 |
| packages/sessions/kinds/architect-steps.ts | sessions | rewritten | 707 |
| packages/sessions/kinds/architect-manifest.ts | sessions | rewritten | 83 |
| packages/sessions/bash-fence.ts | sessions | verbatim | 508 |
| packages/sessions/kinds/brain-fix.ts | sessions | rewritten | 269 |
| packages/sessions/kinds/fix-turn.ts | sessions | rewritten | 331 |
| packages/sessions/kinds/fix-registry.ts | sessions | rewritten | 90 |
| packages/knowledge/brain-paths.ts | knowledge | pruned | 141 |
| packages/flows/claim-validator.ts | flows | verbatim | 233 |
| apps/forge/cli.ts | apps/forge | pruned | 998 **Ceiling re-keyed +1 (M4-sessions s3 3b, T1 ruling 83):** the ruled manifest seam (ruling 81) threads an injected port through this file — three `package-layer-order` rows closed for it. Paid down as far as the file allows before the re-key: the ports contract was extracted to `kinds/architect-ports.ts` (which returned `kinds/architect.ts` to exactly 1,584, no raise), every added comment tightened, and stale runner paths corrected. Not a licence — the next edit measures against the new number. |
| apps/forge/routes.ts | apps/forge | verbatim | 38 |
| packages/sessions/kinds/architect-critic.ts | sessions | verbatim | 297 |
| packages/projects/constraint-author.ts | projects | verbatim | 99 |
| packages/projects/constraint-blocks.ts | projects | verbatim | 257 |
| packages/flows/cron-triggers.ts | flows | verbatim | 242 |
| packages/flows/ci-gate.ts | flows | verbatim | 147 |
| packages/flows/cycle-context.ts | flows | verbatim | 346 |
| packages/flows/cycle-helpers.ts | flows | verbatim | 694 |
| packages/flows/cycle-report.ts | flows | verbatim | 29 |
| packages/flows/cycle.ts | flows | verbatim | 484 |
| packages/flows/daemon.ts | flows | verbatim | 248 |
| packages/sessions/kinds/demo-builder.ts | sessions | verbatim | 775 |
| packages/sessions/kinds/authoring.ts | sessions | rewritten | 142 |
| packages/sessions/kinds/demo-session-store.ts | sessions | rewritten | 86 |
| packages/sessions/kinds/kb-cleanup.ts | sessions | rewritten | 72 |
| packages/flows/demo-fix-loop.ts | flows | verbatim | 218 |
| packages/flows/demo-paths.ts | flows | verbatim | 71 |
| packages/flows/drain-fix-loop.ts | flows | verbatim | 286 |
| packages/flows/enqueue-develop-run.ts | flows | verbatim | 77 |
| packages/flows/enqueue-flow-run.ts | flows | verbatim | 366 |
| packages/flows/enqueue-plan-run.ts | flows | verbatim | 236 |
| packages/agents/failure-classifier.ts | agents | verbatim | 517 |
| packages/flows/finalize-merged.ts | flows | verbatim | 412 |
| packages/flows/fix-work-items.ts | flows | verbatim | 388 |
| packages/flows/flow-artifacts.ts | flows | pruned | 437 |
| packages/flows/flow-budgets.ts | flows | verbatim | 450 |
| packages/flows/flow-run-requests.ts | flows | verbatim | 397 |
| packages/flows/flow-node-context.ts | flows | verbatim | 54 |
| packages/flows/flow-node-kind.ts | flows | verbatim | 66 |
| packages/flows/flow-runner.ts | flows | rewritten | 638 |
| packages/flows/flow-fanout.ts | flows | verbatim | 34 |
| packages/flows/flow-trigger.ts | flows | verbatim | 214 |
| packages/flows/gate-fix-loop.ts | flows | verbatim | 163 |
| packages/projects/gate-recipes.ts | projects | verbatim | 146 |
| packages/flows/initiative-id.ts | flows | verbatim | 210 |
| packages/library/instruction-seed-match.ts | library | verbatim | 152 |
| packages/sessions/kinds/instructions.ts | sessions | verbatim | 706 |
| packages/sessions/interactive-finalizers.ts | sessions | verbatim | 422 |
| packages/sessions/interactive-runner.ts | sessions | verbatim | 294 |
| packages/sessions/interactive-agent-step.ts | sessions | rewritten | 621 |
| packages/sessions/interactive-session.ts | sessions | verbatim | 799 |
| packages/sessions/session-status-io.ts | sessions | rewritten | 224 |
| packages/knowledge/kb-backend.ts | knowledge | verbatim | 142 |
| packages/knowledge/kb-graph.ts | knowledge | verbatim | 683 |
| packages/knowledge/kb-health.ts | knowledge | verbatim | 274 |
| packages/flows/manifest.ts | flows | verbatim | 744 |
| packages/flows/mint-triggered-initiative.ts | flows | verbatim | 233 |
| packages/agents/model-range.ts | agents | verbatim | 115 |
| packages/flows/notify.ts | flows | verbatim | 73 |
| packages/agents/phase-agent.ts | agents | verbatim | 101 |
| packages/factory/phases/adversarial-review-binding.ts | factory | verbatim | 139 |
| packages/factory/phases/adversarial-review.ts | factory | verbatim | 393 |
| packages/agents/phases/agent-scope-guard.ts | agents | verbatim | 111 |
| packages/flows/phases/closure.ts | flows | verbatim | 431 |
| packages/factory/phases/executor-deps.ts | factory | rewritten | 284 |
| packages/factory/phases/executor-table.ts | factory | rewritten | 676 |
| packages/flows/phase-wiring.ts | flows | verbatim | 48 |
| apps/forge/factory-wiring.ts | apps/forge | verbatim | 27 |
| packages/factory/phases/decompose-completeness.ts | factory | verbatim | 197 |
| packages/factory/phases/demo-agent-binding.ts | factory | verbatim | 214 |
| packages/factory/phases/demo-agent.ts | factory | verbatim | 740 |
| packages/factory/phases/dev-binding.ts | factory | verbatim | 339 |
| packages/factory/phases/developer-loop.ts | factory | pruned | 1941 |
| packages/flows/phases/orchestrated-capture.ts | flows | verbatim | 301 |
| packages/factory/phases/pm-binding.ts | factory | verbatim | 386 |
| packages/factory/phases/project-manager.ts | factory | verbatim | 859 |
| packages/flows/phases/ralph-spec-lint.ts | flows | verbatim | 469 |
| packages/factory/phases/reflector-binding.ts | factory | verbatim | 262 |
| packages/factory/phases/reflector.ts | factory | verbatim | 981 |
| packages/factory/phases/release-finalize.ts | factory | verbatim | 299 |
| packages/flows/phases/wi-spec-compile.ts | flows | verbatim | 509 |
| packages/agents/pinned-sdk-query.ts | agents | verbatim | 87 |
| packages/flows/planned-initiatives.ts | flows | verbatim | 53 |
| packages/flows/pr.ts | flows | verbatim | 431 |
| packages/flows/pr-branch-sync.ts | flows | verbatim | 556 |
| packages/flows/pr-ci-watch.ts | flows | verbatim | 203 |
| packages/sessions/kinds/preflight-fix.ts | sessions | rewritten | 132 |
| packages/sessions/kinds/kind-turn.ts | sessions | rewritten | 421 |
| packages/sessions/kinds/project-brain.ts | sessions | rewritten | 179 |
| packages/sessions/kinds/registry.ts | sessions | rewritten | 131 |
| packages/sessions/kinds/architect-ports.ts | sessions | rewritten | 44 |
| packages/contracts/manifest-types.ts | contracts | rewritten | 221 |
| packages/sessions/tests/architect-ports-stub.ts | sessions | rewritten | 44 |
| apps/forge/session-kind-deps.ts | apps/forge | rewritten | 31 |
| apps/forge/brain-fix-turn.ts | apps/forge | rewritten | 85 |
| apps/forge/manifest-fixtures.ts | apps/forge | rewritten | 44 |
| packages/knowledge/project-brain-build.ts | knowledge | rewritten | 219 |
| packages/knowledge/project-brain-seed.ts | knowledge | verbatim | 353 |
| packages/projects/project-config.ts | projects | verbatim | 330 |
| packages/projects/project-config-sidecar.ts | projects | verbatim | 76 |
| packages/projects/project-config-types.ts | projects | verbatim | 211 |
| packages/projects/project-config-validate.ts | projects | verbatim | 468 |
| packages/projects/project-create.ts | projects | verbatim | 364 |
| packages/projects/project-repo-tx.ts | projects | verbatim | 201 |
| packages/projects/reset.ts | projects | verbatim | 583 |
| packages/flows/promote-manifests.ts | flows | verbatim | 76 |
| packages/flows/queue.ts | flows | verbatim | 231 |
| packages/factory/reflector-rerun.ts | factory | verbatim | 112 |
| packages/factory/release-finalize-invocation.ts | factory | verbatim | 165 |
| packages/factory/release-process.ts | factory | verbatim | 66 |
| packages/flows/requeue-resume.ts | flows | verbatim | 193 |
| packages/factory/review-comments.ts | factory | verbatim | 229 |
| packages/agents/run-agent.ts | agents | verbatim | 665 |
| packages/agents/spawn-marker.ts | agents | verbatim | 276 |
| packages/flows/run-model-derive.ts | flows | verbatim | 988 |
| packages/flows/run-model.ts | flows | verbatim | 596 |
| packages/flows/run-model-flow-graph.ts | flows | verbatim | 254 |
| packages/flows/run-view-types.ts | flows | verbatim | 189 |
| packages/flows/scheduler-dispatch.ts | flows | verbatim | 252 |
| packages/flows/scheduler.ts | flows | verbatim | 1031 |
| packages/agents/skill-path.ts | agents | verbatim | 239 |
| packages/agents/stream-deadline.ts | agents | verbatim | 74 |
| packages/library/studio/artifact-registry.ts | library | verbatim | 149 |
| packages/library/studio/catalog-registry.ts | library | verbatim | 90 |
| packages/library/studio/community-index.ts | library | verbatim | 693 |
| packages/library/studio/community-install.ts | library | verbatim | 208 |
| packages/library/studio/community-refresh-api.ts | library | verbatim | 588 |
| packages/library/studio/community-registry.ts | library | verbatim | 321 |
| packages/library/studio/community-source-url.ts | library | verbatim | 164 |
| packages/library/studio/connection-catalog.ts | library | verbatim | 163 |
| packages/library/studio/connection-install.ts | library | verbatim | 101 |
| packages/library/bridge-studio-catalog.ts | library | verbatim | 61 |
| packages/library/studio/authoring-session.ts | library | rewritten | 33 |
| packages/library/studio/agent-facts.ts | library | rewritten | 36 |
| packages/library/studio/connection-library.ts | library | verbatim | 230 |
| packages/library/studio/connection-probe.ts | library | verbatim | 417 |
| packages/library/studio/connection-readiness.ts | library | verbatim | 49 |
| packages/agents/studio/connection-run-gate.ts | agents | verbatim | 71 |
| packages/library/studio/connection-validate.ts | library | verbatim | 217 |
| packages/agents/studio/agent-registry.ts | agents | verbatim | 283 |
| packages/agents/studio/agent-usage.ts | agents | verbatim | 121 |
| packages/agents/studio/derive.ts | agents | verbatim | 290 |
| packages/agents/studio/hook-dispatch.ts | agents | verbatim | 439 |
| packages/library/studio/hook-library.ts | library | verbatim | 526 |
| packages/library/studio/hook-package.ts | library | verbatim | 502 |
| packages/library/studio/hook-runtime.ts | library | verbatim | 372 |
| packages/library/studio/hook-approval-ledger.ts | library | verbatim | 355 |
| packages/library/studio/hook-scan.ts | library | verbatim | 480 |
| packages/library/studio/instructions-draft.ts | library | verbatim | 185 |
| packages/library/studio/library-validate.ts | library | verbatim | 259 |
| packages/knowledge/studio/kb-descriptor.ts | knowledge | verbatim | 210 |
| packages/agents/studio/materials.ts | agents | verbatim | 194 |
| packages/sessions/studio/session-kinds.ts | sessions | verbatim | 580 |
| packages/sessions/studio/session-kinds-validate.ts | sessions | rewritten | 706 |
| packages/sessions/studio/session-kinds-affordances.ts | sessions | rewritten | 148 |
| packages/sessions/studio/session-transcript.ts | sessions | verbatim | 635 **Ceiling re-keyed +9 to 1,368 (M4-sessions s3 3b, T1 ruling 83), and that condition is now DISCHARGED (s4).** The re-key paid for the ruled manifest seam (ruling 81) threading an injected port through this file — three `package-layer-order` rows closed for it — and ruling 83 accepted it *on the condition that row 5's split brought the file back down*. It has: `deriveRoadmapDraft` and its three types moved to `studio/roadmap-draft.ts`, taking the file to **1,298**, below even the pre-3b ceiling of 1,359, and the exemption was TIGHTENED to 1,298 rather than left as a stale allowance. Earlier payment, before the re-key, is still on the record: the ports contract went to `kinds/architect-ports.ts` (returning `kinds/architect.ts` to exactly 1,584, no raise), comments tightened, stale runner paths corrected. Not a licence — the next edit measures against 1,298. |
| packages/sessions/studio/session-artifact-derivers.ts | sessions | rewritten | 711 |
| packages/sessions/studio/roadmap-draft.ts | sessions | rewritten | 134 |
| packages/library/studio/skill-install-ledger.ts | library | verbatim | 166 |
| packages/library/studio/skill-install.ts | library | verbatim | 324 |
| packages/library/studio/skill-package.ts | library | verbatim | 183 |
| packages/library/studio/skill-registry.ts | library | verbatim | 43 |
| packages/library/studio/skill-trust.ts | library | verbatim | 461 |
| packages/agents/studio/skill-md-fidelity.ts | agents | verbatim | 224 |
| packages/library/studio/template-library.ts | library | verbatim | 610 |
| packages/contracts/studio/types.ts | contracts | verbatim | 738 |
| packages/flows/studio/flow-registry.ts | flows | verbatim | 280 |
| packages/flows/studio/validate-triggers.ts | flows | verbatim | 431 |
| orchestrator/studio/validate.ts | kernel | rewritten | 868 |
| packages/library/studio/yaml-comments.ts | library | verbatim | 132 |
| packages/kernel/studio/yaml-fields.ts | kernel | verbatim | 105 |
| packages/agents/tool-event-emit.ts | agents | verbatim | 244 |
| packages/flows/trigger-payload.ts | flows | verbatim | 294 |
| packages/flows/webhook-verify.ts | flows | verbatim | 114 |
| packages/flows/wi-dispatch-scheduler.ts | flows | verbatim | 151 |
| packages/flows/wi-merge-back.ts | flows | verbatim | 464 |
| packages/flows/wi-worktree.ts | flows | verbatim | 327 |
| packages/flows/work-item.ts | flows | verbatim | 710 |
| packages/flows/worktree.ts | flows | verbatim | 201 |
| skills/adversarial-review/SKILL.md | factory | verbatim | 202 |
| skills/architect-completeness-critic/SKILL.md | factory | verbatim | 85 |
| skills/architect/SKILL.md | factory | verbatim | 215 |
| skills/brain-fix/SKILL.md | knowledge | verbatim | 65 |
| skills/brain-ingest/SKILL.md | knowledge | verbatim | 106 |
| skills/brain-lint/SKILL.md | knowledge | verbatim | 66 |
| skills/brain-maintenance/SKILL.md | knowledge | verbatim | 139 |
| skills/brain-query/SKILL.md | knowledge | verbatim | 92 |
| skills/changelog-semver/SKILL.md | flows | verbatim | 56 |
| skills/contract-check/SKILL.md | projects | verbatim | 89 |
| skills/creation-agent/SKILL.md | library | verbatim | 117 |
| skills/cruft-sweep/SKILL.md | kernel | verbatim | 91 |
| skills/demo-agent/SKILL.md | factory | verbatim | 141 |
| skills/demo-builder/SKILL.md | projects | verbatim | 146 |
| skills/demo-design/SKILL.md | projects | verbatim | 218 |
| skills/demo/SKILL.md | factory | verbatim | 323 |
| skills/developer-ralph/SKILL.md | factory | verbatim | 108 |
| skills/doc-updater/SKILL.md | flows | verbatim | 52 |
| skills/forge-onboard-project/SKILL.md | projects | verbatim | 185 |
| skills/handoff/SKILL.md | sessions | verbatim | 38 |
| skills/instructions-creator/SKILL.md | projects | verbatim | 124 |
| skills/onboarding-agent/SKILL.md | projects | verbatim | 108 |
| skills/pre-impl-interview/SKILL.md | factory | verbatim | 39 |
| skills/preflight-fix/SKILL.md | projects | verbatim | 56 |
| skills/project-brain-builder/SKILL.md | knowledge | verbatim | 102 |
| skills/project-manager/SKILL.md | factory | verbatim | 202 |
| skills/project-scoped-review/SKILL.md | projects | verbatim | 215 |
| skills/reflector/SKILL.md | factory | verbatim | 179 |
| skills/release-finalizer/SKILL.md | flows | verbatim | 92 |
| apps/forge/index.ts | apps/forge | verbatim | 8 |
| packages/agents/index.ts | agents | verbatim | 11 |
| packages/contracts/index.ts | contracts | verbatim | 138 |
| packages/contracts/studio-types.ts | contracts | verbatim | 738 |
| packages/factory/index.ts | factory | verbatim | 8 |
| packages/flows/index.ts | flows | verbatim | 11 |
| packages/kernel/config.ts | kernel | verbatim | 493 |
| packages/kernel/ids.ts | kernel | verbatim | 117 |
| packages/kernel/event-cost.ts | kernel | verbatim | 63 |
| packages/kernel/index.ts | kernel | verbatim | 30 |
| packages/kernel/init.ts | kernel | verbatim | 144 |
| packages/kernel/logging.ts | kernel | verbatim | 169 |
| packages/kernel/path-guard.ts | kernel | verbatim | 707 |
| packages/kernel/ports.ts | kernel | verbatim | 71 |
| packages/kernel/spawn-env.ts | kernel | verbatim | 181 |
| packages/kernel/studio-object.ts | kernel | verbatim | 96 |
| packages/kernel/route-entry.ts | kernel | verbatim | 114 |
| packages/kernel/http-envelope.ts | kernel | verbatim | 72 |
| packages/kernel/project-contract.ts | kernel | verbatim | 37 |
| packages/kernel/findings.ts | kernel | verbatim | 37 |
| packages/kernel/project-layout.ts | kernel | verbatim | 125 |
| packages/knowledge/index.ts | knowledge | verbatim | 11 |
| packages/library/index.ts | library | verbatim | 8 |
| packages/projects/index.ts | projects | verbatim | 11 |
| packages/projects/project-roster.ts | projects | verbatim | 468 |
| packages/projects/project-preflight-read.ts | projects | verbatim | 192 |
| packages/projects/project-roadmap.ts | projects | verbatim | 145 |
| packages/projects/bridge-studio-project-onboard.ts | projects | verbatim | 620 |
| packages/projects/bridge-studio-project-preflight-write.ts | projects | verbatim | 298 |
| packages/projects/project-contract-scaffold.ts | projects | verbatim | 596 |
| packages/projects/bridge-studio-project-reset.ts | projects | verbatim | 225 |
| packages/projects/routes.ts | projects | verbatim | 385 |
| packages/sessions/index.ts | sessions | verbatim | 11 |
