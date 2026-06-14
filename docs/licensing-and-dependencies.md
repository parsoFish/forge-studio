# Licensing & Dependencies

Forge is distributed under the **GNU Affero General Public License v3.0 or later
(AGPL-3.0-or-later)**, as declared in `package.json` (`"license":
"AGPL-3.0-or-later"`). This document explains what that means in practice and
records a license audit of Forge's dependency tree.

---

## Part A — What AGPL-3.0 means for you

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
  (see `docs/forge-studio-market-and-differentiation.md`): Forge's differentiation
  is code-enforced quality gates an operator can inspect and trust. The AGPL
  guarantees that a hosted derivative cannot quietly fork those gates, weaken them,
  and ship the result as a black box — the source of the gates a network user is
  subjected to stays open to that user. The reviewable gate *is* the product, and
  copyleft keeps it reviewable downstream.

### For contributors

- Contributions are accepted under AGPL-3.0-or-later. By contributing you agree
  your changes ship under the same license.
- You may freely build on the codebase; derivative works inherit the AGPL.
- Keep the dependency set AGPL-compatible (see the audit below) — adding a dep
  under an incompatible license would make the combined work undistributable.

### For end users / downstream redistributors

- You receive the four freedoms (run, study, modify, share).
- If you pass Forge on, or operate a modified copy as a network service, you must
  pass on the source under AGPL-3.0 too. No additional restrictions may be layered
  on top ("further restrictions" are void under GPL/AGPL §7).

---

## Part B — Dependency license audit

Audit method: read `package.json`, then read the `license` field of each
installed dependency's `node_modules/<pkg>/package.json` (and the package's
`LICENSE`/`LICENSE.md` where the field was non-SPDX). Versions are the resolved
installed versions at audit time.

### AGPL-3.0 compatibility primer

The permissive licenses below (**MIT**, **ISC**, **Apache-2.0**, **BSD**) are all
**one-way compatible with the GPL family**: you may combine them into an
AGPL-3.0 work. Apache-2.0 is compatible with GPLv3/AGPLv3 specifically (it was
*not* compatible with GPLv2, but Forge is v3). None of these are copyleft in a way
that conflicts with AGPL distribution. A problem would only arise from a dependency
that is itself **strong copyleft under an incompatible license** (e.g. plain
GPL-2.0-only, or a proprietary/no-redistribution license linked into the
distributed artifact).

### Runtime dependencies

| Package | Version | License | AGPL-compatible? |
| --- | --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.1.77 | **Proprietary** — `LICENSE.md`: "© Anthropic PBC. All rights reserved." governed by Anthropic's [legal & compliance terms](https://code.claude.com/docs/en/legal-and-compliance) (the `package.json` field reads `"SEE LICENSE IN README.md"`) | **Flagged — see note 1** |
| `blessed-contrib` | 4.11.0 | MIT | Yes |
| `globby` | 14.1.0 | MIT | Yes |
| `gray-matter` | 4.0.3 | MIT | Yes |
| `js-yaml` | 4.2.0 | MIT | Yes |
| `proper-lockfile` | 4.1.2 | MIT | Yes |
| `ws` | 8.21.0 | MIT | Yes |

### Dev dependencies

| Package | Version | License | AGPL-compatible? |
| --- | --- | --- | --- |
| `@types/js-yaml` | 4.0.9 | MIT | Yes |
| `@types/node` | 22.19.17 | MIT | Yes |
| `@types/proper-lockfile` | 4.1.4 | MIT | Yes |
| `@types/ws` | 8.18.1 | MIT | Yes |
| `playwright-core` | 1.60.0 | Apache-2.0 | Yes |
| `typescript` | 5.9.3 | Apache-2.0 | Yes |

### Gated adapter dependencies (optional, not installed)

These back the M8 subsumption-proof drop-ins (ADR-032). They are
**dependency- and credential-gated** (`available: false` in `studio/catalog.yaml`)
and are **not present in `node_modules`** — they ship no code into Forge's
distributed artifact unless an operator opts in by installing them.

| Package | Backs | Published license (per registry; verify on install) | AGPL-compatible? |
| --- | --- | --- | --- |
| `@google/genai` | Gemini `RuntimeAdapter` (`loops/_adapters/gemini`) | Apache-2.0 | Yes |
| `@getzep/zep-cloud` | Zep `KbBackend` (`orchestrator/kb-backends/zep.ts`) | Apache-2.0 | Yes |

> The Aider drop-in invokes the **Aider CLI** as an external process rather than
> linking a library, so it is not a Node dependency in this tree (Aider itself is
> Apache-2.0). Codex is listed in the catalog as `available: false` with no bundled
> dependency.

### Note 1 — the one flagged license: `@anthropic-ai/claude-agent-sdk`

This is the only dependency that is **not open source**. Its `LICENSE.md` reads
"© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements"
at Anthropic's legal-and-compliance page — i.e. a **proprietary, all-rights-reserved**
license, not an SPDX OSS license.

Why this does **not** break AGPL distribution of Forge:

- Forge **depends on** the SDK as a separately-installed npm package; it does not
  **embed or redistribute** Anthropic's SDK source within the Forge repository.
  Forge ships its own AGPL source; the SDK is fetched from npm by the operator
  under Anthropic's own terms. This is analogous to AGPL software that talks to a
  proprietary OS, driver, or cloud SDK installed by the user.
- The SDK is the runtime substrate (the Claude Agent SDK), reached through the
  `RuntimeAdapter` seam (ADR-029) — and that seam exists precisely so the substrate
  is swappable for OSS alternatives (Gemini/Aider), which keeps Forge from being
  hard-bound to one proprietary component.

Action / caveat for redistributors: do **not** vendor or re-publish the SDK's
source under AGPL terms (you can't — it isn't yours to relicense). Operators must
accept Anthropic's terms to use the default Claude adapter. If a fully-OSS stack is
required, route the runtime through one of the OSS adapters once its deps/keys are
provisioned.

---

## Conclusion

The **installed** dependency set is **MIT** and **Apache-2.0** only — both fully
compatible with **AGPL-3.0** distribution; there is no GPL-incompatible or
conflicting-copyleft package in the tree. The single non-OSS component,
`@anthropic-ai/claude-agent-sdk` (proprietary, all-rights-reserved), is a
separately-installed runtime dependency rather than embedded source, so it does
not impair Forge's AGPL-3.0 distribution — but redistributors must not relicense it
and operators accept Anthropic's terms to use it. The gated Gemini/Zep adapter deps
(Apache-2.0, optional, not installed) are also AGPL-compatible. **The dependency set
is compatible with AGPL-3.0 distribution.**
