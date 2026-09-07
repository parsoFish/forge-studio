# Licensing

Forge is distributed under the **GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later)**, as declared in `package.json` (`"license":
"AGPL-3.0-or-later"`). This document explains what that means in practice.

It deliberately does **not** carry a dependency-license audit table. A
point-in-time table of installed packages and their licenses is regenerable
from `package.json` — it's stale the moment a dependency version bumps — and
the campaign's no-new-dependency rule (every new external dependency parks
for a ruling; see `CLAUDE.md`) keeps the actual dependency set small enough
that an operator can read `package.json` directly rather than a curated
summary of it. If you need to know what's installed and under what license,
`package.json` plus each package's own `LICENSE` file is the source of
truth; nothing here should substitute for reading them.

## What AGPL-3.0 means for you

The AGPL is the GPL plus one extra obligation that matters specifically for
*networked* software. Forge is exactly the kind of software the AGPL was written
for: an operator runs it as a service (the daemon + the Studio operator UI over
the bridge), and the value is in *how the gates and flows are wired*, not just in
the binary you can download.

### The core copyleft bargain

- Forge is free software: anyone may run, study, modify, and redistribute it.
- If you **distribute** Forge (modified or not), you must offer the complete
  corresponding **source** under the same AGPL-3.0 terms.
- AGPL's distinguishing clause (**section 13**): if you **run a modified Forge and
  let users interact with it over a network**, those remote users must be offered
  the corresponding source of *your* modified version. Internal-only use without
  external network users does not trigger section 13, but distribution still does.

### For operators (self-hosting)

- **Self-hosting for your own use is unrestricted.** Running Forge — even a
  modified copy — to build your own projects creates no obligation on its own.
- **The moment you expose a modified Forge to other people over a network**
  (a hosted Studio, a multi-tenant deployment, an internal service other users
  drive), section 13 kicks in: you must make your modified source available to
  those users.
- This is the clause that **protects the "gates you can read" claim**
  (see `brain/forge-dev/themes/studio-differentiation-and-subsumption-moat.md`): Forge's differentiation
  is code-enforced quality gates an operator can inspect and trust. The AGPL
  guarantees that a hosted derivative cannot quietly fork those gates, weaken them,
  and ship the result as a black box — the source of the gates a network user is
  subjected to stays open to that user. The reviewable gate *is* the product, and
  copyleft keeps it reviewable downstream.

### For contributors

- Contributions are accepted under AGPL-3.0-or-later. By contributing you agree
  your changes ship under the same license.
- You may freely build on the codebase; derivative works inherit the AGPL.
- Keep the dependency set AGPL-compatible: the permissive licenses forge's
  runtime and dev dependencies use today (MIT, ISC, Apache-2.0, BSD) are all
  one-way compatible with the GPL family, so they combine cleanly into an
  AGPL-3.0 work. A dependency under an incompatible license — plain
  GPL-2.0-only, or a proprietary/no-redistribution license linked into the
  distributed artifact — would make the combined work undistributable, which
  is one more reason a new dependency parks for a ruling rather than landing
  on review alone.

### For end users / downstream redistributors

- You receive the four freedoms (run, study, modify, share).
- If you pass Forge on, or operate a modified copy as a network service, you must
  pass on the source under AGPL-3.0 too. No additional restrictions may be layered
  on top ("further restrictions" are void under GPL/AGPL §7).

## The one dependency that isn't open source

`@anthropic-ai/claude-agent-sdk` ships under Anthropic's own proprietary
terms (`package.json`'s `license` field points at Anthropic's legal &
compliance terms, not an SPDX open-source license) — the one dependency in
the tree that isn't OSS. That does **not** break Forge's AGPL-3.0
distribution:

- Forge **depends on** the SDK as a separately-installed npm package; it does
  not embed or redistribute Anthropic's SDK source inside the Forge
  repository. Forge ships its own AGPL source; the SDK is fetched from npm by
  the operator under Anthropic's own terms — the same relationship AGPL
  software has with a proprietary OS, driver, or cloud SDK the user installs
  separately.
- The SDK is reached through the `RuntimeAdapter` seam
  (`packages/agents/_adapters/`, [ADR 029](../decisions/029-runtime-adapters.md)),
  and that seam exists precisely so the runtime substrate is swappable for an
  OSS alternative — it's what keeps Forge from being permanently hard-bound
  to one proprietary component.

Caveat for redistributors: don't vendor or re-publish the SDK's own source
under AGPL terms — it isn't yours to relicense. Operators accept Anthropic's
terms to use the default runtime adapter; a fully-OSS stack means routing
through one of the seam's other adapters instead.

## Conclusion

Forge's own source ships AGPL-3.0-or-later. Its dependency set is kept small
by the no-new-dependency rule and, as far as it's exercised, permissively
licensed (MIT / Apache-2.0 / BSD) — all one-way compatible with AGPL-3.0
distribution. The one proprietary dependency, the Claude Agent SDK, is a
separately-installed runtime component reached through a swappable seam
rather than embedded source, so it doesn't impair Forge's own AGPL-3.0
distribution — but redistributors can't relicense it, and operators accept
Anthropic's terms to use it. If you need the exact installed set and its
licenses at a point in time, read `package.json` and each package's own
`LICENSE` file directly rather than a table here.
