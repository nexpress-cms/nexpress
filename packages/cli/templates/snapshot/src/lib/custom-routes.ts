import { npDefaultCustomRoutes } from "@nexpress/app/lib/custom-routes";
import { npDefineCustomRoutes } from "@nexpress/core/routes";

/**
 * Code-owned public routes shown in Admin Settings and navigation autocomplete.
 * Add hand-authored static or Next-style dynamic paths to this catalog.
 */
export const npCustomRoutes = npDefineCustomRoutes([...npDefaultCustomRoutes]);
