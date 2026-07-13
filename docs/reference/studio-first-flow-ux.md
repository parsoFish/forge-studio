# Forge Studio — install-to-first-flow UX spec

**Date:** 2026-06-16 · **ADR:** [033](../../decisions/033-studio-first-flow-ux.md)

The single canonical journey this spec serves:

> install from scratch → build a basic flow (a **plan** agent + a **dev** agent + a **review**
> agent, strung together) → onboard a project → give the flow work to complete.

Each principle below is stated so it maps to a per-screen acceptance check the seeded Playwright
journey can assert. The **activation event** ("aha") is *the flow is given work and produces a
first result*; time-to-first-value is the headline metric (target: minutes, not hours).

## UX principles (enforced per screen)

**1. First-run / empty states**
- Every zero-data screen carries a heading, a one-line purpose, and one primary action — never bare
  whitespace or a lone spinner.
- Distinguish *loading* / *first-use empty* / *no-results* with different copy; "empty" must never
  read as "broken."
- Orient in place with contextual empty states; reserve an optional, skippable guided overlay only
  for genuinely novel surfaces (the flow canvas).
- Offer "start from a starter/template" beside "create from scratch."
- CTA copy is a first step with a verb ("Create your first agent"), never "No agents."

**2. Progressive disclosure**
- Show only the few most-used fields by default; defer the rest behind one labelled "Advanced" group.
- Two levels max (primary + Advanced).
- A field is *required* only if the object cannot function without it; never hide a frequently-needed
  field behind Advanced.
- Ship a sensible default for every non-essential setting (model, retry, brain access) — default
  over choose.

**3. Activation / getting-started**
- Instrument the activation event (flow → first result); measure TTFV.
- A persistent, dismissible getting-started checklist mirrors the real path (install → 3 agents →
  flow → project → run) with live completion state.
- Onboarding is skippable and resumable; never block the app behind it.

**4. Discoverable creation**
- Exactly one primary action per screen; others are visually secondary.
- Every create action is a visible on-screen control — never URL-only or CLI-only; the empty-state
  CTA *is* the create entry point.
- The next-step CTA states its outcome ("Add to flow", "Onboard a project").

**5. No dead ends**
- Prefer enabling the primary action + validating on submit over a silently disabled button.
- If a control must be disabled, it says why and how to enable it.
- Every error/empty/no-results message offers a concrete next step; completing or clearing a list
  returns the user to a state that proposes what's next.

**6. Technical-config forms**
- Minimise required fields; mark required vs optional with one consistent convention.
- Pre-fill smart defaults so a valid object is creatable without expanding Advanced.
- Validate inline for progress scent, but never block submission on inline rules alone; focus the
  first error on submit.
- Multi-step only when genuinely sequential (project onboarding); single object creation (an agent)
  is one short form.

## Curated minimal starter library (built — Iteration 0)

Templates under `studio/starters/` (see `studio/starters/README.md` + ADR-033). Clean-room and
minimal: `brainAccess: none`, no composed forge skills, one default model (`claude-sonnet-4-6`),
the minimum tools per role. Validated by `orchestrator/studio/starters.test.ts`.

| Starter | Role | tools (catalog) | allowed-tools |
|---|---|---|---|
| `plan` | read code + request → write `plan.md` | — | Read, Grep, Glob, Write |
| `dev` | follow plan → make checks pass | git, node | Read, Grep, Glob, Edit, Write, Bash |
| `review` | check change → human verdict | gh | Read, Grep, Bash |
| `basic` flow | plan → dev → review (+ `verdict` gate) | — | — |

These pre-fill the "New Agent" / "New Flow" builders (J2/J3) and instantiate into live
`skills/<slug>/SKILL.md` and `studio/flows/<slug>/flow.yaml`.

## Per-journey acceptance checks (the gates)

Each journey's seeded Playwright walkthrough (extending `scripts/e2e-journey.mjs`) asserts, via
`data-*` DOM-as-metrics, at minimum:

- **J1 First run** — `forge studio` reaches `[data-page="library"][data-page-ready="true"]`; an
  orientation section renders with one working primary CTA (no greyed dead CTA); `forge init`
  scaffolds config + `_queue/` layout; preflight surfaces a missing `ANTHROPIC_API_KEY` as a
  friendly message, not a blank page.
- **J2 Agents** — library "+ New Agent" opens a starter picker → builder shows required-only with
  Advanced collapsed; saving 3 agents writes `skills/{plan,dev,review}/SKILL.md`; `forge studio
  lint` green; `[data-dirty]`→saved transitions captured.
- **J3 Flow** — "+ New Flow" → canvas seeded from `basic`; connect plan→dev→review + gate; node
  positions persist across reload; `forge studio lint` green; `[data-can-start="true"]`.
- **J4 Project** — "+ New Project" → required-only onboarding writes `studio/projects.yaml` +
  `.forge/project.json`; `ContractReadiness` green; advanced clauses collapsed.
- **J5 Give work** — idea → architect interview → plan gate → autonomous run on the **authored**
  flow → verdict → reflect; full phase-hex + per-phase-cost + gate-surface asserts; seeded state
  cleaned up.
- **J6 Sweep** — `scripts/e2e-deadpaths.mjs` clicks every nav item + enabled button across all
  routes; zero no-ops/404s/disabled-primary-CTAs on two consecutive runs; advanced-config-hidden
  audit complete across RuntimePicker, ReviewVerdictForm, DemoTimeline, SkillsBind, FlowHeader.

## Sources

NN/g (empty states, onboarding tutorials, progressive disclosure, required fields); Carbon Design
System (empty states); Smashing Magazine (hidden-vs-disabled 2024, disabled-buttons 2021); UX
Magazine / Balsamiq / uxmovement (one primary CTA, placement); Amplitude / daily.dev (TTFV &
activation, Stripe/Vercel benchmarks); setproduct, Candu (empty-state & checklist patterns).
