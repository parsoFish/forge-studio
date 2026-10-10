/**
 * bridge-http — the ONE `readJson` every bridge route module shares.
 *
 * forge-4zk follow-up (post-split review): the ui-bridge.ts split minted
 * FOUR new private mirrors of the same request-body parser
 * (bridge-reflect.ts, bridge-run-triggers.ts, bridge-review-comments.ts,
 * bridge-agent-dispatch.ts), on top of the two that already existed
 * (ui-bridge.ts's own, and bridge-studio.ts's near-duplicate) — six
 * byte-identical copies of the body-size cap and JSON-parse boundary,
 * diffed byte-for-byte before this consolidation (they were identical; no
 * drift to reconcile). Six copies of a body-size/parse-error boundary is
 * exactly the kind of duplication that drifts silently — a future edit to
 * the cap, the oversize error shape, or the malformed-JSON handling would
 * have had to land in six places to stay true.
 *
 * WHY A LEAF MODULE, NOT A HOST EXPORT. `apps/forge/bridge-studio.ts`'s
 * mirror predates any stated reason beyond "shared helper (mirrors readJson
 * in ui-bridge.ts)" — no boundary was ever actually at stake for two files
 * in the SAME directory. The `ctx.readBody()` shape T1 ruling 30 mandates
 * (`packages/kernel/route-entry.ts`) is a DIFFERENT concern: it stops a
 * ranked PACKAGE from importing the host (`package-to-legacy` /
 * `package-to-assembly`), so those callers still receive `readBody` as an
 * injected closure built from this function — never import it directly.
 * This file has ZERO imports from `ui-bridge.ts` or any `bridge-*.ts`, so it
 * removes the only reason a same-directory mirror could ever have existed:
 * every apps/forge sibling can import it with no cycle, ever.
 */
import type { IncomingMessage } from 'node:http';

/** Request-body cap for every bridge write route (1 MiB). */
export const MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Read and parse the JSON request body. Caps at MAX_BODY_BYTES; destroys the
 * socket and rejects (never resolves) on oversize. An empty body resolves to
 * `{}`; a malformed one rejects with the `JSON.parse` error. Every bridge
 * route that needs a body — directly, or via a `readBody: () => readJson(req)`
 * closure handed to a carved package route table — calls this ONE
 * implementation.
 */
export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        rejectJson(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolveJson(raw ? JSON.parse(raw) : {}); } catch (err) { rejectJson(err); }
    });
    req.on('error', rejectJson);
  });
}
