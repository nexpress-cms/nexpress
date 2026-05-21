import type { NpTemplateRenderProps } from "@nexpress/theme";

export function PageApiReferenceTemplate(_props: NpTemplateRenderProps) {
  const params = [
    ["manifest", "required", "Plugin metadata: id, name, version, and supported NexPress range."],
    ["hooks", "optional", "Lifecycle hooks such as content:beforeSave and content:afterSave."],
    ["actions", "optional", "Custom action handlers mounted under the plugin action endpoint."],
    ["routes", "optional", "API-style route handlers registered by the plugin host."],
    ["pageRoutes", "optional", "Public-site React routes rendered through the site shell."],
    ["scheduled", "optional", "pg-boss scheduled tasks reconciled at boot."],
    ["blocks", "optional", "Page-builder block definitions registered into the shared registry."],
  ];

  return (
    <article className="np-docs-api">
      <header className="np-docs-api-hero">
        <p className="np-docs-api-eyebrow">API reference</p>
        <h1>
          <code>definePlugin</code>
        </h1>
        <p>
          Declares a NexPress plugin. v1 plugins are npm package + rebuild:
          they run in-process, can register hooks, actions, API routes,
          public page routes, scheduled tasks, and page-builder blocks.
        </p>
      </header>

      <section className="np-docs-api-signature" aria-label="Signature">
        <div className="np-docs-api-signature-head">
          <span>Signature</span>
          <code>@nexpress/plugin-sdk</code>
        </div>
        <pre>{`import { definePlugin } from "@nexpress/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "reading-time",
    name: "Reading time",
    version: "0.1.0",
    nexpress: { minVersion: "0.1.0" },
  },
  hooks: {
    "content:beforeSave": async (ctx) => ctx.data,
  },
  pageRoutes: [],
  blocks: [],
});`}</pre>
      </section>

      <section className="np-docs-api-section">
        <h2>Parameters</h2>
        <div className="np-docs-api-table">
          {params.map(([name, state, desc]) => (
            <div className="np-docs-api-row" key={name}>
              <code>{name}</code>
              <span>{state}</span>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="np-docs-api-section">
        <h2>Returns</h2>
        <p>
          A plugin definition object consumed by the NexPress bootstrap. The
          host validates the manifest and registers every declared surface in a
          predictable order. Capability and route checks happen at the
          framework boundary.
        </p>
      </section>
    </article>
  );
}
