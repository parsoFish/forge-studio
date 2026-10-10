# @forge/contracts

Browser-safe types and constants only — the studio object model, the manifest
and run-view shapes, and the small vocabulary constants (trigger kinds, agent
bands, spend ceilings, work-item statuses) every other package and the UI
share. It is the bottom rank of the allow-graph:

`contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows ← stations ← factory ← apps/{forge, studio}`

Rank 0: it imports no other forge package, and it is the ONE package
`apps/studio` may import — anything a browser-bundled component needs has to
be reachable from here or it cannot reach the browser at all.

## API (51 values)

| agent fanout isolation kinds | `FANOUT_ISOLATION_KINDS` |
| flow trigger & kickoff vocabulary | `TRIGGER_MODES` · `FLOW_KICKOFF_KINDS` |
| artifact-template vocabulary | `ARTIFACT_KINDS` |
| instruction-seed vocabulary | `INSTRUCTION_SEED_KINDS` · `INSTRUCTION_SEED_SCOPES` |
| KB descriptor vocabulary | `KB_BACKENDS` · `KB_BINDING_KINDS` · `KB_READ_SURFACES` · `KB_READER_ROLES` |
| community registry vocabulary | `COMMUNITY_REGISTRY_KINDS` |
| demo & release-process vocabulary | `DEMO_STEP_KINDS` · `RELEASE_STEP_KINDS` · `RELEASE_STEP_PHASES` |
| the runnable-source rule — whether enqueueFlowRun may claim a manifest | `DEVELOP_FLOW_ID` · `isRunnableSource` |
| the ONE project-readiness rule — Studio shows it, the claim gate enforces it (SPEC §6) | `projectReadiness` |
| the ONE Kickoff-gate rule — the run model derives it, the develop enqueue refuses on it | `KICKOFF_SOURCE_FLOW_ID` · `isAwaitingKickoff` · `kickoffBuiltReason` |
| the demo declaration's pure extraction rules | `SHELL_METACHARACTERS` · `inlineCodeSpan` · `extractDrivableCommand` · `declarationDrivesCheckpoint` · `resolveDeclaredBin` · `isSafeDemoRoute` · `extractDemoRoute` · `PRESENTATION_ONLY_SKILL_IDS` |
| pseudo-project session anchors | `COMMUNITY_REFRESH_PROJECT_ANCHOR` · `isPseudoProjectAnchor` |
| work-item status vocabulary | `WORK_ITEM_STATUSES` |
| work-item id patterns (`WI-`/`UWI-`, the split-suffix rule) + numeric stem | `WORK_ITEM_ID_PATTERN` · `WORK_ITEM_FILE_PATTERN` · `DEV_WORK_ITEM_ID_PATTERN` · `devWorkItemIdStem` |
| trigger payloads — the owner/repo full-name validator | `REPO_RE` |
| trigger-kind registry (D-23) | `TRIGGER_KINDS` · `TRIGGER_KIND_IDS` · `SHIPPED_TRIGGER_KIND_IDS` |
| onboarding session-stage vocabulary | `SESSION_STAGES` |
| agent-band / guard vocabulary (SPEC §1) | `BAND_GUARD_IDS` · `TOGGLE_GUARD_IDS` · `PLATFORM_GUARD_IDS` |
| spend ceilings | `DEFAULT_KICKOFF_COST_CEILING_USD` · `MAX_KICKOFF_COST_CEILING_USD` |
| the fixed bridge port (D-12) | `DEFAULT_BRIDGE_PORT` |
| KB drain round cap | `KB_DRAIN_MAX_ROUNDS` |
| upload-materials vocabulary | `MATERIAL_KINDS` |
| failure-signature prefixes failure-classifier.ts scans for | `COST_CEILING_MESSAGE_PREFIX` · `OPERATOR_STOP_MESSAGE_PREFIX` · `PM_ACCEPTANCE_GATE_UNRESOLVED_PREFIX` · `ARCHITECT_DRAFT_MANIFEST_UNRESOLVED_PREFIX` |

### Types (85)

`AgentBudgets` · `AgentComposition` · `AgentDefinition` · `AgentFanout` ·
`AgentRuntime` · `ArtifactKind` · `ArtifactTemplate` · `ArtifactTemplateSchema` ·
`BandGuardId` · `BrainAccess` · `BuildProcess` · `Catalog` · `CatalogCapability` ·
`CatalogConfigVar` · `CatalogConnectionEntry` · `CatalogEntry` ·
`CatalogGuardEntry` · `CatalogGuardKind` · `CatalogInstallMethod` ·
`CatalogModel` · `CatalogProbeSpec` · `CatalogSdk` · `CommunityRegistry` ·
`CommunityRegistryItem` · `CommunityRegistryKind` · `CommunityRegistrySignals` ·
`CommunityRegistrySource` · `CommunitySkill` · `ContractStage` ·
`ContractStageRow` · `ContractStageStatus` · `CycleOutcome` ·
`DeclarationDriveResult` · `DeclaredBinResult` · `DemoElementDefinition` · `DemoStep` ·
`DemoStepKind` · `DrivableCommandResult` · `FlowDefinition` · `FlowEdge` ·
`FlowKickoff` · `FlowKickoffKind` · `FlowNode` · `FlowReview` · `FlowTrigger` ·
`InitiativeManifest` · `InitiativeOrigin` · `InstructionSeed` ·
`InstructionSeedKind` · `InstructionSeedScope` · `KbBinding` ·
`KbBindingKind` · `KbDescriptor` · `KbProcessImpl` · `KbProcesses` ·
`KbReadSurface` · `KbReaderRole` · `KbUsagePolicy` · `ManifestClass` ·
`ManifestPhase` · `MaterialKind` · `ModelStrategy` · `PresentationOnlySkillId` ·
`ProjectDefinition` · `ProjectReadiness` · `ProjectReadinessInput` · `ProjectRef` ·
`ReadinessCheck` · `ReadinessCheckId` · `ReadinessClause` · `ReleaseConfig` · `ReleaseStep` ·
`ReleaseStepKind` · `ReleaseStepPhase` · `RouteExtraction` · `Run` ·
`RunPhaseMeta` · `RunPhaseStatus` · `RunStatus` · `SessionStage` ·
`TriggerKindId` · `TriggerMode` · `TriggerTarget` · `WebhookTriggerConfig` ·
`WorkItemStatus`

`design.md` documents two of the above in more depth: why `runnable-source.ts`'s
claim rule lives here and is deliberately importless (a real bug — three UI
surfaces each hand-re-derived the rule and drifted the same way, missing a
legitimate hand-off case); and why `Run.costUsd`, `Run.workItems[].costUsd`
and `Run.trigger.kind` are typed looser than the server's own derivation,
resolved toward what the wire genuinely produces rather than a narrower type
two hand-mirrored declarations had only coincidentally agreed on.

## Crash and recovery

Contracts holds no state and performs no I/O. `grep` across all seven source
files (`index.ts`, `studio-types.ts`, `manifest-types.ts`, `project-readiness.ts`,
`runnable-source.ts`, `run-view-types.ts`, `demo-declaration.ts`) for
`node:fs`, `node:path`, `node:child_process`, `node:net`, `node:http`,
`node:https`, `node:os`, `node:crypto`, `node:stream`, or a bare `require(`
finds nothing. The only cross-file import anywhere in the package is a
type-only one (`studio-types.ts` imports the `ManifestClass` type from
`manifest-types.ts`). Every export is a plain type, a frozen array/const, or a
pure function over its arguments (`isRunnableSource`, `inlineCodeSpan`,
`extractDrivableCommand`, `declarationDrivesCheckpoint`, `resolveDeclaredBin`, `isSafeDemoRoute`,
`extractDemoRoute`) — none of them touch a filesystem, a socket, or a child
process, so there is nothing here that writes state and nothing to recover.
