---
id: typescript-node
title: TypeScript / Node conventions
kind: language
appliesTo: [typescript, node, javascript]
scope: both
provenance: "forge's own CLAUDE.md + global code-style rules; corroborated by the managed-project instruction corpora projects/mdtoc/CLAUDE.md and projects/gitpulse/CLAUDE.md"
---

## TypeScript / Node conventions

Distilled from forge's own toolchain and the managed TypeScript CLIs it builds.

- **Immutability.** Return new objects; never mutate inputs. Prefer pure
  functions with an explicit input → output.
- **Small, focused files.** Aim under 400 LOC per source file (hard ceiling
  ~800); organise by feature, not by type.
- **Handle errors explicitly at every level.** Never silently swallow. Validate
  all external input at system boundaries; fail fast with a clear message.
- **No hardcoded values or secrets.** Use constants, config, or env vars.
- **Dependency discipline.** Every dependency is a maintenance liability —
  justify it. Prefer the standard library (`node:*` builtins, `node:test`) and
  battle-tested community tools over hand-rolling.
- **Build / test commands are copied, not invented.** Read `package.json`
  scripts and CI config; state the exact `npm run build` / `npm test`
  invocations. A single, deterministic, creds-free test command is the quality
  gate.
- **Types are the contract.** `tsc --noEmit` is authoritative — a runtime that
  strips types (e.g. `--experimental-strip-types`, `tsx`) does NOT typecheck, so
  a green test run is not proof of a clean build.
