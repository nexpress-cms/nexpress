import { registerOAuthProvider } from "@nexpress/core";
import {
  createGitHubOAuthProvider,
  fetchGitHubProfile,
  type GitHubOAuthOptions,
} from "@nexpress/oauth-providers";
import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * @nexpress/plugin-oauth-github — adds "Sign in with GitHub" via
 * the plugin lifecycle (env-driven setup). Sites that prefer
 * direct registration can skip this plugin and import
 * `createGitHubOAuthProvider` from `@nexpress/oauth-providers`
 * directly.
 *
 * Credentials come from env, NOT `np_plugins.config`:
 *
 *   NP_OAUTH_GITHUB_CLIENT_ID=Iv1.xxxxxxxxxxxx
 *   NP_OAUTH_GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
 *
 * The Authorization callback URL registered in the GitHub OAuth
 * app must be exactly `${SITE_URL}/api/auth/oauth/github/callback`
 * (staff) or `${SITE_URL}/api/members/oauth/github/callback`
 * (member). The provider registry is shared — a single registered
 * GitHub provider works for both pools.
 */

// Re-exports kept for back-compat with sites that imported the
// factory from this package before the @nexpress/oauth-providers
// split. New code should import from @nexpress/oauth-providers.
export { createGitHubOAuthProvider, fetchGitHubProfile, type GitHubOAuthOptions };

export const githubOAuthPlugin = definePlugin({
  manifest: {
    id: "oauth-github",
    version: "0.2.0",
    name: "GitHub OAuth",
    description:
      "Adds 'Sign in with GitHub' for staff + member auth. Reads NP_OAUTH_GITHUB_CLIENT_ID + NP_OAUTH_GITHUB_CLIENT_SECRET; logs a warning and registers nothing if either is unset.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["network:fetch"],
    allowedHosts: ["github.com", "api.github.com"],
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
        "Wires GitHub as an OAuth provider on top of arctic + the framework's /api/{auth,members}/oauth/{provider}/{start,callback} routes.",
      category: "security",
      tags: ["oauth", "sso", "github", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  setup: (ctx) => {
    const clientId = process.env.NP_OAUTH_GITHUB_CLIENT_ID;
    const clientSecret = process.env.NP_OAUTH_GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      ctx.log.warn(
        "GitHub OAuth not configured — set NP_OAUTH_GITHUB_CLIENT_ID and NP_OAUTH_GITHUB_CLIENT_SECRET to enable.",
      );
      return;
    }
    registerOAuthProvider(createGitHubOAuthProvider({ clientId, clientSecret }));
    ctx.log.info("GitHub OAuth provider registered");
  },
});

export default githubOAuthPlugin;
