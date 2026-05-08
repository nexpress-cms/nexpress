import { registerOAuthProvider } from "@nexpress/core";
import {
  createGoogleOAuthProvider,
  fetchGoogleProfile,
  type GoogleOAuthOptions,
} from "@nexpress/oauth-providers";
import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * @nexpress/plugin-oauth-google — adds "Sign in with Google" via
 * the plugin lifecycle (env-driven setup). Sites that prefer
 * direct registration can skip this plugin and import
 * `createGoogleOAuthProvider` from `@nexpress/oauth-providers`
 * directly.
 *
 * Credentials come from env, NOT `np_plugins.config`:
 *
 *   NP_OAUTH_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
 *   NP_OAUTH_GOOGLE_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxx
 *
 * The redirect URI registered in Google Cloud Console must be
 * exactly `${SITE_URL}/api/auth/oauth/google/callback` (staff)
 * or `${SITE_URL}/api/members/oauth/google/callback` (member).
 * The provider registry is shared between the two pools, so a
 * single registered Google provider works for both.
 */

// Re-exports kept for back-compat with sites that imported the
// factory from this package before the @nexpress/oauth-providers
// split. New code should import from @nexpress/oauth-providers.
export { createGoogleOAuthProvider, fetchGoogleProfile, type GoogleOAuthOptions };

export const googleOAuthPlugin = definePlugin({
  manifest: {
    id: "oauth-google",
    version: "0.2.0",
    name: "Google OAuth",
    description:
      "Adds 'Sign in with Google' for staff + member auth. Honors email_verified strictly. Reads NP_OAUTH_GOOGLE_CLIENT_ID + NP_OAUTH_GOOGLE_CLIENT_SECRET; logs a warning and registers nothing if either is unset.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["network:fetch"],
    allowedHosts: [
      "accounts.google.com",
      "oauth2.googleapis.com",
      "openidconnect.googleapis.com",
    ],
    provides: {
      blocks: [],
      fields: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: [],
      hooks: [],
    },
    agent: {
      description:
        "Wires Google as an OAuth provider on top of arctic. Honors email_verified — never links unverified Google addresses to existing NexPress users by email.",
      category: "security",
      tags: ["oauth", "sso", "google", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  setup: (ctx) => {
    const clientId = process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      ctx.log.warn(
        "Google OAuth not configured — set NP_OAUTH_GOOGLE_CLIENT_ID and NP_OAUTH_GOOGLE_CLIENT_SECRET to enable.",
      );
      return;
    }
    registerOAuthProvider(createGoogleOAuthProvider({ clientId, clientSecret }));
    ctx.log.info("Google OAuth provider registered");
  },
});

export default googleOAuthPlugin;
