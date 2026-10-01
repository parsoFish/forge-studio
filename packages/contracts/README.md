# @forge/contracts

Browser-safe types and constants only — the studio object model, the manifest
and run-view shapes, and the small vocabulary constants (trigger kinds, agent
bands, spend ceilings, work-item statuses) every other package and the UI
share. It is the bottom rank of the allow-graph:

`contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows ← stations ← factory ← apps/{forge, studio}`

Rank 0: it imports no other forge package, and it is the ONE package
`apps/studio` may import — anything a browser-bundled component needs has to
be reachable from here or it cannot reach the browser at all.

## API (124 values)

| the Studio object model — agents (composition, runtime, budgets, fanout) | `BrainAccess` · `ModelStrategy` · `AgentComposition` · `AgentRuntime` · `AgentBudgets` · `AgentFanout` · `FANOUT_ISOLATION_KINDS` · `AgentDefinition` |
| the Studio object model — flows, triggers & kickoff | `FlowNode` · `FlowEdge` · `TriggerTarget` · `WebhookTriggerConfig` · `TRIGGER_MODES` · `TriggerMode` · `FlowTrigger` · `FLOW_KICKOFF_KINDS` · `FlowKickoffKind` · `FlowKickoff` · `FlowReview` · `FlowDefinition` |
| the Studio object model — artifact templates | `ARTIFACT_KINDS` · `ArtifactKind` · `ArtifactTemplateSchema` · `ArtifactTemplate` |
| the Studio object model — instruction seeds | `INSTRUCTION_SEED_KINDS` · `InstructionSeedKind` · `INSTRUCTION_SEED_SCOPES` · `InstructionSeedScope` · `InstructionSeed` |
| the Studio object model — KB descriptors | `KB_BACKENDS` · `KbBindingKind` · `KB_BINDING_KINDS` · `KbBinding` · `KbProcessImpl` · `KB_READ_SURFACES` · `KbReadSurface` · `KB_READER_ROLES` · `KbReaderRole` · `KbUsagePolicy` · `KbProcesses` · `KbDescriptor` |
| the Studio object model — catalog (sdks/models/tools/mcps/guards) | `CatalogSdk` · `CatalogModel` · `CatalogEntry` · `CatalogGuardKind` · `CatalogGuardEntry` · `CatalogInstallMethod` · `CatalogProbeSpec` · `CatalogConfigVar` · `CatalogCapability` · `CatalogConnectionEntry` · `Catalog` |
| the Studio object model — community skill/hook/mcp/tool registry | `CommunitySkill` · `COMMUNITY_REGISTRY_KINDS` · `CommunityRegistryKind` · `CommunityRegistrySignals` · `CommunityRegistryItem` · `CommunityRegistrySource` · `CommunityRegistry` |
| the Studio object model — demo & release process declarations | `DEMO_STEP_KINDS` · `DemoStepKind` · `DemoStep` · `DemoElementDefinition` · `RELEASE_STEP_KINDS` · `ReleaseStepKind` · `RELEASE_STEP_PHASES` · `ReleaseStepPhase` · `ReleaseStep` · `ReleaseConfig` · `BuildProcess` |
| the Studio object model — projects | `ProjectDefinition` · `ProjectRef` |
| the initiative manifest shape | `ManifestPhase` · `InitiativeOrigin` · `ManifestClass` · `InitiativeManifest` |
| the runnable-source rule — whether `enqueueFlowRun` may claim a manifest | `DEVELOP_FLOW_ID` · `isRunnableSource` |
| the run view's wire shape | `RunStatus` · `RunPhaseStatus` · `RunPhaseMeta` · `Run` |
| the demo declaration's pure extraction rules | `SHELL_METACHARACTERS` · `inlineCodeSpan` · `DrivableCommandResult` · `extractDrivableCommand` · `DeclarationDriveResult` · `declarationDrivesCheckpoint` · `isSafeDemoRoute` · `RouteExtraction` · `extractDemoRoute` · `PRESENTATION_ONLY_SKILL_IDS` · `PresentationOnlySkillId` |
| work-item status vocabulary | `WorkItemStatus` · `WORK_ITEM_STATUSES` |
| work-item id patterns (`WI-`/`UWI-`, the split-suffix rule) + numeric stem | `WORK_ITEM_ID_PATTERN` · `WORK_ITEM_FILE_PATTERN` · `DEV_WORK_ITEM_ID_PATTERN` · `devWorkItemIdStem` |
| trigger payloads — the owner/repo full-name validator | `REPO_RE` |
| trigger-kind registry (ADR 041) | `TRIGGER_KINDS` · `TriggerKindId` · `TRIGGER_KIND_IDS` · `SHIPPED_TRIGGER_KIND_IDS` |
| onboarding session-stage vocabulary + the contract-stage report row | `SESSION_STAGES` · `SessionStage` · `ContractStageStatus` · `ContractStage` · `ContractStageRow` |
| agent-band / guard vocabulary (ADR 039) | `BAND_GUARD_IDS` · `BandGuardId` · `TOGGLE_GUARD_IDS` · `PLATFORM_GUARD_IDS` |
| spend ceilings | `DEFAULT_KICKOFF_COST_CEILING_USD` · `MAX_KICKOFF_COST_CEILING_USD` |
| the fixed bridge port (ADR 031) | `DEFAULT_BRIDGE_PORT` |
| KB drain round cap | `KB_DRAIN_MAX_ROUNDS` |
| upload-materials vocabulary | `MATERIAL_KINDS` · `MaterialKind` |
| cycle outcome | `CycleOutcome` |
| failure-signature prefixes `failure-classifier.ts` scans for | `COST_CEILING_MESSAGE_PREFIX` · `OPERATOR_STOP_MESSAGE_PREFIX` · `PM_ACCEPTANCE_GATE_UNRESOLVED_PREFIX` · `ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX` |

`design.md` documents two of the above in more depth: why `runnable-source.ts`'s
claim rule lives here and is deliberately importless (a real bug — three UI
surfaces each hand-re-derived the rule and drifted the same way, missing a
legitimate hand-off case); and why `Run.costUsd`, `Run.workItems[].costUsd`
and `Run.trigger.kind` are typed looser than the server's own derivation,
resolved toward what the wire genuinely produces rather than a narrower type
two hand-mirrored declarations had only coincidentally agreed on.

## Crash and recovery

Contracts holds no state and performs no I/O. `grep` across all six source
files (`index.ts`, `studio-types.ts`, `manifest-types.ts`,
`runnable-source.ts`, `run-view-types.ts`, `demo-declaration.ts`) for
`node:fs`, `node:path`, `node:child_process`, `node:net`, `node:http`,
`node:https`, `node:os`, `node:crypto`, `node:stream`, or a bare `require(`
finds nothing. The only cross-file import anywhere in the package is a
type-only one (`studio-types.ts` imports the `ManifestClass` type from
`manifest-types.ts`). Every export is a plain type, a frozen array/const, or a
pure function over its arguments (`isRunnableSource`, `inlineCodeSpan`,
`extractDrivableCommand`, `declarationDrivesCheckpoint`, `isSafeDemoRoute`,
`extractDemoRoute`) — none of them touch a filesystem, a socket, or a child
process, so there is nothing here that writes state and nothing to recover.
