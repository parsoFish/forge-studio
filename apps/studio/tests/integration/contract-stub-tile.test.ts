/**
 * forge-mfv5.1.11 — the onboarding session's build-out tiles show a scaffold stub
 * as `stub`, never as a green "present".
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ContractBuildout } from '../../components/studio/ContractBuildout';
import { parseContractStageRow } from '@/lib/session-client';

test('a stub row parses from the bridge and renders as stub, not ok', () => {
  const row = parseContractStageRow({ stage: 'demo', status: 'stub', source: '.forge/project.json', detail: ['only the onboarding placeholder steps are declared'], bytes: null }, 0);
  const html = renderToStaticMarkup(
    React.createElement(ContractBuildout, { view: { kind: 'contract-buildout', mode: 'checklist', row: null, checklist: [row] } } as never),
  );
  expect(html).toContain('data-checklist-status="stub"');
  expect(html).not.toContain('readiness-item ok');
  expect(html).toContain('— stub');
});
