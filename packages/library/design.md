# `@forge/library` — design record

What governs this package, and the three decisions a reader is most likely to question.

## The ADRs that govern it

- **[ADR 024](../../docs/decisions/024-phases-as-subagents-invoking-skills.md) — agents compose skills.** A skill is an instruction/tool unit an agent invokes; this package owns authoring, scanning and listing them, and `agents` owns invoking them. The split in the ADR is the split in the code: everything here answers "what is this object and may it be trusted", never "run it as part of a turn".
- **[ADR 018](../../docs/decisions/018-three-brain-model.md)** for the boundary this package sits inside — `library` is rank 2 in the allow-graph (`scripts/check-boundaries.mjs`), below `agents`, above `kernel` and `contracts`. It may never import `agents`, `sessions`, `flows` or `factory`, and never a rank-2 sibling (`knowledge`, `projects`): a shared symbol goes to `kernel`/`contracts` additively, or the consumer moves up.
- **[ADR 042](../../docs/decisions/042-surface-cap-scope-and-testability.md)** for why the size cap is a real constraint and not a target to route around.

## Three decisions worth stating

### The hook EXECUTION primitive lives here; hook DISPATCH does not

`runHookScript` is in this package and `packages/agents/studio/hook-dispatch.ts` calls it. That looks backwards next to the spec's "per-spawn runtime → agents" line, and it is deliberate:

- Spec §0: *"the only future candidate for process isolation is untrusted community-hook execution **in `library`**"*.
- Spec §3.1 gives library *"plugin-host isolation applies here only"*.

So `agents` owns *when* a hook fires in a spawn's lifecycle; `library` owns *what it means to run a piece of untrusted third-party code safely* — the env-stripped bounded spawn, the runnable gate, and the place a sandbox would go if one is ever built. Moving the primitive up would put the isolation boundary in the package that has no reason to own it. This was checked against the code before it was written down: `hook-dispatch.ts` already imported `runHookScript` from here.

### The install decides server-side, and the operator confirms

`POST /api/studio/connections/:id/install` derives its argv **only** from the curated catalog pin. No parameter — including the request body — can influence the package, version or registry; an install route that took those from a client would be remote code execution by design. `--ignore-scripts` is always present, because an MCP server is arbitrary third-party code and npm lifecycle scripts run on install.

On top of that, `forge-6gv.8.2` added a review step: an unconfirmed request returns a **preview** (package, version, registry, the exact argv, whether lifecycle scripts run) and performs zero network and executor calls; `{ confirm: true }` is the only path that installs. The preview is derived from the same function that builds the real argv, so it cannot describe a command other than the one that would run — and it is rendered in Studio, because a confirm the operator cannot read is not a confirm.

### `declined` is a review outcome, not a permission

The hook approval ledger carries `approved`, a `revoked` history, and `declined`. `declined` grants nothing: `hookRunState` never reads it, so a declined hook is `runnable: false` exactly like a never-reviewed one. It exists so the review queue can close honestly — a hook an operator looked at and rejected had no state but "needs-review forever". Approve and decline clear each other through the writers; a hand-edited ledger carrying both resolves to `approved` silently, which is the safe direction but is not a contradiction the surface reports.

## Deferred, on purpose

**Plugin-host process isolation is not in 1.0.** Spec §0 defers it to a concrete driver. `runHookScript` today is an env-stripped, bounded child process with the credential exclusions its own header documents — not a sandbox, and it says so rather than implying more safety than it has. The honest-limits section in that file is the contract; if isolation is ever built, this is where it goes.

**One door, not two.** `index.ts` is the public surface; every consumer still uses deep `@forge/library/<file>.ts` paths. Collapsing them is a cross-package change and is recorded rather than quietly left undone.
