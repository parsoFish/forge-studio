/**
 * Acceptance tests for the OOTB-provenance badge (R6-03-F3, exit row 2).
 *
 * Immutable-gate, RED-first (the component does not exist at PIN). The badge is
 * the shared primitive the end-state mockup defines; it must render an "ootb"
 * mark for shipped objects, "planned" for vision objects, and NOTHING for
 * operator-authored ones — the badge is never fabricated for the default case.
 * The Flow-origin mapping only claims OOTB from the real seed signal.
 *
 * RUN: npx vitest run components/ProvenanceBadge.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceBadge, provenanceOfFlowOrigin } from './ProvenanceBadge';

function render(provenance?: 'ootb' | 'operator' | 'vision' | null): string {
  return renderToStaticMarkup(React.createElement(ProvenanceBadge, { provenance }));
}

test('ootb renders the ootb badge with a machine-readable data-provenance', () => {
  const html = render('ootb');
  expect(html).toContain('badge-ootb');
  expect(html).toContain('data-provenance="ootb"');
  expect(html).toContain('ootb');
});

test('vision renders a dim "planned" badge', () => {
  const html = render('vision');
  expect(html).toContain('data-provenance="vision"');
  expect(html).toContain('planned');
});

test('operator-authored (and unknown/null) render NOTHING — no fabricated badge', () => {
  // Kills a badge that defaults every object to "ootb".
  expect(render('operator')).toBe('');
  expect(render(undefined)).toBe('');
  expect(render(null)).toBe('');
});

test('a Flow origin maps to provenance only from the real seed signal', () => {
  expect(provenanceOfFlowOrigin('seed')).toBe('ootb');
  expect(provenanceOfFlowOrigin('ootb-library')).toBe('ootb');
  // Operator + absent origin are NOT OOTB — never claim shipped without the signal.
  expect(provenanceOfFlowOrigin('studio')).toBe('operator');
  expect(provenanceOfFlowOrigin(undefined)).toBe('operator');
  expect(provenanceOfFlowOrigin(null)).toBe('operator');
});
