/**
 * Shared derivation of the pipeline graph model from the event stream.
 *
 * Lifted out of app/page.tsx (Phase B) so both the live graph
 * (AgentGraphCanvas) and the file heatmap consume ONE derivation rather
 * than re-deriving in each component. Pure functions + a thin memo hook —
 * unit-testable without the React tree.
 */

import { useMemo } from 'react';
import type { EventLogEntry } from './bridge-client';
import type { WiGraph } from './wi-graph';
import { derivePhaseStates, type PhaseState } from './phases';
import { derivePerWiStatus, type WiStatus } from './wi-status';

export type GraphWorkItem = {
  id: string;
  title: string;
  dependsOn: string[];
  status?: WiStatus;
};

export type GraphModel = {
  phaseStates: PhaseState[];
  workItems: GraphWorkItem[];
};

export type GraphModelInputs = {
  events: EventLogEntry[];
  wiGraph: WiGraph | null;
};

/**
 * WIs materialise once `pm.work-item-emitted` has fired. Pre-PM, the list is
 * empty. Mirrors the operator note 2026-05-25 event-driven materialisation.
 * Feature layer removed (refocus: initiative→WI directly, no features tier).
 */
export function deriveGraphModel({ events, wiGraph }: GraphModelInputs): GraphModel {
  const phaseStates = derivePhaseStates(events);

  const wiIds = new Set<string>();
  for (const e of events) {
    if (e.message !== 'pm.work-item-emitted') continue;
    const wid = (e.metadata as { work_item_id?: string } | undefined)?.work_item_id;
    if (wid) wiIds.add(wid);
  }

  let workItems: GraphWorkItem[] = [];
  if (wiIds.size > 0) {
    const titleByWi = new Map<string, string>();
    const depsByWi = new Map<string, string[]>();
    if (wiGraph) {
      for (const n of wiGraph.nodes) titleByWi.set(n.id, n.label);
      for (const edge of wiGraph.edges) {
        const arr = depsByWi.get(edge.to) ?? [];
        arr.push(edge.from);
        depsByWi.set(edge.to, arr);
      }
    }
    const statusById = derivePerWiStatus(events, Array.from(wiIds));
    workItems = Array.from(wiIds).map((id) => ({
      id,
      title: titleByWi.get(id) ?? id,
      dependsOn: depsByWi.get(id) ?? [],
      status: statusById[id],
    }));
  }

  return { phaseStates, workItems };
}

export function useGraphModel(inputs: GraphModelInputs): GraphModel {
  const { events, wiGraph } = inputs;
  return useMemo(
    () => deriveGraphModel({ events, wiGraph }),
    [events, wiGraph],
  );
}
