---
area: token-economy
date: 2026-05-23
date_contracts_locked: 2026-05-23
status: contracts locked — see CONTRACTS.md
contract_deps: [C23, C24, C25, C26]
ships_in_stage: S8
sibling_of_c19: yes
---

# Token economy refinement plan (08)

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Specifically: C23 (prompt caching default-on at all SDK call sites),
> C24 (council model routing — Haiku by default, Sonnet for `eng`
> critic only), C25 (output style is per-phase: reviewer + reflector
> emit terse; dev-loop / architect / PM speak normally), C26 (memory
> files are compressed at source — `CLAUDE.md`, `ARCHITECTURE.md`,
> `PRINCIPLES.md`, `brain/INDEX.md`).
>
> **C19 stands** (no budget mechanisms). This plan is C19's positive
> counterpart: lower the natural cost of a cycle instead of policing
> spend.

## Problem

C19 removed budget caps because they were never load-bearing — iteration
caps already prevent runaway and the two real "burned the budget" case
studies (betterado $534 silent drop; intersection-backpressure thrash)
were caused by bad PM decomposition, not lack of $-cap. C19 simplifies.

But cost still matters. The natural cost-per-cycle is higher than it
needs to be for three structural reasons:

1. **No prompt caching anywhere.** Every SDK call sends the full system
   prompt every time. The Ralph loop's hot path re-pays for identical
   system content on every iteration. Anthropic's `cache_control` would
   reduce hot-path input cost by ~90% on cache hits, with a 1-write
   amortised across N iterations.
2. **One-size-fits-all model selection.** Everything runs on
   `claude-sonnet-4-6`. The council has 4 critics where 3 of them
   (`ceo`, `design`, `dx`) do structured-JSON classification on a draft —
   Haiku-grade work. The `eng` critic needs code-reading depth (Sonnet).
3. **Verbose memory files.** `CLAUDE.md`, `ARCHITECTURE.md`, `PRINCIPLES.md`,
   `brain/INDEX.md` are loaded on every cycle. Caveman-compressing them
   at source (one-shot, hand-reviewed) cuts ~46% input on every load,
   forever.

The operator framed this directly: *"investigate other token saving
skills such as caveman... analyse how they could apply to make forge
more economic without having budget constraints in place."*

## Current state

- [`loops/ralph/claude-agent.ts`](../../../loops/ralph/claude-agent.ts) —
  SDK wrapper. `createClaudeAgent({ systemPrompt, allowedTools, maxTurns, ... })`.
  Calls `query()` with no `cache_control` anywhere.
- [`skills/architect-llm-council/council.ts`](../../../skills/architect-llm-council/council.ts) —
  4 critics, all default to `'sonnet'`, `maxTurns: 30`, fresh `query()`
  each. Shared `projectContext` block is re-sent verbatim 4×.
- [`orchestrator/dev-invocation.ts`](../../../orchestrator/dev-invocation.ts),
  [`orchestrator/pm-invocation.ts`](../../../orchestrator/pm-invocation.ts),
  [`orchestrator/reflector-invocation.ts`](../../../orchestrator/reflector-invocation.ts) —
  system-prompt builders. F-34 (per `brain/log.md`) stripped the brain
  navigation index from dev-loop system prompts because the agent was
  anchoring on it; PM still loads the full index every run.
- `CLAUDE.md` (~340 lines), `ARCHITECTURE.md`, `PRINCIPLES.md`,
  `brain/INDEX.md` — verbose markdown, loaded by skills that
  reference them. Roughly: agents load ~25KB of memory content per cycle.
- E2E bench: `slugifier-basic` at $2.35/cycle (6 WIs). Reflection p95
  cost: $1.04. Architect bench: not isolated. No bench measures
  cache-hit rate (it's not a field in our JSONL events yet).

## Caveman context

The operator named **caveman** as one option to consider. Findings (full
research in the parent docs):

- **Canonical**: [`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman)
  — MIT, very active. A prompt-level **output-compression** skill: drops
  articles, filler, pleasantries, hedging; *preserves* code, function
  names, error strings, paths byte-perfect; auto-suspends on
  irreversible/multi-step/security warnings.
- **Critical finding from [`kuba-guzik/caveman-micro`](https://github.com/kuba-guzik/caveman-micro)**:
  the 85-token micro version achieves the same 14-21% structured-task
  savings as the 552-token full skill. The model already knows how to
  be terse — it needs **permission**, not a 552-token tutorial. **Forge
  uses the 5-line micro form**, not the full skill, per simplicity-first.
- **Adjacent**: `caveman-compress` is a sub-tool that rewrites
  memory files into terse form. The author's benchmark claims ~46%
  per-cycle input savings from that pass alone.
- **Failure modes to respect**: caveman should NOT be applied to
  destructive-op confirmations, security warnings, or PR descriptions
  meant for humans. Plan 08 carves these out explicitly (C25).

Caveman is one lever among several. The single highest-leverage lever
is actually **Anthropic native prompt caching**, which doesn't need
caveman at all.

## Proposed refinement

5 work items, prioritised by expected $-saved ÷ implementation-day.

### WI-1 — Prompt caching at every SDK call site (highest leverage)

- Mark `cache_control: { type: 'ephemeral' }` on the system-prompt block
  and tools array in:
  - `loops/ralph/claude-agent.ts` (`createClaudeAgent`)
  - `skills/architect-llm-council/council.ts` (the shared `projectContext`
    block — identical across all 4 critics)
  - `orchestrator/pm-invocation.ts` (system prompt + brain index)
  - `orchestrator/reflector-invocation.ts` (system prompt)
  - `orchestrator/reviewer-invocation.ts` (system prompt — until the
    reviewer is deleted in S4, then this surface goes away)
- Surface a `cacheable?: boolean` knob on `createClaudeAgent` so any
  caller can opt out. Default `true`.
- Use ephemeral 5-min TTL by default; flip to 1-hour for the PM's brain
  index (it doesn't change within a session) per the open-question
  ratification.

**Files touched:** the 5 invocation files above.
**Expected savings:** 50-80% input-token cost on hot paths (dev-loop
iter ≥ 2, council critics 2-4, PM second-fixture).
**Acceptance:** the result message for iter ≥ 2 of any dev-loop run
includes `cache_read_input_tokens > 0`.

### WI-2 — Council model routing

- Extend the `Critic` type in [`council.ts`](../../../skills/architect-llm-council/council.ts):
  `model: 'sonnet' | 'opus' | 'haiku'` (already typed). Update
  `defaultCritics()` so `ceo`, `design`, `dx` use `'haiku'` and `eng`
  stays `'sonnet'`.
- Verify the council bench (8/8 today) still passes at the new model
  routing.
- Per C24, this is "Haiku by default, Sonnet by exception" — the
  exception is documented in `defaultCritics()`.

**Files touched:** `skills/architect-llm-council/council.ts`,
`skills/architect-llm-council/council.test.ts`.
**Expected savings:** 40-60% on council cost (3 of 4 critics at ~1/3
the per-token rate; cached project context multiplies the win).
**Acceptance:** running the council on a fixture emits per-critic
`model` values: 3× `claude-haiku-*`, 1× `claude-sonnet-*`. Bench at
8/8 unchanged.

### WI-3 — Output style directives (per-phase, micro-caveman form)

Per C25, output style is per-phase:

| Phase | Output style | Why |
|---|---|---|
| dev-loop, architect, PM, council | Normal (no compression) | Outputs are commit messages, manifests, JSON verdicts — downstream consumers are humans reading PRs / test runners |
| reviewer (until deleted) | Micro-caveman | PR comments addressed to operator who reads them quickly |
| reflector | Micro-caveman | Theme drafts the operator iterates on; brevity = signal |

The 5-line micro-caveman directive (per `caveman-micro` finding):

```
OUTPUT STYLE:
- Drop articles, filler ("just", "really", "basically"), pleasantries, hedging.
- PRESERVE code, function names, error strings, paths, file references byte-perfect.
- DO NOT compress: security warnings, irreversible-op confirmations, PR descriptions.
- When in doubt, prefer terse.
```

Appended to:
- `skills/reflector/SKILL.md` (under a new `## Output style` heading)
- (`skills/reviewer/SKILL.md` would get it too, but plan 05 deletes
  that file in S4 — so the surface for the reviewer's output goes away
  before this plan lands. If WI-3 ships before S4, the reviewer gets
  the directive in the interim.)

**Files touched:** `skills/reflector/SKILL.md` (small addition).
**Expected savings:** 40-65% output reduction in reflector. Reflector's
output is small but high-leverage — fewer tokens means cheaper future
brain-query operations too.
**Acceptance:** sampling reflector outputs pre/post: aggregate output
token count drops ≥40% on the bench fixture; theme content is still
parseable and useful.

### WI-4 — Compress memory files at source (one-shot, hand-reviewed)

Per C26 — memory files live in compressed form in the repo; no
"compress on load" middleware.

- Run a manual caveman-compress pass over:
  - `CLAUDE.md`
  - `ARCHITECTURE.md`
  - `PRINCIPLES.md`
  - `brain/INDEX.md`
- The operator reviews the diff before committing — automated rewrite
  with hand-review per `feedback_destructive_instruction_preserve_intent`.
- Code blocks, paths, ADR refs, file references preserved byte-perfect
  per caveman's rules.

**Files touched:** the 4 memory files.
**Expected savings:** ~46% input-token reduction on every cycle that
loads any of these (per caveman's own benchmark on similar files).
Multiplied across PM + architect + reviewer + reflector reads.
**Acceptance:** before/after byte counts logged; agent behaviour
unchanged across a full e2e bench run; cycle cost on `slugifier-basic`
drops measurably.

### WI-5 — Cost-per-cycle bench (A/B harness)

- Add `benchmarks/token-economy/` (lightweight — no LLM cost beyond
  what's measured):
  - Frozen baseline snapshot: today's cost-per-fixture (`slugifier-basic`
    $2.35) recorded as `benchmarks/token-economy/baseline.json`.
  - Harness runs the e2e bench against a fixture with the current
    agent config; emits `result.json` with cost + cache-hit rate
    per phase.
  - Scoring: `delta_pct` from baseline; pass threshold not a fixed
    number — pass if **strictly improving** vs the last-committed
    `baseline.json` (ratchet).
- Surface `cache_read_input_tokens` and `cache_creation_input_tokens`
  in the existing JSONL events (`orchestrator/logging.ts`) so the bench
  has data to slice.

**Files touched:** `benchmarks/token-economy/` (new),
`orchestrator/logging.ts` (extend `EventLogEntry`).
**Expected savings:** none directly — protects them. Without this,
future refinements can quietly regress the cost floor.
**Acceptance:** running the bench against the post-WI-1..4 agent config
on `slugifier-basic` returns a `delta_pct < 0` (cost dropped). The
result is committed as the new `baseline.json` for future runs to beat.

## Cross-plan deps

- **C19 stands** (no budget mechanisms). This plan is C19's positive
  counterpart.
- **Plan 02 (architect)** — once the architect's plan-doc surface
  stabilises in S2A, the architect/council prompts can be cached
  aggressively without invalidation churn. WI-1 + WI-2 best paired
  with S2A landed.
- **Plan 05 (reviewer deletion)** — if S4 lands first, the reviewer
  surface goes away before WI-3 needs to touch it. Order is fluid;
  whichever lands first, the other adapts trivially.
- **Plan 01 graphify (C20-C22)** — if graphify becomes the canonical
  brain index, the PM/architect/reflector might load *less* narrative
  brain content (graph-first queries return tighter slices). This
  shrinks WI-4's compression target (`brain/INDEX.md`). Net effect:
  WI-4 stays useful but expected savings may halve once graphify is
  in. Re-measure after S1.4.

## Bench / measurement

- **WI-5 *is* the bench.** A ratcheting A/B harness keyed to a frozen
  baseline; every Plan 08 PR must show strict improvement.
- Per-phase cost surfaced in JSONL events (`tokensIn`, `tokensOut`,
  `costUsd`, plus new `cacheReadTokens` / `cacheWriteTokens` after WI-5).
- Manual sanity-checks:
  - `cache_read_input_tokens > 0` for dev-loop iter ≥ 2
  - `model: claude-haiku-*` for 3 of 4 council critics
  - reflector output byte count drops ≥40%
  - memory file byte counts drop ~46%

## Acceptance criteria for THIS refinement

1. Cycle cost on `slugifier-basic` drops ≥40% vs the C19-baseline
   snapshot (today: $2.35).
2. Cache reads observed in JSONL events for dev-loop iter ≥ 2 (per
   `cache_read_input_tokens > 0`).
3. Council bench (8/8) still passes with model routing live.
4. Reflection bench (5/5) still passes with micro-caveman output
   directive live.
5. E2E bench (1/1 score 1.0) still passes with all four production
   changes live (no quality regression at the new price).
6. `benchmarks/token-economy/` exists with a frozen baseline JSON and
   a ratchet harness.
7. `cacheReadTokens` / `cacheWriteTokens` fields are present in
   `EventLogEntry` and populated on every SDK result.

## Open questions for the operator

1. **Cache TTL default — 5 min or 1 hour?** 5 min is the safe default
   (hot loops); 1-hour costs 2× to write but pays back at scale (PM
   ran an hour ago, second WI starts now). Lean: 5-min default, opt
   1-hour for PM/architect outputs that may be re-consumed.
2. **Council routing — `ceo`/`design`/`dx` on Haiku (proposed), or
   ALL critics on Haiku unless explicitly bumped?** Inverting the
   default would push the cost floor even lower but risks the `eng`
   critic missing subtle code-quality issues. Sonnet for `eng` is the
   safer call; flag if you'd rather try all-Haiku-with-fallback.
3. **Caveman-compress CLAUDE.md specifically — yes or hybrid?** Compressed
   form is harder to skim for a human onboarding. Hybrid option: keep
   `CLAUDE.md` human-readable, ship `CLAUDE.compressed.md` that the SDK
   loads instead — but that's two sources of truth, which violates
   simplicity-first. Lean: compress in place; CLAUDE.md is for agents,
   `README.md` is for humans. Confirm before WI-4 runs.
4. **Bench ratchet vs hard threshold?** "Strictly improving each PR"
   is harsh; never letting cost go up means a useful refinement that
   adds tokens (e.g. a new event for visibility) can't land. Alternative:
   ratchet with a 5% slack zone. Lean: strict ratchet for first 3
   refinements, then evaluate.
