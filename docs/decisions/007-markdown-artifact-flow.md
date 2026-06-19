# ADR 007 — Markdown artifacts flow phase-to-phase

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The prior approach represented work as a mix of TypeScript objects, JSON state files, and markdown agent personas. Inputs/outputs between phases were typed but not greppable; debugging "what did the planner emit?" required a JSON read or a database query.

[gstack](https://github.com/garrytan/gstack) demonstrated a more debuggable approach: every phase reads and writes **markdown documents in the project**. The "spec" is the markdown doc, mutated by successive phases. Every artifact is greppable, debuggable, and version-controllable. The phase boundary is just "which file does this skill read and which does it write."

## Decision

**All inter-phase data is markdown** with optional YAML frontmatter for structured metadata. The flow:

```
Roadmap (markdown) ──► Initiative manifest (markdown + frontmatter) ──► Work item spec (markdown) ──► PR description (markdown) ──► Retro (markdown)
```

## Amendment 2026-06-04 — feature layer removed

The intermediate **Feature spec** node is gone. The architect now emits initiatives whose markdown body carries vision + Given/When/Then acceptance criteria directly (no `features[]` list), and the PM decomposes those ACs straight into work items. The flow is now:

```
Roadmap ──► Initiative manifest ──► Work item spec ──► PR description ──► Retro
```

Every artifact:
- Lives in a known location (project's repo for project artifacts; `_queue/` for orchestrator state; `brain/` for durable knowledge).
- Has YAML frontmatter declaring its type, owner, dependencies, status.
- Is human-editable — the human can intervene at any boundary by editing the file.
- Is greppable — `grep -r 'work_item_id: WI-42' projects/` works.

Skills consume markdown via `gray-matter` for frontmatter parsing and emit markdown via direct file writes.

## Consequences

**Positive:**
- Every phase boundary is debuggable with `cat` and `grep`.
- Humans can intervene at any artifact, not just the designated interaction points.
- Artifacts live in version control alongside the code they describe.
- No bespoke serialisation; no migration when a field is added.

**Negative / accepted trade-offs:**
- No compile-time schema enforcement. Mitigated by lint skills (`forge brain lint`, `forge studio lint`) and the `orchestrator/work-item.ts` parser/validator, which assert artifact shape at the phase boundary.
- Markdown is verbose vs binary formats. Accepted.

## Alternatives considered

- **JSON / YAML for everything** — less human-friendly, breaks the "documentation = data" property.
- **A typed work-item DB** — gives schema validation but loses transparency and version-control alignment.
- **gRPC / protobuf between phases** — overkill for a single-machine system.

## References

- [garrytan/gstack](https://github.com/garrytan/gstack) — entire workflow is markdown-driven
- The prior `src/state/store.ts` (structured state we are explicitly not reproducing)
