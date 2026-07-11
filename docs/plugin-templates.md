# Plugin page templates

Plugins can contribute document templates through the definition-level
`templates` registry. The shape is collection slug → template id → definition:

```tsx
import {
  definePlugin,
  type NpPluginTemplateDefinition,
  type NpPluginTemplates,
} from "@nexpress/plugin-sdk";

function DocsTemplate({ doc }: Parameters<NpPluginTemplateDefinition["component"]>[0]) {
  return (
    <main>
      <h1>{String(doc.title ?? "Documentation")}</h1>
    </main>
  );
}

const templates = {
  pages: {
    docs: {
      label: "Documentation",
      description: "Readable documentation page.",
      component: DocsTemplate,
    },
  },
} satisfies NpPluginTemplates;

export default definePlugin({
  manifest: {/* … */},
  templates,
});
```

Collection slugs use lowercase kebab-case. Template ids are safe identifiers
made from letters, numbers, `.`, `_`, and `-`. Labels are required;
descriptions are optional; components must be functions. Unknown definition
fields are rejected.

`definePlugin()` validates this shape during module evaluation and derives
`pages:docs` into `manifest.provides.templates`. The core host repeats the
validation for definitions that bypass the SDK. Malformed templates therefore
fail before the Admin picker or site renderer can cast and call the component.

Templates from different plugins share the collection/id namespace. The last
loaded plugin wins, with a boot warning and `plugins.template_conflict` doctor
diagnostic. Namespace ids when the override is not intentional. An active
theme still wins over plugin templates with the same id because the theme is
the site's design authority.

Plugin reload removes every previous contribution before registering the
currently enabled set. Disabling a plugin therefore removes its templates;
if it had overridden another plugin, the earlier owner's template becomes
effective again.

The `page-plugin` CLI starter and bundled `block-callout` plugin contain typed
examples.
