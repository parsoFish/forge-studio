# Community registry — who writes it, and how writes reach git

**Status:** decided 2026-08-21 (W7-B3, wave-7 park-point "registry commit
policy" — `_wave7/plan.md` B3 row). Ratifies the write model the wave-7
goal pack locked: *Studio writes the file; the operator commits via their
normal git flow; the browser shows the uncommitted state.*

## The file

`studio/community/registry.yaml` is the declared-list source of truth for
community items (W6-CR-1) and is **repo-tracked** — its history is its audit
trail. Structural schema lives in `orchestrator/studio/registry.ts`
(`loadCommunityRegistry`); `forge studio lint` re-validates it on every run.

## The three writers (the only three)

| Writer | Path | Stamps |
| --- | --- | --- |
| `commitRegistryDraft` (orchestrator/interactive-finalizers.ts) | community-refresh session → operator **approve** verdict | `fetchedAt: <now>` / `fetchedBy: community-refresh/<sid>` on rows the agent genuinely verified; `meta.lastRefresh: <now>` |
| Studio CRUD routes (cli/bridge-studio-writes.ts, W7-B3) | `POST/PUT/DELETE /api/studio/community/registry/items[/:id]` — `kind: skill` only (the index sources every other kind outside the registry) | `fetchedAt: null` / `fetchedBy: "operator"` — FORCED; `signals.stars`, `signals.starsDisplay` and `upstreamUpdatedAt` are SERVER-OWNED fetch facts: body values are ignored, a create starts them `null`, an edit carries the existing row's values forward (an operator edit must neither fabricate nor wipe agent-fetched facts — W7-B3 review F4/F5); a hand-curated row honestly reads "seed — never verified" |
| A human editing the YAML in a PR | ordinary code review | whatever the diff says — lint is the gate |

All three converge on the ONE serializer (`serializeCommunityRegistry`,
orchestrator/studio/registry.ts) and, for the two programmatic writers,
temp-then-rename with a re-parse through the ONE loader before the real file
is replaced — a write that cannot be re-loaded never lands.

## Commit policy (the decision)

Studio **writes the working tree only**. It never runs `git add`/`git
commit` on the forge repo — an unattended-adjacent surface silently
committing to the operator's own checkout is exactly the class of surprise
ADR-031's "one interaction point" exists to avoid, and the 2026-07-16
bridge-self-merge incident is the standing lesson. Instead:

- `GET /api/studio/community` carries `meta.registryDirty` — git's own
  three-state answer (`true`/`false`, or `null` when git did not answer) —
  and `/community` renders the "uncommitted changes — commit it via your
  normal git flow" notice while it is `true`.
- The operator commits when they choose, with their own identity, through
  their normal flow.

## Debris rule

`studio/community/staging/` is never a legitimate path — it is the
pre-fence-era escape shape (a community-refresh agent resolving a relative
`staging/` beside `registryPath`). `forge studio lint` errors on its
existence (`community/stray-staging`) and names the fix: delete it. Drafts
live only under the session's own directory and reach the registry only
through the approve verdict.
