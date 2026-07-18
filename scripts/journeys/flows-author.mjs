import { defineJourney } from '../lib/journey-runtime.mjs';
import {
  cleanFirstFlow, J3_FLOW_DIR, waitForFile, readSavedFlowNodes, J3_FLOW,
  readSavedFlow, waitForFlowVersion, THINK, cleanFirstFlowRun, QDIR, J5_INIT,
  J4_PROJECT, J5_CYCLE_ID, j5Event, SEED_FLOW_PATH,
  SCRATCH_FLOW_DIR, SCRATCH_FLOW, FORGE_ROOT, caption, ACT, READ, cleanScratchFlow,
} from '../lib/journey-fixtures.mjs';
import { sleep } from '../lib/journey-assertions.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import yaml from 'js-yaml';

// The three agents authored, live, into the from-scratch flow — same roles as
// the forge-develop seed (developer-ralph → developer-unifier → a gated
// review node), so the topological parity compare below has something real
// to compare against.
const SCRATCH_CHAIN = ['developer-ralph', 'developer-unifier', 'project-scoped-review'];

// R2-02-F3: no shipped library agent is currently `capability.interactive:
// true` — the roster's few `surface: interactive` skills (demo-builder,
// instructions-creator, cruft-sweep) are deliberately excluded from the
// composable roster (registry.ts's isStudioAgent — `library: false` or no
// `runtime` block). To prove the BUILD tab's placement gate genuinely reads
// the F1 `agent.capability.interactive` descriptor (not a stub), the
// scratch-build beat flips ONE real, unrelated roster agent's capability via
// a one-shot network fixture — never a SCRATCH_CHAIN agent — narrated
// honestly as a fixture, not a "real" interactive agent.
const CAPABILITY_FIXTURE_AGENT = 'project-manager';

// Drop-coordinate spacing for the three scratch-flow nodes, shared by the main
// beat AND the clip so both drop hexes the same way. Canvas-fraction based (not
// pixel-based) so it scales with whatever viewport is recording. Widened from
// the original 0.22/0.28-step spacing after hexes were observed dropping
// overlapped at the recorder's wider default canvas.
const SCRATCH_DROP_X_FRACTIONS = [0.18, 0.42, 0.66];
const SCRATCH_DROP_Y_FRACTION = 0.45;

// ── HTML5 DnD: AgentPalette agent chip → FlowBuilderCanvas ──────────────────
// Mirrors AgentPalette's DraggableChip (encodeDragPayload sets text/plain to
// JSON.stringify({kind:'agent', ref})) → FlowBuilderCanvas.onDrop (decodes it,
// only accepts kind==='agent', places the new fn-<ts> node at
// rfInstance.project({x: clientX-rect.left, y: clientY-rect.top})).
async function dropAgentNode(page, agentRef, clientX, clientY) {
  const chip = page.locator(`[data-palette-chip="agent"][data-chip-ref="${agentRef}"]`);
  const canvas = page.locator('[data-component="flow-builder-canvas"]');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await chip.dispatchEvent('dragstart', { dataTransfer });
  await canvas.dispatchEvent('dragover', { dataTransfer, clientX, clientY });
  await canvas.dispatchEvent('drop', { dataTransfer, clientX, clientY });
  await chip.dispatchEvent('dragend', { dataTransfer });
}

// ── ReactFlow handle-drag (real mouse, NOT synthetic dispatch) ──────────────
// ReactFlow's own pointer-drag connection logic listens for real
// mousedown/mousemove/mouseup, not synthetic DOM events — this must be an
// actual Playwright mouse drag between the two Handle nodes
// ([data-nodeid][data-handleid="out"|"in"]).
async function wireEdge(page, srcNodeId, tgtNodeId) {
  const srcHandle = page.locator(`[data-nodeid="${srcNodeId}"][data-handleid="out"]`);
  const tgtHandle = page.locator(`[data-nodeid="${tgtNodeId}"][data-handleid="in"]`);
  const srcBox = await srcHandle.boundingBox();
  const tgtBox = await tgtHandle.boundingBox();
  if (!srcBox || !tgtBox) return false;
  const sx = srcBox.x + srcBox.width / 2, sy = srcBox.y + srcBox.height / 2;
  const tx = tgtBox.x + tgtBox.width / 2, ty = tgtBox.y + tgtBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 8 });
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
  return true;
}

// On connect, FlowBuilderCanvas's onConnectEnd opens the ArtifactPicker at
// the real cursor (mouseup) position — pick the artifact label there. (An
// Artifact-Reference chip dragged onto an edge is a no-op by design; this
// post-connect picker is the ONLY UI path that actually labels an edge.)
// `calloutText`, when passed, turns the pick into a callout moment: the
// picker is given a beat to be READ (caption + dwell) before the click —
// used by the clip, where this moment needs to land with the viewer; the
// main beat calls this with no callout so its own checks stay fast.
async function pickArtifact(page, artifactId, { timeout = 6000, calloutText } = {}) {
  try {
    await page.waitForSelector('[data-component="artifact-picker"]', { timeout });
  } catch { return false; }
  if (calloutText) {
    await caption(page, calloutText);
    await sleep(READ);
  }
  const opt = page.locator(`[data-artifact-option="${artifactId}"]`);
  if ((await opt.count()) === 0) return false;
  await opt.click();
  return true;
}

// ── module-local topological structural-parity compare ─────────────────────
// Deliberately NOT the fixtures' parseFlowStructure (literal node-id compare)
// — FlowBuilderCanvas always auto-generates `fn-<ts>` node ids on drop, so a
// from-scratch UI rebuild can never match the seed's literal ids. This walks
// the node chain in topological (source→sink) order instead and compares:
//   - the agent-ref MULTISET of every non-gated node in the chain — EXCLUDING
//     the terminal gate node's agent identity. rfNodesToFlow() always writes
//     a concrete `agent:` for every UI-saved node, but the production seed's
//     `review` node is a bare gate placeholder with NO `agent:` field at all
//     — a from-scratch UI rebuild structurally cannot reproduce that exactly.
//     An honest, source-confirmed UI limit, not something to fake around.
//   - the ordered edge artifact-label sequence (wi-branches, then pr)
//   - gate PLACEMENT: which position in the chain carries a gate, and which
//     gate kind (verdict) — not that node's agent identity.
function topoChain(doc) {
  const nodes = Array.isArray(doc?.nodes) ? doc.nodes : [];
  const edges = Array.isArray(doc?.edges) ? doc.edges : [];
  const hasIncoming = new Set(edges.map((e) => e.to));
  let current = nodes.find((n) => !hasIncoming.has(n.id))?.id ?? nodes[0]?.id;
  const order = [];
  const edgeArtifacts = [];
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    order.push(current);
    const edge = edges.find((e) => e.from === current);
    if (edge) edgeArtifacts.push(edge.artifact ?? null);
    current = edge?.to;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { order: order.map((id) => byId.get(id)), edgeArtifacts };
}

function compareFlowTopology(seedDoc, scratchDoc) {
  const seed = topoChain(seedDoc);
  const scratch = topoChain(scratchDoc);
  const results = [];
  results.push({
    ok: seed.order.length === scratch.order.length,
    label: `chain length matches the seed (seed ${seed.order.length}, scratch ${scratch.order.length})`,
  });
  const n = Math.min(seed.order.length, scratch.order.length);
  const seedAgents = seed.order.slice(0, n).filter((nd) => typeof nd?.gate !== 'string').map((nd) => nd?.agent);
  const scratchAgents = scratch.order.slice(0, n).filter((nd) => typeof nd?.gate !== 'string').map((nd) => nd?.agent);
  results.push({
    ok: JSON.stringify([...seedAgents].sort()) === JSON.stringify([...scratchAgents].sort()),
    label: `non-gated agent-ref multiset matches the seed (seed: ${seedAgents.join(',')}; scratch: ${scratchAgents.join(',')})`,
  });
  results.push({
    ok: JSON.stringify(seed.edgeArtifacts) === JSON.stringify(scratch.edgeArtifacts),
    label: `edge artifact-label sequence matches the seed (seed: ${seed.edgeArtifacts.join('→')}; scratch: ${scratch.edgeArtifacts.join('→')})`,
  });
  const seedGateIdx = seed.order.findIndex((nd) => typeof nd?.gate === 'string');
  const scratchGateIdx = scratch.order.findIndex((nd) => typeof nd?.gate === 'string');
  results.push({
    ok: seedGateIdx !== -1 && seedGateIdx === scratchGateIdx,
    label: `gate placement matches the seed (chain position ${seedGateIdx}, scratch position ${scratchGateIdx})`,
  });
  const seedGateKind = seedGateIdx !== -1 ? seed.order[seedGateIdx]?.gate : null;
  const scratchGateKind = scratchGateIdx !== -1 ? scratch.order[scratchGateIdx]?.gate : null;
  results.push({
    ok: seedGateKind !== null && seedGateKind === scratchGateKind,
    label: `gate kind matches the seed ("${seedGateKind}" vs "${scratchGateKind}")`,
  });
  return results;
}

export const journey = defineJourney({
    id: 'flows-author',
    title: 'Author a flow',
    story: 'As an operator, I author a brand-new cycle flow entirely as data — the flows pillar\'s user-creates path — stringing plan/dev/review agents together, handing the result real work, and genuinely rebuilding forge-develop from scratch in the live builder UI to prove it is topologically identical to the production seed.',
    beats: [
      {
        id: 'flows-author-new-flow',
        title: 'String plan/dev/review into a flow (new-flow builder)',
        narration: 'From the library\'s "+ New Flow" CTA, the canvas seeds itself from the basic starter (plan → dev → review, one verdict gate); the operator names and saves it, drags a node to a new position, and reloads — proving the authored flow, and its hand-arranged layout, both persist and pass `studio lint`.',
        drive: async (ctx) => {
              const { page, watch, check, frame } = ctx;
              // ── J3: STRING THE THREE AGENTS INTO A FLOW (new-flow builder) ────────────
              // From the library "+ New Flow" → canvas seeded from the basic starter
              // (plan → dev → review + verdict gate). Name it, save (slug derived), and
              // prove: lint-green, runnable, and node positions PERSIST across reload.
              console.log('\n[J3] String plan/dev/review into a flow (new-flow builder)');
              cleanFirstFlow();
              // discoverable creation: the library "+ New Flow" CTA is a real enabled link
              await page.goto(watch.uiUrl + '/', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const newFlowCta = await page.evaluate(() => {
                const el = document.querySelector('[data-action="new-flow"]');
                return el ? { href: el.getAttribute('href'), disabled: el.hasAttribute('disabled') } : null;
              });
              check(newFlowCta !== null && !newFlowCta.disabled && (newFlowCta.href ?? '').includes('/flows/new'),
                'J3: library "+ New Flow" CTA is enabled and routes to the flow builder');

              await page.goto(watch.uiUrl + '/flows/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Seeded from the basic starter: ≥3 nodes on the canvas.
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const seededNodeCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
              check(seededNodeCount >= 3, `J3: new-flow canvas seeded from the basic starter (≥3 nodes, got ${seededNodeCount})`);
              const flowAdvCollapsed = await page.evaluate(() => {
                const d = document.querySelector('[data-section="flow-advanced"]');
                return d ? !(d).open : false;
              });
              check(flowAdvCollapsed, 'J3: project/KB/triggers collapsed under Advanced by default (progressive disclosure)');
              await frame(page, 'j3-0-new-flow-seeded', 'J3 — new flow seeded from the basic starter (plan → dev → review)');

              // Name the flow + save (slug derived from name → /flows/my-first-flow).
              await page.locator('[data-field="flow-name"]').fill('My First Flow');
              await page.locator('[data-action="save-flow"]').click();
              const flowYamlPath = join(J3_FLOW_DIR, 'flow.yaml');
              const flowLanded = await waitForFile(flowYamlPath, 12000);
              check(flowLanded, `J3: saving the new flow writes studio/flows/${J3_FLOW}/flow.yaml`);

              // Persistence: every node carries a numeric x/y (the J3 schema addition).
              const nodesV1 = readSavedFlowNodes(J3_FLOW);
              const allHaveXY = nodesV1.length >= 3 && nodesV1.every((n) => typeof n.x === 'number' && typeof n.y === 'number');
              check(allHaveXY, `J3: saved flow persists node positions (every node has numeric x/y; ${nodesV1.length} nodes)`);
              const gatePresent = nodesV1.some((n) => typeof n.gate === 'string');
              check(gatePresent, 'J3: authored flow keeps the human verdict gate (zero-gate flows are rejected)');

              // lint validates the authored flow; it is runnable.
              let j3LintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                j3LintOk = true;
              } catch (e) {
                console.error(`  [studio lint J3] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(j3LintOk, 'J3: `forge studio lint` validates the authored flow (exit 0)');

              // Saving a new flow auto-redirects to its real route — wait for that
              // navigation rather than racing it with our own goto.
              await page.waitForURL(new RegExp(`/flows/${J3_FLOW}`), { timeout: 15000 }).catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              const j3CanStart = await page.evaluate(() =>
                document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-can-start'));
              check(j3CanStart === 'true', `J3: authored flow is runnable (data-can-start="true", got "${j3CanStart}")`);

              // Position round-trip: drag a node, save, reload, save again — the dragged
              // position must survive (proves x/y are honoured on load, not recomputed).
              await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              const dragId = nodesV1[0]?.id ?? 'plan';
              const x0 = nodesV1.find((n) => n.id === dragId)?.x ?? 0;
              const vBeforeDrag = readSavedFlow(J3_FLOW).version;
              let dragged = false;
              try {
                const nodeEl = page.locator(`.react-flow__node:has([data-node-id="${dragId}"])`).first();
                const box = await nodeEl.boundingBox();
                if (box) {
                  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                  await page.mouse.down();
                  await page.mouse.move(box.x + box.width / 2 + 230, box.y + box.height / 2 + 150, { steps: 12 });
                  await page.mouse.up();
                  dragged = true;
                }
              } catch { /* drag unavailable */ }
              await sleep(THINK);
              await page.locator('[data-action="save-flow"]').click();
              // Wait for the async save to land (version bumps) — not a fixed sleep.
              await waitForFlowVersion(J3_FLOW, vBeforeDrag + 1, 15000);
              const xDrag = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? x0;
              check(dragged && Math.abs(xDrag - x0) > 40, `J3: dragging node "${dragId}" moved + saved its position (x ${x0}→${xDrag})`);
              await frame(page, 'j3-1-flow-arranged', 'J3 — authored flow, node hand-arranged on the canvas');

              // Reload + save again (no move): the dragged position survives the reload
              // (proves persisted x/y are honoured on load, not recomputed by autolayout).
              const vBeforeReload = readSavedFlow(J3_FLOW).version;
              await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // Stage C — a no-runs flow monitor shows the per-flow kickoff surface (FlowKickoff).
              const j3KickoffKind = await page.evaluate(() => {
                const el = document.querySelector('[data-section="flow-kickoff"]');
                return el ? el.getAttribute('data-kickoff-kind') : null;
              });
              check(j3KickoffKind !== null, `J3: no-runs flow shows the kickoff surface ([data-kickoff-kind]="${j3KickoffKind}")`);
              await page.locator('[data-page="flow-monitor"] .tab', { hasText: 'BUILD' }).first().click().catch(() => {});
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              await page.locator('[data-action="save-flow"]').click();
              await waitForFlowVersion(J3_FLOW, vBeforeReload + 1, 15000);
              const xReload = readSavedFlow(J3_FLOW).nodes.find((n) => n.id === dragId)?.x ?? -9999;
              check(Math.abs(xReload - xDrag) < 30, `J3: node position PERSISTS across reload (x ${xDrag} → ${xReload})`);
              await frame(page, 'j3-2-flow-persisted', 'J3 — node positions persist across reload (authored flow is durable)');

        },
      },
      {
        id: 'flows-author-scratch-build',
        title: 'Build the forge-develop flow from scratch (flow-as-data)',
        narration: 'The operator genuinely rebuilds forge-develop in the live builder. First, the BUILD tab\'s capability gate (R2-02-F3): an interactive agent\'s palette chip is greyed out and non-placeable, and even a raw drop naming it is rejected — both driven by the F1 capability descriptor, proven here against a one-shot fixture since no shipped library agent is presently declared interactive. Then: clear the seeded starter, drag three agents onto a blank canvas by HTML5 drag-and-drop, wire two edges by real ReactFlow handle-drag (labelling each via the ArtifactPicker), gate the terminal node, bind a KB, name it, and save. `studio lint` validates the result and a topological compare (agent-ref multiset + edge artifact labels + gate placement — not literal node ids, which the canvas always auto-generates) proves it matches the production seed\'s shape. Two honest UI limits: the seed\'s bare, agent-less gate node cannot be reproduced exactly (every UI-saved node carries a concrete agent), and triggers/kickoff/cost-ceiling have no UI surface at all.',
        drive: async (ctx) => {
              const { page, watch, browser, frame, recordClip, check, countAtLeast } = ctx;
              // ── A2: BUILD THE FORGE DEVELOP FLOW FROM SCRATCH, LIVE IN THE UI ─────────
              console.log('\n[A2] Build the forge-develop flow from scratch (flow-as-data)');
              cleanScratchFlow(); // defensive — a prior run's leftover, if any

              // R2-02-F3: register the capability fixture BEFORE the navigation
              // below so /flows/new's GET /api/studio/agents traffic is
              // intercepted — flips CAPABILITY_FIXTURE_AGENT's
              // capability.interactive to true (see CAPABILITY_FIXTURE_AGENT
              // comment up top). /flows/new fires TWO independent fetches to
              // this endpoint on mount (loadBuildData's agents prop and
              // AgentPalette's own load), so the handler mutates EVERY
              // intercepted response for the beat's duration — idempotently,
              // it only ever rewrites the one agent's field — rather than
              // unrouting after the first hit, which left the fetch that lost
              // the race unmutated. Cleanup is the existing end-of-beat
              // page.unroute below, once both fetches are safely done with.
              await page.route('**/api/studio/agents', async (route) => {
                const response = await route.fetch();
                const body = await response.json();
                const agents = Array.isArray(body.agents)
                  ? body.agents.map((a) => (a && a.slug === CAPABILITY_FIXTURE_AGENT
                      ? { ...a, capability: { interactive: true, runtimeSdks: a.capability?.runtimeSdks ?? [] } }
                      : a))
                  : body.agents;
                await route.fulfill({ response, json: { ...body, agents } });
              });

              await page.goto(watch.uiUrl + '/flows/new', { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                null, { timeout: 15000 },
              ).catch(() => {});
              await caption(page, 'Building the forge-develop flow from scratch, live: three agents dropped from the palette, two edges wired by hand, one verdict gate — the same shape as the production seed.');

              // R2-02-F3: BUILD-tab capability gate, checked against the fixture
              // above before anything else — a non-placeable palette chip, and a
              // rejected raw drop (bypassing the disabled chip's own dragstart
              // guard, belt-and-suspenders per FlowBuilderCanvas.onDrop).
              const fixtureChip = page.locator(`[data-palette-chip="agent"][data-chip-ref="${CAPABILITY_FIXTURE_AGENT}"]`);
              await fixtureChip.waitFor({ timeout: 8000 }).catch(() => {});
              const fixturePlaceable = await fixtureChip.getAttribute('data-chip-placeable').catch(() => null);
              check(fixturePlaceable === 'false',
                `author-from-scratch: an interactive agent's palette chip is non-placeable (data-chip-placeable="${fixturePlaceable}")`);

              const realChip = page.locator(`[data-palette-chip="agent"][data-chip-ref="${SCRATCH_CHAIN[0]}"]`);
              const realPlaceable = await realChip.getAttribute('data-chip-placeable').catch(() => null);
              check(realPlaceable === 'true',
                `author-from-scratch: a normal (unattended) agent's palette chip stays placeable (data-chip-placeable="${realPlaceable}")`);

              const nodeCountBeforeReject = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
              const canvasEl = page.locator('[data-component="flow-builder-canvas"]');
              const rejectDataTransfer = await page.evaluateHandle((ref) => {
                const dt = new DataTransfer();
                dt.setData('text/plain', JSON.stringify({ kind: 'agent', ref }));
                return dt;
              }, CAPABILITY_FIXTURE_AGENT);
              await canvasEl.dispatchEvent('dragover', { dataTransfer: rejectDataTransfer });
              await canvasEl.dispatchEvent('drop', { dataTransfer: rejectDataTransfer });
              await page.waitForSelector('[data-component="canvas-drop-reject"]', { timeout: 3000 }).catch(() => {});
              const rejectMessage = await page.evaluate(() =>
                document.querySelector('[data-component="canvas-drop-reject"]')?.getAttribute('data-drop-reject-message') ?? null);
              check(rejectMessage !== null && rejectMessage.toLowerCase().includes('interactive'),
                `author-from-scratch: FlowBuilderCanvas.onDrop rejects an interactive-agent drop even via a raw payload (message: "${rejectMessage}")`);
              const nodeCountAfterReject = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
              check(nodeCountAfterReject === nodeCountBeforeReject,
                `author-from-scratch: the rejected interactive-agent drop created no new node (count stayed ${nodeCountBeforeReject})`);
              await page.unroute('**/api/studio/agents').catch(() => {});
              await frame(page, 'a2-0b-capability-gate', 'A2 — the BUILD tab gates interactive-agent placement (R2-02-F3): a non-placeable palette chip, and a rejected drop, both driven by the F1 capability descriptor');

              // /flows/new always seeds the basic starter — there is no blank path.
              // WAIT for the starter fetch to land first: loadBuildData is async, and
              // clearing before it resolves lets the starter re-materialise over the
              // "blank" canvas (observed: plan/dev starter nodes under our drops).
              await page.waitForFunction(
                () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                null, { timeout: 15000 },
              ).catch(() => {});
              // Clear the canvas (native window.confirm) to author genuinely from scratch.
              page.once('dialog', (d) => d.accept());
              const clearBtn = page.locator('[data-action="clear-canvas"]');
              const clearPresent = (await clearBtn.count()) > 0;
              check(clearPresent, 'author-from-scratch: [data-action="clear-canvas"] present on a freshly seeded flow');
              if (clearPresent) await clearBtn.click();
              await page.waitForFunction(
                () => document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') === '0',
                null, { timeout: 8000 },
              ).catch(() => {});
              const clearedCount = await page.evaluate(() =>
                document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count'));
              check(clearedCount === '0', `author-from-scratch: clear-canvas empties the canvas (data-node-count="${clearedCount}")`);
              await sleep(READ);
              await frame(page, 'a2-0-blank-canvas', 'A2 — a genuinely blank canvas: cleared, ready to author from scratch');

              // Drop the three agents from the palette by HTML5 DnD.
              await countAtLeast(page, '[data-palette-chip="agent"]', 3, 'author-from-scratch: palette agent chips loaded before dropping');
              const canvasBox = await page.locator('[data-component="flow-builder-canvas"]').boundingBox();
              for (let i = 0; i < SCRATCH_CHAIN.length; i += 1) {
                const ref = SCRATCH_CHAIN[i];
                const x = canvasBox.x + canvasBox.width * SCRATCH_DROP_X_FRACTIONS[i];
                const y = canvasBox.y + canvasBox.height * SCRATCH_DROP_Y_FRACTION;
                await dropAgentNode(page, ref, x, y);
                await page.waitForFunction(
                  (n) => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= n,
                  i + 1, { timeout: 8000 },
                ).catch(() => {});
              }
              const droppedCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10));
              check(droppedCount === 3, `author-from-scratch: 3 agent nodes dropped onto the canvas via HTML5 DnD (data-node-count=${droppedCount})`);
              await frame(page, 'a2-1-nodes-dropped', 'A2 — dev → unifier → review agent nodes dropped from the palette (real HTML5 DnD)');

              // CRITICAL settle wait — FitOnChange's 60ms-delayed, 300ms-transition
              // auto-fit must finish before edge-wiring reads stable handle boxes.
              await sleep(800);

              const idFor = async (ref) => page.evaluate((r) =>
                document.querySelector(`[data-flow-node][data-agent-ref="${r}"]`)?.getAttribute('data-node-id') ?? null, ref);
              const [devId, unifierId, reviewId] = await Promise.all(SCRATCH_CHAIN.map(idFor));
              check(!!devId && !!unifierId && !!reviewId,
                `author-from-scratch: dropped nodes resolve to real node ids (${devId}, ${unifierId}, ${reviewId})`);

              // Edge 1: dev → unifier, artifact wi-branches (real ReactFlow handle-drag).
              const wired1 = devId && unifierId ? await wireEdge(page, devId, unifierId) : false;
              check(wired1, 'author-from-scratch: ReactFlow handle-drag wires dev → unifier');
              const picked1 = wired1 ? await pickArtifact(page, 'wi-branches') : false;
              check(picked1, 'author-from-scratch: ArtifactPicker labels the dev → unifier edge "wi-branches"');
              await sleep(THINK);

              // Edge 2: unifier → review, artifact pr.
              const wired2 = unifierId && reviewId ? await wireEdge(page, unifierId, reviewId) : false;
              check(wired2, 'author-from-scratch: ReactFlow handle-drag wires unifier → review');
              const picked2 = wired2 ? await pickArtifact(page, 'pr') : false;
              check(picked2, 'author-from-scratch: ArtifactPicker labels the unifier → review edge "pr"');
              const edgeCount = await page.evaluate(() =>
                document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-edge-count'));
              check(edgeCount === '2', `author-from-scratch: 2 edges wired (data-edge-count="${edgeCount}")`);
              await frame(page, 'a2-2-edges-wired', 'A2 — edges wired by real handle-drag; ArtifactPicker labels each (wi-branches, pr)');

              // Gate: click the terminal node to open its mini-panel; toggle the gate.
              let gateToggled = false;
              if (reviewId) {
                await page.locator(`[data-testid="rf__node-${reviewId}"]`).click({ force: true }).catch(() => {});
                try {
                  await page.waitForSelector(`[data-component="node-mini-panel"][data-panel-node-id="${reviewId}"]`, { timeout: 6000 });
                  await page.locator('[data-action="toggle-gate"]').click();
                  await sleep(THINK);
                  gateToggled = true;
                } catch { /* mini panel did not open */ }
                await page.keyboard.press('Escape').catch(() => {});
              }
              check(gateToggled, 'author-from-scratch: node-mini-panel opens on click; [data-action="toggle-gate"] sets the human verdict gate');
              await frame(page, 'a2-3-gate-toggled', 'A2 — the terminal node gated: a human verdict is required before this flow can complete');

              // KB bind — Advanced → kb-select (this one WORKS; not a UI limit).
              await page.locator('summary[data-action="toggle-flow-advanced"]').click().catch(() => {});
              await page.waitForFunction(
                () => document.querySelector('[data-section="flow-advanced"]')?.open === true,
                null, { timeout: 5000 },
              ).catch(() => {});
              const kbSelect = page.locator('[data-field="kb-select"]');
              let kbBound = false;
              if ((await kbSelect.count()) > 0) {
                await kbSelect.selectOption('cycles').catch(() => {});
                kbBound = (await kbSelect.inputValue().catch(() => '')) === 'cycles';
              }
              check(kbBound, 'author-from-scratch: Advanced kb-select binds the flow to the "cycles" KB');

              // Honest UI limits, narrated rather than faked: `resumable` has no UI
              // toggle; triggers are hardcoded to on:'complete' (the seed's real
              // trigger is on:'merged' — unreachable from this UI); kickoff and
              // costCeilingUsd have no UI fields at all (server defaults apply).
              // None of these gate the parity compare below — it only asserts the
              // shapes the UI genuinely CAN author.

              // Name + save.
              await page.locator('[data-field="flow-name"]').fill('Forge Develop Scratch');
              await page.locator('[data-action="save-flow"]').click();
              await page.waitForURL(new RegExp(`/flows/${SCRATCH_FLOW}`), { timeout: 15000 }).catch(() => {});
              const savedYamlPath = join(SCRATCH_FLOW_DIR, 'flow.yaml');
              const savedLanded = await waitForFile(savedYamlPath, 12000);
              check(savedLanded, `author-from-scratch: saving writes studio/flows/${SCRATCH_FLOW}/flow.yaml`);
              await sleep(READ);
              await frame(page, 'a2-4-saved', 'A2 — "Forge Develop Scratch" saved: a from-scratch flow, authored entirely in the UI');

              // `forge studio lint` validates the authored flow — the platform's own gate.
              let lintOk = false;
              try {
                execFileSync(process.execPath,
                  ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', 'lint'],
                  { cwd: FORGE_ROOT, stdio: 'pipe' });
                lintOk = true;
              } catch (e) {
                console.error(`  [studio lint A2] non-zero: ${(e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '')}`.slice(0, 600));
              }
              check(lintOk, 'author-from-scratch: `forge studio lint` validates the from-scratch flow (exit 0)');

              // Topological structural parity vs the production seed.
              if (savedLanded) {
                const seedDoc = yaml.load(readFileSync(SEED_FLOW_PATH, 'utf8'));
                const scratchDoc = yaml.load(readFileSync(savedYamlPath, 'utf8'));
                for (const { ok, label } of compareFlowTopology(seedDoc, scratchDoc)) {
                  check(ok, `author-from-scratch: ${label}`);
                }
              } else {
                check(false, 'author-from-scratch: topological parity vs the seed (skipped — save did not land)');
              }

              // Clip: the whole authoring arc, start to finish — the "money clip".
              // Re-authors the SAME-named flow in a fresh context: an idempotent
              // re-save of the same slug (not a collision), purely so the clip shows
              // the complete from-nothing arc rather than a partial replay. Entry
              // point is the library's real "+ New Flow" CTA (not a direct goto) —
              // the same trigger surface an operator actually clicks.
              await recordClip(browser, watch, 'flow-scratch-build', '/', async (p) => {
                await p.waitForFunction(
                  () => document.querySelector('[data-page="library"]')?.getAttribute('data-page-ready') === 'true',
                  null, { timeout: 8000 },
                ).catch(() => {});
                await caption(p, 'Starting from the library — the "+ New Flow" CTA is how an operator actually gets here.');
                await sleep(THINK);
                await p.locator('[data-action="new-flow"]').click().catch(() => {});
                await p.waitForFunction(
                  () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-active-tab') === 'build',
                  null, { timeout: 12000 },
                ).catch(() => {});
                // Same async-starter race as the main beat: wait for the seed to land
                // before clearing, or it re-materialises over the blank canvas.
                await p.waitForFunction(
                  () => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= 3,
                  null, { timeout: 12000 },
                ).catch(() => {});
                await caption(p, 'Clearing the seeded starter — rebuilding forge-develop genuinely from scratch.');
                await sleep(THINK);
                p.once('dialog', (d) => d.accept());
                await p.locator('[data-action="clear-canvas"]').click().catch(() => {});
                await p.waitForFunction(
                  () => document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') === '0',
                  null, { timeout: 6000 },
                ).catch(() => {});

                const box = await p.locator('[data-component="flow-builder-canvas"]').boundingBox();
                if (box) {
                  await caption(p, 'Three agents, dropped one by one from the palette — dev, unifier, review.');
                  for (let i = 0; i < SCRATCH_CHAIN.length; i += 1) {
                    const ref = SCRATCH_CHAIN[i];
                    const cx = box.x + box.width * SCRATCH_DROP_X_FRACTIONS[i];
                    const cy = box.y + box.height * SCRATCH_DROP_Y_FRACTION;
                    await dropAgentNode(p, ref, cx, cy).catch(() => {});
                    await p.waitForFunction(
                      (n) => parseInt(document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-node-count') ?? '0', 10) >= n,
                      i + 1, { timeout: 4000 },
                    ).catch(() => {});
                  }
                }
                // CRITICAL settle wait — mirrors the main beat: FitOnChange's
                // delayed auto-fit must finish before edge-wiring reads stable
                // handle boxes, or the drag lands on stale coordinates.
                await sleep(800);

                const clipIdFor = async (ref) => p.evaluate((r) =>
                  document.querySelector(`[data-flow-node][data-agent-ref="${r}"]`)?.getAttribute('data-node-id') ?? null, ref);
                const [d1, d2, d3] = await Promise.all(SCRATCH_CHAIN.map(clipIdFor));

                if (d1 && d2) {
                  const wired = await wireEdge(p, d1, d2).catch(() => false);
                  if (wired) {
                    await pickArtifact(p, 'wi-branches', {
                      calloutText: 'The ArtifactPicker pops — it labels the dev → unifier edge "wi-branches".',
                    }).catch(() => false);
                  }
                }
                await sleep(300);
                if (d2 && d3) {
                  const wired = await wireEdge(p, d2, d3).catch(() => false);
                  if (wired) {
                    await pickArtifact(p, 'pr', {
                      calloutText: 'And here — the picker labels the unifier → review edge as a PR hand-off.',
                    }).catch(() => false);
                  }
                }

                // Prove the edges actually landed before continuing — a bounded
                // wait, not a fixed sleep (the defect this fixes: the clip used
                // to proceed on stale/half-wired state and lose an edge).
                let edgesConfirmed = false;
                try {
                  await p.waitForFunction(
                    () => document.querySelector('[data-component="flow-builder-canvas"]')?.getAttribute('data-edge-count') === '2',
                    null, { timeout: 5000 },
                  );
                  edgesConfirmed = true;
                } catch { /* the clip still holds on whatever state it reached */ }

                if (edgesConfirmed && d3) {
                  await caption(p, 'Both edges wired — now gate the terminal node: a human verdict before this flow can complete.');
                  await sleep(THINK);
                  await p.locator(`[data-testid="rf__node-${d3}"]`).click({ force: true }).catch(() => {});
                  await p.locator('[data-action="toggle-gate"]').click().catch(() => {});
                  await p.keyboard.press('Escape').catch(() => {});
                  await sleep(400);
                  await caption(p, 'Name it, save it — forge-develop, rebuilt entirely as data.');
                  await p.locator('[data-field="flow-name"]').fill('Forge Develop Scratch').catch(() => {});
                  await p.locator('[data-action="save-flow"]').click().catch(() => {});
                  await p.waitForURL(new RegExp(`/flows/${SCRATCH_FLOW}`), { timeout: 12000 }).catch(() => {});
                  await sleep(1000);
                }
              }, { readySel: '[data-page="library"]', caption: 'From the library "+ New Flow" CTA to a saved, edge-proven flow — dev → unifier → review', holdTailMs: 1500 });

        },
      },
      {
        id: 'flows-author-seeded-run',
        title: 'Give the authored flow work (seeded run on my-first-flow)',
        narration: 'The freshly authored flow is handed a real run: its own plan/dev/review hexes progress and park at the verdict gate, with per-phase cost accruing — proof a user-authored flow is a first-class citizen of the monitor, not a demo-only shell.',
        drive: async (ctx) => {
              const { page, watch, check, frame, expectPhaseCost } = ctx;
              // ── J5: GIVE THE AUTHORED FLOW WORK (seeded run) ──────────────────────────
              // The user's authored flow (my-first-flow) is given work against the
              // onboarded project. Seeded (no real agents), this proves the monitor
              // surfaces a USER-AUTHORED flow's run — its plan→dev→review hexes progress
              // and the run parks at the verdict gate. (The full mdtoc idea→reflect
              // path is proven separately by the RUN act below.)
              console.log('\n[J5] Give the authored flow work (seeded run on my-first-flow)');
              cleanFirstFlowRun();
              // Seed a gated run: manifest (flow_id binds it to the authored flow) + events.
              mkdirSync(QDIR('ready-for-review'), { recursive: true });
              writeFileSync(join(QDIR('ready-for-review'), `${J5_INIT}.md`), [
                '---',
                `initiative_id: ${J5_INIT}`,
                `project: ${J4_PROJECT}`,
                `project_repo_path: ${join(FORGE_ROOT, 'projects', J4_PROJECT)}`,
                `created_at: '${new Date().toISOString()}'`,
                'iteration_budget: 3',
                'cost_budget_usd: 5',
                'phase: ready-for-review',
                'origin: human-directed',
                `cycle_id: ${J5_CYCLE_ID}`,
                `flow_id: ${J3_FLOW}`,
                '---',
                '',
                '# Give the authored flow work',
                '',
                'A seeded run proving the authored plan → dev → review flow renders in the monitor.',
                '',
              ].join('\n'));
              j5Event('orchestrator', 'start', 'cycle.start', { origin: 'human-directed' });
              j5Event('plan', 'start', 'plan.start');
              j5Event('plan', 'end', 'plan.end', {}, { cost_usd: 0.12, duration_ms: 24000 });
              j5Event('dev', 'start', 'dev.start');
              j5Event('dev', 'log', 'gate.pass', {});
              j5Event('dev', 'end', 'dev.end', {}, { cost_usd: 0.28, duration_ms: 41000 });
              j5Event('review', 'start', 'review.start');

              await page.goto(watch.uiUrl + `/flows/${J3_FLOW}`, { waitUntil: 'domcontentloaded' });
              await page.waitForFunction(
                () => document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-page-ready') === 'true',
                null, { timeout: 15000 },
              ).catch(() => {});
              // The run is discovered + associated with the authored flow (flow_id).
              const j5RunCount = await page.evaluate(() =>
                parseInt(document.querySelector('[data-page="flow-monitor"]')?.getAttribute('data-run-count') ?? '0', 10));
              check(j5RunCount >= 1, `J5: the authored flow shows the seeded run (run-count ${j5RunCount})`);
              // The monitor renders the authored flow's own nodes (plan/dev/review).
              for (const nodeId of ['plan', 'dev', 'review']) {
                await page.waitForSelector(`[data-mon-node][data-node-id="${nodeId}"]`, { timeout: 10000 }).catch(() => {});
                const present = await page.evaluate((n) => document.querySelector(`[data-mon-node][data-node-id="${n}"]`) !== null, nodeId);
                check(present, `J5: monitor renders the "${nodeId}" hex of the authored flow`);
              }
              // Phase statuses progressed (plan + dev complete) and the run parked at the gate.
              const planStatus = await page.evaluate(() =>
                document.querySelector('[data-mon-node][data-node-id="plan"]')?.getAttribute('data-status'));
              check(planStatus === 'complete', `J5: plan phase shows complete (got "${planStatus}")`);
              const reviewStatus = await page.evaluate(() =>
                document.querySelector('[data-mon-node][data-node-id="review"]')?.getAttribute('data-status'));
              check(reviewStatus === 'gated' || reviewStatus === 'active', `J5: review phase awaits the human verdict (got "${reviewStatus}")`);
              await expectPhaseCost(page, 'J5: the authored run shows accrued per-phase cost');
              await frame(page, 'j5-0-authored-run', 'J5 — the authored flow, given work, runs plan → dev → review to the verdict gate');
              // Clean the seeded run now so it does not bleed into the mdtoc RUN act.
              cleanFirstFlowRun();

        },
      },
    ],
});
