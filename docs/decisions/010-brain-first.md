# ADR 010 — Brain-first research

**Status:** Amended 2026-05-16 — brain-first is **narrowed to the
planner/architect and reflector**; the dev-loop and reviewer
deliberately do NOT read the brain (their intent is wholly in the
work items the planner authored). See the brain-read-policy theme
(`brain/forge-dev/themes/brain-read-policy.md`) and F-34 / F-41.
Amended 2026-05-26 — three-brain model (ADR 018): dev-loop and reviewer
MAY read Brain 3 (`<project-repo>/brain/` — location further amended by
ADR 035, 2026-06-20: Brain 3 now lives at `brain/projects/<name>/themes/`
in the forge repo) for supplemental project
context, but this is advisory not mandatory. The forge brain (Brains 1+2)
remains off-limits for dev-loop and reviewer.
Amended 2026-08-09 — R1-06 (band-scoped KBs + Studio KB sessions): (a) a
Studio-created KB bound `{kind: flow, ref: <flow>, band: <band>}` may grant
the band's canonical agent role a read of THAT KB only — the sole mapped case
is `band: review-band` → the reviewer; the dev-loop gains nothing, and the
OOTB Brains 1+2 (`forge-dev`, `cycles`) remain off-limits to dev-loop and
reviewer exactly as before. (b) The reflector is no longer the sole brain
writer: operator-initiated Studio sessions (KB creation seeding, KB
maintenance/consolidate) are a second, bounded write path — structure only,
never ingest (operator decision 3, 2026-08-03).
**Date:** 2026-04-24 (amended 2026-05-16, 2026-05-26, 2026-08-09)

## Context

User principle 4: every component must use the brain as its first source of knowledge but must be able to research further when the brain is insufficient. Without enforcement, agents will reach for whatever's familiar (web search, training data, ad-hoc reading) and the brain stops being useful — exactly what happened in the earlier forge build's early cycles before the wiki existed.

## Decision (amended 2026-05-16)

**The brain is read by the phases that *plan*, not the phases that
*execute*** — with two narrow, descriptor-declared exceptions for executors:
Brain 3 (2026-05-26 amendment, below) and a band-scoped KB's band-role grant
(2026-08-09 amendment, below). Original ADR mandated every skill brain-query first;
the trafficGame arc proved that net-negative for execution phases
(F-34/F-41 strip-backs were the right call). The policy now:

- **Architect / project-manager (the planner): MUST read the brain**
  first — antipatterns + historical work-sizing shape how an
  initiative is sliced. Runtime-enforced for PM (throws on 0 brain
  reads).
  *(Amended 2026-07-11 — plan 2.11, PM turn economy: the orchestrator now
  PRE-FETCHES the deterministic subset — the project profile + the
  always-relevant themes — and inlines it into the PM prompt, so the
  mandate is satisfied structurally; injected files count toward the
  runtime gate and 0 agent-side brain `Read` turns is the intended fast
  path. The behavioural throw remains as a backstop when injection comes
  up empty AND the agent read nothing. Three cycles' evidence
  (2026-07-01→10): turn-budgeted re-discovery of known context caused
  `error_max_turns` empty decompositions.)*
- **Reflector: reads (and writes) the brain** by definition.
  *(Amended 2026-08-09 — R1-06/R4-19: the reflector is no longer the SOLE
  writer. Operator-initiated Studio sessions are a second write class with a
  different trigger topology — interactive, operator-launched, not gated on a
  completed cycle's merge: (1) **KB creation seeding** — seeds a new KB's
  structure from that scope's real history at creation time; (2) **KB
  maintenance** — the consolidate session merges duplicates, relinks edges,
  tags themes against real lint findings. Bounds: both edit STRUCTURE over
  existing evidence only — **neither may ingest new raw content; ingest
  remains exclusively the reflection path's output** (operator decision 3,
  2026-08-03, an explicit negative AC on R1-06/R6-08). Every session write
  goes through the canonical serializer + containment choke points
  (`serializeKbDescriptor`, `resolveKbBrainDir`/`guardKbTail`) and must leave
  `forge brain lint` green on completion.)*
- **Dev-loop and reviewer: MUST NOT read the forge brain (Brains 1+2).**
  The planner already encoded every relevant pattern/antipattern/convention
  into the work items; the WI (dev-loop) and the manifest+WI set (reviewer)
  are the **single source of intent**. A forge-brain pass is wasted cost and
  a source-of-truth split. No runtime brain gate for these.
  *(Amended 2026-05-26 — ADR 018: they MAY read Brain 3, the cycle's
  project brain at `projects/<name>/brain/` (location further amended by
  ADR 035, 2026-06-20: Brain 3 now lives at `brain/projects/<name>/themes/`
  in the forge repo), for supplemental project
  context — file layout, testing norms — now that it is scope-clean
  project-only. Advisory, not mandatory; the WI remains the single source
  of* intent*, Brain 3 is supplemental* context*.)*
  *(Amended 2026-08-09 — **R1-06 band-scoped reviewer grant**: a KB whose
  descriptor binds `{kind: flow, ref: <flow>, band: <band>}` may declare the
  band's canonical agent role in `usage.readers`, granting that role a read of
  **that KB only**, through its declared read surface (navigation-index /
  search). The ratified band→role map is exactly: `review-band` → reviewer. No
  band maps to the dev-loop; `demo-band`, `wi-contract`, and `reflection-close`
  map to no reader role until a future dated entry here says otherwise. This is
  the first deliberate crossing of the "scoping, not who-reads-what" boundary —
  crossed consciously, not drifted across (roadmap R1-06-F1 ⚑). Standing rules
  unchanged: the WI/manifest remains the single source of* intent*; a band KB is
  supplemental, advisory context with the same standing as Brain 3; the OOTB
  Brains 1+2 stay categorically off-limits to dev-loop and reviewer — a band KB
  is a separately-created, separately-bound KB, not a gate into `forge-dev` or
  `cycles`. Enforcement: `orchestrator/kb-read-policy-guard.test.ts` is extended
  beyond its four phase-binding source greps to walk every `brain/*/kb.yaml` and
  `brain/projects/*/kb.yaml` — any descriptor whose resolved `usage.readers`
  grants dev-loop or reviewer on a non-project binding without a band mapping
  ratified in THIS ADR fails the guard. Until a runtime actually feeds band KBs
  to the review band (R4-19+), this grant is contract + guard only; the guard
  must be extended in the same change that wires any real read, mirroring the
  dispatch it backstops.)*
- Permitted brain reads go through the navigation metadata
  (`INDEX.md`, category indexes, `profile.md`) — never full-tree scans.

`brain-query` still logs gaps; the reflector still reports gap counts.
Full rationale: `brain/cycles/themes/brain-read-policy.md`.

## Consequences

**Positive:**
- The brain stays current — it's continuously stress-tested by every skill invocation.
- Gaps surface automatically.
- New users (and new skills) inherit the project's accumulated knowledge by default.

**Negative / accepted trade-offs:**
- Every skill pays a small upfront cost (one brain query). Mitigated by `brain-query` using a fast model (Haiku by default).
- Skills could lie about having queried the brain. Mitigated by event-log enforcement — the orchestrator can reject skill outputs that don't have a corresponding `brain-query` event.

## Alternatives considered

- **Optional brain consultation** — observed in the prior approach to drift to "never queried." Rejected.
- **Brain queries as a hook injected by the runner** — couples the runner to the brain too tightly; better to keep it in the skill where it's visible.

## References

- The prior `.forge/wiki/` — proved the wiki concept; this ADR makes consultation mandatory
- [Karpathy LLM-wiki gist](https://gist.github.com/karpathy/) — the philosophy
- ADR 027 §4 (as amended 2026-08-09) — the `band?:` qualifier shape on `{kind: flow}` bindings
- ADR 018 / ADR 035 — the prior scoping-only amendment chain this entry is the first to deliberately break
- `docs/roadmaps/R1-contract-componentry.md` R1-06 — the initiative carrying this amendment; operator decision 3 (2026-08-03) — ingest stays reflection-only
