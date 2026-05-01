# @nexpress/plugin-oauth-google

Google OAuth provider plugin for
[NexPress](https://github.com/hahabsw/nexpress).

## Install

```bash
pnpm add @nexpress/plugin-oauth-google
```

## Usage

```ts
// nexpress.config.ts
import googleAuth from "@nexpress/plugin-oauth-google";

export default defineConfig({
  // ...
  plugins: [
    googleAuth({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
});
```

The plugin registers a `google` OAuth provider via
`registerOAuthProvider`. See the `@nexpress/core/auth` OAuth surface.

## License

MIT
