import { registerOAuthProvider } from "@nexpress/core/auth";
import {
  createGoogleOAuthProvider,
  fetchGoogleProfile,
  type GoogleOAuthOptions,
} from "@nexpress/oauth-providers";
import { definePlugin } from "@nexpress/plugin-sdk";
import { z } from "zod";

/**
 * Environment credentials take precedence as a complete pair. Site config is
 * resolved per request so credential, scope and activation changes stay scoped.
 * Only verified email addresses may link existing users. Google supports both
 * staff and member callbacks; registration instructions live in ../README.md.
 */

// Preserve the original package imports; new consumers use @nexpress/oauth-providers.
export { createGoogleOAuthProvider, fetchGoogleProfile, type GoogleOAuthOptions };

const configSchema = z.object({
  clientId: z
    .string()
    .default("")
    .describe("Google OAuth client ID (xxxxx.apps.googleusercontent.com)"),
  clientSecret: z
    .string()
    .default("")
    .meta({ sensitive: true })
    .describe("Google OAuth client secret"),
  scopes: z
    .array(z.string())
    .default(["openid", "email", "profile"])
    .describe("OAuth scopes requested at authorization"),
});

export type GoogleOAuthConfig = z.infer<typeof configSchema>;

export const googleOAuthPlugin = definePlugin<GoogleOAuthConfig>({
  manifest: {
    id: "oauth-google",
    version: "0.3.0",
    name: "Google OAuth",
    description:
      "Adds 'Sign in with Google' for staff + member auth. Credentials read from env (NP_OAUTH_GOOGLE_CLIENT_ID + NP_OAUTH_GOOGLE_CLIENT_SECRET) OR the admin auto-form — env wins on a tie. Honors email_verified strictly. Logs an informational setup hint when neither source provides credentials.",
    author: { name: "NexPress" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["network:fetch", "settings:read"],
    allowedHosts: ["accounts.google.com", "oauth2.googleapis.com", "openidconnect.googleapis.com"],
    provides: {
      blocks: [],
      collections: [],
      adminExtensions: [],
      apiRoutes: [],
      hooks: [],
    },
    agent: {
      description:
        "Wires Google as an OAuth provider. Credentials hybrid env-or-admin (env precedence). Admin form masks the client secret via the G.1 sensitive widget. Honors email_verified — never links unverified Google addresses to existing NexPress users by email.",
      category: "security",
      tags: ["oauth", "sso", "google", "auth"],
    },
    usesTokens: [],
    styleSlots: {},
  },
  configSchema,
  setup: (ctx) => {
    // Reject partial environment credentials rather than mixing env and site config.
    const envId = process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
    const envSecret = process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;
    const envHasAny = Boolean(envId || envSecret);
    const envHasBoth = Boolean(envId && envSecret);
    if (envHasAny && !envHasBoth) {
      ctx.log.error(
        "Google OAuth env vars are partial — set BOTH NP_OAUTH_GOOGLE_CLIENT_ID and NP_OAUTH_GOOGLE_CLIENT_SECRET, or unset both to fall back to the admin form. Refusing to mix env and DB credentials for the same provider.",
      );
      return;
    }
    const resolveSiteOptions = async () => {
      const config = configSchema.parse(await ctx.settings.getPlugin());
      return {
        clientId: envHasBoth ? envId! : config.clientId,
        clientSecret: envHasBoth ? envSecret! : config.clientSecret,
        scopes: config.scopes,
      };
    };
    const resolveSiteProvider = async () => {
      const options = await resolveSiteOptions();
      if (!options.clientId || !options.clientSecret) {
        throw new Error(
          "Google OAuth is not configured for the current site. Set both environment variables or complete the plugin config form.",
        );
      }
      return createGoogleOAuthProvider(options);
    };

    registerOAuthProvider({
      id: "google",
      label: "Google",
      sourcePluginId: "oauth-google",
      audiences: ["staff", "member"] as const,
      isAvailable: async () => {
        const options = await resolveSiteOptions();
        return Boolean(options.clientId && options.clientSecret);
      },
      authorize: async (params) => (await resolveSiteProvider()).authorize(params),
      exchange: async (params) => (await resolveSiteProvider()).exchange(params),
    });
    ctx.log.info("Google OAuth provider registered", {
      credentials: envHasBoth ? "environment" : "site-config",
      resolution: "request-time",
    });
  },
});

export default googleOAuthPlugin;
