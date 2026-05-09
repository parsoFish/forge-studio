---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2026-05-09-healarr-quickstart-readme
status: pending
depends_on: []
acceptance_criteria:
  - given: "the project README"
    when:  "a reader scrolls through it"
    then:  "a `## Quick start` heading is present"
  - given: "the new Quick start section"
    when:  "the reader follows it"
    then:  "the section contains an `Install` step (line containing `Install` or starting with `### Install`) and a `Run` step (line containing `Run` or starting with `### Run`)"
files_in_scope:
  - README.md
estimated_iterations: 1
---

# Add a Quick start section to README.md

Make it possible for a new user to install and run healarr in under a minute. Add a `## Quick start` section to `README.md` that includes:

- An **Install** step (subheading or a line starting with `Install`).
- A **Run** step (subheading or a line starting with `Run`).

The contents of the steps are at your discretion (placeholder commands are fine — this is a fixture). The section heading must be exactly `## Quick start` (case-sensitive, double-hash).

## Hard rules

- Only modify `README.md`. Do not touch `docs/` or any other file.
- Do not remove existing content from the README; add the new section at the end.

## Brain themes worth a look

- `markdown-artifact-flow` — README is the entry point; structure matters.
