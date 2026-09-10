/**
 * M6-D / operator ruling 477 — the detail page's install decision for an item
 * forge does NOT already have on disk.
 *
 * Before 477 there was one answer: a non-vendored item was a browse-upstream
 * dead end, because nothing fetched what its URL named. There are now two, and
 * the page picks between them WITHOUT re-deriving anything — the server sends
 * `upstreamFetchable`, computed by `toWireItem` from the same
 * `parseCommunityUpstream` grammar `routeCommunityInstall` uses. A URL grammar
 * duplicated in the UI is a UI that eventually offers a door the route
 * refuses, which is worse than a UI that offers none.
 *
 * Lives beside `community-view.test.ts` rather than inside it: that file sits
 * at its `check-file-size` ceiling, and an exemption is a ceiling rather than
 * a licence. Its own non-vendored dead-end test stays there, now fixtured with
 * an upstream forge genuinely cannot read a package out of.
 */
import { test, expect } from 'vitest';

import { installActionForItem } from '../../lib/community-view.ts';

test('installActionForItem: a non-vendored skill whose upstream IS fetchable offers the install — §3\'s second door', () => {
  const action = installActionForItem({
    kind: 'skill',
    id: 'handoff',
    vendored: false,
    upstreamFetchableAs: 'https://github.com/obra/superpowers',
    installState: 'not-installed',
    upstream: 'https://github.com/obra/superpowers',
    installMethod: null,
  });

  expect(action).toEqual({ action: 'install' });
});

test('installActionForItem: a non-vendored HOOK never offers an install — the route has no fetch arm for hooks', () => {
  // The server never sets `upstreamFetchable` true for a hook (hook items are
  // vendored by construction, D1), so this pins the page's half of the same
  // rule: what it renders follows the server's answer, and the server's answer
  // for a hook is always false.
  const action = installActionForItem({
    kind: 'hook',
    id: 'block-protected-branch-push',
    vendored: false,
    upstreamFetchableAs: null,
    installState: 'not-installed',
    upstream: 'https://github.com/parsoFish/forge-studio',
    installMethod: null,
  });

  expect(action).toEqual({ action: 'browse-upstream', href: 'https://github.com/parsoFish/forge-studio' });
});

test('installActionForItem: present-unmanaged still wins over a fetchable upstream — a local file that merely shares the id is never overwritten', () => {
  const action = installActionForItem({
    kind: 'skill',
    id: 'handoff',
    vendored: false,
    upstreamFetchableAs: 'https://github.com/obra/superpowers',
    installState: 'present-unmanaged',
    upstream: 'https://github.com/obra/superpowers',
    installMethod: null,
  });

  expect(action).toEqual({ action: 'present-unmanaged', href: '/skills/handoff' });
});
