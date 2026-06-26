---
id: screenshot
name: Live-resource screenshot
phase: capture
description: Captures a screenshot of the live resource / portal the change affects, as visual evidence.
configHint: What to screenshot + how (e.g. "the release definition in the ADO portal"). May reference a capture script.
---

# Demo element — Live-resource screenshot

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/screenshot/SKILL.md` that captures a screenshot of the LIVE
resource the initiative affects (a portal page, a rendered UI, a dashboard) and
renders ONE HTML fragment embedding it as visual evidence.

The generated element-skill must:
- Capture a REAL screenshot of the live resource (via the project's own capture
  machinery — a Playwright/headless step, a portal export, or an existing
  `captureCheckpoints`-style helper). Never fabricate or stub the image; if the
  screenshot can't be produced (no creds / no live system), say so in the fragment
  rather than faking it.
- **Handle portal auth.** Most resource portals (e.g. the Azure DevOps web UI) are
  interactive-auth (AAD) — an unauthenticated browser is REDIRECTED to a login
  page, so an API token (PAT) is NOT enough for a browser screenshot. The skill
  must load a saved Playwright `storageState` (a logged-in browser session) when
  one is present (look for `.forge/demo/auth/<portal>.storage.json`), and pass it
  via `browser.newContext({ storageState })`. If no storageState exists and the
  page lands on a login screen, emit the "screenshot unavailable — portal auth
  (a Playwright storageState) is required" fragment rather than capturing a login
  page. Document in the fragment how to create one (log into the portal in a
  browser, save the auth state).
- Emit a self-contained HTML fragment using the Forge demo classes (`.demo-card`)
  with the image inlined (data URI) or referenced, led by a one-line caption of
  what the screenshot proves.
- Keep the image reasonably sized; crop to the relevant resource.
