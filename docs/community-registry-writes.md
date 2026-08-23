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

### Schema v2 (W8-B5) — repo facts are keyed by repo

v1 gave every item its own `signals.stars` / `upstreamUpdatedAt` / `fetchedAt` /
`fetchedBy`. Those describe an upstream **repository**, and the nine seeded
items share only five distinct `sourceUrl`s, so one repo's star count was
written onto N rows and the copies drifted (a refresh pass left six rows at
275713 and two at 170882). v2 moves them into a top-level `sources:` map keyed
by a normalized source key (`github:<owner>/<repo>`, `npm:<pkg>`,
`mcp:<server>` — derived by `orchestrator/studio/community-source-url.ts`) and
resolves them at read time. **The item is given no field to hold a mis-scoped
copy**: writing `stars:` on an item is a load error naming `sources:`.

There is no v1 compatibility arm — a `schemaVersion: 1` file fails to load with
the remedy named (CLAUDE.md forbids back-compat paths; forge has no legacy
users).

### Comments

`js-yaml` cannot round-trip comments, so `serializeCommunityRegistry` captures
the file's **leading comment block** at load and re-emits it verbatim above the
dump — every writer inherits that, so a Studio "Add item" click no longer
destroys the curation header (community-28). A comment *inside* `items:` still
cannot survive a write, so `forge studio lint` **refuses** one
(`community-registry/lossy-comment`), naming the line. Rationale belongs in the
header block.

## The three writers (the only three)

| Writer | Path | Stamps |
| --- | --- | --- |
| `refreshCommunityRegistry` (orchestrator/studio/community-refresh-api.ts, W8-B5) | `forge community refresh` — deterministic, no LLM: three fixed API calls behind a three-origin allowlist | On a source it got a real 200 for: `fetchedAt: <now>` / `fetchedBy: api:github` (or `api:npm` / `api:mcp-registry`) plus the fetched facts; `meta.lastRefresh: <now>` only when at least one source verified. A missing/invalid `GH_TOKEN` or an exhausted rate limit aborts and writes **nothing**; a 404 / network error / timeout / malformed body leaves that source row **byte-identical** and reports it. It never writes: it returns a next registry and the caller owns the write. |
| `commitRegistryDraft` (orchestrator/interactive-finalizers.ts) | community-refresh session → operator **approve** verdict | `fetchedAt: <now>` / `fetchedBy: community-refresh/<sid>` on **source rows** every consuming item's evidence marked verified; one unverified consumer keeps the live row; `meta.lastRefresh: <now>` |
| Studio CRUD routes (cli/bridge-studio-writes.ts, W7-B3) | `POST/PUT/DELETE /api/studio/community/registry/items[/:id]` — `kind: skill` only (the index sources every other kind outside the registry) | Curation only. W7-B3 review F4/F5 had to FORCE `stars`/`starsDisplay`/`upstreamUpdatedAt` server-side; v2 removes the field, so there is nothing to force — a body carrying a real repo fact is **400**, naming `sources:` (an explicit `null` is accepted and dropped). The shared `sources` map and the curation header are carried forward untouched. |
| A human editing the YAML in a PR | ordinary code review | whatever the diff says — lint is the gate |

All of them converge on the ONE serializer (`serializeCommunityRegistry`,
orchestrator/studio/registry.ts) — which is exactly why the comment-preservation
fix lives there and not in any one writer — and, for the programmatic writers,
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
