'use client';

import type { Catalog, AgentRuntime } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// YamlPreview — live-rendered YAML mirroring save shape
// ---------------------------------------------------------------------------

type Props = {
  slug: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  hooks: string[];
  process: string;
  interactivity: string;
  runtime: AgentRuntime;
  brainAccess: string;
  catalog: Catalog;
};

function catalogName(catalog: Catalog, id: string): string {
  const all = [
    ...(catalog.skills ?? []),
    ...(catalog.tools ?? []),
    ...(catalog.mcps ?? []),
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

function buildYaml(props: Props): string {
  const { slug, name, purpose, skills, tools, mcps, hooks, process, interactivity, runtime, brainAccess, catalog } = props;

  const lines: string[] = [];

  const kv = (key: string, val: string) =>
    `<span class="yaml-key">${esc(key)}:</span> <span class="yaml-val">${esc(val)}</span>`;
  const sect = (label: string) =>
    `<span class="yaml-sect">${esc(label)}:</span>`;
  const listItem = (s: string) =>
    `  - <span class="yaml-list">${esc(s)}</span>`;
  const emptyList = () =>
    `  <span class="yaml-list">[]</span>`;

  function listIds(ids: string[]) {
    const names = ids.map((id) => catalogName(catalog, id));
    if (names.length === 0) { lines.push(emptyList()); return; }
    names.forEach((n) => lines.push(listItem(n)));
  }

  lines.push(kv('slug', slug || '(new)'));
  lines.push(kv('name', name || '(unnamed)'));
  lines.push(kv('purpose', purpose || '—'));
  lines.push('');
  lines.push(sect('composition'));
  lines.push(`  ${kv('skills', '')}`); listIds(skills);
  lines.push(`  ${kv('tools', '')}`); listIds(tools);
  lines.push(`  ${kv('mcps', '')}`); listIds(mcps);
  lines.push(`  ${kv('hooks', '')}`); listIds(hooks);
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
  lines.push(`  ${kv('sdk', sdkName(catalog, runtime.sdk))}`);
  lines.push(`  ${kv('strategy', runtime.strategy)}`);
  if (runtime.strategy === 'fixed') {
    lines.push(`  ${kv('model', modelName(catalog, runtime.model))}`);
  } else {
    lines.push(`  <span class="yaml-key">range:</span>`);
    if (runtime.range.length === 0) {
      lines.push(`    <span class="yaml-list">[]</span>`);
    } else {
      runtime.range.forEach((id) =>
        lines.push(`    - <span class="yaml-list">${esc(modelName(catalog, id))}</span>`)
      );
    }
  }
  lines.push('');
  lines.push(kv('brain_access', brainAccess));

  return lines.join('\n');
}

export function YamlPreview(props: Props) {
  const html = buildYaml(props);

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
