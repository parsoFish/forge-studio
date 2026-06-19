# ADR 032 — The runtime-adapter swap surface (modularity-as-subsumption)

**Status:** accepted (2026-06-14)

**Relates to:** ADR-027 (studio object model / KB), ADR-028 (flow engine /
node-executor registry), ADR-029 (runtime adapters), ADR-031 (Studio is the
product). Realises the market thesis in
`docs/forge-studio-market-and-differentiation.md` §3.

> **Reframed to as-built state.** This ADR originally claimed a "second
> implementation behind *every* seam," closed by a standing
> `subsumption-proof.test.ts`. Two of those second implementations did not
> survive: the `ZepKbBackend` (`orchestrator/kb-backends/zep.ts`) and the
> cross-seam `subsumption-proof.test.ts` were both removed. The KB seam ships
> filesystem-only. What survives — and what this ADR now records honestly — is
> the **runtime-adapter** swap surface, where a real second and third adapter
> are registered behind the seam and proven by the per-seam conformance suite.

## Context

The differentiation analysis names forge's durable advantage as
**modularity-as-subsumption**: forge wins by turning best-in-class point
solutions into *components* plugged into clean seams, not by out-building them.
The honest position is that this is **architecture-validated, partially shipped**
— the Claude runtime is live; the KB is forge's own filesystem; the runtime
seam additionally accepts non-Claude adapters that are registered but
dep+creds-gated until an operator provisions them.

The runtime-adapter registry (ADR-029) is the seam this ADR is the record of:
the dev-loop builds agents via `getAdapter(sdkId)`, and `resolveSdkId` gates a
definition's free-text `runtime.sdk` so an unavailable adapter falls back to
Claude rather than throwing.

## Decision

Register **real non-Claude adapters behind the runtime seam**, and prove each
one satisfies the adapter contract with the standing conformance suite.

| Seam | 1st (live) | Registered alternatives | Where |
|---|---|---|---|
| Runtime adapter (ADR-029) | `claudeAdapter` | `geminiAdapter`, `aiderAdapter` (`available:false` until provisioned) | `loops/_adapters/{gemini,aider}/`, registered in `registry.ts` |
| Dev-loop engine | Ralph (Claude) | Aider CLI via the runtime-adapter seam | `loops/_adapters/aider/` |
| KB backend (ADR-027) | `FilesystemKbBackend` | seam present (`backend:` field); no second backend ships | `orchestrator/kb-backend.ts` |

The standing proofs are **per-seam**, not a single cross-seam test:
`loops/_adapters/conformance.test.ts` asserts every registered adapter satisfies
the `RuntimeAdapter` surface; `registry.test.ts` asserts the registry resolves
the registered ids; `orchestrator/kb-backend.test.ts` is the `KbBackend`
contract test. (The earlier single `subsumption-proof.test.ts` that asserted
"two impls behind every seam simultaneously" was removed once one of those
second impls — `ZepKbBackend` — was dropped; the per-seam contract tests are the
durable replacement.)

Each non-Claude adapter is **dep + creds-gated** (`available:false` until
provisioned): the SDK is imported via a string-variable dynamic import so `tsc`
stays green with the dep absent, and `available` reflects `dep present && creds
present`. This is the honest state: the seam accepts the components; nothing runs
a non-Claude component live without the operator opting in.

## Consequences

- The flywheel is real at the *mechanism* level for the runtime seam: adding a
  best-in-class runtime is "implement `RuntimeAdapter` + pass conformance +
  register," and two non-Claude adapters already sit behind the seam.
- **Realization gap (live).** A *running* non-Claude cycle (a flow executing on
  Gemini or Aider) additionally needs, and is deferred to follow-ups:
  - provisioning — `@google/genai` + `GEMINI_API_KEY`; the `aider` CLI + a model
    key (then flip `available`/catalog);
  - a **Gemini tool executor** — the bare `generateContent` API surfaces
    `functionCall` blocks but does not apply them to the worktree, and the
    dev-loop gates on `git diff`, so Gemini cannot drive a real dev-loop yet;
  - **per-adapter model/tier resolution** — `deriveAgentSpec`/`MODEL_BY_TIER`
    are Claude-only, so a non-Claude agent definition cannot yet be derived.
- **The KB seam is the unfinished half.** Only `FilesystemKbBackend` ships; a
  graph-memory backend would implement `KbBackend` and be selected via the
  `kb.yaml` `backend:` field. That selection path and a second backend are both
  future work — the seam is in place, the second implementation is not.
- The real-cycle harness (`scripts/verify-cycle.mjs`) already accepts
  `--project`; driving a non-default-runtime flow live is a provisioning +
  flow-selection step, not a code gap.
- Marketing must keep saying the *specific* version (§3.4): the seam accepts the
  component; the live integration ships as each is provisioned.
