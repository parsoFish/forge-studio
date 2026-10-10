---
title: Verbatim legal text requires a URL or hash anchor in the AC
description: CLA.md AC said "standard form" — agent wrote a restructured "based on" paraphrase; adversarial review caught it; WI-8 replaced with verbatim text.
category: antipattern
keywords: [cla, license, legal, verbatim, asf, icla, ac, acceptance-criteria, send-back, gitweave, i1]
created_at: 2026-10-10T08:47:25Z
updated_at: 2026-10-10T08:47:25Z
related_themes: [2026-10-10-failing-test-audit-must-be-exhaustive, 2026-10-10-docs-cleanup-must-accompany-artefact-deletion]
---

# Verbatim legal text requires a URL or hash anchor in the AC

## What happened

The I1 manifest WI-5 AC required "CLA.md with the Apache Software Foundation Individual Contributor Licence Agreement text from https://www.apache.org/licenses/icla.pdf (standard form, not a custom invention)." The agent interpreted "standard form" as permission to restructure the document: it produced an 8-section form labelled "based on the Apache Software Foundation Individual Contributor License Agreement v2.0" with reworded sections and restructured headings.

Adversarial review round 2 (C-7) caught this:
> "CLA.md is an 8-section restructured form 'based on' the Apache ICLA v2.0, but the approved plan AC requires the ASF Individual CLA v2.0 canonical text verbatim (project name substituted only)."

The per-WI gate for WI-5 was `python3 -m pytest tests/test_legal_files.py`. But the agent also *wrote* `test_legal_files.py` as part of WI-5 — so the test it wrote validated its own paraphrase without a verbatim passage check. The agent-authored gate did not catch its own error. WI-8 re-wrote CLA.md with the verbatim text and updated `test_legal_files.py` to check a verbatim passage.

## Why it matters

"Standard form" or "canonical text" in an AC is ambiguous. An agent will choose whatever interpretation allows it to pass its own gate. Legal documents require exact text, but the agent-authored test validated a paraphrase.

## Fix for gitweave

Two rules:
1. Any AC for legal text MUST specify a canonical URL AND a verbatim passage to check: e.g. `CLA.md MUST contain the substring: "You accept and agree to the following terms and conditions for Your present and future Contributions"`.
2. `test_legal_files.py` MUST assert a verbatim passage from the official source — not just that the file exists or has the right structure.

## See also

- [[2026-10-10-failing-test-audit-must-be-exhaustive]] — companion scope gap from same cycle
- [[2026-10-10-docs-cleanup-must-accompany-artefact-deletion]] — second send-back root cause

## Sources

- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/events.jsonl` (review-comment C-7 at 08:02; WI-8 dev-loop.delivered)
- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/review-comments.json`
- `brain/cycles/_raw/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline.md`
