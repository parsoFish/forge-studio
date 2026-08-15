---
title: Background work is server-owned; the client only ever observes it
description: Every multi-step operator intent that outlives one request is a server-minted runId backed by on-disk status, reconstructed by GET — never client-held state. The client is a pure poller rendering exactly three states (watching / timed-out-but-running / terminal); nav-away must never lose work, and silence must never be a state. The identical bounded-poll defect recurred four times before W6-B14 closed the class.
category: decision
keywords: [background-work, server-owned-state, pure-observer, three-state-poll, timed-out-not-failed, reattach-on-mount, pollUntilTerminal, fixAllAgent, nav-away-safe, bounded-poll-loop]
created_at: 2026-08-15
updated_at: 2026-08-15
related_themes: [derived-never-stored-run-model, journey-never-gate-on-async-lagging-ui-display]
---

# Background work is server-owned; the client only ever observes it

Any operator action dispatching work that outlives one HTTP request — an agent turn, a drain, a
consolidate, an onboarding session — mints its identity SERVER-SIDE and persists progress ON DISK,
keyed by that runId. The client never holds the work; it only asks "what is runId X's state right
now" and renders the answer. Get this backwards — runId in component state only, poll loop inside
the dispatching click handler — and the work becomes invisible the moment the tab changes, even
though it is still running.

## The three visible states

- **watching** — still running, being observed.
- **timed-out-but-running** — the POLL gave up; the WORK almost certainly has not. Render a
  re-check affordance, never a fabricated terminal.
- **terminal** — a real done/cleared/failed/etc outcome the server actually observed.

Silence is never a fourth state. A poll that exhausts its budget and just stops, leaving the
last-seen `'running'` on screen forever, is indistinguishable from success to an operator not
staring at it — `LintResolutionPanel.tsx`'s `fixAllAgent` (deleted W6-B13): dispatch one turn per
finding, poll each IN THE BROWSER, dying silently on nav-away with zero server-side trace of "was
this ever finished."

## The fix shape, and the defect found four times

`KbDrainPanel.tsx` (W6-B13) is the model: dispatch mints a runId, `_logs/_kb-drain-<runId>/
status.json` is the single source of truth, and MOUNTING always reattaches via
`fetchActiveOrLatestKbDrain` first — never assumes a fresh, run-less state. `pollUntilTerminal`
(`lib/agent-dispatch.ts`) is the one shared core: fetch immediately, then on interval while running,
until a real terminal arrives or the budget exhausts — `onTimeout` fires with the LAST REAL status
observed, never a guess. The identical bounded-poll-with-silent-give-up shape then recurred
independently in `RunPanel.tsx`, `OnboardWithAgent`, KB consolidate, and
`ContractResolutionPanel.tsx`'s user-tier submit (W6-B14) — each a hand-rolled loop `await`ed
directly inside a click handler. Two reopens of one class is the stop-and-fix-the-class signal
([[journey-never-gate-on-async-lagging-ui-display]]); four is a rule. Reattach-on-mount is added
wherever a server-side "active/latest" GET exists cheaply — adding one where none existed
(`GET .../consolidate/active`, `GET .../onboarding/active`) is itself the fix when the alternative
is a client that forgets its own runId.

## The rule a planner/reviewer applies

Before shipping a dispatch+poll surface: (1) does a GET reconstruct full state from disk alone, no
client-held field required? (2) does mounting reattach rather than assume idle? (3) exactly three
renderable states, `timed-out` distinct from `terminal`? A "no" anywhere is
[[derived-never-stored-run-model]]'s sibling defect at the LIFECYCLE layer — the run's own
EXISTENCE must be re-derivable server-side, never authored only in a closure.

## See also

- [[derived-never-stored-run-model]] — the value-derivation half of this posture; this theme is its lifecycle/reattach half.
- [[journey-never-gate-on-async-lagging-ui-display]] — the two-reopen-stop applied to the poll-loop class itself.
