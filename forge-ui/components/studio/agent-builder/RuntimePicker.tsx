'use client';

import type { Catalog, CatalogItem, AgentRuntime } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// RuntimePicker — SDK cards, strategy toggle, model chips, sub-agent model,
// brain-access cards
// ---------------------------------------------------------------------------

type Props = {
  runtime: AgentRuntime;
  brainAccess: string;
  catalog: Catalog;
  onRuntimeChange: (runtime: AgentRuntime) => void;
  onBrainAccessChange: (value: string) => void;
  onToast: (msg: string) => void;
};

function modelsForSdk(catalog: Catalog, sdkId: string): CatalogItem[] {
  return (catalog.models ?? []).filter((m) => m.sdk === sdkId);
}

function formatCost(m: CatalogItem): string {
  const costIn = m.costIn as number | undefined;
  const costOut = m.costOut as number | undefined;
  if (costIn === 0 && costOut === 0) return 'local';
  if (costIn == null || costOut == null) return '';
  return `$${costIn}/$${costOut} per Mtok`;
}

function sdkAvailable(sdk: CatalogItem): boolean {
  return sdk.available !== false;
}

export function RuntimePicker({
  runtime,
  brainAccess,
  catalog,
  onRuntimeChange,
  onBrainAccessChange,
  onToast,
}: Props) {
  const sdks = catalog.sdks ?? [];
  const isRange = runtime.strategy === 'range';
  const sdkModels = modelsForSdk(catalog, runtime.sdk);

  // computed model count for data-attr
  const modelCount = isRange
    ? runtime.range.length
    : (runtime.model ? 1 : 0);

  function selectSdk(sdkId: string) {
    if (runtime.sdk === sdkId) return;
    const sdk = sdks.find((s) => s.id === sdkId);
    if (!sdk || !sdkAvailable(sdk)) {
      onToast(`${sdk ? String(sdk.name) : sdkId} is not installed — register an adapter to enable it.`);
      return;
    }
    const newModels = modelsForSdk(catalog, sdkId).map((m) => m.id);
    const cleared: string[] = [];

    let model = runtime.model;
    let range = runtime.range;

    if (model && !newModels.includes(model)) { model = null; cleared.push('primary model'); }
    const filteredRange = range.filter((id) => newModels.includes(id));
    if (filteredRange.length !== range.length) { range = filteredRange; cleared.push('model range'); }

    if (cleared.length > 0) onToast(`SDK changed — cleared: ${cleared.join(', ')}.`);
    onRuntimeChange({ ...runtime, sdk: sdkId, model, range });
  }

  function setStrategy(strategy: 'fixed' | 'range') {
    if (runtime.strategy === strategy) return;
    onRuntimeChange({ ...runtime, strategy });
  }

  function toggleModel(modelId: string) {
    if (isRange) {
      const range = runtime.range.includes(modelId)
        ? runtime.range.filter((id) => id !== modelId)
        : [...runtime.range, modelId];
      onRuntimeChange({ ...runtime, range });
    } else {
      const model = runtime.model === modelId ? null : modelId;
      onRuntimeChange({ ...runtime, model });
    }
  }

  return (
    <div
      className="field-group"
      data-section="runtime"
      data-component="runtime-picker"
      data-sdk={runtime.sdk}
      data-strategy={runtime.strategy}
      data-model-count={modelCount}
    >
      {/* Section header */}
      <div className="runtime-section-header">
        <label className="field-label" style={{ margin: 0 }}>Runtime</label>
        <span className="runtime-section-caption">
          the runtime this agent executes on — flows can mix runtimes per agent
        </span>
      </div>

      {/* SDK cards */}
      <div style={{ marginBottom: 14 }}>
        <div className="field-label" style={{ marginBottom: 8 }}>SDK</div>
        <div className="sdk-cards" id="sdk-cards">
          {sdks.map((sdk) => {
            const available = sdkAvailable(sdk);
            const selected = runtime.sdk === sdk.id;
            return (
              <div
                key={String(sdk.id)}
                className={`sdk-card${selected ? ' selected' : ''}${!available ? ' disabled' : ''}`}
                data-sdk-id={sdk.id}
                tabIndex={available ? 0 : -1}
                title={!available ? 'Not installed — coming in a future milestone' : undefined}
                style={!available ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                onClick={() => selectSdk(String(sdk.id))}
                onKeyDown={(e) => { if (available && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectSdk(String(sdk.id)); } }}
              >
                <div className="sdk-card-name">{String(sdk.name)}</div>
                <div className="sdk-card-vendor">{String(sdk.vendor ?? '')}</div>
                <div className="sdk-card-desc">{String(sdk.desc ?? '')}</div>
                {!available && (
                  <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 3, fontStyle: 'italic' }}>coming soon</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Strategy segmented control */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <div className="field-label" style={{ margin: 0 }}>Model Strategy</div>
          <div className="seg-control">
            <button
              className={`seg-btn${!isRange ? ' active' : ''}`}
              data-strategy="fixed"
              id="seg-fixed"
              onClick={() => setStrategy('fixed')}
            >
              Fixed
            </button>
            <button
              className={`seg-btn${isRange ? ' active' : ''}`}
              data-strategy="range"
              id="seg-range"
              onClick={() => setStrategy('range')}
            >
              Range
            </button>
          </div>
        </div>
        {isRange && (
          <div id="strategy-caption" style={{ fontSize: 12, color: 'var(--faint)', marginBottom: 6 }}>
            the agent routes each task to the cheapest model that can do it
          </div>
        )}
        <ModelChipRow
          models={sdkModels}
          selectedIds={isRange ? runtime.range : (runtime.model ? [runtime.model] : [])}
          onToggle={toggleModel}
        />
      </div>

      {/* Brain / Knowledge access */}
      <div>
        <div className="field-label" style={{ marginBottom: 8 }}>Knowledge Access</div>
        <div className="brain-options" id="brain-options">
          {(['mandatory', 'advisory', 'none'] as const).map((access) => (
            <BrainAccessCard
              key={access}
              access={access}
              selected={brainAccess === access}
              onSelect={onBrainAccessChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelChipRow
// ---------------------------------------------------------------------------

type ModelChipRowProps = {
  models: CatalogItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
};

function ModelChipRow({ models, selectedIds, onToggle }: ModelChipRowProps) {
  if (models.length === 0) {
    return (
      <div className="model-chip-row" id="model-chip-row-main">
        <span style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}>
          No models available for this SDK.
        </span>
      </div>
    );
  }
  return (
    <div className="model-chip-row">
      {models.map((m) => {
        const selected = selectedIds.includes(String(m.id));
        const tier = String(m.tier ?? 'worker');
        const cost = formatCost(m);
        return (
          <div
            key={String(m.id)}
            className={`model-chip${selected ? ' selected' : ''}`}
            data-model-id={m.id}
            tabIndex={0}
            onClick={() => onToggle(String(m.id))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(String(m.id)); } }}
          >
            <span className="dot" />
            {String(m.name)}
            <span className="tier-badge" data-tier={tier}>{tier}</span>
            {cost && <span className="cost-label">{cost}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BrainAccessCard
// ---------------------------------------------------------------------------

const BRAIN_LABELS: Record<string, string> = {
  mandatory: 'Mandatory',
  advisory:  'Advisory',
  none:      'None',
};
const BRAIN_DESCS: Record<string, string> = {
  mandatory: 'must query the knowledge base before acting — planners',
  advisory:  'may consult project knowledge — supplemental',
  none:      'works only from its inputs — the work item is the single source of intent',
};

function BrainAccessCard({ access, selected, onSelect }: { access: string; selected: boolean; onSelect: (v: string) => void }) {
  return (
    <div
      className={`brain-option${selected ? ' selected' : ''}`}
      data-access={access}
      tabIndex={0}
      onClick={() => onSelect(access)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(access); } }}
    >
      <div className="brain-option-label">{BRAIN_LABELS[access] ?? access}</div>
      <div className="brain-option-desc">{BRAIN_DESCS[access] ?? ''}</div>
    </div>
  );
}
