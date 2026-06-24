---
title: For browser↔WSL connectivity, build URLs from `window.location.hostname`
description: >-
  A Windows browser hitting a WSL2-hosted dev server can only reach
  ports via `localhost` (auto-forwarded into WSL) — `127.0.0.1` is the
  Windows loopback, not the WSL host. When a server tells the client
  where to find a sibling service, return the **port** (or a relative
  path) and let the client build the URL from `window.location.hostname`
  so the same forwarding catches every service.
category: pattern
keywords:
  - wsl2
  - windows
  - browser
  - networking
  - localhost
  - forge-ui
  - port-forwarding
created_at: 2026-05-24T00:00:00Z
updated_at: 2026-05-24T00:00:00Z
source_dates:
  - 2026-05-24
---

## The problem

Forge runs in WSL2 with a dev server (port 4124) and WebSocket bridge
(port 4123), both binding to `0.0.0.0`. From the Windows browser:
`http://localhost:*` works via WSL2's auto-port-forwarding, but
`http://127.0.0.1:*` fails — 127.0.0.1 is the Windows loopback, not WSL.

The old API route `/api/forge-config` returned `http://127.0.0.1:4123`,
correct inside WSL but meaningless in the browser. Result: "bridge ○ reconnecting" forever.

## The fix

Return the **port** (not the full URL) and have the client compose:

```ts
// API route (server-side):
const port = Number(new URL(process.env.FORGE_BRIDGE_URL).port);
return Response.json({ bridgePort: port });

// Client (browser):
const { bridgePort } = await fetch('/api/forge-config').then((r) => r.json());
const base = `${window.location.protocol}//${window.location.hostname}:${bridgePort}`;
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
```

Now the WS connects to `ws://localhost:4123/ws` from the Windows
browser, which WSL2 forwards to the bridge inside WSL. Same trick
applies to any browser↔sibling-service composition under WSL2 / any
other localhost-forwarding scheme (docker-desktop's `host.docker.internal`,
SSH `LocalForward`, etc.).

## Generalises beyond WSL

"Give the browser the discriminator it needs; let it build the URL from its own
origin." Covers reverse proxies, subdomain routing, and tunnels.

## Diagnostic surface

Badge turns red and footer shows the resolved bridge URL (copy/paste-able).
Also available on `data-bridge-url` on the root `<main>` (see [[dom-as-metrics-for-headless-driven-uis]]) for headless probes.

## See also

- [[fixed-port-takeover-for-pinned-browser-tabs]]
- [`forge-ui/lib/bridge-client.ts:resolveBridgeUrl`](../../../forge-ui/lib/bridge-client.ts)
- [`forge-ui/app/api/forge-config/route.ts`](../../../forge-ui/app/api/forge-config/route.ts)
