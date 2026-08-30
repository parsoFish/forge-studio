import { describe, it, expect } from 'vitest';
import { builderSnapshot, savedNodesCarryPositions } from './flow-builder-dirty';

// The exact shape the seed flows ship with: nodes carry NO x/y.
const SEED_NODES = [
  { id: 'plan', agent: 'plan' },
  { id: 'dev', agent: 'dev' },
];
// What rfNodesToFlow always hands back — autolayout positions, always present.
const CANVAS_NODES = [
  { id: 'plan', agent: 'plan', x: 40, y: 120 },
  { id: 'dev', agent: 'dev', x: 300, y: 120 },
];
const HEADER = { name: 'Develop', goal: 'ship it', project: '', kb: '', triggers: [] };

describe('savedNodesCarryPositions', () => {
  it('is false for a seed flow shipped without positions', () => {
    expect(savedNodesCarryPositions(SEED_NODES)).toBe(false);
  });

  it('is true once any saved node carries a position', () => {
    expect(savedNodesCarryPositions(CANVAS_NODES)).toBe(true);
    expect(savedNodesCarryPositions([{ id: 'a', agent: 'a' }, { id: 'b', agent: 'b', x: 1 }])).toBe(true);
  });

  it('is false for a missing or non-array node list', () => {
    expect(savedNodesCarryPositions(null)).toBe(false);
    expect(savedNodesCarryPositions(undefined)).toBe(false);
  });
});

describe('builderSnapshot', () => {
  // THE REGRESSION: this is the comparison the page actually makes — baseline
  // from the file, live side from the canvas. Before the fix these two never
  // matched for a seed flow, so an untouched seed reported unsaved edits.
  it('reports an untouched seed flow as CLEAN despite synthesized canvas positions', () => {
    const includePositions = savedNodesCarryPositions(SEED_NODES);
    const baseline = builderSnapshot(HEADER, SEED_NODES, [], includePositions);
    const live = builderSnapshot(HEADER, CANVAS_NODES, [], includePositions);
    expect(live).toBe(baseline);
  });

  it('still reports a real edit as dirty on a seed flow', () => {
    const includePositions = savedNodesCarryPositions(SEED_NODES);
    const baseline = builderSnapshot(HEADER, SEED_NODES, [], includePositions);
    const edited = builderSnapshot(
      HEADER,
      [...CANVAS_NODES, { id: 'review', agent: 'review', x: 560, y: 120 }],
      [],
      includePositions,
    );
    expect(edited).not.toBe(baseline);
  });

  it('still reports a header edit as dirty', () => {
    const includePositions = savedNodesCarryPositions(SEED_NODES);
    const baseline = builderSnapshot(HEADER, SEED_NODES, [], includePositions);
    const edited = builderSnapshot({ ...HEADER, goal: 'changed' }, CANVAS_NODES, [], includePositions);
    expect(edited).not.toBe(baseline);
  });

  // J3 stays protected: a flow whose FILE carries a layout still treats a drag
  // as an unsaved edit, because there the positions are the operator's.
  it('treats a drag as dirty when the saved file carries positions', () => {
    const includePositions = savedNodesCarryPositions(CANVAS_NODES);
    expect(includePositions).toBe(true);
    const baseline = builderSnapshot(HEADER, CANVAS_NODES, [], includePositions);
    const dragged = builderSnapshot(
      HEADER,
      [{ id: 'plan', agent: 'plan', x: 41, y: 120 }, CANVAS_NODES[1]],
      [],
      includePositions,
    );
    expect(dragged).not.toBe(baseline);
  });

  it('is order-insensitive across object keys but not across node order', () => {
    const a = builderSnapshot(HEADER, [{ id: 'x', agent: 'y' }], [], false);
    const b = builderSnapshot(HEADER, [{ agent: 'y', id: 'x' }], [], false);
    expect(a).toBe(b);
  });
});
