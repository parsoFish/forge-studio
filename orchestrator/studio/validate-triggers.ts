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
import { resolveBandHook } from '../agent-bands.ts';
import type { AgentDefinition, FlowDefinition } from './types.ts';

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
const WEBHOOK_EVENTS = new Set(['push', 'release']);
const SECRET_ENV_RE = /^[A-Z][A-Z0-9_]*$/;

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
      } else if (trigger.on === 'merged' && resolveBandHook(agentDef) !== 'reflection-close') {
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

    // trigger-webhook
    if (trigger.on === 'webhook') {
      if (!trigger.webhook) {
        findings.push(err(obj, 'trigger-webhook', 'webhook trigger requires a "webhook" block'));
      } else {
        const wh = trigger.webhook;
        if (!WEBHOOK_ID_RE.test(wh.id)) {
          findings.push(err(obj, 'trigger-webhook', `webhook.id "${wh.id}" does not match ${WEBHOOK_ID_RE}`));
        }
        if (!WEBHOOK_PROVIDERS.has(wh.provider)) {
          findings.push(
            err(
              obj,
              'trigger-webhook',
              `webhook.provider "${wh.provider}" must be one of ${[...WEBHOOK_PROVIDERS].join('|')}`,
            ),
          );
        }
        if (!Array.isArray(wh.events) || wh.events.length === 0) {
          findings.push(err(obj, 'trigger-webhook', 'webhook.events must be non-empty'));
        } else {
          for (const ev of wh.events) {
            if (!WEBHOOK_EVENTS.has(ev)) {
              findings.push(
                err(
                  obj,
                  'trigger-webhook',
                  `webhook.events entry "${ev}" must be one of ${[...WEBHOOK_EVENTS].join('|')}`,
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
      findings.push(...checkTargetProject(obj, 'trigger-webhook', flow, trigger.target, opts));
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
    if (trigger.on !== 'webhook' && trigger.webhook !== undefined) {
      findings.push(
        err(obj, 'trigger-shape', `"webhook" block is only valid on webhook triggers (got on:"${trigger.on}")`),
      );
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
function checkTargetProject(
  obj: string,
  check: 'trigger-cron' | 'trigger-webhook',
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
        `${check === 'trigger-cron' ? 'cron' : 'webhook'} trigger targets flow "${target.ref}", which has no project binding — external triggers mint runs against the TARGET flow's project`,
      ),
    ];
  }
  return [];
}
