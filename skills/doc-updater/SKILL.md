---
name: doc-updater
description: Detect the documentation surface a change touched and refresh it using the project's own declared doc tool, then stage the result. Maps the diff to the docs that describe it (generated reference docs via the project's generator command, hand-written guides/READMEs for behaviour changes), runs the project's `docs` release step command when one is declared, and stages the regenerated/edited files. Composed by the release-finalizer during pre-merge finalisation; language- and tool-agnostic (it runs whatever command the project declares).
phase: release-finalize
surface: unattended
model: claude-sonnet-4-6
---

# Doc-updater — refresh changed documentation

## What this skill is

The documentation half of release finalisation. A merged feature whose docs are
stale ships a lie; this skill keeps the documented surface in sync with the code
on the PR branch, before merge. The `release-finalizer` composes it for any
`docs` step the project declares.

It is **tool-agnostic**: it runs whatever generator/command the project declares
in its `releaseProcess` `docs` step (e.g. `tfplugindocs generate`,
`typedoc`, `mkdocs build`, a project script). It never assumes a stack.

## Inputs

- The branch diff (`git diff --name-only main...HEAD`) — what changed.
- The project's declared `docsDir` (where docs live) and the `docs` release
  step's `command` (how to regenerate them), if any.

## What to do

1. **Detect the changed surface.** From the diff, decide which docs describe the
   change:
   - A public API / resource / CLI surface change → regenerated reference docs.
   - A behaviour or usage change → hand-written guides / README sections under
     `docsDir`.
   - No doc-bearing change (internal refactor, test-only) → nothing to do; report
     that and return.
2. **Run the project's doc generator** when a `docs` step `command` is declared
   (via `Bash`). Trust the project's tool — do not hand-edit generated files.
3. **Hand-edit guides/READMEs** for behaviour changes the generator does not
   cover (via `Edit`), staying inside `docsDir`.
4. **Stage** every regenerated/edited doc file (`git add`) so it joins the
   finalisation commit the release-finalizer makes.

## Hard rules

- Stay within `docsDir` (and any path the declared command writes). Do not
  reopen feature code.
- Do not commit, push, tag, or merge — the release-finalizer owns the commit;
  CI owns tag/publish.
- If the project declares no doc tool and the change has no hand-written docs to
  touch, report "no doc surface changed" and return cleanly.
