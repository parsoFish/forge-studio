/**
 * The orchestrated capture's nonce verdict (bead forge-8vfn.17).
 *
 * Moved out of the demo agent when the LLM node was deleted (spec §5 item 4):
 * the verdict is about the ORCHESTRATOR's own capture run, not about anything an
 * agent authored, so it outlives the agent. Behaviour is unchanged — this file
 * is the same two functions and the same words.
 */
import { readFileSync } from 'node:fs';

/**
 * bead forge-8vfn.17 — "did not happen" and "happened wrong" are different facts.
 *
 * The orchestrated capture stamps the nonce it was given into demo.json. A
 * DIFFERENT nonce means the file on disk was produced by some other run: that is
 * the tampering claim, and it is justified. A MISSING nonce means the capture
 * never got as far as stamping — a crash, a timeout, a command that could not
 * run. Reporting the second as the first sends the operator hunting an incident
 * that does not exist while the real cause goes unnamed, which is exactly what
 * the 2026-09-04 G1 run did.
 *
 * An empty stamp is treated as missing rather than as a mismatch: a truncated or
 * half-written file is a failed write, not a forged one.
 */
export type CaptureNonceVerdict =
  | { ok: true }
  | { ok: false; reason: 'capture-not-stamped' | 'nonce-mismatch'; detail: string };

export function judgeCaptureNonce(expected: string, stamped: string | null): CaptureNonceVerdict {
  if (!stamped) {
    return {
      ok: false,
      reason: 'capture-not-stamped',
      detail:
        'the orchestrated capture exited without stamping demo.json — the capture did not complete, ' +
        'so no evidence was produced for this run. This is a capture failure, not a claim about the artifact.',
    };
  }
  if (stamped !== expected) {
    return {
      ok: false,
      reason: 'nonce-mismatch',
      detail:
        'demo.json capture.nonce does not match this orchestrated run — the evidence was not produced by ' +
        'this capture (stale, replayed, or hand-written)',
    };
  }
  return { ok: true };
}

export function readStampedNonce(demoJsonAbs: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(demoJsonAbs, 'utf8')) as { capture?: { nonce?: unknown } };
    return typeof parsed.capture?.nonce === 'string' ? parsed.capture.nonce : null;
  } catch {
    return null;
  }
}
