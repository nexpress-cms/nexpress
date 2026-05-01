# @nexpress/plugin-oauth-github

GitHub OAuth provider plugin for
[NexPress](https://github.com/hahabsw/nexpress).

## Install

```bash
pnpm add @nexpress/plugin-oauth-github
```

## Usage

```ts
// nexpress.config.ts
import githubAuth from "@nexpress/plugin-oauth-github";

export default defineConfig({
  // ...
  plugins: [
    githubAuth({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
});
```

The plugin registers a `github` OAuth provider via
`registerOAuthProvider`. See
[docs/agent-integration.md](https://github.com/hahabsw/nexpress/blob/main/docs/agent-integration.md)
and the `@nexpress/core/auth` OAuth surface.

## License

MIT
