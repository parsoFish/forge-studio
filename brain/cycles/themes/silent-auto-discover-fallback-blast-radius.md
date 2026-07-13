---
title: A silent auto-discover fallback is a blast-radius hazard under unattended execution
description: Lookup helpers that silently auto-discover and mutate "any matching" live resource when the expected target is missing must fail loud instead — an unattended agent under gate pressure won't question why the fallback found something.
category: antipattern
keywords: [silent-fallback, auto-discover, fail-loud, blast-radius, unattended-execution, fixture-resolution, resource-lookup]
created_at: 2026-07-13
updated_at: 2026-07-13
related_themes: [reactive-constraint-stripback-arc]
---

# A silent auto-discover fallback is a blast-radius hazard under unattended execution

- **Evidence**: betterado 2026-07 (SEV-1, git history). `resolveOrCreateFixtureProject`'s silent auto-discover-if-missing fallback found and mutated the operator's real personal ADO project when the expected fixture was absent (org at project cap), before being fixed to fail-loud (PR #47). See the betterado project theme `2026-07-02-live-acc-test-destroyed-shared-fixture`.

When an unattended agent's helper can't find its expected target, a "helpful" broad
fallback — search for anything roughly matching, then use/create/mutate it — is far
more dangerous than a hard failure, because the agent has no context to recognize
the fallback fired at all. It just sees the call succeed and moves on.

The generalizable rule for any lookup-with-fallback touched by an unattended
pipeline: **if the fallback's search space includes anything the agent doesn't own
or wasn't explicitly told about, remove the fallback and fail loud.** A fixed,
obvious failure is always safer than a silently-broadened one under agentic
execution.

## See also

- [[reactive-constraint-stripback-arc]] — diagnose the structural root; prefer removing the unsafe mechanism over layering guardrails.
