---
title: Declared data fails open — parsed, typed, surfaced, enforced nowhere
description: The wave-4/5 campaign's #1 recurring defect class. A field, status or flag is declared, parsed, lint-validated, carried on the wire and rendered — and no production path reads it to make a decision. The suite stays green because the acceptance tests build the carrier object by hand, at the one layer where the defect cannot exist.
category: antipattern
keywords:
  - declared-data-fails-open
  - fail-open
  - unenforced-field
  - call-site-sweep
  - last-hop-drop
  - wire-contract-mismatch
  - field-parity-pin
  - test-on-the-wrong-surface
  - derive-dont-declare
created_at: 2026-08-08
updated_at: 2026-08-15
related_themes:
  - suppression-env-fakes-the-pass
  - quality-gate-cmd-must-assert-new-work
  - 2026-07-11-pm-gate-vacuous-pass-new-function-name
  - 2026-07-03-unifier-demo-regen-silently-fakes-when-tooling-unavailable
  - silent-auto-discover-fallback-blast-radius
---

# Declared data fails open

A field is added to a schema. It is parsed, typed, lint-validated, carried on the wire, and rendered. **No production path reads it to decide anything.** The feature is non-functional in the product while thousands of checks pass — because the acceptance tests construct the carrier object *by hand at the layer under test*, the one place the defect cannot exist.

Named the campaign's recurring TOP finding and logged as a brain gap twelve times across batch C before this page existed (`_wave5/ledger.md` L6013–6021, L6357–6362).

## Instances — by where in the pipeline the declaration dies

| Position | Instance | Ledger |
|---|---|---|
| Never carried from the producer | R2-08-F1 `projects:` trigger scoping. Four production `stageFlowRunRequest(` sites — `packages/flows/flow-trigger.ts`, `orchestrator/flow-runner.ts`, `packages/flows/cron-triggers.ts`, `packages/flows/bridge-hooks.ts` — and *"not one passes `projects` or `eventProject`"*, so the drain's guard never ran outside tests. An operator could declare `projects: [gitpulse]`, `forge studio lint` would confirm the id, and the trigger fired for every project: *"parsed, lint-validated, surfaced, enforced nowhere"*. The sibling `concurrency` was already carried in the same file. | L6836–6850 |
| Carried, never matched on | `fireAgentCompleteTriggers(flows, triggeredBy)` took `triggeredBy` and never matched on it — any agent completing fired every `on: agent-complete` row — and the test pinned that as the contract. | L6460–6470 |
| Dropped at the last client hop (×3) | `parseRun` (`apps/studio/lib/studio-client.ts`) enumerates fields explicitly and never listed `trigger`: server-derived, proven on the wire, discarded one hop from the screen. Then `reflectionLost` + `reflectionLostNote`, declared on **both** server and client types and never set by `parseRun`'s literal — *"the THIRD instance of the last-hop-drop class"*. | L10545–10550, L11333–11337, L11440–11444 |
| Wire-contract mismatch | R6-06: server emits `{id,linkKind,href,status,costUsd}`; the client validator additionally required `when`, `what`, `narrativeKinds`, all non-optional, and discarded the whole response if any row failed — **every non-empty response rejected, deterministically**. *"THE FEATURE WAS COMPLETELY NON-FUNCTIONAL IN THE PRODUCT, with 4074 + 715 + 825 checks green."* An empty `rows: []` passes `.every()` vacuously, so one assertion in 826 stood between this and shipping; `deriveAgentLedgerRows`, the wire→row transform itself, had **zero callers on the fetch path**. | L13117–13146 |
| A guard that exists and is never called | `packages/sessions/bridge-studio-sessions.ts` carries a resolver whose docstring says *"never `readSessionStatus`"* — `collectSessionRows` calls exactly that. `validateProjectId` sits in `cli/ui-bridge.ts` and a second route does not call it. *"The guard existed and was exactly as documented; the call sites simply never called it."* | L12750–12762, L13470–13472 |
| A second copy of the declaration | A hardcoded `FALLBACK_SESSION_KINDS` mirroring the registry — *"a second copy of declared data that nothing enforces against the first"*. | L12535–12545 |
| Batch E: declared step contract | `turnSpec.writes` — the phase table declares which dirs a drafting turn writes; the spine never checked that the declared write happened, so an empty drafting turn advanced `analyzing → awaiting-review` silently. Caught by R4-21's per-WI adversarial review, invisible to a 4400-test suite. Instance N of the class *inside the primitive built by the campaign that named the class*. | L16449–16970 (R4-21 phase 2) |
| Batch A / batch B | `legacyRoutes` *"parsed, typed and asserted by tests but validated and consumed NOWHERE"*, whose **fix round shipped its own instance**. Generalised past code by batch B's N7: *"A rule declared in the goal pack, enforced nowhere"* — 12 instances shipped (`_wave5/batch-b-efficiency-report.md:281`). | L228–231, L249–252 |
| Batch H: fail-open at the seam, cured constructively | R4-19-F2's kb-cleanup **join failed open** — a `cleared` status was claimable without the scanned-domain evidence backing it; cure = the claim carries its evidence (`open\|cleared\|unknown`, gated on a scanned-domain signal — a variant of [[derive-status-dont-store-it]]). And R4-23 found all four runner-private `loadSkillPrompt` helpers **failing open** (`catch { return 'You are the forge <x> agent.' }`) — survivable while the skill was a preamble, fatal once SKILL.md became the single source of intent; cure = one shared fail-loud loader that throws naming skill, turn id and available ids. Both green at every unit layer; both caught only by a real spawn / adversarial review. | batch-H ledger §R4-19-F2, §R4-23; ADR-043 amendment §4 |

## Detection — enforce end to end

1. **Sweep the call sites; don't add the parameter.** *"The discovery step is the fix; the param is plumbing"* (L7281–7285). Enumerate every production caller of producer *and* consumer — a new caller of an already-unguarded shared function emits **zero** signal from file-scoped ratchets (L12788–12796).
2. **Delete-test it.** If removing the field breaks no production behaviour, nothing enforces it. Prefer deriving to declaring: *"the fix is not 'validate the declared field' but 'delete it and derive'"* (L1064–1069).
3. **Walk every hop** — producer → JSON round-trip → route → client parser → component → `data-*` attribute. Each hop is a drop point; batch C lost fields at three of them.
4. **The friction invariant:** *"the declared path must never carry less friction than the undeclared path"* (L1956). A declaration that buys its caller a cheaper route is a declaration nothing checks.

## The AT rule that kills it

- **Drive the real path with a real captured artifact.** Capture the response by actually invoking the route, then assert the real client resolver's output equals the real derivation over the same entries — *"a hand-written fixture is exactly how this defect survived 43 tests"* (L13198–13206). Hand-building the carrier object tests the one layer where the bug cannot live (L6845–6848).
- **Close the class, not the instance.** Ship a **field-parity pin**: a fully-populated fixture whose runtime loop iterates `Object.keys(raw)` and asserts every declared field survives the parser, so a fourth field cannot silently drop (L11440–11444). Mutation-prove it by dropping a *currently working* field — that is what makes it a class proof rather than a re-test of the known instances (L11548–11556).
- Every new field, guard or function owes an enumerated call-site table in the test-writer's brief and **≥1 AT on a real production call path**.

## Sources

- [`packages/flows/flow-trigger.ts`](../../../packages/flows/flow-trigger.ts) — the trigger producer; carries `projects` onto the staged request since R2-08.
- [`apps/studio/lib/studio-client.ts`](../../../apps/studio/lib/studio-client.ts) — `parseRun`, the last client hop where `trigger` and `reflectionLost` were dropped.
- [`apps/studio/lib/agent-ledger.ts`](../../../apps/studio/lib/agent-ledger.ts) — the R6-06 row validator and `deriveAgentLedgerRows`.
- [`packages/sessions/bridge-studio-sessions.ts`](../../../packages/sessions/bridge-studio-sessions.ts) — the documented session-dir guard its siblings did not call.
- `_wave5/ledger.md` (gitignored campaign state) — all `L…` citations above; batch C is the region after `# ============ BATCH C ============`.

## See also

- [[suppression-env-fakes-the-pass]] — the sibling class: the *environment*, not the data, decides the result.
- [[quality-gate-cmd-must-assert-new-work]] — the gate-command form of the same fail-open.
- [[2026-07-11-pm-gate-vacuous-pass-new-function-name]] — a vacuous pass from a check that matched nothing.
- [[2026-07-03-unifier-demo-regen-silently-fakes-when-tooling-unavailable]] — a verdict field written without the evidence it claims.
- [[silent-auto-discover-fallback-blast-radius]] — remove the unenforced mechanism rather than layering a guard on it.
