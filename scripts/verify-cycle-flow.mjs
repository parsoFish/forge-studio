/**
 * verify-cycle-flow.mjs — what `--flow <id>` selects, and the door stage 2 uses.
 *
 * Stage 1 is always the plan flow (`forge-architect`: interview, plan gate, pm).
 * Stage 2 hands the planned initiative to a flow. Before this flag that was only
 * ever `forge-develop`, through `POST /api/develop/start` — a door whose target
 * is fixed to the develop flow. Any other flow under `studio/flows/` is reached
 * through the platform's generic per-flow door, `POST /api/flows/<id>/run`, the
 * one Studio's flow monitor uses; it repoints an existing initiative onto the
 * named flow and asks the caller to CONFIRM the flow it is moving from.
 *
 * The known ids are the platform's own registry over the tree (`listFlowIds`),
 * never a list kept here, so a flow added as data is selectable without editing
 * this file. Pure functions of argv and those ids so the decision is testable
 * without a funded run (§15.163).
 */
import { PLAN_FLOW_ID, flowPathForId, loadFlowDefinition } from '@forge/flows';
import { listFlowIds } from '@forge/flows/studio/flow-registry.ts';

/** The flow `POST /api/develop/start` enqueues onto — the harness default. */
export const DEVELOP_FLOW_ID = 'forge-develop';

/** Every flow id under `<forgeRoot>/studio/flows/`, from the platform's registry. */
export function knownFlowIds(forgeRoot) {
  return listFlowIds(forgeRoot);
}

/** The parsed flow definition the runner would load for `flowId`. */
export function flowDefinition(flowId) {
  return loadFlowDefinition(flowPathForId(flowId));
}

/**
 * @param {string[]} argv            the harness's argv
 * @param {string[]} knownIds        flow ids the registry lists
 * @returns {{ flowId: string, door: 'develop-start' | 'flow-run' }}
 */
export function resolveFlowSelection(argv, knownIds) {
  const at = argv.flatMap((a, i) => (a === '--flow' ? [i] : []));
  if (at.length === 0) return { flowId: DEVELOP_FLOW_ID, door: 'develop-start' };
  if (at.length > 1) throw new Error('--flow given more than once — name the one flow stage 2 hands off to');

  const known = [...knownIds].sort().join(', ');
  const raw = argv[at[0] + 1];
  if (raw === undefined || raw.startsWith('--')) throw new Error(`--flow needs a flow id; known: ${known}`);
  if (!knownIds.includes(raw)) throw new Error(`--flow "${raw}" is not a flow under studio/flows/ — known: ${known}`);
  if (raw === PLAN_FLOW_ID) {
    throw new Error(`--flow "${raw}" is stage 1 itself — --flow chooses the flow the plan is handed to (known: ${known})`);
  }
  if (raw === DEVELOP_FLOW_ID) return { flowId: raw, door: 'develop-start' };
  if (argv.includes('--send-back')) {
    // The send-back drain re-enters the develop executor by node (resume_from
    // 'develop'); it has been exercised on forge-develop's topology and nowhere
    // else. Refused rather than attempted on a flow it may not reach.
    throw new Error(`--send-back is proven on ${DEVELOP_FLOW_ID} only; it cannot be combined with --flow "${raw}"`);
  }
  return { flowId: raw, door: 'flow-run' };
}

/**
 * The generic door's request for one initiative. Confirms the repoint FROM the
 * plan flow — the move this harness is actually making, and the answer the
 * flow monitor's operator gives.
 */
export function stageTwoRequest(selection, initiativeId) {
  if (selection.door !== 'flow-run') {
    throw new Error(`stageTwoRequest serves the flow-run door; ${selection.flowId} goes through develop-start`);
  }
  return {
    path: `/api/flows/${encodeURIComponent(selection.flowId)}/run`,
    payload: { initiativeId, confirmRepointFrom: PLAN_FLOW_ID },
  };
}

/** True when the flow declares `{ on: merged, target: { ref: reflector } }` — the only way a merge fires reflect. */
export function flowDeclaresMergedReflect(flowDef) {
  const triggers = Array.isArray(flowDef?.triggers) ? flowDef.triggers : [];
  return triggers.some((t) => t?.on === 'merged' && t?.target?.ref === 'reflector');
}
