/**
 * KB read-policy predicate (R1-06, ADR-010 amendment "R1-06 band-scoped
 * reviewer grant").
 *
 * The asymmetric brain-read policy (ADR-010 as amended) governs WHO may read a
 * KB. Encoded here as a PURE, exported predicate so both `forge studio lint`
 * (cli/studio-lint.ts — the production wiring) and the guard test
 * (orchestrator/kb-read-policy-guard.test.ts) apply the SAME single rule
 * against a real, loaded descriptor rather than a hand-rolled re-derivation.
 *
 * Placed in `cli/` (not `orchestrator/`) deliberately: ADR-042 caps the
 * surface area of `orchestrator/`, and `cli/` routes/helpers are not capped.
 * It may import from `orchestrator/studio` for the descriptor type + the
 * default-usage resolver.
 *
 * The rule (per the T1 ruling + ADR-010 amendment):
 *
 *   - A `project` binding is ALWAYS exempt. Per-project brains (Brain-3, ADR
 *     035) legitimately grant the full reader set
 *     [planner, reflector, dev-loop, reviewer] — the dev-loop and reviewer may
 *     consult the cycle's Brain 3 (advisory, ADR-010 amended 2026-05-26). This
 *     is the exemption the previous ad-hoc helper got WRONG: it flagged every
 *     real project KB.
 *
 *   - On a NON-project binding (`flow` or `unique`), the resolved
 *     `usage.readers` set must NOT grant `dev-loop` OR `reviewer` UNLESS a
 *     ratified band mapping authorises it. The ONLY ratified map is
 *     `band: 'review-band' -> reviewer` (a flow binding scoped to the review
 *     band grants the reviewer an advisory read). Therefore:
 *       * a `dev-loop` grant is NEVER ratified on a non-project binding;
 *       * a `reviewer` grant is ratified ONLY when
 *         `binding.kind === 'flow' && binding.band === 'review-band'`.
 *
 * `usage.readers` is the RESOLVED set (`resolveKbProcesses` — an explicit
 * `processes.usage.readers` in the kb.yaml, else `deriveKbUsageDefaults`), so a
 * KB that hand-declares `readers: [reviewer]` on a bandless flow binding is
 * caught exactly like one that would resolve there by default.
 */

import { resolveKbProcesses } from './studio/kb-descriptor.ts';
import type { KbDescriptor } from '@forge/contracts/studio/types.ts';

/** The one ratified band → reader-role exception (ADR-010 amendment). */
const RATIFIED_BAND_READER = { band: 'review-band', role: 'reviewer' } as const;

export type KbReadPolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * Evaluate the ADR-010 brain-read policy against a loaded KB descriptor.
 * Returns `{ ok: true }` for a compliant KB and `{ ok: false, reason }` naming
 * the offending grant otherwise. Pure — no I/O, no throw for a well-formed
 * descriptor.
 */
export function kbReadPolicyViolation(kb: KbDescriptor): KbReadPolicyResult {
  // Project bindings (Brain-3, ADR-035 / ADR-010) legitimately grant the full
  // reader set — always compliant.
  if (kb.binding.kind === 'project') return { ok: true };

  const readers = resolveKbProcesses(kb).usage.readers;
  const band = kb.binding.kind === 'flow' ? kb.binding.band : undefined;

  // dev-loop is never a ratified reader on a non-project binding.
  if (readers.includes('dev-loop')) {
    return {
      ok: false,
      reason:
        `KB "${kb.id}" grants the "dev-loop" reader role on a non-project ` +
        `binding (kind: ${kb.binding.kind}${band ? `, band: ${band}` : ''}) — ` +
        `the dev-loop must not read the forge brain (ADR-010); a dev-loop grant ` +
        `is never ratified off a project binding`,
    };
  }

  // reviewer is ratified only on a flow binding scoped to the review band.
  if (readers.includes('reviewer')) {
    const ratified = kb.binding.kind === 'flow' && band === RATIFIED_BAND_READER.band;
    if (!ratified) {
      return {
        ok: false,
        reason:
          `KB "${kb.id}" grants the "reviewer" reader role on a non-project ` +
          `binding (kind: ${kb.binding.kind}${band ? `, band: ${band}` : ''}) ` +
          `without the ratified band scope — the reviewer may read a KB only when ` +
          `it is bound { kind: flow, band: ${RATIFIED_BAND_READER.band} } (ADR-010 ` +
          `amendment "R1-06 band-scoped reviewer grant")`,
      };
    }
  }

  return { ok: true };
}
