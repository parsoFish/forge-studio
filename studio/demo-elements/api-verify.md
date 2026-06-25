---
id: api-verify
name: Live API verify
phase: verify
description: GETs a live endpoint/resource the change affects and shows the real response as evidence.
configHint: How to query the live resource (e.g. "az rest --method get --url …" or "curl -s https://…"). Requires the project's live creds in the env.
---

# Demo element — Live API verify

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/api-verify/SKILL.md` that queries the LIVE resource the
initiative affects and renders ONE HTML fragment showing the real response — the
gold-standard demo for external-resource projects (show the actual resource, not a
test-name table).

The generated element-skill must:
- Run the configured query with Bash against the live system (the project's creds
  are in the serve env) and capture the REAL response body. Never fabricate it; if
  creds are absent, say so in the fragment rather than faking a response.
- Emit an HTML fragment using the Forge demo classes — the request + the salient
  response fields in a `pre`, inside a `.demo-card`, led by a one-line caption of
  what the response proves (e.g. idempotency on a re-GET).
