/**
 * Framework-shipped OAuth provider factories. Each function
 * returns an `OAuthProvider` ready for `registerOAuthProvider()`
 * — usable from a plugin's `setup()`, from app boot code, or
 * anywhere else the framework registry is reachable.
 *
 * Sites typically read credentials from env (`NP_OAUTH_*`) and
 * hand them to the factory:
 *
 *   import { registerOAuthProvider } from "@nexpress/core";
 *   import { createGoogleOAuthProvider } from "@nexpress/oauth-providers";
 *
 *   if (process.env.NP_OAUTH_GOOGLE_CLIENT_ID && process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET) {
 *     registerOAuthProvider(
 *       createGoogleOAuthProvider({
 *         clientId: process.env.NP_OAUTH_GOOGLE_CLIENT_ID,
 *         clientSecret: process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET,
 *       }),
 *     );
 *   }
 *
 * The bundled `@nexpress/plugin-oauth-{google,github}` packages
 * are thin wrappers that do exactly this from a plugin manifest
 * — sites that already use them keep working unchanged.
 */

export {
  createGoogleOAuthProvider,
  fetchGoogleProfile,
  type GoogleOAuthOptions,
} from "./google.js";

export {
  createGitHubOAuthProvider,
  fetchGitHubProfile,
  type GitHubOAuthOptions,
} from "./github.js";

export {
  createDiscordOAuthProvider,
  fetchDiscordProfile,
  type DiscordOAuthOptions,
} from "./discord.js";
