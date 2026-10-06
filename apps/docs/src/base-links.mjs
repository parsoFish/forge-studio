// Prefixes root-absolute link and image URLs in docs pages with the site's
// base path, so pages keep writing `/guides/x/` and `/media/...` and still
// resolve when the site is served under a sub-path. It runs on Astro's own
// Markdown processor (Sätteri), registered ahead of the links validator so the
// validator checks the prefixed URLs. No new dependency: the plugin is a plain
// definition object, the same shape the validator itself registers.

/** `url` with `base` in front when it is root-absolute and not already prefixed. */
export function withBase(url, base) {
  const prefix = base.replace(/\/+$/, '');
  if (prefix === '' || typeof url !== 'string') return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  if (url === prefix || url.startsWith(`${prefix}/`)) return url;
  return `${prefix}${url}`;
}

const ATTRIBUTE = Object.freeze({ a: 'href', img: 'src' });

/** The Sätteri hast plugin entry that applies `withBase` to every `a[href]` and `img[src]`. */
export function baseLinksHastPlugin(base) {
  return () => ({
    name: 'forge-base-links',
    element: {
      filter: Object.keys(ATTRIBUTE),
      visit(node, ctx) {
        const key = ATTRIBUTE[node.tagName];
        const value = node.properties?.[key];
        const next = withBase(value, base);
        if (next !== value) ctx.setProperty(node, key, next);
      },
    },
  });
}

/** An Astro integration that registers the plugin. List it before Starlight. */
export function baseLinks() {
  return {
    name: 'forge-base-links',
    hooks: {
      'astro:config:setup': ({ config }) => {
        const processor = config.markdown?.processor;
        if (!processor?.options?.hastPlugins) {
          throw new Error('forge-base-links: the Markdown processor exposes no hastPlugins list; the base path cannot be applied');
        }
        processor.options.hastPlugins.unshift(baseLinksHastPlugin(config.base));
      },
    },
  };
}
