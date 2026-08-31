/**
 * Flow trigger validation (R2-04, ADR-041) — extracted from validate.ts so the
 * per-trigger checks don't push that file past the 800-line cap and can be
 * tested in isolation. Check ids match the design 1:1: trigger-kind,
 * trigger-kind-reserved, trigger-target, trigger-cron, trigger-webhook,
 * trigger-shape. Cross-flow webhook-id uniqueness is NOT checked here (a single
 * flow can't see its siblings) — it lives in cli/studio-lint.ts (check id
 * trigger-webhook-unique).
 */
import { Cron } from 'croner';

import { TRIGGER_KINDS, TRIGGER_KIND_IDS } from '../flow-trigger.ts';
import { resolveBandGuard } from '@forge/agents/agent-bands.ts';
import { TRIGGER_MODES } from '@forge/contracts/studio/types.ts';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';

export type TriggerFinding = {
  level: 'error';
  object: string;
  check: string;
  message: string;
};

function err(object: string, check: string, message: string): TriggerFinding {
  return { level: 'error', object, check, message };
}

// Derived from the registry (no duplicated literals) — rows with
// status:'reserved' are vocabulary-reserved but have no runtime yet.
const RESERVED_TRIGGER_KIND_IDS = new Set<string>(
  TRIGGER_KINDS.filter((k) => k.status === 'reserved').map((k) => k.id),
);

const WEBHOOK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const WEBHOOK_PROVIDERS = new Set(['github', 'gitea', 'gitlab']);
const SECRET_ENV_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * R2-08-F3: `pr-merged` / `issue-raised` reuse the SAME `webhook:` config
 * shape `on: webhook` uses (own `on:` value, per ADR-027's amendment — never
 * a sub-event under `on: webhook`), but each kind accepts only its OWN event
 * name — never a shared set, or a `webhook` trigger could silently declare
 * `events: [pull_request]` (a kind bridge-hooks.ts never resolves for it) and
 * lint would wave it through.
 */
const WEBHOOK_EVENTS_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = {
  webhook: new Set(['push', 'release']),
  'pr-merged': new Set(['pull_request']),
  'issue-raised': new Set(['issues']),
};
/** The `on:` kinds that carry the `webhook:` config block (R2-08-F3). */
const WEBHOOK_FAMILY_KIND_IDS = new Set(['webhook', 'pr-merged', 'issue-raised']);

/**
 * adversarial-review fix: `pr-merged`/`issue-raised` are GitHub-only by
 * ruled design (`cli/bridge-hooks.ts`'s `resolveEventName` only maps
 * `pull_request`/`issues` under `provider === 'github'` — gitea/gitlab stay
 * schema-reserved with zero stub handlers). Without a matching lint
 * restriction, a `provider: gitlab` (or `gitea`) declaration on either kind
 * was lint-clean yet structurally could never fire — a dead declaration an
 * operator could author with no warning. `on: webhook` keeps all three
 * providers (push/release ARE shipped for gitea/gitlab).
 */
const WEBHOOK_PROVIDERS_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = {
  webhook: WEBHOOK_PROVIDERS,
  'pr-merged': new Set(['github']),
  'issue-raised': new Set(['github']),
};

export type TriggerCheckOpts = {
  /** The full registered flow-id set — enables the target-flow existence check. */
  flowIds?: ReadonlySet<string>;
  /**
   * Resolve a flow's `project` binding by id. Enables the project-binding
   * requirement to be checked on the TARGET flow (the flow the mint actually
   * uses), not the declaring flow. Omitted callers (a single-flow PUT that
   * hasn't consulted the registry) skip that check; studio-lint, which sees
   * every flow, supplies it so the full check runs.
   */
  flowProjectOf?: (flowId: string) => string | null | undefined;
  /**
   * R2-08-F1: the full discovered-project id set (`discoverProjects`) —
   * enables the `trigger-projects` check (an unknown id in `projects:` is a
   * lint error). Mirrors `flowIds` exactly: omitted callers skip the check
   * (a single-flow PUT that hasn't consulted the registry), studio-lint
   * supplies it so lint reads the SAME evidence the dispatcher reads.
   */
  projectIds?: ReadonlySet<string>;
};

export function checkFlowTriggers(
  flow: FlowDefinition,
  agents: ReadonlyMap<string, AgentDefinition>,
  opts: TriggerCheckOpts | undefined,
): TriggerFinding[] {
  const findings: TriggerFinding[] = [];
  const obj = `flow:${flow.id}`;

  for (const trigger of flow.triggers) {
    // Defensive: a trigger reaching validate without a well-formed target
    // (e.g. a hand-crafted PUT body that bypassed parseFlowTrigger) is a
    // finding, never a TypeError on `trigger.target.kind`.
    if (!trigger.target || typeof trigger.target.kind !== 'string' || typeof trigger.target.ref !== 'string') {
      findings.push(err(obj, 'trigger-target', 'trigger is missing a well-formed "target: { kind, ref }"'));
      continue;
    }

    // trigger-kind: `on` must be a registry vocabulary member.
    if (!(TRIGGER_KIND_IDS as readonly string[]).includes(trigger.on)) {
      findings.push(
        err(
          obj,
          'trigger-kind',
          `Trigger "on" value "${trigger.on}" is not a known trigger kind — must be one of ${TRIGGER_KIND_IDS.join('|')}`,
        ),
      );
    }

    // trigger-kind-reserved: the kind is schema-reserved (no runtime yet).
    if (RESERVED_TRIGGER_KIND_IDS.has(trigger.on)) {
      findings.push(
        err(
          obj,
          'trigger-kind-reserved',
          `trigger kind '${trigger.on}' is schema-reserved (not yet shipped — see the owning roadmap item); declaring it has no runtime`,
        ),
      );
    }

    // trigger-target: a `flow` target must not self-loop and (when the caller
    // supplies the registered flow-id set) must reference a real flow; an
    // `agent` target must reference a real roster agent.
    if (trigger.target.kind === 'flow') {
      if (trigger.target.ref === flow.id) {
        findings.push(
          err(
            obj,
            'trigger-target',
            `Trigger target flow "${trigger.target.ref}" is this flow itself — a trigger cannot target its own flow (self-loop)`,
          ),
        );
      } else if (opts?.flowIds && !opts.flowIds.has(trigger.target.ref)) {
        findings.push(
          err(obj, 'trigger-target', `Trigger target flow "${trigger.target.ref}" is not a registered flow`),
        );
      }
    } else if (trigger.target.kind === 'agent') {
      const agentDef = agents.get(trigger.target.ref);
      if (!agentDef) {
        findings.push(
          err(obj, 'trigger-target', `Trigger target agent "${trigger.target.ref}" is not a known agent`),
        );
      } else if (trigger.on === 'merged' && resolveBandGuard(agentDef) !== 'reflection-close') {
        // R4-09-F1: an `on: merged` agent target is dispatched by
        // finalize-merged.ts ONLY when the agent declares the `reflection-close`
        // band (resolveMergeAgentHandler). Any other agent would silently land
        // in the loud unhandled-target branch and never run — so lint must
        // reject it here, mirroring the dispatch's own requirement (a gate must
        // use the same evidence as the path it backstops).
        findings.push(
          err(
            obj,
            'trigger-target',
            `Trigger target agent "${trigger.target.ref}" has no "reflection-close" band, so an "on: merged" trigger would never dispatch it — merge-time agent targets must be the reflect agent`,
          ),
        );
      }
    }

    // trigger-cron
    if (trigger.on === 'cron') {
      if (!trigger.schedule || !trigger.schedule.trim()) {
        findings.push(err(obj, 'trigger-cron', 'cron trigger requires a non-empty "schedule"'));
      } else {
        try {
          new Cron(trigger.schedule, { paused: true });
        } catch (e) {
          findings.push(
            err(
              obj,
              'trigger-cron',
              `cron trigger "schedule" "${trigger.schedule}" is not a valid croner pattern — ${(e as Error).message}`,
            ),
          );
        }
      }
      if (trigger.concurrency === 'replace') {
        findings.push(
          err(
            obj,
            'trigger-cron',
            `cron trigger concurrency "replace" is enum-reserved (kill-in-flight semantics not yet shipped) — use allow|forbid`,
          ),
        );
      } else if (
        trigger.concurrency !== undefined &&
        trigger.concurrency !== 'allow' &&
        trigger.concurrency !== 'forbid'
      ) {
        findings.push(
          err(obj, 'trigger-cron', `cron trigger concurrency "${trigger.concurrency}" must be one of allow|forbid`),
        );
      }
      findings.push(...checkTargetProject(obj, 'trigger-cron', flow, trigger.target, opts));
    }

    // trigger-webhook: `on: webhook` REQUIRES a "webhook" block. `on: pr-merged`
    // / `on: issue-raised` (R2-08-F3) reuse the SAME config shape but do NOT
    // require it at this layer — only the bridge receiver needs one to be
    // addressable; a bare project-event trigger is not itself a lint error
    // (mirrors the F3 acceptance pin: a minimal pr-merged/issue-raised trigger
    // with no webhook block must produce zero findings). When a webhook block
    // IS present on any of the three kinds, its shape is validated identically
    // — except `events`, checked against a KIND-SPECIFIC allowed set so an
    // `on: webhook` row can never declare `events: [pull_request]` (a header
    // bridge-hooks.ts never resolves for that kind) and vice versa.
    if (trigger.on === 'webhook' && !trigger.webhook) {
      findings.push(err(obj, 'trigger-webhook', 'webhook trigger requires a "webhook" block'));
    }
    if (trigger.webhook && WEBHOOK_FAMILY_KIND_IDS.has(trigger.on)) {
      const wh = trigger.webhook;
      const allowedEvents = WEBHOOK_EVENTS_BY_KIND[trigger.on] ?? WEBHOOK_EVENTS_BY_KIND.webhook;
      const allowedProviders = WEBHOOK_PROVIDERS_BY_KIND[trigger.on] ?? WEBHOOK_PROVIDERS;
      if (!WEBHOOK_ID_RE.test(wh.id)) {
        findings.push(err(obj, 'trigger-webhook', `webhook.id "${wh.id}" does not match ${WEBHOOK_ID_RE}`));
      }
      if (!allowedProviders.has(wh.provider)) {
        findings.push(
          err(
            obj,
            'trigger-webhook',
            `webhook.provider "${wh.provider}" must be one of ${[...allowedProviders].join('|')}` +
              (trigger.on !== 'webhook'
                ? ` for on:"${trigger.on}" (GitHub only — gitea/gitlab have no grounded payload shape)`
                : ''),
          ),
        );
      }
      if (!Array.isArray(wh.events) || wh.events.length === 0) {
        findings.push(err(obj, 'trigger-webhook', 'webhook.events must be non-empty'));
      } else {
        for (const ev of wh.events) {
          if (!allowedEvents.has(ev)) {
            findings.push(
              err(
                obj,
                'trigger-webhook',
                `webhook.events entry "${ev}" must be one of ${[...allowedEvents].join('|')} for on:"${trigger.on}"`,
              ),
            );
          }
        }
      }
      if (!SECRET_ENV_RE.test(wh.secretEnv)) {
        findings.push(
          err(obj, 'trigger-webhook', `webhook.secretEnv "${wh.secretEnv}" does not match ${SECRET_ENV_RE}`),
        );
      }
      if (wh.secretEnvPrevious !== undefined && !SECRET_ENV_RE.test(wh.secretEnvPrevious)) {
        findings.push(
          err(
            obj,
            'trigger-webhook',
            `webhook.secretEnvPrevious "${wh.secretEnvPrevious}" does not match ${SECRET_ENV_RE}`,
          ),
        );
      }
      if (!Array.isArray(wh.sources) || wh.sources.length === 0) {
        findings.push(err(obj, 'trigger-webhook', 'webhook.sources must be non-empty'));
      }
    }
    if (WEBHOOK_FAMILY_KIND_IDS.has(trigger.on)) {
      findings.push(...checkTargetProject(obj, 'trigger-webhook', flow, trigger.target, opts));
    }

    // trigger-agent-complete (R2-08-F2, T1 ruling #1): `agent:` is REQUIRED on
    // an `on: agent-complete` row — absent must never mean "fires for all"
    // (the fail-open shape T1's ruling closed).
    if (trigger.on === 'agent-complete' && !trigger.agent) {
      findings.push(
        err(
          obj,
          'trigger-agent-complete',
          'agent-complete trigger requires a non-empty "agent" (the source agent slug whose completion fires this row) — absent never means "fires for all"',
        ),
      );
    }
    // adversarial-review fix: `agent-complete` mints a fresh run exactly like
    // cron/webhook (fireAgentCompleteTriggers → stageFlowRunRequest →
    // mintTriggeredInitiative), so its `flow` target needs the SAME target-flow
    // project-binding requirement — missed when this check was added for
    // cron/webhook only. Not silent at runtime (mintTriggeredInitiative's
    // `no-project` status still fail-closes the mint), but a flow author
    // authoring a project-less agent-complete target got no early warning.
    if (trigger.on === 'agent-complete') {
      findings.push(...checkTargetProject(obj, 'trigger-agent-complete', flow, trigger.target, opts));
    }

    // trigger-projects (R2-08-F1): `projects:` is kind-independent — SHAPE is
    // checked UNCONDITIONALLY — independent of `opts.projectIds` — mirroring
    // `trigger-agent-complete` twelve lines above: a hand-crafted PUT body
    // (e.g. a bare string) must be refused even by a caller that never learns
    // about `projectIds`. A bare string is itself a valid `for...of` target
    // (it iterates CHARACTERS) — the membership loop below must never run
    // against a malformed value, or a single bad string emits one nonsense
    // finding per letter instead of one type error.
    //
    // WITHDRAWN EXCLUSION (R2-08 addendum, 2026-08-07, WI forge-f9g,
    // docs/decisions/027-studio-object-model.md — withdrawn 2026-08-23, W8-A1):
    // this used to special-case `on: merged` OUT of `projects:` scoping
    // entirely, because that kind dispatches INLINE from
    // `orchestrator/finalize-merged.ts` (`resolveMergeAgentHandler`) and never
    // staged a claimable `FlowRunRequest`, so `drainFlowRunRequests`'s scope
    // enforcement never ran for it — a declared scope would have been
    // silently unenforced. That gap is now closed at the SOURCE rather than
    // by making the declaration unauthorable: `decideTriggerProjectScope`
    // (`orchestrator/flow-run-requests.ts`) is a single exported, pure
    // predicate that BOTH `drainFlowRunRequests` (the staged-request path)
    // and `fireFlowTriggers` (`orchestrator/flow-trigger.ts`, the inline
    // `on: merged` path finalize-merged.ts drives) consult before dispatch —
    // one structural choke point every dispatch mechanism passes through,
    // inline dispatch included. `on: merged` therefore falls through to the
    // SAME shape + membership checks every other kind gets, below.
    if (trigger.projects !== undefined) {
      const shapeOk = Array.isArray(trigger.projects) && trigger.projects.every((p) => typeof p === 'string');
      if (!shapeOk) {
        findings.push(
          err(
            obj,
            'trigger-projects',
            `Trigger "projects" must be an array of strings — got ${JSON.stringify(trigger.projects)}`,
          ),
        );
      } else if (opts?.projectIds) {
        // MEMBERSHIP: any declared id must be a REAL discovered project. Lint
        // reads the SAME evidence the dispatcher reads (rule 2): the same
        // project enumeration (`discoverProjects`) threaded in as
        // `opts.projectIds`. Omitted opt ⇒ skip, mirroring `flowIds`'s own
        // precedent — only reachable once shape is already known-good.
        for (const p of trigger.projects) {
          if (!opts.projectIds.has(p)) {
            findings.push(
              err(
                obj,
                'trigger-projects',
                `Trigger "projects" names "${p}", which is not a discovered project — must be one of ${[...opts.projectIds].join('|')}`,
              ),
            );
          }
        }
      }
    }

    // trigger-shape: per-kind field coherence — cron/webhook fields are stray
    // outside their owning kind.
    if (trigger.on !== 'cron' && trigger.schedule !== undefined) {
      findings.push(err(obj, 'trigger-shape', `"schedule" is only valid on cron triggers (got on:"${trigger.on}")`));
    }
    if (trigger.on !== 'cron' && trigger.concurrency !== undefined) {
      findings.push(
        err(obj, 'trigger-shape', `"concurrency" is only valid on cron triggers (got on:"${trigger.on}")`),
      );
    }
    if (!WEBHOOK_FAMILY_KIND_IDS.has(trigger.on) && trigger.webhook !== undefined) {
      findings.push(
        err(
          obj,
          'trigger-shape',
          `"webhook" block is only valid on webhook/pr-merged/issue-raised triggers (got on:"${trigger.on}")`,
        ),
      );
    }
    // R4-09-F3: `mode` (reflect interactive|automated) is valid ONLY on an
    // `on: merged` agent target (the reflect-agent dispatch). Enum value + placement.
    if (trigger.mode !== undefined) {
      if (!(TRIGGER_MODES as readonly string[]).includes(trigger.mode)) {
        findings.push(
          err(obj, 'trigger-mode', `"mode" must be one of ${TRIGGER_MODES.join('|')} (got "${trigger.mode}")`),
        );
      }
      if (!(trigger.on === 'merged' && trigger.target.kind === 'agent')) {
        findings.push(
          err(obj, 'trigger-shape', `"mode" is only valid on an "on: merged" agent (reflect) target (got on:"${trigger.on}", target.kind:"${trigger.target.kind}")`),
        );
      }
    }
  }

  return findings;
}

/**
 * External triggers (cron/webhook) mint a fresh run for the TARGET flow's
 * project — so THAT flow must carry a project binding, not the declaring flow.
 * For a `flow` target, resolve the target's project via `opts.flowProjectOf`
 * and require it non-null. An `agent` target has no mint (R4-09 dispatch), so
 * no project requirement. When `flowProjectOf` is absent (single-flow PUT with
 * no registry), the check is skipped — studio-lint, which sees every flow,
 * runs it.
 */
const TARGET_PROJECT_CHECK_LABEL: Readonly<Record<string, string>> = {
  'trigger-cron': 'cron',
  'trigger-webhook': 'webhook',
  'trigger-agent-complete': 'agent-complete',
};

function checkTargetProject(
  obj: string,
  check: 'trigger-cron' | 'trigger-webhook' | 'trigger-agent-complete',
  flow: FlowDefinition,
  target: { kind: string; ref: string },
  opts: TriggerCheckOpts | undefined,
): TriggerFinding[] {
  if (target.kind !== 'flow') return [];
  if (!opts?.flowProjectOf) return [];
  // A self-loop is already a trigger-target error; the mint would use this same
  // flow's project, so fall back to the declaring flow for that (impossible)
  // case rather than reporting a spurious missing-target.
  const targetProject =
    target.ref === flow.id ? flow.project : opts.flowProjectOf(target.ref);
  if (targetProject === null || targetProject === undefined || targetProject === '') {
    return [
      err(
        obj,
        check,
        `${TARGET_PROJECT_CHECK_LABEL[check]} trigger targets flow "${target.ref}", which has no project binding — external triggers mint runs against the TARGET flow's project`,
      ),
    ];
  }
  return [];
}
