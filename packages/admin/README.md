# @nexpress/admin

Admin UI components for [NexPress](https://github.com/nexpress-cms/nexpress) —
the Next.js-based CMS. shadcn-style React components built on Radix UI
and Tailwind v4.

## Install

```bash
pnpm add @nexpress/admin
```

## Client / server boundary

This package splits exports to keep client-only code out of RSC bundles:

```ts
// Server Components / route handlers — types + view shells
import type { AdminShellProps } from "@nexpress/admin";

// Client Components — `"use client"` injected by the bundler
import { AdminShell, CollectionListView } from "@nexpress/admin/client";
```

Importing the wrong subpath breaks the build (RSC sees `"use client"` ;
client gets server-only deps). The reference app's protected admin
layout is the canonical pattern — see
[`apps/web/src/app/(admin)/admin/(protected)/layout.tsx`](<https://github.com/nexpress-cms/nexpress/blob/main/apps/web/src/app/(admin)/admin/(protected)/layout.tsx>).

## Quick example

```tsx
// app/(admin)/admin/(protected)/layout.tsx
import { can } from "@nexpress/core/auth";
import { AdminShell } from "@nexpress/admin/client";

export default async function AdminLayout({ children }) {
  const user = await getCurrentUser(); // your auth resolver
  const caps = {
    canManageAdmin: can(user, "admin.manage"),
    canPublish: can(user, "content.publish"),
    canModerate: can(user, "community.moderate"),
  };
  return (
    <AdminShell user={user} collections={collections} caps={caps}>
      {children}
    </AdminShell>
  );
}
```

The shell receives **resolved capability flags** as props from the
server parent — `can()` is server-only, so calling it from `AdminShell`
itself would drag `@nexpress/core` into the browser bundle.

## What's exported

- **`AdminShell`** — sidebar + topbar layout
- **`CollectionListView`** / **`CollectionEditView`** — collection
  table + edit form
- **`MediaLibraryView`**, **`PluginListView`**, **`JobsAdminView`**,
  **`MembersView`**, **`ReportsView`**, **`AuditLogView`**,
  **`SettingsView`**, …
- **Field renderers** under `@nexpress/admin/client` for every
  `defineCollection()` field type

## Links

- [Repository](https://github.com/nexpress-cms/nexpress)
- [AGENTS.md](https://github.com/nexpress-cms/nexpress/blob/main/AGENTS.md) — architecture overview
- [docs/plugin-admin.md](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-admin.md) — adding admin surfaces from a plugin

## License

MIT
