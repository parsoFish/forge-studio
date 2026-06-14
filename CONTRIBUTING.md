# Contributing to Forge

## Prerequisites

- Node.js via [nvm](https://github.com/nvm-sh/nvm) — `nvm use` in the repo root picks the right version.
- Install dependencies: `npm install`
- The Claude Agent SDK key (`ANTHROPIC_API_KEY`) must be set for any test that hits the live API. CI tests use injected mocks and do not require a key.

## Build and test gates

Every PR must pass all four gates before merge:

```bash
npm run build          # TypeScript compile — zero errors
npm test               # ~1172 unit tests via node:test
forge studio lint      # validate agents/flows/catalog/kb defs; exits non-zero on error
forge brain lint       # 8 structural integrity checks on brain/; exits non-zero on error
```

Run the UI journey if you touch `forge-ui/` or any Studio surface:

```bash
npm run ui:journey     # headless end-to-end operator journey (video + DOM assertions)
```

`npm run verify:cycle` is the real-money regression harness (ADR-022). It runs a live cycle against a managed project. This is operator-gated — do not run it in automated CI.

## Commits

Conventional commits, no exceptions:

```
feat: add Zep KbBackend behind the kb seam
fix: unifier exits non-zero when no WI branches found
refactor: extract cycle helpers to cycle-helpers.ts
docs: extend ADR-029 with Gemini realization gap
test: add aider adapter conformance suite
chore: update @google/genai to 0.7
```

No AI-attribution lines (`Co-authored-by: …`) in commit messages.

## One concern per PR

Each PR touches one seam, one fix, or one phase. Stacked PRs are fine; squash-merge on stacked PRs is not (the lesson lives in `brain/forge-dev/`).

## The ADR rule

If your change conflicts with or supersedes a decision in `docs/decisions/`, **update the ADR first** — rationale required — before changing the code. ADRs are load-bearing; a code change that contradicts one without updating it will be sent back.

## Extension points

The three seams that accept new implementations without touching core orchestration are documented in [`docs/extending-forge.md`](./docs/extending-forge.md):

1. **RuntimeAdapter** — plug in a new LLM SDK or agentic coder (`loops/_adapters/`).
2. **KbBackend** — swap the brain's storage layer (`orchestrator/kb-backends/`).
3. **Flow** — add a new agent workflow (`studio/flows/`).
4. **Skill/agent** — define a new phase agent (`skills/`).

Read that guide before starting extension work.

## Where to ask

Open an issue or start a discussion in the repo. For architectural questions that touch an ADR, reference the ADR number.
