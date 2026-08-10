# `studio/artifact-templates/` — the canonical artifact set

The **planning** category of the Studio templates library (R3-06): every artifact a
`FlowEdge.artifact` label can name, documented as gray-matter markdown — `id` (matching the
edge label), `name`, `kind` (`file | git-state`), optional `producer`/`consumer`, a `schema`
block (`requiredFiles` / `requiredFields` / `gitInvariants`), and a prose contract body. Loaded
by `orchestrator/studio/registry.ts`'s `loadArtifactTemplate` / `listArtifactTemplates`;
validated by `validateArtifactTemplate` (`orchestrator/studio/validate.ts`). Surfaced in the
Studio UI at `/templates` (category `planning`) and `/templates/[id]`, alongside
`studio/demo-elements/` (`demo-output`) and `studio/starters/projects/` (`project-scaffold`) —
see `orchestrator/studio/template-library.ts` for the unifying registry.

## The 8 templates

| id | name | kind | producer → consumer | edge-backed? |
|---|---|---|---|---|
| `plan` | Plan | file | architect → project-manager | yes — `forge-architect` (`architect→pm`) |
| `work-items` | Work Items | file | project-manager → developer-ralph | no — orchestrator-band re-entry |
| `wi-branches` | WI Branches | git-state | developer-ralph → demo-agent | yes — `forge-develop` (`dev→demo`) |
| `pr` | Pull Request | file | demo-agent → adversarial-review | yes — `forge-develop` (`demo→adversarial-review`) |
| `review-findings` | Review Findings | file | adversarial-review → review | yes — `forge-develop` (`adversarial-review→review`) |
| `verdict` | Verdict | file | review → reflector | no — orchestrator-band re-entry |
| `demo-fix-spec` | Demo Fix Spec | file | demo-agent → developer-ralph | no — orchestrator-band re-entry |
| `contract` | Contract | file | onboarding-agent → contract-check | yes — `onboard-project` (`onboard→contract-check`) |

**Edge-backed** means the artifact is the declared `artifact:` label on a real edge in one of
the four seed flows (`studio/flows/*/flow.yaml`) — its producer/consumer can be
cross-validated against the flow graph's actual node topology
(`verifyTemplateEndpoints`, `orchestrator/studio/template-library.ts`), and the templates
library's `/templates/[id]` detail page renders `endpointsVerified: true` for it.

The three that are **not** edge-backed travel by **orchestrator-band re-entry** instead of a
DAG edge — a post-develop fix loop or the human verdict gate re-dispatches the existing
develop/review executor rather than the flow walking a literal edge to a "verdict" or
"work-items" node. Their producer/consumer are still real (the orchestrator code paths that
read/write them), but the claim can't be checked against flow-graph topology, so the detail
page renders `endpointsVerified: false` with an explanatory note rather than silently treating
the declaration as confirmed.

## Enforced: every `FlowEdge.artifact` must resolve to a registered template

`validateArtifactRef` (`orchestrator/studio/validate.ts`) is a **hard error** in
`forge studio lint` (promoted from advisory 2026-08-04, this initiative — R3-06/R2-05-F1): an
edge naming an artifact id with no `.md` file here fails lint. This is why the flow builder's
hardcoded `ARTIFACTS` catalog (`forge-ui/lib/flow-artifact-catalog.ts`) is pinned, in both
directions, to this directory's id set by a CI-enforced parity test
(`forge-ui/lib/flow-artifact-catalog.test.ts`) — a template added or removed here without that
list following is a red CI run, not a silent drift.

Adding another template means: a new `.md` file here (gray-matter frontmatter + contract body),
a lint pass (`forge studio lint`), and — if it is meant to be pickable from the flow builder's
ArtifactPicker — an entry added to `ARTIFACTS` in the same PR (the parity test will otherwise
fail red, which is the point).
