/**
 * Adapter registry (M6-2, ADR 029).
 *
 * Maps sdk id → RuntimeAdapter. The registry is the source of truth for
 * which adapters are installed and available. The catalog.yaml `available`
 * flag is reconciled with this registry: a sdk is selectable in the UI iff
 * `isSdkAvailable(id)` returns true here.
 *
 * Adding a real second adapter (Codex / Gemini / local) later:
 *   1. Implement RuntimeAdapter in loops/_adapters/<sdk>/index.ts.
 *   2. Run the conformance suite (loops/_adapters/conformance.ts) — must pass.
 *   3. Import + register below.
 *   4. Install the npm dep (ask-first event per PRINCIPLES.md).
 */

import { claudeAdapter } from './claude/index.ts';
import { exampleAdapter } from './example/index.ts';
import { geminiAdapter } from './gemini/index.ts';
import { aiderAdapter } from './aider/index.ts';
import type { RuntimeAdapter } from './types.ts';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ADAPTERS: Record<string, RuntimeAdapter> = {
  claude: claudeAdapter,
  example: exampleAdapter,
  // M8-A flywheel drop-ins: registered but available:false until their dep +
  // creds are provisioned (geminiAdapter: @google/genai + GEMINI_API_KEY;
  // aiderAdapter: the aider CLI + its model key). Registering an unavailable
  // adapter is harmless — getAdapter resolves it, isSdkAvailable stays false.
  gemini: geminiAdapter,
  aider: aiderAdapter,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the adapter registered under `id`.
 * Throws with a clear message (including the list of known ids) if unknown.
 */
export function getAdapter(id: string): RuntimeAdapter {
  const adapter = ADAPTERS[id];
  if (!adapter) {
    const known = Object.keys(ADAPTERS).join(', ');
    throw new Error(`Unknown adapter id "${id}". Registered ids: ${known}`);
  }
  return adapter;
}

/**
 * Returns all registered adapters (in registration order).
 * Use for introspection / health checks — the catalog GET, not the hot path.
 */
export function listAdapters(): RuntimeAdapter[] {
  return Object.values(ADAPTERS);
}

/**
 * Returns the ids of every registered adapter.
 * Drives the UI SDK picker: only ids returned here are candidates.
 */
export function registeredSdkIds(): string[] {
  return Object.keys(ADAPTERS);
}

/**
 * Returns true iff a registered adapter with the given id reports
 * `available: true`. An unregistered id always returns false (no throw —
 * callers use this as a boolean gate, not as a presence check).
 */
export function isSdkAvailable(id: string): boolean {
  return ADAPTERS[id]?.available === true;
}
