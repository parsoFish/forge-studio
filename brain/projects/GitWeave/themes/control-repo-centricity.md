---
title: GitWeave — control-repo centricity is non-negotiable
description: >-
  All behaviour drives from one repo. No bespoke services, no parallel control
  planes. Initiatives that propose a separate "GitWeave service" are
  escalations, not auto-resolves.
category: decision
keywords:
  - gitweave
  - control-repo
  - governance
  - monolith
  - platform-as-code
  - single-source-of-truth
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# GitWeave — control-repo centricity

GitWeave's core principle: *one* control repository configures the entire GitHub organisation. The opposite — multiple coordinating services or repos — is the failure mode it explicitly rejects.

What this means for forge initiatives:

- An initiative that proposes "spin up a separate GitWeave service" is an **architect-level escalation**, not a mechanical fix. The CEO critic should surface this for the user.
- Adding a new automation or governance feature → adding a module under `modules/` (composable, in-repo) — *not* a new repo or external service.
- The metrics aggregator can run as a Service or Workflow but its config still lives in the control repo. It's an *outbound* consumer of the control state, not a peer.

The reviewer phase rejects PRs that introduce parallel control surfaces (e.g. config that lives outside this repo, secrets stored elsewhere). All control state is in the repo or in Terraform-managed cloud resources.

## Sources

- GitWeave README "Constitution & Governance" + "Core Concepts" sections.
