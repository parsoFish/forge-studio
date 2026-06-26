---
id: screenshot
name: Live-resource screenshots
phase: capture
description: Captures 1→n screenshots of the live resource / portal areas the change introduced, chosen by the agent to match the change's scope.
configHint: How to reach the live resource (e.g. "the release definition in the ADO portal") + any standing-resource id. The agent decides WHICH views + HOW MANY.
---

# Demo element — Live-resource screenshots (adaptive, 1→n)

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/screenshot/SKILL.md` that captures REAL screenshot(s) of the
live resource the initiative affects and renders an HTML fragment embedding them.

**This element is deliberately NON-deterministic — the generated skill REASONS
about the change and chooses what to capture.** It is not a single fixed shot.

The generated element-skill must:

1. **Decide what to show — and how many shots — from the actual change.** Read the
   initiative's diff / new capabilities and pick the portal views that
   *demonstrate them*. Scale to the change:
   - A small cleanup / refactor (e.g. an idempotency fix) → 0–1 shots of the one
     affected area (or skip with an honest note that there's nothing visual).
   - A new resource or a big feature → SEVERAL shots, one per newly-possible
     configuration area. (When ADO release pipelines were first added, that meant
     separate shots of stages, tasks/jobs, gates & approvals, triggers, variables,
     retention — each new surface.)
   Caption EACH shot with the specific capability it shows.

2. **Capture each chosen view with a reusable, authenticated capture primitive.**
   Most resource portals (e.g. the Azure DevOps web UI) are interactive-auth (AAD)
   — an unauthenticated browser is REDIRECTED to login, so an API token (PAT) is
   NOT enough for a browser screenshot. Use a saved Playwright `storageState`
   (a logged-in session) at `.forge/demo/auth/<portal>.storage.json` via a small
   capture primitive the skill invokes once per view (one URL → one PNG), so the
   skill stays a thin "choose views + compose" layer over a stable capture tool.
   Drive different areas by the resource editor's tab/section URLs (and, where a
   view needs a click — a stage's tasks, a gates dialog — interact with the
   authenticated page). Target a STANDING resource (one that persists), never a
   transient acceptance resource that is destroyed after the run.

3. **Never fabricate.** If the storageState is missing/expired (the page lands on a
   login screen) or no live resource exists, emit an honest "screenshot
   unavailable — portal auth (a Playwright storageState) is required" fragment
   documenting how to create one — never a login-page capture or a stub image.

4. **Compose the fragment.** Emit a self-contained HTML fragment using the Forge
   demo classes (`.demo-card`) with EACH image inlined (data URI), each led by its
   one-line caption. Crop/scale sensibly. One fragment, 1→n images.
