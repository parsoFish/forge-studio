---
name: demo-design
description: Reference for authoring a project's demoProcess declaration (.forge/project.json) so it actually drives cycle-time demo evidence — the bare-argv command rule for capture steps, the safe-route rule for browser checkpoints, and how an acceptance criterion's WHEN clause becomes a checkpoint automatically. demoProcess is the SOLE cycle-time demo input; nothing generated from it is required for a cycle to capture evidence.
library: true
phase: onboarding
surface: operator-triggered
model: claude-sonnet-4-6
---

# Demo-design — authoring the demo declaration

## What this skill is

`demoProcess` (`.forge/project.json`) is the **SOLE cycle-time demo input**
(bead forge-mfv5.2.2): the integrate band derives every checkpoint from it —
and from the initiative's typed acceptance criteria — at the moment a cycle
runs. Nothing generated ahead of time is required for that derivation to
work. This skill is guidance for AUTHORING the declaration so it is actually
drivable, not a generator that produces machinery on the project's behalf.

`forge preflight`'s `DEMO-SKILL` clause checks exactly what this skill
teaches: that at least one `capture` step names a command the integrate band
can actually run. `DEMO` checks the declaration's shape (≥1 `capture` + ≥1
`verify` step); `DEMO-SKILL` checks that shape is drivable.

## The three step kinds

- **`capture`** — what before/after evidence to record. Its text names the
  command (see below) whose stdout IS that evidence.
- **`verify`** — the assertion that makes the captured evidence non-trivial.
- **`present`** — how the evidence is surfaced in the PR/demo.

## The rule: a capture step's inline code is a bare-argv command

A `capture` step's text is operator prose with the command in an **inline-code
span**: `` Run `npm run demo` to build the fixture and capture the report. ``
The span inside the backticks — `npm run demo` — is read verbatim as the
command; the whole sentence is the caption shown beside the evidence.

That command is spawned as a **bare argv with no shell**, so it must contain
no shell metacharacters: pipes, redirects, `&&`/`;`, backticks, `$()`
substitution, globs, or newlines. `` Run `npm run demo | tee out.txt` ``
is rejected — pipe it inside a wrapper script instead and name the wrapper:
`` Run `npm run demo:capture`. ``

A capture step with no inline-code span, or one whose span fails this rule,
drives nothing — `DEMO-SKILL` fails and names which step and why (no
inline-code span, or which metacharacter). A `demoProcess` needs only ONE
drivable `capture` step to pass; author more when more evidence is useful,
each with its own inline-code command.

## Browser checkpoints: an inline-code route

A `capture` step whose inline-code span is an **in-app route** instead of a
command — starts with `/`, no `..`, and only safe path/query characters — is
captured as a browser screenshot instead of a terminal run: `` Load
`/reports/latest` and note the totals row. `` An unsafe or traversal-bearing
route (`/../secret`, a protocol-relative `//host/path`) drives nothing; it is
never silently treated as a command either.

## Acceptance criteria can drive checkpoints too (forge-mfv5.1.7)

An initiative's typed acceptance criterion (`GIVEN … WHEN … THEN …`) whose
`WHEN` clause carries the same kind of inline-code span — a bare-argv command
or a safe route — becomes its OWN checkpoint automatically, ahead of the
project's `demoProcess` checkpoints: the strongest evidence link a demo can
carry is one tied to the exact criterion it proves. Write acceptance criteria
with a concrete, runnable `WHEN` when you can; `demoProcess` is still what
covers everything an AC's `WHEN` does not name.

## Validate

```
forge preflight <project>
```

confirms `DEMO` (shape) and `DEMO-SKILL` (drivability) both pass. A failing
`DEMO-SKILL` names each undrivable capture step and why — fix the step's
inline-code span, not the clause.

## Presentation is a separate, optional step

None of the above requires a generated file. Optionally, run the
`demo-builder` **session** to author a per-project presentation composer
(`.forge/skills/demo-design/SKILL.md`, project-local — same slug as this
forge-wide skill, different file) that renders a rich, Forge-styled HTML view
of each initiative's captured evidence for the Studio demo page. That
composer is presentation guidance ONLY — it is never read at cycle time
(bead forge-mfv5.2.8 tracks folding the session's own output into the
declaration more directly). If you want it bound as a project skill (so
Studio shows it and `checkSkills` verifies it resolves), keep `demo-design`
in `.forge/project.json`'s `skills` list; the agent-prompt loader
(`loadDeclaredSkills`) skips it automatically because it is presentation-only
(`PRESENTATION_ONLY_SKILL_IDS`):

```json
{
  "skills": ["demo-design"]
}
```

## Done when

- Every `capture` step's inline-code span is a bare-argv command (no shell
  metacharacters) or a safe in-app route.
- `forge preflight <project>` reports `DEMO` and `DEMO-SKILL` both ✓.
- The operator understands that no generated file is required for a cycle to
  capture evidence — only the declaration above.
