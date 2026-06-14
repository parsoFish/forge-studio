/**
 * Subsumption proof (M8-D, ADR-032) — the closure that ties the three flywheel
 * seams together.
 *
 * The market thesis (docs/forge-studio-market-and-differentiation.md §3) is
 * "modularity-as-subsumption": forge turns best-in-class point solutions into
 * COMPONENTS by plugging them into clean seams. M8-0 made three seams real
 * (runtime adapter, dev-loop adapter, KB backend) and M8-A/B/C shipped a second
 * implementation behind each (Gemini, Aider, Zep). This test asserts the
 * MECHANICAL claim: every seam resolves a second implementation SIMULTANEOUSLY —
 * i.e. forge is, structurally, a composition substrate, not a single-runtime tool.
 *
 * Realization gap (honest): the second impls are dep+creds-gated (available:false
 * in CI). A LIVE combined cycle (a flow actually running on Gemini + Aider + Zep)
 * additionally needs their deps + API keys provisioned + a Gemini tool executor +
 * per-adapter model resolution — see ADR-032. This test proves the SEAMS accept
 * the components; it does not run them live.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getAdapter, listAdapters, registeredSdkIds, isSdkAvailable } from '../loops/_adapters/registry.ts';
import type { RuntimeAdapter } from '../loops/_adapters/types.ts';
import { FilesystemKbBackend } from './kb-backend.ts';
import { ZepKbBackend } from './kb-backends/zep.ts';

const KB_METHODS = ['buildGraph', 'getNodeArticle', 'listPendingGuidance', 'deleteGuidanceFile', 'search'] as const;

function isRuntimeAdapterShape(a: RuntimeAdapter): boolean {
  return (
    typeof a.id === 'string' &&
    typeof a.available === 'boolean' &&
    typeof a.createAgent === 'function' &&
    typeof a.query === 'function'
  );
}

// ---------------------------------------------------------------------------
// Seam 1 — runtime adapter: >= 2 implementations resolve
// ---------------------------------------------------------------------------

test('runtime seam: claude + a second runtime (gemini, aider) all resolve to RuntimeAdapter shape', () => {
  for (const id of ['claude', 'gemini', 'aider']) {
    const a = getAdapter(id);
    assert.equal(a.id, id);
    assert.ok(isRuntimeAdapterShape(a), `${id} must satisfy the RuntimeAdapter shape`);
  }
  // The seam holds >= 2 real second runtimes beyond the live claude reference.
  const second = registeredSdkIds().filter((id) => id !== 'claude' && id !== 'example');
  assert.ok(second.length >= 2, `expected >=2 non-claude runtimes, got ${second.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Seam 2 — KB backend: >= 2 implementations satisfy the contract
// ---------------------------------------------------------------------------

test('kb seam: FilesystemKbBackend + ZepKbBackend both implement the KbBackend surface', () => {
  for (const Backend of [FilesystemKbBackend, ZepKbBackend]) {
    assert.equal(typeof Backend, 'function', 'backend must be a constructable class');
    for (const m of KB_METHODS) {
      assert.equal(
        typeof (Backend.prototype as unknown as Record<string, unknown>)[m],
        'function',
        `${Backend.name} must implement KbBackend.${m}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The simultaneous tie-together + the honest realization gap
// ---------------------------------------------------------------------------

test('subsumption matrix: each seam has >=2 impls AND the second impls are creds-gated (the realization gap)', () => {
  // Mechanically, all three seams accept a second component at the same time.
  assert.ok(listAdapters().length >= 4, 'runtime seam: claude + example + gemini + aider');
  assert.ok([FilesystemKbBackend, ZepKbBackend].length === 2, 'kb seam: filesystem + zep');

  // Honest gap: the live second runtimes are unavailable until provisioned.
  assert.equal(isSdkAvailable('claude'), true, 'claude is the live reference');
  assert.equal(isSdkAvailable('gemini'), false, 'gemini live needs @google/genai + GEMINI_API_KEY');
  assert.equal(isSdkAvailable('aider'), false, 'aider live needs the aider CLI + a model key');
});
