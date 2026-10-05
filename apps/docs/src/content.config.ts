import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { PAGE_TYPES } from './freshness.mjs';

// Every page declares what it is, who keeps it true, when it was last checked
// against the product, and which code it describes. A page missing any of
// these fails `astro build`.
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        type: z.enum(PAGE_TYPES),
        owner: z.string().min(1),
        last_verified: z.coerce.date(),
        covers: z.array(z.string().min(1)).min(1),
        generated_from: z.string().min(1).optional(),
      }),
    }),
  }),
};
