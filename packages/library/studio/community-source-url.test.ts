/**
 * W8-B5 WI-1 (exit row E3) — SSRF containment for the community refresh.
 *
 * `sourceUrl` is operator-typable through the registry CRUD form
 * (cli/bridge-studio-writes.ts) so it is ATTACKER-CONTROLLED input that would
 * otherwise be handed straight to forge's own server process. These tests pin
 * the two halves of the containment:
 *
 *   1. the fixed API-origin allowlist, compared on `new URL(...).origin`
 *      EXACTLY — never a `startsWith` on the raw string;
 *   2. `sourceUrl` is never fetched, only PARSED into an upstream identity;
 *      anything that does not parse is "no upstream", not an error.
 *
 * Every refusal shape below is a real escape the naive
 * "refresh = fetch each row's sourceUrl" design would have taken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMUNITY_REFRESH_ALLOWED_ORIGINS,
  isAllowedApiOrigin,
  parseCommunityUpstream,
  communitySourceKey,
  formatStarCount,
} from './community-source-url.ts';

// ---------------------------------------------------------------------------
// The origin allowlist
// ---------------------------------------------------------------------------

test('the API-origin allowlist is exactly three origins and is frozen', () => {
  assert.deepEqual([...COMMUNITY_REFRESH_ALLOWED_ORIGINS], [
    'https://api.github.com',
    'https://registry.modelcontextprotocol.io',
    'https://registry.npmjs.org',
  ]);
  assert.ok(Object.isFrozen(COMMUNITY_REFRESH_ALLOWED_ORIGINS), 'the allowlist must not be mutable at runtime');
});

test('isAllowedApiOrigin admits the three API origins on any path', () => {
  assert.equal(isAllowedApiOrigin('https://api.github.com/repos/obra/superpowers'), true);
  assert.equal(isAllowedApiOrigin('https://registry.npmjs.org/js-yaml'), true);
  assert.equal(isAllowedApiOrigin('https://registry.modelcontextprotocol.io/v0/servers?search=x'), true);
});

test('isAllowedApiOrigin compares ORIGIN exactly — a prefix-lookalike host is refused (kills: startsWith on the raw URL string)', () => {
  // Every one of these string-STARTS-WITH an allowlisted origin or contains it.
  assert.equal(isAllowedApiOrigin('https://api.github.com.evil.com/repos/a/b'), false);
  assert.equal(isAllowedApiOrigin('https://api.github.com@evil.com/repos/a/b'), false);
  assert.equal(isAllowedApiOrigin('https://evil.com/https://api.github.com/repos/a/b'), false);
  assert.equal(isAllowedApiOrigin('http://api.github.com/repos/a/b'), false, 'scheme is part of the origin');
  assert.equal(isAllowedApiOrigin('https://api.github.com:8443/repos/a/b'), false, 'a non-default port is a different origin');
});

test('isAllowedApiOrigin refuses non-http schemes and unparseable strings', () => {
  assert.equal(isAllowedApiOrigin('file:///etc/passwd'), false);
  assert.equal(isAllowedApiOrigin('http://169.254.169.254/latest/meta-data/'), false);
  assert.equal(isAllowedApiOrigin('not a url'), false);
  assert.equal(isAllowedApiOrigin(''), false);
});

// ---------------------------------------------------------------------------
// sourceUrl -> upstream identity (never fetched, only parsed)
// ---------------------------------------------------------------------------

test('parseCommunityUpstream: a plain GitHub repo URL yields owner/repo and a normalized key', () => {
  const up = parseCommunityUpstream('https://github.com/obra/superpowers');
  assert.deepEqual(up, { kind: 'github', owner: 'obra', repo: 'superpowers', key: 'github:obra/superpowers' });
});

test('parseCommunityUpstream: extra path segments are IGNORED (a deep-link to a subdir is still that repo)', () => {
  const up = parseCommunityUpstream('https://github.com/anthropics/skills/tree/main/skills/webapp-testing');
  assert.deepEqual(up, { kind: 'github', owner: 'anthropics', repo: 'skills', key: 'github:anthropics/skills' });
});

test('parseCommunityUpstream: the key is case-normalized so one repo cannot become two source rows', () => {
  assert.equal(communitySourceKey('https://github.com/Obra/SuperPowers'), 'github:obra/superpowers');
  assert.equal(communitySourceKey('https://github.com/obra/superpowers'), 'github:obra/superpowers');
});

test('parseCommunityUpstream: a trailing .git and a trailing slash normalize to the same key', () => {
  assert.equal(communitySourceKey('https://github.com/obra/superpowers.git'), 'github:obra/superpowers');
  assert.equal(communitySourceKey('https://github.com/obra/superpowers/'), 'github:obra/superpowers');
});

test('parseCommunityUpstream: SSRF refusal shapes all return null (honestly "no upstream", never an error, never a fetch)', () => {
  const refused = [
    'http://169.254.169.254/latest/meta-data/',     // cloud metadata service
    'https://github.com.evil.com/a/b',              // suffix-attached lookalike host
    'https://user@github.com/a/b',                  // userinfo confusion
    'https://user:pw@github.com/a/b',
    'https://github.com/onlyowner',                 // missing repo segment
    'https://github.com/',                          // no segments at all
    'file:///etc/passwd',                           // non-http scheme
    'http://github.com/obra/superpowers',           // plain http
    'https://github.com:8443/obra/superpowers',     // non-default port
    'https://127.0.0.1/obra/superpowers',
    'https://raw.githubusercontent.com/obra/superpowers/main/x',
    'not a url',
    '',
  ];
  for (const url of refused) {
    assert.equal(parseCommunityUpstream(url), null, `must refuse: ${url}`);
    assert.equal(communitySourceKey(url), null, `must refuse: ${url}`);
  }
});

test('parseCommunityUpstream: dot-segments cannot survive into a request path — new URL() normalizes them away BEFORE the parser sees them', () => {
  // REFUTED EXPECTATION, recorded on purpose: this was first written as a
  // refusal case. It is not one. `new URL` resolves "/../../etc/passwd" to
  // "/etc/passwd", so by the time the parser runs there is no traversal left
  // to refuse — it reads as the (nonexistent) repo `etc/passwd`, which the
  // refresh then queries at api.github.com and gets a plain 404 for. The
  // containment holds because owner/repo are re-validated against
  // GITHUB_SEGMENT_RE (no `/`, no `%`, no `..`) before interpolation, not
  // because the string was rejected.
  assert.deepEqual(parseCommunityUpstream('https://github.com/../../etc/passwd'), {
    kind: 'github',
    owner: 'etc',
    repo: 'passwd',
    key: 'github:etc/passwd',
  });
  // A dot-segment that would still BE a segment after normalization is refused.
  assert.equal(parseCommunityUpstream('https://github.com/%2e%2e/%2e%2e'), null);
  assert.equal(parseCommunityUpstream('https://github.com/obra/..'), null);
});

test('parseCommunityUpstream: the real seed row with NO repo at all (a blog post) is honestly unrefreshable', () => {
  // studio/community/registry.yaml's `pre-impl-interview` row — the case that
  // proves the refresh does not fabricate a repo it does not have.
  assert.equal(parseCommunityUpstream('https://www.firecrawl.dev/blog/best-claude-code-skills'), null);
});

test('parseCommunityUpstream: an npm package page parses to an npm upstream', () => {
  assert.deepEqual(parseCommunityUpstream('https://www.npmjs.com/package/js-yaml'), {
    kind: 'npm',
    pkg: 'js-yaml',
    key: 'npm:js-yaml',
  });
  assert.deepEqual(parseCommunityUpstream('https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem'), {
    kind: 'npm',
    pkg: '@modelcontextprotocol/server-filesystem',
    key: 'npm:@modelcontextprotocol/server-filesystem',
  });
});

test('parseCommunityUpstream: an MCP registry server URL parses to an mcp upstream', () => {
  assert.deepEqual(parseCommunityUpstream('https://registry.modelcontextprotocol.io/servers/ac.inference.sh/mcp'), {
    kind: 'mcp',
    server: 'ac.inference.sh/mcp',
    key: 'mcp:ac.inference.sh/mcp',
  });
});

// ---------------------------------------------------------------------------
// formatStarCount — deterministic, derived from the number, never curated text
// ---------------------------------------------------------------------------

test('formatStarCount is a pure deterministic function of the count (no curated display string can drift from it)', () => {
  assert.equal(formatStarCount(0), '0');
  assert.equal(formatStarCount(999), '999');
  assert.equal(formatStarCount(1400), '1.4k');
  assert.equal(formatStarCount(9999), '10k');
  assert.equal(formatStarCount(14000), '14k');
  assert.equal(formatStarCount(151000), '151k');
  assert.equal(formatStarCount(276412), '276k');
  assert.equal(formatStarCount(1250000), '1.3M');
  assert.equal(formatStarCount(null), null);
});
