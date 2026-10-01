/**
 * Row 174 (forge-8vfn.8.5.9): the roadmap says "not claimable" before the
 * operator presses Start development on a ground the scheduler would refuse
 * (DEPS — no node_modules). Measured on the M7-E stranger run: the refusal
 * otherwise lives only in `_logs/daemon/serve.log`.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { NotClaimableNotice } from '../../components/studio/NotClaimableNotice';

const render = (runnableGate: { pass: boolean; detail: string } | null) =>
  renderToStaticMarkup(React.createElement(NotClaimableNotice, { projectId: 'gitpulse', runnableGate }));

test('a failing runnable gate renders the not-claimable notice naming DEPS and the fix', () => {
  const html = render({ pass: false, detail: 'no node_modules/ exists in the ground' });
  expect(html).toContain('data-section="not-claimable"');
  expect(html).toContain('data-clause="DEPS"');
  expect(html).toContain('Not claimable: DEPS');
  expect(html).toContain('npm ci');
  expect(html).toContain('projects/gitpulse');
  expect(html).toContain('no node_modules/ exists in the ground');
});

test('a passing or unknown runnable gate renders nothing', () => {
  expect(render({ pass: true, detail: 'provisioned' })).toBe('');
  expect(render(null)).toBe('');
});
