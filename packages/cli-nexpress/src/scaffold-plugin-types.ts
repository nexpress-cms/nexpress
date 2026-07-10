/**
 * Generators for the four non-block plugin kinds — hook, route, admin
 * settings, scheduled task. Each one writes a self-contained starter
 * package the operator can drop into `packages/plugins/<slug>/` (or any
 * workspace member), build, and register with `nexpress plugin add`.
 *
 * The block scaffold lives in its own file (`scaffold-block-plugin.ts`)
 * because it has more variants (static vs interactive) and more moving
 * parts (`"use client"` directive preservation, self-import wiring).
 * Splitting keeps either side readable — the four kinds in this file
 * are deliberately uniform: minimal manifest, single feature surface,
 * exhaustively commented `definePlugin()` body that explains *why* each
 * field is there, not just *what* it does.
 */
import {
  assertDirAvailable,
  basePackageJson,
  baseTsconfig,
  deriveNames,
  resolveTsconfigExtends,
  SERVER_TSUP_CONFIG,
  writeScaffoldFiles,
  type ScaffoldOptions,
  type ScaffoldResult,
} from "./scaffold-utils.js";

const README_FOOTER = `
## Develop

\`\`\`bash
pnpm --filter <packageName> dev    # rebuild on changes
pnpm --filter <packageName> build  # one-shot
\`\`\`

## Register in your project

\`\`\`bash
# From your NexPress project root:
pnpm --filter <packageName> build
pnpm exec nexpress plugin add <packageName>
# Restart your dev server or redeploy, then:
pnpm --silent run ops:plugins -- doctor --json
\`\`\`

\`plugin add\` installs the local workspace package, updates the
\`nexpress.config.ts\` plugin markers, and prints the restart step. Restart
your dev server or redeploy before the doctor check. If your config does not
use the marker block, the CLI prints the exact snippet to paste manually.

The manual equivalent is:

\`\`\`ts
import { defineConfig } from "@nexpress/core";
import <exportName> from "<packageName>";

export default defineConfig({
  // ...
  plugins: [<exportName>],
});
\`\`\`

## Remove from your project

\`\`\`bash
# From your NexPress project root:
pnpm exec nexpress plugin remove <packageName>
# Restart your dev server or redeploy, then:
pnpm --silent run ops:plugins -- doctor --json
\`\`\`

\`plugin remove\` unregisters the plugin, removes the package dependency, and
prints the restart step. Restart your dev server or redeploy before checking
that the plugin no longer appears in the loaded plugin list.

Reference: [Plugin SDK quickstart](https://github.com/nexpress-cms/nexpress/blob/main/docs/plugin-quickstart.md).
`;

function fillReadme(template: string, packageName: string, exportName: string): string {
  return template.replaceAll("<packageName>", packageName).replaceAll("<exportName>", exportName);
}

// ────────────────────────────────────────────────────────────────────────
// Content-hook plugin
// ────────────────────────────────────────────────────────────────────────

export async function scaffoldHookPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir, dependencyRanges } = options;
  const names = deriveNames(slug, outDir);
  assertDirAvailable(names.pluginDir);

  const description = `Content-hook plugin: ${names.packageName}`;
  const indexSource = `import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * Hook plugin scaffold. The default starter listens to
 * \`content:afterCreate\` and logs a line through the plugin-scoped
 * logger. Replace the body with whatever you want to do on save —
 * email a notification, push to a search index, fan out to webhooks.
 *
 * Full hook list: \`content:before/afterCreate\`,
 * \`content:before/afterUpdate\`, \`content:before/afterDelete\`,
 * \`content:before/afterPublish\`, \`content:beforeUnpublish\`,
 * \`auth:afterLogin\`,
 * \`auth:beforeLogout\`, \`auth:afterRegister\`,
 * \`render:beforePage\`,
 * \`media:before/afterUpload\`.
 *
 * \`definePlugin\` auto-derives \`manifest.capabilities\` from the
 * declared hooks (\`content:*\` → \`hooks:content\`), so block-only
 * authors never have to remember which capability gates which hook.
 * Capabilities you DO have to declare are the ones the framework
 * can't infer from the surface — \`storage:kv\`, \`media:write\`,
 * \`network:fetch\`, etc.
 */
export const ${names.exportName} = definePlugin({
  manifest: {
    id: "${names.pluginId}",
    version: "0.1.0",
    name: "${names.packageName}",
    description: "${description}",
    author: { name: "" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  hooks: {
    "content:afterCreate": ({ data, ctx }) => {
      // Content payloads use one vocabulary across their lifecycle:
      // \`document\`, \`documentId\`, \`originalDocument\`, \`operation\`,
      // \`source\`, and \`principal\`. \`ctx\` provides runtime services.
      ctx.log.info("New document created", {
        collection: data.collection,
        id: data.documentId,
        title:
          typeof data.document.title === "string" ? data.document.title : "(no title)",
      });
    },
  },
});

export default ${names.exportName};
`;

  const readmeTop = `# ${names.packageName}

A content-hook plugin scaffolded by \`nexpress create hook-plugin\`.

The starter logs a line on every \`content:afterCreate\`. Edit
\`src/index.tsx\` to add more hooks or do something useful — webhooks,
search indexing, notifications.
`;

  const files: Record<string, string> = {
    "package.json": basePackageJson(names.packageName, description, { dependencyRanges }),
    "tsconfig.json": baseTsconfig({ extendsPath: resolveTsconfigExtends(names.pluginDir) }),
    "tsup.config.ts": SERVER_TSUP_CONFIG,
    "README.md": readmeTop + fillReadme(README_FOOTER, names.packageName, names.exportName),
    "src/index.tsx": indexSource,
  };

  return {
    files: await writeScaffoldFiles(names.pluginDir, files),
    packageDir: names.pluginDir,
    kind: "hook",
    interactive: false,
  };
}

// ────────────────────────────────────────────────────────────────────────
// API route plugin
// ────────────────────────────────────────────────────────────────────────

export async function scaffoldRoutePlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir, dependencyRanges } = options;
  const names = deriveNames(slug, outDir);
  assertDirAvailable(names.pluginDir);

  const description = `API route plugin: ${names.packageName}`;
  const indexSource = `import { definePlugin, npAdminStatus } from "@nexpress/plugin-sdk";

/**
 * API route plugin scaffold. Plugin routes mount under
 * \`/api/plugins/<id>/<path>\`, so this starter lives at
 * \`GET /api/plugins/${names.pluginId}/health\`.
 *
 * Auth model:
 *   - \`auth: false\` (default) — public route. The framework rate-
 *     limits the catch-all to 30 req/min/IP; serious public endpoints
 *     should add their own validator (signature header, captcha, etc.).
 *   - \`auth: true\` — verifies a staff session and passes
 *     \`req.user\` into the handler. Use for diagnostics / admin actions.
 *
 * \`definePlugin\` auto-adds \`api:route\` to \`manifest.capabilities\`
 * because at least one route is declared — the host gates registration
 * on it, so forgetting to declare it would crash boot. Capabilities for
 * what the handler actually does (\`storage:kv\`, \`network:fetch\`,
 * \`content:read\`, etc.) still have to be listed manually.
 *
 * Route paths are static and canonical: start with \`/\`, use no trailing
 * slash, and declare each method/path pair once. Handlers may return either
 * synchronously or asynchronously. Every result must contain an HTTP status;
 * statuses 204, 205, and 304 must not include a body.
 */
export const ${names.exportName} = definePlugin({
  manifest: {
    id: "${names.pluginId}",
    version: "0.1.0",
    name: "${names.packageName}",
    description: "${description}",
    author: { name: "" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  routes: [
    {
      method: "GET",
      path: "/health",
      auth: false,
      description: "Liveness probe — returns the current server time.",
      handler: (req, _ctx) => {
        return {
          status: 200,
          body: {
            ok: true,
            now: new Date().toISOString(),
            // Echo a query param so operators can confirm the
            // request shape end-to-end without setting up a UI.
            echo: typeof req.query.echo === "string" ? req.query.echo : null,
          },
        };
      },
    },
  ],
});

export default ${names.exportName};
`;

  const readmeTop = `# ${names.packageName}

An API-route plugin scaffolded by \`nexpress create route-plugin\`.

The starter exposes \`GET /api/plugins/${names.pluginId}/health\` returning
\`{ ok: true, now, echo }\`. Edit \`src/index.tsx\` to add real handlers
or chain in your own auth / validation.
`;

  const files: Record<string, string> = {
    "package.json": basePackageJson(names.packageName, description, { dependencyRanges }),
    "tsconfig.json": baseTsconfig({ extendsPath: resolveTsconfigExtends(names.pluginDir) }),
    "tsup.config.ts": SERVER_TSUP_CONFIG,
    "README.md": readmeTop + fillReadme(README_FOOTER, names.packageName, names.exportName),
    "src/index.tsx": indexSource,
  };

  return {
    files: await writeScaffoldFiles(names.pluginDir, files),
    packageDir: names.pluginDir,
    kind: "route",
    interactive: false,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Admin-settings plugin (settings + widget + action)
// ────────────────────────────────────────────────────────────────────────

export async function scaffoldAdminPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir, dependencyRanges } = options;
  const names = deriveNames(slug, outDir);
  assertDirAvailable(names.pluginDir);

  const description = `Admin extension plugin: ${names.packageName}`;
  const indexSource = `import { definePlugin, npAdminStatus } from "@nexpress/plugin-sdk";
import { z } from "zod";

/**
 * Admin-extension plugin scaffold. Demonstrates the three most useful
 * declarative surfaces:
 *   - \`configSchema\` — a typed auto-form rendered by the admin.
 *     Values persist as plugin config via PUT \`/api/admin/plugins/:id/config\`.
 *   - \`widgets\` — small status / metric cards shown on the plugin's
 *     dashboard at \`/admin/plugins/<id>\`.
 *   - \`actions\` — buttons that dispatch a registered action handler
 *     from the definition-level \`actions\` registry.
 *
 * The action and the widget both reference \`actionId: "syncStatus"\`,
 * which the typed registry below declares. Click the action
 * button OR re-render the widget and the same handler runs.
 *
 * Settings persist into \`np_settings\` under \`plugin.config:<id>\`;
 * read them back via \`ctx.config\` (typed by the generic on
 * \`definePlugin<TConfig>\`).
 */
const configSchema = z.object({
  apiKey: z.string().default("").describe("API key"),
  enabled: z.boolean().default(true).describe("Enable"),
});

export type ${names.componentName}Config = z.infer<typeof configSchema>;

export const ${names.exportName} = definePlugin<${names.componentName}Config>({
  manifest: {
    id: "${names.pluginId}",
    version: "0.1.0",
    name: "${names.packageName}",
    description: "${description}",
    author: { name: "" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  configSchema,
  admin: {
    widgets: [
      {
        id: "status",
        label: "Connection status",
        kind: "status",
        actionId: "syncStatus",
        description: "Pings the upstream service and reports up / down.",
      },
    ],
    actions: [
      {
        id: "ping",
        label: "Ping now",
        actionId: "syncStatus",
        description: "Manually trigger the same status check the widget runs.",
      },
    ],
  },
  actions: {
    // The registry keeps action id, result kind, and handler together so
    // definePlugin + plugin doctor can verify every admin reference before
    // an operator clicks it. General action buttons may share this typed
    // status handler; only widgets/tables impose a result kind.
    syncStatus: {
      kind: "status",
      handler: async (_data, ctx) => {
        const config = ctx.config;
        if (!config.enabled) {
          return npAdminStatus("warn", "Plugin is disabled in settings.");
        }
        if (!config.apiKey) {
          return npAdminStatus("error", "Missing API key in settings.");
        }
        // Replace with a real upstream call once you've wired one up.
        return npAdminStatus("ok", "All systems go.");
      },
    },
  },
});

export default ${names.exportName};
`;

  const readmeTop = `# ${names.packageName}

An admin-extension plugin scaffolded by \`nexpress create admin-plugin\`.

The starter ships:

- a configSchema-powered settings form (\`apiKey\`, \`enabled\`)
- a status widget that shows up / down
- a manual "Ping now" action button

Both the widget and the action call the same typed \`syncStatus\` handler
declared in the definition-level \`actions\` registry. Replace the body with a
real upstream call to make this plugin do something.
`;

  const files: Record<string, string> = {
    "package.json": basePackageJson(names.packageName, description, {
      dependencyRanges,
      extraDependencies: { zod: "^4.4.3" },
    }),
    "tsconfig.json": baseTsconfig({ extendsPath: resolveTsconfigExtends(names.pluginDir) }),
    "tsup.config.ts": SERVER_TSUP_CONFIG,
    "README.md": readmeTop + fillReadme(README_FOOTER, names.packageName, names.exportName),
    "src/index.tsx": indexSource,
  };

  return {
    files: await writeScaffoldFiles(names.pluginDir, files),
    packageDir: names.pluginDir,
    kind: "admin",
    interactive: false,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Scheduled-task plugin
// ────────────────────────────────────────────────────────────────────────

export async function scaffoldScheduledPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir, dependencyRanges } = options;
  const names = deriveNames(slug, outDir);
  assertDirAvailable(names.pluginDir);

  const description = `Scheduled-task plugin: ${names.packageName}`;
  const indexSource = `import { definePlugin } from "@nexpress/plugin-sdk";

/**
 * Scheduled-task plugin scaffold. Each \`scheduled\` entry becomes one
 * row in \`pgboss.schedule\` plus a per-task worker queue
 * (\`plugin.scheduledTask.<pluginId>.<taskId>\`).
 *
 * Cron expressions follow standard 5-field syntax (m h dom mon dow). A
 * quick reference:
 *   - every 15 minutes — use a step value in the minute field
 *   - \`0 * * * *\`    — top of every hour
 *   - \`0 2 * * *\`    — every day at 02:00
 *   - \`0 9 * * 1\`    — every Monday at 09:00
 *
 * Adding a new \`scheduled\` entry after the worker is already running
 * needs a worker restart to pick up the new boss.work() loop —
 * "Reload all" in /admin/plugins updates pg-boss schedule rows but
 * can't install workers across processes. The admin toast warns when
 * this is the case.
 *
 * \`definePlugin\` auto-adds \`hooks:scheduled\` because at least one
 * scheduled task is declared. You still list capabilities for what the
 * handler actually calls (\`storage:kv\`, \`content:read\`, etc.).
 */
export const ${names.exportName} = definePlugin({
  manifest: {
    id: "${names.pluginId}",
    version: "0.1.0",
    name: "${names.packageName}",
    description: "${description}",
    author: { name: "" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  scheduled: [
    {
      id: "dailyHousekeeping",
      cron: "0 2 * * *",
      description: "Runs nightly at 02:00 server-local time.",
      handler: async (ctx) => {
        // \`ctx\` here is the same shape \`setup()\` and route handlers
        // receive — \`content\` / \`media\` / \`storage\` / \`log\` /
        // \`http\` / \`actions\` are all available subject to the
        // capabilities the plugin declared.
        ctx.log.info("daily housekeeping running", {
          startedAt: new Date().toISOString(),
        });
        // ...do work here.
      },
    },
  ],
});

export default ${names.exportName};
`;

  const readmeTop = `# ${names.packageName}

A scheduled-task plugin scaffolded by \`nexpress create scheduled-plugin\`.

The starter declares one cron task that runs daily at 02:00. Edit
\`src/index.tsx\` to change the cron expression or add more \`scheduled\`
entries. Each entry maps to one row in \`pgboss.schedule\` and one
worker queue.
`;

  const files: Record<string, string> = {
    "package.json": basePackageJson(names.packageName, description, { dependencyRanges }),
    "tsconfig.json": baseTsconfig({ extendsPath: resolveTsconfigExtends(names.pluginDir) }),
    "tsup.config.ts": SERVER_TSUP_CONFIG,
    "README.md": readmeTop + fillReadme(README_FOOTER, names.packageName, names.exportName),
    "src/index.tsx": indexSource,
  };

  return {
    files: await writeScaffoldFiles(names.pluginDir, files),
    packageDir: names.pluginDir,
    kind: "scheduled",
    interactive: false,
  };
}
