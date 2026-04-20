# NexPress

Next.js-based open-source CMS for developers building content-managed sites.

<!-- badges -->

## Features

- Next.js 15 App Router, TypeScript strict
- PostgreSQL + Drizzle ORM
- Lexical rich-text editor
- Block-based page builder (drag & drop)
- Media library with image processing (sharp)
- Plugin SDK (`definePlugin()`)
- Admin UI (shadcn-style, Tailwind v4)
- Theme engine with CSS custom properties
- Background jobs (pg-boss)
- `create-nexpress` CLI scaffolder
- Docker-ready (standalone output)
- Self-hosted by default

## Quick Start

```bash
npx create-nexpress my-site
cd my-site
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm dev
```

The site runs at `localhost:3000` and the admin panel is available at `localhost:3000/admin`.

## Architecture

```
packages/
├── core        — Config, DB, Auth, Collections, Media, Theme, Jobs, Plugins
├── editor      — Lexical rich-text (client + SSR renderer)
├── blocks      — Block system + 8 defaults + DnD editor
├── admin       — UI primitives + admin views
├── theme       — CSS generation from design tokens
├── plugin-sdk  — definePlugin() + types for plugin authors
└── cli         — create-nexpress scaffolder
apps/
└── web         — Next.js 15 reference app
```

## Development

```bash
git clone https://github.com/hahabsw/nexpress.git
cd nexpress
pnpm install
docker compose -f docker/docker-compose.yml up -d db
pnpm build
pnpm dev
```

Prerequisites: Node >=20, pnpm, Turborepo.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 15 (App Router) |
| Language | TypeScript (strict) |
| Database | PostgreSQL + Drizzle ORM |
| Editor | Lexical |
| UI | React 19 + Tailwind CSS v4 + Radix UI |
| Block DnD | @dnd-kit |
| Auth | JWT + Argon2 |
| Jobs | pg-boss |
| Media | sharp |
| Build | pnpm + Turborepo + tsup |
| Deploy | Docker (standalone) |

## Plugin Development

Example of `definePlugin` usage:

```typescript
import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "A sample NexPress plugin.",
    author: { name: "Your Name" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
    capabilities: ["hooks:content"],
    agent: {
      description: "Logs a message after content creation.",
      category: "utility",
    },
  },
  hooks: {
    "content:afterCreate": async (ctx) => {
      ctx.ctx.log.info("Document created!");
    },
  },
});
```

## Project Structure

Standard structure for projects generated via `create-nexpress`:

```
my-site/
├── src/
│   ├── collections/
│   ├── app/
│   │   ├── (site)/
│   │   ├── (admin)/
│   │   └── api/
│   └── nexpress.config.ts
├── docker/
├── public/media/
└── package.json
```

## Scripts

| Script | Description |
| --- | --- |
| `pnpm build` | Build all packages and applications |
| `pnpm dev` | Start development servers for all packages |
| `pnpm lint` | Run ESLint across the monorepo |
| `pnpm typecheck` | Run TypeScript compiler checks |
| `pnpm test` | Execute test suites |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm clean` | Remove build artifacts and node_modules |

## License

MIT
