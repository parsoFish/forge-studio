import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';

import { baseDescriptor, makeForgeRoot, writeAgentSkill, writeForgeUiRoute, writeSessionKindsYaml } from './test-fixtures/session-kinds-core.ts';

// ===========================================================================
// AT-amendment-3, A1 (AT-61..67) — legacyRouteResolves has NO containment
// check. `existsSync(join(forgeRoot, 'apps', 'studio', 'app', ...segments))` is
// evaluated on the path.join()-NORMALIZED result — `..` segments collapse
// BEFORE existsSync runs, so a route entry can point anywhere `existsSync`
// can see. Every scenario below was run against the actual, unfixed
// `legacyRouteResolves`/`validateSessionKinds` before being written (see
// each test's comment for the empirically-verified outcome).
// ===========================================================================

describe('validateSessionKinds — legacyRouteResolves has NO containment check (AT-amendment-3, A1)', () => {
  it('AT-61: a legacyRoutes entry escaping upward to a REAL directory OUTSIDE apps/studio/app → error (empirically verified: currently returns true, i.e. wrongly "resolves" — LIVE bypass)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]'); // negative control: the real, legitimate sibling
    mkdirSync(join(root, 'escaped-outside-target'), { recursive: true }); // the escape target REALLY exists
    const evilRoute = '../../escaped-outside-target'; // apps/studio/app/../.. => root; + escaped-outside-target
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', evilRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding (the escape, not the real sibling), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(evilRoute), `message must name the offending route, got: ${routeFindings[0].message}`);
  });

  it('AT-62: a legacyRoutes entry of exactly "../../.." → error (empirically verified: normalizes ONE level above forgeRoot — not forgeRoot itself, but still a real, always-present directory — currently returns true — LIVE bypass)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const evilRoute = '../../..';
    // Sanity precondition (not the assertion under test): confirm the target
    // this route actually resolves to is real, so the AT can't pass for the
    // wrong reason (a route that resolves to nothing would be correctly
    // rejected even by the buggy code).
    const target = join(root, 'apps', 'studio', 'app', '..', '..', '..');
    assert.ok(existsSync(target), `precondition failed: "${target}" (what "../../.." resolves to) must exist for this AT to mean anything`);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', evilRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(evilRoute));
  });

  it('AT-63: legacyRoutes entries reaching absolute filesystem paths via excess ".." segments (clamps past the root, then descends into "/etc" and a self-controlled outside dir) → error for EACH (empirically verified: both currently return true — LIVE bypass; a literal bare "/etc" string does NOT bypass on this codebase — see AT-64\'s neighbor note — this is the actual reachable shape)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const outsideAbsDir = makeForgeRoot('legacy-abs-outside-target-'); // a REAL, independent absolute dir
    const manyDotDot = Array(30).fill('..').join('/'); // safely more than any real nesting depth
    const routeToEtc = `${manyDotDot}/etc`;
    const routeToOutsideAbsDir = manyDotDot + outsideAbsDir; // outsideAbsDir already starts with '/'
    writeSessionKindsYaml(root, [
      baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', routeToEtc, routeToOutsideAbsDir] }),
    ]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 2, `expected exactly 2 findings (both absolute escapes, not the real sibling), got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings.some((f) => f.message.includes(routeToEtc)), `expected a finding naming the /etc escape, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings.some((f) => f.message.includes(routeToOutsideAbsDir)), `expected a finding naming the outside-dir escape, got: ${JSON.stringify(routeFindings)}`);
  });

  it('AT-64: a legacyRoutes entry containing a BACKSLASH separator → error (empirically verified: this does NOT bypass containment today — POSIX treats "\\\\" as a plain filename character, not a separator, so the literal-backslash "filename" simply never exists; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const backslashRoute = '..\\..\\escaped-outside-target';
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', backslashRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(backslashRoute));
  });

  it('AT-65: a legacyRoutes entry containing a NULL BYTE → error (empirically verified: does NOT bypass — existsSync neither throws nor matches a literal-NUL "filename"; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    mkdirSync(join(root, 'escaped-outside-target'), { recursive: true }); // real target — proves the NUL, not a missing dir, is what blocks it
    const nullByteRoute = '../../escaped-outside-target' + String.fromCharCode(0);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', nullByteRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes('escaped-outside-target'));
  });

  it('AT-66: a legacyRoutes entry containing a URL-ENCODED traversal ("%2e%2e%2f...") → error (empirically verified: never URL-decoded anywhere in this code path — the literal percent-text is just an opaque filename that never exists; ALREADY correctly rejected — pinned as coverage, not a fresh catch)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const encodedRoute = '%2e%2e%2fescaped-outside-target';
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', encodedRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(encodedRoute));
  });

  it('AT-67: a legacyRoutes entry that escapes and comes back down to the SAME real, legitimate directory → error (T2 ruling: a declared route is a Studio route path, not a filesystem expression — "../app/fixture-kind/[sessionId]" numerically round-trips to the real target, but the STRING contains ".." and must be rejected regardless; empirically verified: currently returns true — LIVE bypass, and the most dangerous shape since it looks harmless on inspection)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeForgeUiRoute(root, '/fixture-kind/[sessionId]');
    const roundTripRoute = '../app/fixture-kind/[sessionId]'; // normalizes right back to the real target
    // Sanity precondition: confirm this route really does round-trip to the
    // legitimate target (so the AT is pinning "must reject despite being
    // numerically legitimate", not accidentally pinning a missing-dir case).
    const target = join(root, 'apps', 'studio', 'app', '..', 'app', 'fixture-kind', '[sessionId]');
    assert.ok(existsSync(target), `precondition failed: "${target}" must exist (it's the same real dir as the legitimate route)`);
    writeSessionKindsYaml(root, [baseDescriptor({ legacyRoutes: ['/fixture-kind/[sessionId]', roundTripRoute] })]);

    const findings = validateSessionKinds(root);
    const routeFindings = findings.filter((f) => f.check === 'session-kinds/legacy-route-not-found');
    assert.equal(routeFindings.length, 1, `expected exactly 1 finding — a route string containing ".." must be rejected even when it numerically resolves back to a legitimate target, got: ${JSON.stringify(routeFindings)}`);
    assert.ok(routeFindings[0].message.includes(roundTripRoute));
  });
});

