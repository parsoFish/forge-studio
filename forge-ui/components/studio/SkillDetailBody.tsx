'use client';

import Link from 'next/link';
import { FilePackage } from '@/components/studio/FilePackage';
import type { SkillDetail } from '@/lib/skill-client';
import { disabledAttrs } from '@/lib/disabled-reason';

// ---------------------------------------------------------------------------
// SkillDetailBody
// ---------------------------------------------------------------------------

const REASON_TEXT: Record<string, string> = {
  'hash-drift': "This skill's files changed after it was approved — the pinned content hash no longer matches what's on disk. Review the diff before trusting it again.",
  'provenance-tampered': "This skill's provenance metadata doesn't check out — the recorded install info doesn't match reality.",
  'unregistered-install': "This skill wasn't installed through the tracked install pipeline, so its origin can't be verified.",
};

export function SkillDetailBody({
  detail,
  approving,
  approveError,
  onApprove,
}: {
  detail: SkillDetail;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
}) {
  const usedBy = detail.usedBy;

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: '0 0 8px' }}>
          {detail.name}
        </h1>
        {detail.description && (
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
            {detail.description}
          </p>
        )}
      </div>

      {detail.trust === 'needs-review' && (
        <section
          data-section="needs-review"
          style={{ fontSize: 13, color: '#f87171', padding: '12px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
        >
          {detail.reason ? REASON_TEXT[detail.reason] ?? detail.reason : 'This skill no longer matches its pinned content — it has dropped out of the palette until re-approved.'}
        </section>
      )}

      <section>
        <SectionLabel>Package</SectionLabel>
        <FilePackage files={detail.files} />
      </section>

      <section data-section="used-by" data-used-by-count={usedBy.length}>
        <SectionLabel>Used by</SectionLabel>
        {usedBy.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>
            Unbound — bind it from an agent's builder.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {usedBy.map((slug) => (
              <Link key={slug} href={`/agents/${encodeURIComponent(slug)}`} data-used-by-agent={slug} className="badge badge-agent" style={{ textDecoration: 'none' }}>
                {slug}
              </Link>
            ))}
          </div>
        )}
      </section>

      {detail.provenance && (
        <section
          data-section="provenance"
          data-content-hash={detail.provenance.contentHash}
          data-upstream-source={detail.provenance.source}
          {...(detail.provenance.upstreamRef ? { 'data-upstream-ref': detail.provenance.upstreamRef } : {})}
        >
          <SectionLabel>Provenance</SectionLabel>
          <dl className="kv" style={{ fontSize: 12.5 }}>
            <dt>source</dt>
            <dd>{detail.provenance.source}</dd>
            {detail.provenance.upstreamRef && (<><dt>ref</dt><dd>{detail.provenance.upstreamRef}</dd></>)}
            <dt>content hash</dt>
            <dd style={{ fontFamily: 'var(--font-mono, monospace)' }}>{detail.provenance.contentHash}</dd>
            <dt>installed</dt>
            <dd>{detail.provenance.installedAt}</dd>
          </dl>
        </section>
      )}

      {/* W8-B4 (library-36): this used to be `detail.trust === 'draft' &&
          detail.scan` — the SECOND half of that guard is why widening only
          the trust check would not have been enough: the bridge only ever
          populates `scan` for a draft (cli/bridge-studio-skills.ts, "the scan
          is drafts-only"), so `needs-review` NEVER carries one. The scan
          preview/report below stays scan-gated (draft-only, by design); the
          Approve control itself is gated on TRUST alone so a needs-review
          skill — dropped after an edit, a hash drift, or a tampered/
          unregistered install — gets the same way back to composable a draft
          always had, mirroring `app/hooks/[id]/page.tsx`'s `!resolved` gate. */}
      {(detail.trust === 'draft' || detail.trust === 'needs-review') && (
        <section
          data-section="approval-gate"
          style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <SectionLabel>Approval gate</SectionLabel>
            <p style={{ fontSize: 12.5, color: 'var(--dim)', margin: '0 0 10px', lineHeight: 1.6 }}>
              {detail.trust === 'draft'
                ? 'This is an installed draft — quarantined, not palette-visible, and not runnable as an agent (D4). Read the full SKILL.md below, review the inventory, then approve if you trust it.'
                : 'This skill dropped out of the palette (see the reason above) — quarantined and not runnable as an agent until re-approved. Approving re-pins the content hash to what is on disk right now.'}
            </p>
            {detail.scan && (
              <pre style={{ margin: 0, padding: '12px 14px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>
                <code>{detail.scan.body}</code>
              </pre>
            )}
          </div>

          {detail.scan && (
            <div
              data-section="scan-report"
              data-quarantined-count={detail.scan.quarantinedKeys.length}
              data-executable-count={detail.scan.executableFiles.length}
            >
              <SectionLabel>Scan — an inventory, not a verdict</SectionLabel>
              <p style={{ fontSize: 11.5, color: 'var(--faint)', margin: '0 0 8px', fontStyle: 'italic' }}>
                This lists facts for you to read before approving — it does not judge the skill safe
                or clean. Real security scanning applies to hooks, not skills.
              </p>
              <dl className="kv" style={{ fontSize: 12.5 }}>
                <dt>files</dt>
                <dd>{detail.scan.fileCount} ({detail.scan.totalBytes} bytes)</dd>
                <dt>quarantined keys</dt>
                <dd>{detail.scan.quarantinedKeys.length > 0 ? detail.scan.quarantinedKeys.join(', ') : 'none'}</dd>
                <dt>executable-extension files</dt>
                <dd>{detail.scan.executableFiles.length > 0 ? detail.scan.executableFiles.join(', ') : 'none'}</dd>
              </dl>
            </div>
          )}

          <div>
            <button
              type="button"
              className="btn btn-primary"
              data-action="approve-skill"
              onClick={onApprove}
              {...disabledAttrs(approving ? 'Approving…' : null)}
            >
              {approving ? 'Approving…' : 'Approve'}
            </button>
            {approveError && <span style={{ marginLeft: 10, fontSize: 12, color: '#f87171' }}>{approveError}</span>}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 8px' }}>
      {children}
    </h2>
  );
}
