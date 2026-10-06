// forge's documentation site. Static build only; publishing waits for the
// operator's hosting gate. Plugins are the ratified set (R14) and nothing else.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightSidebarTopics from 'starlight-sidebar-topics';
import starlightLinksValidator from 'starlight-links-validator';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightPageActions from 'starlight-page-actions';
import { baseLinks } from './src/base-links.mjs';

export default defineConfig({
  // GitHub Pages project site (operator ruling R27).
  site: 'https://parsofish.github.io',
  base: '/forge-studio',
  // The monorepo root hoists an older `cookie` (express's); bundling it makes the
  // prerender chunk use astro's own copy instead of resolving the root one.
  vite: { resolve: { noExternal: ['cookie'] } },
  integrations: [
    baseLinks(),
    starlight({
      title: 'forge',
      description: 'Build and run agentic software factories.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/parsoFish/forge-studio' }],
      routeMiddleware: './src/route-data.ts',
      components: { LastUpdated: './src/components/LastUpdated.astro' },
      plugins: [
        starlightSidebarTopics([
          {
            label: 'Guides',
            link: '/how-forge-works/',
            icon: 'open-book',
            items: [
              'how-forge-works',
              { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
            ],
          },
          {
            label: 'Reference',
            link: '/reference/',
            icon: 'information',
            items: [{ autogenerate: { directory: 'reference' } }],
          },
        ]),
        starlightLinksValidator(),
        starlightLlmsTxt(),
        // The plugin also writes each page's raw markdown next to its HTML
        // (`<path>.md`), which is the per-page agent surface.
        starlightPageActions({ actions: { chatgpt: false, claude: true, markdown: true } }),
      ],
    }),
  ],
});
