# Component Relationships

> How the [components](docs/architecture/refocus-architecture/README.md) connect: the control flow, the artifact +
> queue protocol, the brain read/write policy, the skill-composition seam, and the UI
> boundary. The governing rule is **one source of intent per edge** — each arrow carries a
> specific artifact or event, never free-form chat.

## 1. The spine, in one line

```
operator ─(UI only)─▶ ① ARCHITECT ──INIT-*.md (GWT ACs)──▶ [orchestrator: claim + worktree + spawn @ tier]
                                                                  │
        ┌─────────────────────────────────────────────────────────┘
        ▼
   ② project-manager ─WI-*.md─▶ ③ developer-loop ─branch─▶ ④ unifier ─demo+PR─▶ ⑤ REVIEW ─merge─▶ closure ─▶ ⑥ REFLECT
        └──────────────── each phase = an agent that composes skills ───────────────┘                                │
                                                                                                                      ▼
   planners (①②) + reflector (⑥) ◀── read ── BRAIN (3 scopes) ── write ──▶ reflector (⑥)
```

Architect → PM hand-off: the initiative manifest carries vision + GWT ACs in the body;
**no `features[]` list** — the PM decomposes ACs directly into WIs (3 levels: initiative → WI → file).

Uppercase = the three **human moments** on the UI; the rest run unattended in the
orchestrator. Every inter-phase hand-off is a **file** (markdown artifact) or a **JSONL
event**, never a conversation.

## 2. Control + data flow

```mermaid
flowchart TB
    OP(["Operator"])

    subgraph UI["forge UI — sole operator surface · ADR 023"]
      direction LR
      AR["① Architect<br/><i>idea → initiatives (GWT ACs)</i>"]
      RV["⑤ Review<br/><i>read demo · approve · merge</i>"]
      RF["⑥ Reflect<br/><i>feedback</i>"]
    end

    ORCH["Orchestrator — thin, LLM-free coordination<br/>claim · worktree · heartbeat · _queue/ state machine · merge-gate · recovery<br/>picks agent + model tier; owns no phase prompt"]

    subgraph PHASES["Each phase = a model-tiered AGENT that COMPOSES skills · ADR 024"]
      direction LR
      PM["② project-manager<br/><i>ACs → work items + gates</i>"]
      DV["③ developer-loop<br/><i>Ralph × N work items</i>"]
      UN["④ unifier<br/><i>unify · demo · PR</i>"]
      RFL["⑥ reflector"]
    end

    subgraph CAP["Skills — composable capabilities (shared, not restated)"]
      direction LR
      S1["brain-query"]
      S2["demo"]
      S3["gate-running"]
      S4["developer-ralph · unifier · …"]
    end

    BRAIN[("Brain — 3 scopes<br/>forge-dev · cycle · project-dev<br/>planners + reflector READ; dev-loop/reviewer do NOT read forge brain")]
    PROTO[("Markdown artifacts + JSONL event log + _queue/ state machine<br/>the inter-phase protocol · ADR 007/008/011")]

    OP --> UI
    AR -->|writes _queue/pending/INIT-*.md| ORCH
    ORCH ==>|spawn @ tier| PM
    PM ==>|WI-*.md| DV ==>|branch| UN
    UN -->|self-contained PR + demo| RV
    RV -->|merge confirmed → closure| RFL
    PM -.compose.-> CAP
    DV -.compose.-> CAP
    UN -.compose.-> CAP
    RFL -.compose.-> CAP
    PM -.read.-> BRAIN
    AR -.read.-> BRAIN
    RFL <-.read / write.-> BRAIN
    PHASES ==> PROTO
    PROTO -.replay.-> RFL
    RF --> RFL

    classDef human fill:#2d2410,stroke:#d29922,color:#e6edf3;
    classDef agent fill:#0d2b45,stroke:#58a6ff,color:#e6edf3;
    classDef cap fill:#10231a,stroke:#2ea043,color:#e6edf3;
    classDef store fill:#1b1b2b,stroke:#8957e5,color:#e6edf3;
    class OP,AR,RV,RF human;
    class PM,DV,UN,RFL agent;
    class S1,S2,S3,S4 cap;
    class BRAIN,PROTO store;
```

## 3. The artifact + queue protocol (the filesystem IS the state)

```mermaid
flowchart LR
    IDEA["operator idea"] --> ARCH["architect"]
    ARCH -->|INIT-*.md| PEND["_queue/pending/"]
    PEND -->|claim mv + worktree| INFL["_queue/in-flight/"]
    INFL --> WI[".forge/work-items/WI-*.md"]
    WI --> BRANCH["initiative branch (pushed)"]
    BRANCH --> DEMO["demo/&lt;id&gt;/demo.json → DEMO.html + PR"]
    DEMO -->|operator merges in GitHub| MERGED{"gh pr == MERGED?"}
    MERGED -->|yes| DONE["_queue/done/ (⇒ MERGED)"]
    MERGED -->|not yet| RFR["_queue/ready-for-review/"]
    RFR -.operator merges later.-> DONE
    DONE --> REFL["reflection fires"]
    INFL -.failure.-> FAIL["_queue/failed/ (bounded auto-retry ≤2 → pending)"]

    classDef q fill:#1b1b2b,stroke:#8957e5,color:#e6edf3;
    class PEND,INFL,RFR,DONE,FAIL q;
```

**Invariant G1:** `done/` ⇒ a GitHub-confirmed merge. **G9:** forge never auto-merges.
**G10:** reflection fires only on a confirmed merge. The event log (`events.jsonl`) — not the
queue dir — is the closest thing to ground truth; `dev-loop.delivered` (git diff) is the
authoritative completion signal.

## 4. Brain read/write policy (one source of intent per phase)

```mermaid
flowchart TB
    subgraph B["Brain (3 scopes)"]
      B1[("Brain 1 · forge-dev<br/>graphify code graph + ADR/themes")]
      B2[("Brain 2 · cycle<br/>markdown themes — NO graphify")]
      B3[("Brain 3 · project-dev<br/>graphify code graph + project lessons")]
    end
    ARCH["architect (planner)"] -->|read| B2
    ARCH -->|read| B3
    PM["project-manager (planner)"] -->|read| B2
    PM -->|read| B3
    DEV["developer-loop / unifier (executor)"] -.read advisory.-> B3
    DEV -. must NOT read .-> B2
    REFL["reflector"] -->|read| B2
    REFL -->|read| B3
    REFL -->|WRITE forge-machinery lessons| B2
    REFL -->|WRITE project lessons| B3
    DEVR["operator + Claude on forge"] <-->|read/write| B1

    classDef store fill:#1b1b2b,stroke:#8957e5,color:#e6edf3;
    class B1,B2,B3 store;
```

- **Planners (architect/PM) + reflector** read Brain 2 + the project's Brain 3 (mandatory).
- **Executor (dev-loop/reviewer)** takes intent from the work item; may consult Brain 3
  (advisory); must **not** read the forge brain.
- **Reflector** is the only durable writer (Brain 2 + Brain 3), routed by the dual-scope
  litmus. **Brain 1** is forge's own engineering wiki, outside the cycle.

## 5. The skill-composition seam (ADR 024)

```mermaid
flowchart LR
    ORCH["Orchestrator<br/>picks PhaseAgentSpec + model tier<br/>spawns clean context"] -->|spawn| AGENT["Phase agent<br/>persona + tier + tool allow-list"]
    AGENT -->|composes| SK["Skills (shared capabilities)<br/>brain-query · demo · gate · per-phase skill"]
    SK -.future plugins.-> AGENT
    classDef a fill:#0d2b45,stroke:#58a6ff,color:#e6edf3;
    classDef c fill:#10231a,stroke:#2ea043,color:#e6edf3;
    class ORCH,AGENT a;
    class SK c;
```

North star: the SKILL.md *is* the runnable source of intent, and new capabilities arrive as
**skills-as-plugins** for any phase agent. Today only the unifier crosses this seam.

## 6. Relationship matrix

| Component | Consumes (from) | Produces (to) | Reads brain | Writes brain |
|---|---|---|---|---|
| **Architect** | operator idea/verdict (UI); project + Brain 2/3 | `INIT-*.md` (vision + GWT ACs) → queue | 2, 3 | — |
| **Orchestrator** | `INIT-*.md`; `.forge/project.json`; git/gh | `_queue/` moves; worktrees; events; PRs (via closure) | — | — |
| **Project Manager** | `INIT-*.md` body (GWT ACs) | `WI-*.md` + DAG | 2, 3 | — |
| **Developer Loop** | `WI-*.md` + gates | commits on branch; `dev-loop.delivered` | 3 (advisory) | — |
| **Unifier** | branch + WIs | `demo.json` + PR description | 3 (advisory) | — |
| **Review/Closure** | branch + demo + operator verdict | GitHub PR; merge confirm; `done/` | — | — |
| **Reflection** | event log + merged tree + feedback | themes + cycle archive | 2, 3 (+1 read) | 2, 3 |
| **Forge UI** | events + queue + artifacts (via bridge) | handoff files (verdict/answers/feedback) | — | — |
| **Brains** | source (graphify); reflector lessons | query results; index | — | — |
| **Contract** | project tree + `.forge/project.json` | preflight verdict; loaded config | — | — |

## 7. The load-bearing seams (where failures cluster)

Both learnings syntheses + the comparable-systems research agree: phases are reliable; the
**seams** and the **merge boundary** are where forge breaks. The seams to keep honest:

1. **Architect → PM** — one decomposition (initiative ACs → WIs), not two. *(locked; no features[] intermediate layer)*
2. **PM → dev-loop** — the WI is the executor's single source of intent; no re-decomposition.
3. **dev-loop → unifier** — `dev-loop.delivered` (git diff) is completion truth; an empty
   branch must never open a PR.
4. **unifier → review** — one self-contained demo; the operator's verdict is a real gate.
5. **review → closure** — `done/` ⇒ MERGED; one terminal-move authority.
6. **closure → reflect** — fires only on confirmed merge; reflector is the only brain writer.
7. **scheduler ↔ cycle** — one owner of `_queue/` state transitions.

Every one of these is a place where "intent declared in prose but not enforced in the
runtime path" has bitten before — the refinement backlog moves each into enforced code.
