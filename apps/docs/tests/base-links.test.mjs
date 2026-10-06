/**
 * base-links.test.mjs — the site is served under a sub-path (operator ruling
 * R27), and pages keep writing root-absolute links. `withBase` prefixes them;
 * the build-level door is site-build.test.mjs, whose control page links
 * `/how-forge-works/` and builds only because the plugin prefixes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBase, baseLinksHastPlugin } from '../src/base-links.mjs';

const B = '/forge-studio';

test('a root-absolute page link and a public-media path gain the base', () => {
  assert.equal(withBase('/guides/install/', B), '/forge-studio/guides/install/');
  assert.equal(withBase('/media/stories/S1/01.png', B), '/forge-studio/media/stories/S1/01.png');
  assert.equal(withBase('/', B), '/forge-studio/');
});

test('links that are not root-absolute, or already carry the base, are left alone', () => {
  for (const url of ['https://github.com/parsoFish/forge-studio', '//cdn.example/x.js', '#see-it-run', 'guides/x/', '../x/', '/forge-studio/guides/x/', '/forge-studio']) {
    assert.equal(withBase(url, B), url, url);
  }
  assert.equal(withBase(undefined, B), undefined);
});

test('a root base changes nothing', () => {
  assert.equal(withBase('/guides/install/', '/'), '/guides/install/');
});

test('a base path that merely starts the same way is still prefixed', () => {
  assert.equal(withBase('/forge-studio-old/x/', B), '/forge-studio/forge-studio-old/x/');
});

test('the hast plugin rewrites a[href] and img[src] through the visitor context only', () => {
  const plugin = baseLinksHastPlugin(B)();
  assert.deepEqual(plugin.element.filter.sort(), ['a', 'img']);
  const calls = [];
  const ctx = { setProperty: (node, key, value) => calls.push([node.tagName, key, value]) };
  plugin.element.visit({ tagName: 'a', properties: { href: '/reference/cli/' } }, ctx);
  plugin.element.visit({ tagName: 'img', properties: { src: '/media/x.png' } }, ctx);
  plugin.element.visit({ tagName: 'a', properties: { href: 'https://example.com' } }, ctx);
  assert.deepEqual(calls, [
    ['a', 'href', '/forge-studio/reference/cli/'],
    ['img', 'src', '/forge-studio/media/x.png'],
  ]);
});
