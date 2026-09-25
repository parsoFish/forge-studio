---
name: tf-acceptance-test-author
description: Author a TF_ACC live-acceptance test for a betterado resource/data-source — apply against real ADO, assert via a provider read-back, prove idempotency with a re-plan, and capture live REST evidence before a clean destroy. Use whenever a cycle ships or changes live ADO behaviour; an offline gomock gate cannot catch live-only failures.
when_to_use: Any cycle whose change touches a live ADO resource or data source (the C7 live-acceptance WI + the "Live acceptance" / "Live evidence" standing ACs).
tier: sonnet
---

# tf-acceptance-test-author — live-acceptance test recipe

## Purpose

The merge decision for a live-ADO change must be backed by a real acceptance test,
not an offline mock. An offline gomock gate is blind to live-only failures (e.g.
`ConfigMode: SchemaConfigModeAttr` making nested attributes required at apply).
This skill authors the `TestAcc*` test that proves the change against the real org.

## When to use

- A new `betterado_*` resource or data source ⇒ a new `TestAcc<Name>`.
- A change to an existing one ⇒ an updated `TestAcc<Name>`.
- The C7 live-acceptance WI (whose `quality_gate_cmd` targets the acceptance suite).

## The required test shape

Tests live in `azuredevops/internal/acceptancetests/`. Each test:

1. **PreCheck** — `testutils.PreCheck(t, nil)` (asserts `TF_ACC`,
   `AZDO_ORG_SERVICE_URL`, `AZDO_PERSONAL_ACCESS_TOKEN`; a missing var is a
   `t.Fatal`, never a silent skip).
2. **Non-default fixture** — write the HCL config with NON-default values (a UUID
   name prefix, explicit retention, explicit approvals) so the read-back asserts
   real round-tripping, not schema defaults.
3. **Apply + read-back** — a `resource.TestStep` whose `Check` uses
   `resource.TestCheckResourceAttr` against the provider's own read (state ⇒ API ⇒
   state), covering every new/changed attribute.
4. **Idempotency** — a follow-up plan-only step with `ExpectNonEmptyPlan: false`
   (a perpetual diff is a flatten/expand bug).
5. **Import verify** — `ImportState: true` + `ImportStateVerify: true` where the
   resource supports import.
6. **Clean destroy** — a `CheckDestroy` that confirms the object is gone (404 ⇒
   deleted). `t.Cleanup` / `CheckDestroy` tear down on success AND failure so a
   killed run doesn't leak the fixture (`make sweep` is the backstop).

## Live evidence (mandatory for the demo)

During the live read-back, BEFORE destroy, call
`_ = testutils.CaptureLiveEvidence(label, url, apiResponse)` (template:
`resource_task_group_test.go` `captureTaskGroupEvidence`) so
`.forge/live-evidence/<label>.json` is written and `forge demo render` back-fills
it into `demo.json`. Use label `acceptance-resource-<type>` with the resource's
short type name (e.g. `acceptance-resource-azurerm`, `acceptance-resource-dashboard`)
— evidence files are keyed by label, so a shared label means each capture
OVERWRITES the previous one and a multi-resource initiative ships evidence for
only its last-run resource. The demo compiler picks up every
`.forge/live-evidence/*.json`; unmatched labels surface as extra harness
checkpoints, so per-type labels lose nothing. For release resources, build the
**vsrm-host** GET URL with the release client (release API lives on
`vsrm.dev.azure.com`, not `dev.azure.com`).

## Gotchas (paid for in prior cycles)

- Two API hosts: core `dev.azure.com`, release `vsrm.dev.azure.com`. Build the
  evidence URL from the right client.
- Stale-revision update returns HTTP 400 (not 409) — `InvalidRequestException`,
  "old copy of the release pipeline". Update must re-read + retry once.
- 404 in Read ⇒ `d.SetId("")` + nil, never an error (external delete).
- Only `_test.go` files carry a `//go:build` tag; the production `.go` carries none.
- `provider_test.go`'s resource-count list must include any new resource.

## Run

`TF_ACC=1 go test -tags all -run TestAcc<Name> ./azuredevops/internal/acceptancetests/...`
(the serve env sets `TF_ACC` + creds from `secrets.env`).

## Done when

The `TestAcc*` applies, asserts every new/changed attribute via read-back, re-plans
clean (`ExpectNonEmptyPlan: false`), captures live evidence with a real GET URL,
and destroys cleanly — and the WI's `quality_gate_cmd` is the live acceptance
command.
