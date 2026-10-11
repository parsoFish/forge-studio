'use client';

/**
 * CommunityItemGrid — the `/community` card grid, paged (forge-nk1y.17,
 * D-46 §3.1): one page of `COMMUNITY_PAGE_SIZE` cards plus "show more", so the
 * registry never sets the page height. `data-community-shown` says how many
 * cards are on screen; the page root's `data-item-count` stays the filtered
 * total. The parent re-keys this grid when the filter changes, so paging
 * restarts at page 1 for every new result set.
 */
import { useState } from 'react';
import Link from 'next/link';
import type { CommunityItem } from '@/lib/community-client';
import {
  installStateLabel,
  signalsLabel,
  hubLabel,
  freshnessBadge,
  visibleCommunityItems,
  COMMUNITY_PAGE_SIZE,
} from '@/lib/community-view';

export function CommunityItemGrid({ items, nowMs }: { items: readonly CommunityItem[]; nowMs: number }): JSX.Element {
  const [shownPages, setShownPages] = useState(1);
  const shown = visibleCommunityItems(items, COMMUNITY_PAGE_SIZE, shownPages);
  const hidden = items.length - shown.length;
  return (
    <div data-community-shown={shown.length} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
        {shown.map((item) => (
          <CommunityCard key={`${item.kind}/${item.id}`} item={item} nowMs={nowMs} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          className="btn btn-sm"
          data-action="community-show-more"
          onClick={() => setShownPages((n) => n + 1)}
          style={{ alignSelf: 'flex-start' }}
        >
          Show more ({hidden} more)
        </button>
      )}
    </div>
  );
}

function CommunityCard({ item, nowMs }: { item: CommunityItem; nowMs: number }) {
  const freshness = freshnessBadge(item.fetchedAt, nowMs);
  return (
    <Link
      href={`/community/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`}
      className="lib-card"
      data-card-type="community-item"
      data-item-id={item.id}
      data-item-kind={item.kind}
      data-item-hub={item.hub?.id}
      // W8-B5 (community-05): ABSENT for an item with no registry row — the
      // same discipline data-item-hub / data-fetched-at already hold, never a
      // fabricated attribute value.
      data-item-category={item.category ?? undefined}
      data-install-state={item.installState}
      data-has-signals={item.signals !== null ? 'true' : 'false'}
      data-fetched-at={item.fetchedAt ?? undefined}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{item.name}</span>
        <span className="badge">{item.kind}</span>
      </div>
      <p className="card-body">{item.desc}</p>
      <div className="card-meta">
        <span className="card-stat">{hubLabel(item.hub)}</span>
        <span className="card-stat">{signalsLabel(item.signals)}</span>
        <span className="card-stat">{installStateLabel(item.installState)}</span>
        <span
          className="card-stat"
          data-component="freshness-badge"
          data-freshness={freshness.state}
          style={freshness.state === 'seed' ? { color: 'var(--faint)', fontStyle: 'italic' } : undefined}
        >
          {freshness.label}
        </span>
      </div>
    </Link>
  );
}
