import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { isStale, windowDays } from './freshness.mjs';

// Shows who keeps each page true and when it was last checked, and flags a
// page whose check is older than its type's freshness window.
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  // Starlight's built-in 404 is not a content page and carries none of the fields.
  if (route.id === '404') return;
  const data = route.entry.data;
  const checked = data.last_verified.toISOString().slice(0, 10);
  // Starlight renders LastUpdated only when this is set; the override prints last_verified + owner.
  route.lastUpdated = data.last_verified;
  route.editUrl = undefined;
  if (isStale(data.type, data.last_verified, new Date())) {
    data.banner = {
      content: `This page was last checked on ${checked}, more than ${windowDays(data.type)} days ago. It may be out of date. Owner: ${data.owner}.`,
    };
  }
});
