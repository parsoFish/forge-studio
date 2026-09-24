/**
 * Client-side glue to the forge-ui-bridge — the import surface the rest of
 * the app uses (`@/lib/bridge-client`). `forge-8vfn.7.6.135` split the real
 * implementation into sibling modules at their client-surface seams (pure
 * move, no behavior change); this file re-exports all of them so no caller
 * changes:
 *   - `./bridge-client-core.ts`       — URL resolution, fetch/post envelopes,
 *                                       the WebSocket subscription.
 *   - `./bridge-client-roadmap.ts`    — cycles, work items, the per-project
 *                                       roadmap, attention, cost, recovery,
 *                                       the scheduler.
 *   - `./bridge-client-runs.ts`       — verdicts, start-development, the plan
 *                                       trigger, per-flow run triggers, the
 *                                       structured demo model, run + gate
 *                                       write endpoints.
 *   - `./bridge-client-interviews.ts` — architect, instructions-creator,
 *                                       demo-builder, project-brain,
 *                                       authoring, reflection.
 */
export * from './bridge-client-core.ts';
export * from './bridge-client-roadmap.ts';
export * from './bridge-client-runs.ts';
export * from './bridge-client-interviews.ts';
