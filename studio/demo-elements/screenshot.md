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
- Emit a self-contained HTML fragment using the Forge demo classes (`.demo-card`)
  with the image inlined (data URI) or referenced, led by a one-line caption of
  what the screenshot proves.
- Keep the image reasonably sized; crop to the relevant resource.
