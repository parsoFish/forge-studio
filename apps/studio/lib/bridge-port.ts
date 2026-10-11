/**
 * Bridge PORT facts shared across the forge-ui workspace (W6-P4 redesign,
 * reviewer fix #1 — never trade an app-wide guarantee, the 16 statically
 * prerendered route shells, for a per-request fact that has a stable
 * default).
 *
 *   - `DEFAULT_BRIDGE_PORT` — the fixed-port convention's default, re-exported
 *     from `@forge/contracts`. It used to be a hand-kept literal mirroring
 *     `apps/forge/forge-watch.ts`, "since the two live in different npm workspaces
 *     and can't share a single TS import cleanly" — that is no longer true:
 *     contracts is a workspace package both sides import, so there is one
 *     definition and drift is structurally impossible rather than merely
 *     detected. The client's last-resort fallback (forge-nk1y.29: the layout no
 *     longer inlines it — the launched port arrives via `bridgePortScript`).
 *   - `resolveBridgePortFromEnv` — the AUTHORITATIVE, env-derived value
 *     (reads `FORGE_BRIDGE_URL`, the var `apps/forge/forge-watch.ts` sets on the
 *     Next.js process for both `next dev`/`next start`). Read by the dynamic
 *     `/api/forge-config` route and its `/script` twin (`bridgePortScript`).
 *
 * Host never lives here: WSL2 + a Windows browser needs the host to come
 * from `window.location.hostname` client-side
 * (brain/cycles/themes/windows-browser-to-wsl-via-window-location.md) — both
 * exports below only ever hand back a port number.
 */

/** The fixed-port convention's default bridge port (CLAUDE.md: "fixed ports
 *  — bridge 4123, UI 4124"). One definition, in `@forge/contracts`, imported
 *  by both this app and `apps/forge/forge-watch.ts`. */
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

/**
 * forge-nk1y.29 — the script `/api/forge-config/script` serves, loaded `beforeInteractive` by the
 * root layout: the LAUNCHED bridge port from the Next process's env, set before any bridge call.
 * The layout used to inline the build-time default (4123) and the first call used it; an alt-port
 * Studio read — and from a writing page, wrote — another session's bridge. `null` = this Next
 * process has no FORGE_BRIDGE_URL (the client then falls back to the default, as the JSON route does).
 */
export function bridgePortScript(env: NodeJS.ProcessEnv = process.env): string {
  return `window.__FORGE_BRIDGE_PORT__=${resolveBridgePortFromEnv(env) ?? 'null'};`;
}
