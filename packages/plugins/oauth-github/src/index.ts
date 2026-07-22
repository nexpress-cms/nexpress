import { registerOAuthProvider } from "@nexpress/core/auth";
import {
  createGitHubOAuthProvider,
  fetchGitHubProfile,
  type GitHubOAuthOptions,
} from "@nexpress/oauth-providers";
import { definePlugin } from "@nexpress/plugin-sdk";
import { z } from "zod";

/**
 * @nexpress/plugin-oauth-github — adds "Sign in with GitHub" via
 * the plugin lifecycle.
 *
 * Credentials can come from EITHER environment variables OR the
 * admin auto-form (G.1):
 *
 *   1. `NP_OAUTH_GITHUB_CLIENT_ID` + `NP_OAUTH_GITHUB_CLIENT_SECRET`
 *      env vars (12-factor; recommended for production secret
 *      management — works with Doppler / 1Password CLI / AWS
 *      Secrets Manager / Kubernetes secrets).
 *   2. The admin form at `/admin/plugins/oauth-github` (operator
 *      self-service; values persist to `np_settings`).
 *
 * **Env wins on a tie** — the admin form acts as a fallback so
 * existing deployments stay unchanged after upgrading. Empty env
 * with a populated admin form opts into DB-stored credentials.
 *
 * The Authorization callback URL registered in a GitHub OAuth App
 * must match the configured audience: `${SITE_URL}/api/auth/oauth/github/callback`
 * for staff, or `${SITE_URL}/api/members/oauth/github/callback`
 * for members. GitHub OAuth Apps accept one callback URL, so this
 * bundled provider defaults to staff-only visibility; switch the
 * `audience` setting to `member` if the GitHub app is registered for
 * the member callback instead.
 *
 * Admin-form config is resolved inside the current site scope for every OAuth
 * request. Credential, scope, audience, and activation changes therefore do
 * not require a plugin reload and cannot bleed across sites.
 */

// Re-exports kept for back-compat with sites that imported the
// factory from this package before the @nexpress/oauth-providers
// split. New code should import from @nexpress/oauth-providers.
export { createGitHubOAuthProvider, fetchGitHubProfile, type GitHubOAuthOptions };

const configSchema = z.object({
  clientId: z.string().default("").describe("GitHub OAuth app client ID (Iv1.…)"),
  clientSecret: z
    .string()
    .default("")
    .meta({ sensitive: true })
    .describe("GitHub OAuth app client secret"),
  scopes: z
    .array(z.string())
    .default(["read:user", "user:email"])
    .describe("OAuth scopes requested at authorization"),
  audience: z
    .enum(["staff", "member"])
    .default("staff")
    .describe("Login surface that should show the GitHub OAuth button"),
});

export type GitHubOAuthConfig = z.infer<typeof configSchema>;

export const githubOAuthPlugin = definePlugin<GitHubOAuthConfig>({
  manifest: {
    id: "oauth-github",
    version: "0.3.0",
    name: "GitHub OAuth",
    description:
      "Adds 'Sign in with GitHub' for one auth surface. Credentials read from env (NP_OAUTH_GITHUB_CLIENT_ID + NP_OAUTH_GITHUB_CLIENT_SECRET) OR the admin auto-form — env wins on a tie. GitHub OAuth Apps accept one callback URL, so the audience setting controls whether the button appears on staff or member login.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["network:fetch", "settings:read"],
    allowedHosts: ["github.com", "api.github.com"],
    provides: {
      blocks: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: [],
      hooks: [],
    },
    agent: {
      description:
        "Wires GitHub as an OAuth provider. Credentials hybrid env-or-admin (env precedence). Admin form masks the client secret via the G.1 sensitive widget.",
      category: "security",
      tags: ["oauth", "sso", "github", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  configSchema,
  setup: (ctx) => {
    // G.2.2 — credentials must come from a single source. Mixing
    // env-managed clientId with DB-stored clientSecret (or vice
    // versa) is almost always a misconfiguration — typically a
    // half-finished migration between env and admin form. Treat
    // partial-env as an explicit error so the operator notices,
    // rather than silently registering a Frankenstein credential
    // pair that's hard to audit later.
    const envId = process.env.NP_OAUTH_GITHUB_CLIENT_ID;
    const envSecret = process.env.NP_OAUTH_GITHUB_CLIENT_SECRET;
    const envHasAny = Boolean(envId || envSecret);
    const envHasBoth = Boolean(envId && envSecret);
    if (envHasAny && !envHasBoth) {
      ctx.log.error(
        "GitHub OAuth env vars are partial — set BOTH NP_OAUTH_GITHUB_CLIENT_ID and NP_OAUTH_GITHUB_CLIENT_SECRET, or unset both to fall back to the admin form. Refusing to mix env and DB credentials for the same provider.",
      );
      return;
    }

    const resolveSiteOptions = async () => {
      const config = configSchema.parse(await ctx.settings.getPlugin());
      return {
        audience: config.audience,
        clientId: envHasBoth ? envId! : config.clientId,
        clientSecret: envHasBoth ? envSecret! : config.clientSecret,
        scopes: config.scopes,
      };
    };
    const resolveSiteProvider = async () => {
      const options = await resolveSiteOptions();
      if (!options.clientId || !options.clientSecret) {
        throw new Error(
          "GitHub OAuth is not configured for the current site. Set both environment variables or complete the plugin config form.",
        );
      }
      return createGitHubOAuthProvider(options);
    };

    registerOAuthProvider({
      id: "github",
      label: "GitHub",
      sourcePluginId: "oauth-github",
      audiences: ["staff", "member"],
      isAvailable: async (audience) => {
        const options = await resolveSiteOptions();
        return Boolean(options.clientId && options.clientSecret) && options.audience === audience;
      },
      authorize: async (params) => (await resolveSiteProvider()).authorize(params),
      exchange: async (params) => (await resolveSiteProvider()).exchange(params),
    });
    ctx.log.info("GitHub OAuth provider registered", {
      credentials: envHasBoth ? "environment" : "site-config",
      resolution: "request-time",
    });
  },
});

export default githubOAuthPlugin;
