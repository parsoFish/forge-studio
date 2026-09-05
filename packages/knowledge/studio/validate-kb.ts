/**
 * KB descriptor validation (ADR 027, §6) — the `kb` half of what was
 * `orchestrator/studio/validate.ts`, moved here by T1 ruling 159 to sit beside
 * `kb-descriptor.ts`, the loader whose output it checks.
 *
 * Deliberately narrow: only the id rule and the backend enum. The `binding`
 * SHAPE is already load-guarded in `kb-descriptor.ts` (`parseKbBinding`) and is
 * not duplicated here; the binding CROSS-REFERENCE checks (dangling ref,
 * exactly-one-unique) need the full KB roster plus the discovered flows and
 * projects, so they live in `apps/forge/studio-lint.ts`, the only composer that
 * has all three.
 */

import type { KbDescriptor } from '@forge/contracts/studio/types.ts';
import { KB_BACKENDS } from '@forge/contracts/studio/types.ts';
import { type Finding, err } from '@forge/kernel/findings.ts';
import { KB_ID_RE } from '@forge/kernel/ids.ts';

export function validateKb(kb: KbDescriptor): Finding[] {
  const findings: Finding[] = [];
  const obj = `kb:${kb.id}`;

  if (!KB_ID_RE.test(kb.id)) {
    findings.push(err(obj, 'slug', `KB id "${kb.id}" does not match ${KB_ID_RE}`));
  }

  // backend (optional) must be a known storage backend. Loader parses it leniently
  // so a typo is a lint error here, not a load crash.
  if (kb.backend !== undefined && !(KB_BACKENDS as readonly string[]).includes(kb.backend)) {
    findings.push(
      err(obj, 'backend', `KB backend "${kb.backend}" must be one of ${KB_BACKENDS.join('|')}`),
    );
  }

  // Note: the `binding` shape (kind enum + ref presence) is already
  // load-guarded in registry (parseKbBinding); we do not duplicate it here.
  // Binding *cross-reference* checks (dangling ref, exactly-one-unique) live
  // in apps/forge/studio-lint.ts, which has the full KB roster + discovered
  // flows/projects needed to check them.

  return findings;
}
