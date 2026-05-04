# Brain — Per-Project Sub-Wikis

> One folder per managed project. Each folder is its own mini-wiki with a `profile.md` (who/what/taste) and `themes/` for project-specific patterns, antipatterns, and operations.

**Status:** empty (scaffold). Populated by brain seeding Pass B (existing projects from `~/sideProjects/projects/`) and by cycle retros for newly-onboarded projects.

## Layout per project

```
projects/<name>/
├── profile.md                      # who this project is for, what it is, taste signals, status
├── themes/                         # project-specific theme pages
│   └── <theme-slug>.md
├── patterns.md                     # category index (project-specific)
├── antipatterns.md                 # category index (project-specific)
├── decisions.md                    # category index (project-specific)
└── operations.md                   # category index (project-specific)
```

The structure mirrors `brain/forge/` deliberately — agents and humans navigate the same way at the project level as at the system level.

## Profile.md

```yaml
---
project: <name>
created_at: <ISO-8601>
updated_at: <ISO-8601>
status: active | paused | archived
domain: <e.g. "browser game", "infrastructure tooling", "music production">
stack: [list, of, primary, technologies]
taste_decay: 0.05               # weekly decay weight on taste signals (gstack-inspired)
---

# <Project>

<One paragraph: what is this project, who is it for, what does success look like?>

## Taste signals

- ...
- ...

## Hard constraints

- ...

## Active focus

- ...
```

## Why per-project sub-wikis

System-level patterns (`brain/forge/`) generalise across projects. Project-specific knowledge (this directory) doesn't — it's a function of the project's domain, stack, and taste. Mixing them dilutes both. Separation = the right knowledge surfaces in the right context.
