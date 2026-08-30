/**
 * Bridge PORT facts shared across the forge-ui workspace (W6-P4 redesign,
 * reviewer fix #1 — never trade an app-wide guarantee, the 16 statically
 * prerendered route shells, for a per-request fact that has a stable
 * default).
 *
 *   - `DEFAULT_BRIDGE_PORT` — the fixed-port convention's default, re-exported
 *     from `@forge/contracts`. It used to be a hand-kept literal mirroring
 *     `cli/forge-watch.ts`, "since the two live in different npm workspaces
 *     and can't share a single TS import cleanly" — that is no longer true:
 *     contracts is a workspace package both sides import, so there is one
 *     definition and drift is structurally impossible rather than merely
 *     detected. Still a build-time constant, NOT an env read — `app/layout.tsx`
 *     inlines it into `window.__FORGE_BRIDGE_PORT__` with zero per-request
 *     work, so the layout stays fully static.
 *   - `resolveBridgePortFromEnv` — the AUTHORITATIVE, env-derived value
 *     (reads `FORGE_BRIDGE_URL`, the var `cli/forge-watch.ts` sets on the
 *     Next.js process for both `next dev`/`next start`). Used only by the
 *     dynamic `/api/forge-config` route — the correction path
 *     `lib/bridge-client.ts` falls back to when the optimistic default
 *     guess turns out wrong (e.g. a `--bridge-port` override).
 *
 * Host never lives here: WSL2 + a Windows browser needs the host to come
 * from `window.location.hostname` client-side
 * (brain/cycles/themes/windows-browser-to-wsl-via-window-location.md) — both
 * exports below only ever hand back a port number.
 */

/** The fixed-port convention's default bridge port (CLAUDE.md: "fixed ports
 *  — bridge 4123, UI 4124"). One definition, in `@forge/contracts`, imported
 *  by both this app and `cli/forge-watch.ts`. */
export { DEFAULT_BRIDGE_PORT } from '@forge/contracts';

export function resolveBridgePortFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const url = env.FORGE_BRIDGE_URL ?? '';
  if (!url) return null;
  try {
    return Number(new URL(url).port) || null;
  } catch {
    return null;
  }
}
