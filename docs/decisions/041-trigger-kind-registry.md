# ADR 041 — Trigger-kind registry and external-trigger trust

- **Status:** accepted (R2-04, 2026-07-25)
- **Amends:** [ADR 027](./027-studio-object-model.md) — the flow `triggers:` schema changes from `{on, flow}` to `{on, target: {kind, ref}, …per-kind config}` (recorded there as an amendment; seed files migrated one-shot, the old key fails loud at parse). [ADR 028](./028-flow-engine.md) needs no amendment — `fireFlowTriggers`' declaration-driven firing model is unchanged.
- **Relates to:** [ADR 040](./040-review-send-back-develop-loop.md) (built in the same wave), R5-01's dry-bridge seam, R4-09-F1 (the standalone-reflect consumer of the agent-target extension).

## Context

Flow triggers were a closed two-value vocabulary (`complete`, `merged`) with an
untyped `{on, flow}` declaration nothing validated, a dispatch that could only
start forge-develop, and no external kinds at all. R2-04's intent: open the
vocabulary into a typed registry, ship **cron** and **webhook (git push /
release)** as the first external kinds, extend targets beyond flows to
standalone agents (R4-09's reflect consumer), and do it without creating any
dispatch surface that sits outside the `FORGE_ARCHITECT_NO_SPAWN` / dry-bridge
perimeter — the class of the 2026-07-16 bridge-self-merge incident.

## Decision

1. **Registry-as-data.** `TRIGGER_KINDS` (`orchestrator/flow-trigger.ts`) is a
   typed row table: `flow-complete | agent-complete | merged | manual | cron |
   webhook | feed`, each row carrying `origin` (`platform` vs `ootb` — domain
   events like `merged` are rows the OOTB suite contributes, never platform
   literals) and `status` (`shipped` vs `reserved`). Reserved kinds are
   vocabulary-reserved: the parser accepts them (nobody can squat different
   semantics on the id), `forge studio lint` errors (`trigger-kind-reserved`),
   and there are **no runtime stubs**. `complete` renamed `flow-complete`.

2. **Declaration shape.** `triggers: [{ on, target: {kind: flow|agent, ref},
   …per-kind config }]`. Cron rows carry `schedule` (croner-validated at lint —
   one grammar for lint and runtime, never two parsers) and `concurrency`
   (K8s-style `allow | forbid`, default forbid, enforced at drain time;
   `replace` is enum-reserved). Webhook rows carry `{id, provider, events,
   secretEnv, secretEnvPrevious?, sources}`. Agent targets land as schema +
   lint + a dispatch seam that throws (request retained) until R4-09 wires the
   standalone-agent dispatch.

3. **Queue-only dispatch — the guard invariant.** Every trigger fire, internal
   or external, is a **staged claimable request file** (`_queue/flow-runs/`);
   dispatch happens only in the daemon's sweep, where every agent spawn already
   funnels through `runAgent`'s NO_SPAWN/dry-bridge enforcement. Cron jobs are
   armed in the scheduler (never the bridge) and their fire callback only
   stages. The webhook route only stages (bridge classification:
   `exempt-local`). There is structurally no new spawn-capable surface.

4. **Generic enqueue + origination.** `enqueueFlowRun` (hoisted from
   `enqueue-develop-run.ts`, now a delegate) lets any flow be the chaining
   target; the develop-specific decomposition gate stays keyed to
   forge-develop. Cron/webhook fires with no source initiative **mint** a fresh
   `origin: 'triggered'` initiative for the target flow's (lint-required)
   project, with conservative config-owned budgets (`triggers` section —
   defaults $10 / 30 iterations; an unattended fire must not carry
   architect-scale spend authority).

5. **Content trust (fail closed).**
   - Webhook signatures are verified **mandatorily** over the RAW request body
     before any parse: GitHub/Gitea via `@octokit/webhooks-methods`
     (`X-Hub-Signature-256`, constant-time, rotation via `verifyWithFallback`);
     GitLab via `crypto.timingSafeEqual` on `X-Gitlab-Token`. A missing secret
     is **503, never accept-unverified**. Secrets are env-var *names* in the
     declaration; values live in the operator environment (`secrets.env`
     convention) — never in flow.yaml.
   - A mandatory `sources` repo allowlist is checked after verification
     (scoping, not the trust root). Source-IP allowlisting is deliberately not
     shipped — defense-in-depth only, never a substitute for signatures.
   - **Typed-payload isolation (OWASP LLM01).** External payloads enter as the
     `TriggerPayload` union: structured fields strict-charset validated at
     extraction; free text (commit messages, release bodies) capped +
     control-char-stripped and carried verbatim **as data** via the
     `trigger-payload.json` artifact. Prompt assembly interpolates only
     strict-validated tokens (one `- Trigger: …` line); a malicious commit
     message demonstrably cannot alter agent instructions (fixture-tested).
   - Initiative ids for minted runs are generated from validated tokens only —
     external text never reaches id/path space.

6. **Dependencies (research-first, per the hand-rolling prohibition):**
   `croner` (0 deps, precise DST semantics, `protect` overrun guard; also the
   lint validator via `paused` construction) and `@octokit/webhooks-methods`
   (0 deps, audited constant-time HMAC). Both chosen over hand-rolling the two
   most correctness-sensitive pieces (timer semantics, signature comparison).

## Consequences

- New trigger kinds are registry rows + lint + an arm; the dispatch pipeline is
  shared. R4-09's reflect cutover re-points forge-develop's `merged` trigger at
  an agent target with no schema change.
- The bridge binds `0.0.0.0` (WSL2 port-forwarding), so the webhook endpoint is
  LAN-reachable on day one — acceptable because verification is fail-closed and
  mandatory; the public-exposure story (tunnel/reverse-proxy) is operator ops,
  documented not automated.
- Minted-run budget defaults are a spend-policy proposal (config-tunable);
  flagged for operator review.
- The `ui:journey` seeding guard now also refuses stray `_queue/flow-runs/`
  request files — staged fuel from a prior run must not leak into a harness run.
