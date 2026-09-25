'use client';

import type { Catalog, AgentRuntime, AgentFanout, AgentBudgets } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// YamlPreview — live-rendered preview of the definition as it will be SAVED.
//
// agents-15: this used to take ~13 individually hand-passed props and render
// a hand-maintained subset of AgentDefinition's fields — phase, fanout,
// allowed-tools and disallowed-tools were simply never wired through, so the
// preview drifted silently from what the save path actually sent. It now
// takes ONE `definition` object — `buildAgentPreviewModel`'s output
// (lib/agent-authoring-view.ts), itself built by spreading the REAL save
// serializer's (`buildAgentPutBody`) own return value plus the read-only
// pass-through fields that function deliberately omits — so a field can
// only go missing from the preview by going missing from that ONE model,
// never by a second hand-copied prop list falling out of sync with it.
//
// agents-15 (forge-6gv.5.1): `description`, `library`, `surface`, `executor`
// and `budgets` were missing from the preview for the same reason — `Agent`
// never parsed them off the wire at all. Now that the wire type + parser
// moved to lib/agent-wire.ts (out of studio-client.ts, which was pinned at
// its 800-line file-size ratchet ceiling), `buildAgentPreviewModel` carries
// all five and this component renders them the SAME way as `phase`/`fanout`
// just above: declared-or-absent, straight off the one model, never a
// second hand-maintained field list.
// ---------------------------------------------------------------------------

/** The shape `buildAgentPreviewModel` returns — loosely typed (it is built
 *  from a `Record<string, unknown>` spread) but every key this component
 *  reads is named here so a rename on either side is a type error, not a
 *  silently-blank preview row. */
type Definition = {
  slug?: string;
  name?: string;
  phase?: string;
  purpose?: string;
  composition?: { skills?: string[]; tools?: string[]; mcps?: string[]; guards?: string[]; hooks?: string[] };
  materials?: string[];
  process?: string;
  interactivity?: string;
  runtime?: AgentRuntime;
  fanout?: AgentFanout;
  brainAccess?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  // agents-15 (forge-6gv.5.1)
  description?: string;
  library?: boolean;
  surface?: string;
  executor?: string;
  budgets?: AgentBudgets;
};

type Props = {
  definition: Definition;
  catalog: Catalog;
};

function catalogName(catalog: Catalog, id: string): string {
  const all = [
    ...(catalog.skills ?? []),
    ...(catalog.tools ?? []),
    ...(catalog.mcps ?? []),
    ...(catalog.guards ?? []),
    ...(catalog.hooks ?? []),
  ];
  return (all.find((i) => i.id === id)?.name as string) ?? id;
}

function modelName(catalog: Catalog, id: string | null | undefined): string {
  if (!id) return '(not set)';
  const m = (catalog.models ?? []).find((m) => m.id === id);
  return m ? String(m.name) : id;
}

function sdkName(catalog: Catalog, id: string): string {
  const s = (catalog.sdks ?? []).find((s) => s.id === id);
  return s ? String(s.name) : id;
}

// Produce syntax-highlighted spans — rendered with dangerouslySetInnerHTML
// The content is entirely built from our own state (no user-injected HTML).
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildYaml(definition: Definition, catalog: Catalog): string {
  const {
    slug, name, phase, purpose, composition, materials, process, interactivity,
    runtime, fanout, brainAccess, allowedTools, disallowedTools,
    description, library, surface, executor, budgets,
  } = definition;
  const comp = composition ?? {};

  const lines: string[] = [];

  const kv = (key: string, val: string) =>
    `<span class="yaml-key">${esc(key)}:</span> <span class="yaml-val">${esc(val)}</span>`;
  const sect = (label: string) =>
    `<span class="yaml-sect">${esc(label)}:</span>`;
  const listItem = (s: string) =>
    `  - <span class="yaml-list">${esc(s)}</span>`;
  const emptyList = () =>
    `  <span class="yaml-list">[]</span>`;

  function listIds(ids: string[] | undefined) {
    const names = (ids ?? []).map((id) => catalogName(catalog, id));
    if (names.length === 0) { lines.push(emptyList()); return; }
    names.forEach((n) => lines.push(listItem(n)));
  }

  // Materials/allowed-tools/disallowed-tools are plain string vocabularies,
  // not catalog entries — rendered as-is rather than through catalogName's
  // lookup (materials: the closed MATERIAL_KINDS set; allowed/disallowed:
  // raw Claude Code tool names).
  function listRaw(values: string[] | undefined) {
    if (!values || values.length === 0) { lines.push(emptyList()); return; }
    values.forEach((v) => lines.push(listItem(v)));
  }

  lines.push(kv('slug', slug || '(new)'));
  lines.push(kv('name', name || '(unnamed)'));
  // phase — agents-15: SKILL.md-authored, read-only (ADR-027); shown only
  // when actually declared, same "absent is meaningful" discipline the rest
  // of this preview already uses.
  if (phase) lines.push(kv('phase', phase));
  // agents-15 (forge-6gv.5.1): SKILL.md-authored metadata, same
  // "declared vs absent" discipline as `phase` just above. `library` is a
  // real declared boolean (`false` is meaningful, not "absent") so its row
  // is gated on `!== undefined`, not truthiness.
  if (description) lines.push(kv('description', description));
  if (library !== undefined) lines.push(kv('library', String(library)));
  if (surface) lines.push(kv('surface', surface));
  if (executor) lines.push(kv('executor', executor));
  lines.push(kv('purpose', purpose || '—'));
  lines.push('');
  lines.push(sect('composition'));
  lines.push(`  ${kv('skills', '')}`); listIds(comp.skills);
  lines.push(`  ${kv('tools', '')}`); listIds(comp.tools);
  lines.push(`  ${kv('mcps', '')}`); listIds(comp.mcps);
  lines.push(`  ${kv('guards', '')}`); listIds(comp.guards);
  lines.push(`  ${kv('hooks', '')}`); listIds(comp.hooks);
  lines.push('');
  // materials is a TOP-LEVEL field (mirrors `fanout`), not nested under
  // composition (D1, packages/agents/studio/materials.ts) — rendered as its
  // own section, not indented under composition:.
  lines.push(sect('materials'));
  listRaw(materials);
  lines.push('');
  lines.push(sect('process'));
  (process || '—').split('\n').forEach((l) =>
    lines.push(`  <span class="yaml-val">${esc(l)}</span>`)
  );
  lines.push('');
  lines.push(sect('interactivity'));
  (interactivity || '—').split('\n').forEach((l) =>
    lines.push(`  <span class="yaml-val">${esc(l)}</span>`)
  );
  lines.push('');
  lines.push(sect('runtime'));
  const rt = runtime;
  lines.push(`  ${kv('sdk', sdkName(catalog, rt?.sdk ?? ''))}`);
  lines.push(`  ${kv('strategy', rt?.strategy ?? 'fixed')}`);
  if ((rt?.strategy ?? 'fixed') === 'fixed') {
    lines.push(`  ${kv('model', modelName(catalog, rt?.model))}`);
  } else {
    lines.push(`  <span class="yaml-key">range:</span>`);
    const range = rt?.range ?? [];
    if (range.length === 0) {
      lines.push(`    <span class="yaml-list">[]</span>`);
    } else {
      range.forEach((id) =>
        lines.push(`    - <span class="yaml-list">${esc(modelName(catalog, id))}</span>`)
      );
    }
  }
  // fanout — agents-15: absent (not fanout-capable) renders nothing at all,
  // same "declared vs absent" discipline as materials/`AgentFanout` itself.
  if (fanout) {
    lines.push('');
    lines.push(sect('fanout'));
    lines.push(`  ${kv('drivingArtifact', fanout.drivingArtifact)}`);
    lines.push(`  ${kv('isolation', fanout.isolation)}`);
    if (fanout.concurrencyCap !== undefined) lines.push(`  ${kv('concurrencyCap', String(fanout.concurrencyCap))}`);
    if (fanout.perItemGate) lines.push(`  ${kv('perItemGate', fanout.perItemGate)}`);
  }
  // budgets — agents-15 (forge-6gv.5.1): same "declared vs absent"
  // discipline as fanout just above; a declared-but-empty block (no
  // overrides) renders no section at all rather than an empty header.
  if (budgets && Object.keys(budgets).length > 0) {
    lines.push('');
    lines.push(sect('budgets'));
    if (budgets.iterationFloor !== undefined) lines.push(`  ${kv('iterationFloor', String(budgets.iterationFloor))}`);
    if (budgets.iterationCap !== undefined) lines.push(`  ${kv('iterationCap', String(budgets.iterationCap))}`);
    if (budgets.maxTurnsPerIteration !== undefined) lines.push(`  ${kv('maxTurnsPerIteration', String(budgets.maxTurnsPerIteration))}`);
    if (budgets.wedgeKillMs !== undefined) lines.push(`  ${kv('wedgeKillMs', String(budgets.wedgeKillMs))}`);
    if (budgets.maxTurns !== undefined) lines.push(`  ${kv('maxTurns', String(budgets.maxTurns))}`);
    if (budgets.maxBudgetUsd !== undefined) lines.push(`  ${kv('maxBudgetUsd', String(budgets.maxBudgetUsd))}`);
    if (budgets.maxBudgetUsdShare !== undefined) lines.push(`  ${kv('maxBudgetUsdShare', String(budgets.maxBudgetUsdShare))}`);
  }
  lines.push('');
  lines.push(kv('brain_access', brainAccess || 'none'));
  lines.push('');
  lines.push(`  ${kv('allowed-tools', '')}`); listRaw(allowedTools);
  lines.push(`  ${kv('disallowed-tools', '')}`); listRaw(disallowedTools);

  return lines.join('\n');
}

export function YamlPreview({ definition, catalog }: Props) {
  const html = buildYaml(definition, catalog);

  return (
    <div className="preview-panel panel" style={{ margin: '12px 12px 0', borderRadius: 'var(--radius)' }} data-component="yaml-preview">
      <div className="panel-head">
        <span>Definition Preview</span>
        <span className="spacer" />
        <span className="badge badge-dim" style={{ fontSize: 9.5 }}>YAML</span>
      </div>
      <div className="preview-block" style={{ margin: 0, border: 'none', borderRadius: '0 0 var(--radius) var(--radius)' }}>
        <pre
          id="yaml-preview"
          aria-label="Live YAML manifest"
          // Safe: all content is esc()-escaped above from known state values
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
