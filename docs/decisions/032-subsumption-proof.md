# ADR 032 — Subsumption proof: a second implementation behind every seam (M8-A/B/C/D)

**Status:** accepted (2026-06-14)

**Relates to:** ADR-027 (studio object model / KB), ADR-028 (flow engine /
node-executor registry), ADR-029 (runtime adapters), ADR-031 (Studio is the
product). Realises the market thesis in
`docs/forge-studio-market-and-differentiation.md` §3.

## Context

The differentiation analysis names forge's durable advantage as
**modularity-as-subsumption**: forge wins by turning best-in-class point
solutions into *components* plugged into clean seams, not by out-building them.
The same analysis is blunt that this was, at M7, **architecture-validated but
not shipped** — "only the Claude runtime is live, the KB is forge's own
filesystem, the dev-loop is Ralph with placeholder adapters." Credibility
depended on shipping a real *second* implementation behind a seam.

M8-0 (ADR-028/029/027 amendments) made three seams real and *used in
production*: the runtime adapter registry (the dev-loop builds agents via
`getAdapter(sdkId)`), the dev-loop/runtime seam, and the `KbBackend` (the brain's
store became swappable).

## Decision

Ship a **second implementation behind each of the three seams**, and prove the
composition mechanically with a standing test.

| Seam | 1st (live) | 2nd impl (M8) | Where |
|---|---|---|---|
| Runtime adapter (ADR-029) | `claudeAdapter` | `geminiAdapter`, `aiderAdapter` | `loops/_adapters/{gemini,aider}/`, registered in `registry.ts` |
| Dev-loop engine | Ralph (Claude) | Aider CLI (via the runtime adapter seam) | `loops/_adapters/aider/` |
| KB backend (ADR-027) | `FilesystemKbBackend` | `ZepKbBackend` | `orchestrator/kb-backends/zep.ts` |

The closure is `orchestrator/subsumption-proof.test.ts`: it asserts every seam
resolves a second implementation **simultaneously** (the runtime registry holds
≥2 non-Claude runtimes; both KB backends satisfy the `KbBackend` surface). That
is the "competitors → components" claim, mechanically true rather than asserted.

Each second impl is **dep + creds-gated** (`available:false` until provisioned):
the SDK is imported via a string-variable dynamic import so `tsc` stays green
with the dep absent, and `available` reflects `dep present && creds present`.
This is the honest state: the seams accept the components; nothing runs a
best-in-class component live without the operator opting in.

## Consequences

- The flywheel is no longer a promise at the *mechanism* level: adding a
  best-in-class component is "implement the interface + register," proven for
  three independent seams at once.
- **Realization gap (live).** A *running* combined cycle (a flow executing on
  Gemini + Aider + Zep) additionally needs, and is deferred to follow-ups:
  - provisioning — `@google/genai` + `GEMINI_API_KEY`; the `aider` CLI + a model
    key; `@getzep/zep-cloud` + `ZEP_API_KEY` (then flip `available`/catalog);
  - a **Gemini tool executor** — the bare `generateContent` API surfaces
    `functionCall` blocks but does not apply them to the worktree, and the
    dev-loop gates on `git diff`, so Gemini cannot drive a real dev-loop yet;
  - **per-adapter model/tier resolution** — `deriveAgentSpec`/`MODEL_BY_TIER`
    are Claude-only, so a non-Claude agent definition cannot yet be derived;
  - **descriptor-driven KB selection** — `ZepKbBackend` is reachable today by
    construction (the contract-proof); `getKbBackend` selecting it from a
    `kb.yaml` `backend:` field is the next step.
- The real-cycle harness (`scripts/verify-cycle.mjs`) already accepts
  `--project`; driving a non-default-component flow live is a provisioning +
  flow-selection step, not a code gap.
- Marketing must keep saying the *specific* version (§3.4): the seam accepts the
  component; the live integration ships as each is provisioned.
