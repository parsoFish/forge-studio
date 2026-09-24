/**
 * `forge-8vfn.6.11.37` — CreateFromTemplate's error paragraph carried no
 * `data-*` handle, so a failed create's message was unreadable by a beat
 * (S2 run 6 needed a CLI probe to learn it). The failure lives in
 * `useState` inside `CreateFromTemplate`, which `renderToStaticMarkup`
 * cannot reach, so the paragraph is pulled out as its own presentational
 * component, `CreateError({ message })`, and pinned directly here.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateError } from '@/components/studio/CreateFromTemplate';

test('CreateError renders exactly one data-section="create-error" carrying the message', () => {
  const html = renderToStaticMarkup(React.createElement(CreateError, { message: 'create failed: name taken' }));
  const matches = html.match(/data-section="create-error"/g) ?? [];
  expect(matches).toHaveLength(1);
  expect(html).toContain('create failed: name taken');
});

test('CreateError renders nothing when there is no message', () => {
  const html = renderToStaticMarkup(React.createElement(CreateError, { message: null }));
  expect(html).toBe('');
});
