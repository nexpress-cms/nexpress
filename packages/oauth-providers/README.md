# @nexpress/oauth-providers

Framework-shipped OAuth provider factories for Google, GitHub, and Discord.
They normalize provider profiles into the NexPress OAuth contract without
requiring a plugin wrapper.

## Install

```bash
pnpm add @nexpress/oauth-providers
```

```ts
import { createGoogleOAuthProvider } from "@nexpress/oauth-providers";

const clientId = process.env.NP_OAUTH_GOOGLE_CLIENT_ID;
const clientSecret = process.env.NP_OAUTH_GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) throw new Error("Google OAuth credentials are required");

const provider = createGoogleOAuthProvider({
  clientId,
  clientSecret,
});
```

Google and Discord only expose verified email addresses to identity matching.
GitHub falls back to the verified-email endpoint when the public profile hides
its primary address. Apps register the returned provider through their normal
NexPress bootstrap or plugin setup.

## Links

- [Authentication](https://github.com/nexpress-cms/nexpress/blob/main/docs/authentication.md)
- [Community and member OAuth](https://github.com/nexpress-cms/nexpress/blob/main/docs/community.md)

## License

MIT
