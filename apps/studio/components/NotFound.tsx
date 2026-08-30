'use client';

/**
 * NotFound — the ONE not-found treatment for every unknown id in Studio
 * (W7-A4, findings crosscut-27 / crosscut-07 and the per-route unknown-id
 * findings it consolidates).
 *
 * Every `[id]` route's unknown branch, `app/not-found.tsx` (unmatched paths),
 * `/knowledge?id=` / `?node=`, `/artifact?run=` and the session/run pages
 * render THIS for "the thing you asked for does not exist" — never a
 * different object (the first KB, the blank builder), never a blank editor,
 * never a fake "not yet produced".
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md → "Not-found contract"):
 *
 *   <main data-page="not-found" data-page-ready="true"
 *         data-not-found-kind="<kind>"      the object kind asked for
 *         data-not-found-id="<id>"          the id asked for, verbatim ("" when none)
 *         data-not-found-variant="unknown"|"retired"|"unselected">
 *     <StudioNav/>                            nav intact — never a bare page
 *     [data-component="not-found"]            the honest body
 *       h1 — unknown:    No <kind> "<id>"
 *            retired:    <kind> "<id>" is retired
 *            unselected: No <kind> selected
 *       p  — optional `detail` (what to do instead)
 *       a[data-action="not-found-back"][href=backHref] — always a way back
 *
 * Variants:
 *   - `unknown`    (default) — no object with this id.
 *   - `retired`    — the id was real once (a retired flow id such as
 *                    `release-refine`, or the pre-flow_id `unknown` sentinel);
 *                    reads as retired, not as a typo.
 *   - `unselected` — no id was given at all (bare `/artifact`); never claims
 *                    an id the operator did not type.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

import { StudioNav } from '@/components/StudioNav';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';

export type NotFoundVariant = 'unknown' | 'retired' | 'unselected';

export type NotFoundProps = {
  /** Human noun for the object kind: "project", "flow", "run", "agent", "knowledge base", … */
  kind: string;
  /** The id the operator asked for, verbatim; "" for `unselected`. */
  id: string;
  /** Where "back" goes — the kind's index (`/projects`, `/flows`, …) or `/`. */
  backHref: string;
  /** Label for the back link, e.g. "Projects". */
  backLabel: string;
  variant?: NotFoundVariant;
  /** Optional one-line explanation / next step rendered under the heading. */
  detail?: ReactNode;
};

function heading(kind: string, id: string, variant: NotFoundVariant): ReactNode {
  if (variant === 'unselected') return <>No {kind} selected</>;
  if (variant === 'retired') return <>{kind} &ldquo;{id}&rdquo; is retired</>;
  return <>No {kind} &ldquo;{id}&rdquo;</>;
}

export function NotFound({ kind, id, backHref, backLabel, variant = 'unknown', detail }: NotFoundProps) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page="not-found"
      data-page-ready="true"
      data-not-found-kind={kind}
      data-not-found-id={id}
      data-not-found-variant={variant}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div
        data-component="not-found"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 24px', textAlign: 'center' }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          {heading(kind, id, variant)}
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
          {detail ?? (variant === 'unselected'
            ? <>Pick one from the list to open it here.</>
            : variant === 'retired'
              ? <>This id was real once but is no longer registered.</>
              : <>Nothing is registered under that id — it may have been renamed or removed, or the link is stale.</>)}
        </p>
        <Link
          href={backHref}
          data-action="not-found-back"
          style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
        >
          &larr; {backLabel}
        </Link>
      </div>
    </main>
  );
}
