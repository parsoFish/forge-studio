---
source_type: docs
source_url: docs/decisions/007-markdown-artifact-flow.md
source_title: ADR 007 — Markdown artifacts flow phase-to-phase
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 007 — Markdown artifacts flow phase-to-phase

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

V1 represented work as a mix of TypeScript objects, JSON state files, and markdown agent personas. Inputs/outputs between phases were typed but not greppable; debugging "what did the planner emit?" required a JSON read or a database query.

[gstack](https://github.com/garrytan/gstack) demonstrated a more debuggable approach: every phase reads and writes **markdown documents in the project**. The "spec" is the markdown doc, mutated by successive phases. Every artifact is greppable, debuggable, and version-controllable.

## Decision

All inter-phase data is markdown with optional YAML frontmatter for structured metadata.

```
Roadmap (markdown) ──► Initiative manifest (markdown + frontmatter) ──► Feature spec (markdown) ──► Work item spec (markdown) ──► PR description (markdown) ──► Retro (markdown)
```

Every artifact lives in a known location, has YAML frontmatter declaring type/owner/dependencies/status, is human-editable, and is greppable. Skills consume markdown via `gray-matter` for frontmatter parsing and emit markdown via direct file writes.

## Consequences

- Every phase boundary is debuggable with `cat` and `grep`.
- Humans can intervene at any artifact, not just at designated interaction points.
- Artifacts live in version control alongside the code they describe.
- No bespoke serialisation; no migration when a field is added.
- Trade-off: no compile-time schema enforcement. Mitigated by lint skills and benchmarks that validate artifact shape.

## Alternatives considered

- JSON / YAML for everything — less human-friendly, breaks the "documentation = data" property.
- A typed work-item DB — gives schema validation but loses transparency and version-control alignment.
- gRPC / protobuf between phases — overkill for a single-machine system.

## References

- https://github.com/garrytan/gstack — entire workflow is markdown-driven
- v1's `src/state/store.ts` (structured state we are explicitly not reproducing)
