---
id: plan
name: Plan
kind: file
producer: architect
consumer: project-manager
schema:
  requiredFiles:
    - _queue/in-flight/<initiative-id>.md
  requiredFields:
    - initiative_id
    - project
---

# Plan artifact contract

The architect's approved initiative manifest, handed to the project-manager. The body carries
the vision plus Given/When/Then acceptance criteria — it is the **single source of intent** the
PM decomposes (no pre-sized `features[]`). The PLAN.html snapshot is the human-facing render of
the same content, surfaced at the architect's plan gate.

- **Producer:** architect (plan gate).
- **Consumer:** project-manager (`renderPmUserPrompt` reads the manifest body).
- **Must exist before** the `pm` node runs.
