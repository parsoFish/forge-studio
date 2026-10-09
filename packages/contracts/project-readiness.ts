/**
 * `projectReadiness` — the ONE rule for whether a project is ready (SPEC §6).
 *
 * Two readers ask the same question and must get the same answer: Studio's
 * `ContractReadiness` (what the operator is shown) and the scheduler's claim
 * gate (`packages/flows/claim-validator.ts`, what the factory refuses). Both
 * call this function; neither holds a copy of the rules below. The claim gate
 * therefore refuses exactly what Studio already shows as not-ready — never
 * stricter, never looser.
 *
 * Face A is the five definition fields the operator fills in; Face B is the
 * preflight report's hard clauses. Pure: no I/O, so it is browser-safe.
 */

import type { DemoStep } from './studio-types.ts';

export type ReadinessCheckId = 'north-star' | 'instructions' | 'demo' | 'skills' | 'kb' | 'preflight';

export type ReadinessCheck = { id: ReadinessCheckId; ok: boolean; text: string };

export type ReadinessClause = { clause: string; hard: boolean; pass: boolean };

export type ProjectReadinessInput = {
  northStar: string;
  instructions: string;
  demoProcess: readonly DemoStep[];
  skills: readonly string[];
  kb: string | null;
  /** The preflight report's clauses; `null` while preflight has not answered. */
  clauses: readonly ReadinessClause[] | null;
};

export type ProjectReadiness = {
  ready: boolean;
  checks: readonly ReadinessCheck[];
  /** Ids of the failing checks; for `preflight`, followed by the failing hard clause names. */
  failing: readonly string[];
};

export function projectReadiness(input: ProjectReadinessInput): ProjectReadiness {
  const northStar = input.northStar.trim();
  const hardFailures = input.clauses === null ? [] : input.clauses.filter((c) => c.hard && !c.pass);

  const checks: readonly ReadinessCheck[] = [
    { id: 'north-star', ok: northStar.length > 0 && northStar.length <= 140, text: 'North star set (≤ 140 chars)' },
    { id: 'instructions', ok: input.instructions.trim().length > 0, text: 'Instructions present' },
    {
      id: 'demo',
      ok: input.demoProcess.some((s) => s.kind === 'capture') && input.demoProcess.some((s) => s.kind === 'verify'),
      text: 'Demo has ≥ 1 capture + ≥ 1 verify step',
    },
    { id: 'skills', ok: input.skills.length > 0, text: '≥ 1 relevant skill bound' },
    { id: 'kb', ok: !!input.kb, text: 'Knowledge base bound' },
    { id: 'preflight', ok: input.clauses !== null && hardFailures.length === 0, text: 'Preflight has no failing hard clause' },
  ];

  const failing = checks.flatMap((c) =>
    c.ok ? [] : c.id === 'preflight' ? [c.id, ...hardFailures.map((h) => h.clause)] : [c.id],
  );
  return { ready: checks.every((c) => c.ok), checks, failing };
}
