import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  baseTsconfig,
  frameworkDependencyRanges,
  resolveTsconfigExtends,
  type ScaffoldDependencyRanges,
} from "./scaffold-utils.js";

/**
 * Author-friendly identifier derivation for new block plugins. The
 * generator takes a slug (`my-callout`, `@scope/my-callout`) and
 * produces:
 *   - `packageName`  — what shows up in package.json (`@nexpress/plugin-block-<slug>` if no scope, otherwise the input)
 *   - `dirName`      — the on-disk folder name
 *   - `pluginId`     — manifest id, hyphenated
 *   - `exportName`   — the JS export (camelCase + "Plugin")
 *   - `blockType`    — default block id (`<slug>.<slug>` would be silly — use `<slug>.example`)
 */
function packageNameFromSlug(slug: string): string {
  if (slug.startsWith("@")) return slug;
  return slug;
}

function camelCase(input: string): string {
  const parts = input
    .replace(/^@[^/]+\//, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "plugin";
  const [first, ...rest] = parts;
  return (
    (first ?? "").toLowerCase() +
    rest.map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase()).join("")
  );
}

function pascalCase(input: string): string {
  const lower = camelCase(input);
  return lower[0]?.toUpperCase() + lower.slice(1);
}

function dirNameFromSlug(slug: string): string {
  return slug.replace(/^@[^/]+\//, "");
}

export interface ScaffoldOptions {
  slug: string;
  outDir: string;
  /**
   * When true, the scaffold emits a second entry (`./client`) with a
   * `"use client"` interactive form alongside the server-rendered block.
   * Picks up the wiring drilled in by the newsletter dogfood:
   *   - tsup `splitting: false` so the directive prologue stays at the
   *     top of `dist/<entry>.js`
   *   - self-import (`<package>/client`) marked external so the
   *     server entry keeps a real import line crossing into the client
   *     module — Next's bundler relies on this to detect the boundary
   *   - tsconfig `lib: ["DOM", "DOM.Iterable"]` added so DOM types
   *     resolve in the client component
   * Default false; static blocks (Callout / Embed) don't pay for any
   * of this.
   */
  interactive?: boolean;
  dependencyRanges?: ScaffoldDependencyRanges;
}

// `ScaffoldResult` is shared with the other plugin-kind generators —
// re-exporting from utils keeps the existing `import { ScaffoldResult }
// from "./scaffold-block-plugin.js"` callers compiling.
export type { ScaffoldResult } from "./scaffold-utils.js";
import type { ScaffoldResult } from "./scaffold-utils.js";

export async function scaffoldBlockPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir, dependencyRanges, interactive = false } = options;
  const dirName = dirNameFromSlug(slug);
  const pluginDir = resolve(outDir, dirName);

  if (existsSync(pluginDir)) {
    throw new Error(
      `Refusing to overwrite existing directory: ${pluginDir}. Pick a new slug or remove the directory first.`,
    );
  }

  const packageName = packageNameFromSlug(slug);
  const pluginId = dirName;
  const identifier = camelCase(slug);
  const exportName = `${identifier}Plugin`;
  const blockTypeRoot = identifier;
  const blockComponentName = pascalCase(slug);

  // ────────────── package.json ──────────────
  const exportsBlock: Record<string, { types: string; import: string }> = {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
  };
  if (interactive) {
    exportsBlock["./client"] = {
      types: "./dist/client.d.ts",
      import: "./dist/client.js",
    };
  }
  const packageJson =
    JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        description: `Block plugin: ${packageName}`,
        license: "MIT",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: exportsBlock,
        files: ["dist"],
        engines: { node: ">=20" },
        peerDependencies: {
          react: "^19.0.0",
        },
        dependencies: {
          ...frameworkDependencyRanges(dependencyRanges),
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          tsup: "^8.5.0",
          typescript: "^5.8.0",
        },
        scripts: {
          build: "tsup",
          dev: "tsup --watch --no-clean",
          clean: "rm -rf dist",
          typecheck: "tsc --noEmit",
        },
      },
      null,
      2,
    ) + "\n";

  // ────────────── tsconfig.json ──────────────
  const tsconfig = baseTsconfig({
    extendsPath: resolveTsconfigExtends(pluginDir),
    ...(interactive ? { lib: ["ES2022", "DOM", "DOM.Iterable"] } : {}),
  });

  // ────────────── tsup.config.ts ──────────────
  const tsupConfig = interactive
    ? `import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: {
    index: "src/index.tsx",
    client: "src/client.tsx",
  },
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  // Self-import (\`${packageName}/client\`) stays external so the index
  // bundle keeps a real \`import\` line crossing into the client module —
  // Next.js's bundler keys off that import to detect the "use client"
  // boundary. Inline it (the tsup default) and Next sees a server module
  // calling \`useState\`, which crashes at render.
  external: ["react", "${packageName}/client"],
  // Without splitting:false, esbuild pulls shared code into a chunk file
  // that doesn't carry the \`"use client"\` directive prologue. Each entry
  // ships self-contained instead.
  splitting: false,
});
`
    : `import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: ["react"],
});
`;

  // ────────────── README.md ──────────────
  const readme = `# ${packageName}

A NexPress ${interactive ? "interactive " : ""}block plugin scaffolded by \`nexpress create block-plugin\`${interactive ? " --interactive" : ""}.

## Develop

\`\`\`bash
pnpm --filter ${packageName} dev    # rebuild on changes
pnpm --filter ${packageName} build  # one-shot
\`\`\`

## Register in your project

\`\`\`bash
# From your NexPress project root:
pnpm --filter ${packageName} build
pnpm exec nexpress plugin add ${packageName}
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
import ${exportName} from "${packageName}";

export default defineConfig({
  // ...
  plugins: [${exportName}],
});
\`\`\`

## Remove from your project

\`\`\`bash
# From your NexPress project root:
pnpm exec nexpress plugin remove ${packageName}
# Restart your dev server or redeploy, then:
pnpm --silent run ops:plugins -- doctor --json
\`\`\`

\`plugin remove\` unregisters the plugin, removes the package dependency, and
prints the restart step. Restart your dev server or redeploy before checking
that the plugin no longer appears in the loaded plugin list.

\`definePlugin()\` validates every block type, metadata field, props schema,
container constraint, and renderer while the module loads. The doctor reports
malformed definitions as \`plugins.block_invalid\`, same-plugin duplicates as
\`plugins.block_duplicate\`, and cross-plugin ownership as
\`plugins.block_conflict\`.

## What's inside

${
  interactive
    ? `\`src/index.tsx\` defines a server-rendered block (\`${blockTypeRoot}.example\`) and
imports a \`"use client"\` form from \`./client\`. The form uses \`useState\` to
manage local state — open the file and replace the placeholder with your real
interactive UI.

\`src/client.tsx\` is a real client component (the \`"use client"\` directive at
the top is required). Don't import server-only modules from here — anything
you reference will land in the browser bundle.

The package re-imports the client entry through its own \`./client\` subpath
so Next.js's bundler can detect the server → client boundary. See the inline
comments in \`tsup.config.ts\` for the why.`
    : `\`src/index.tsx\` defines a single example block (\`${blockTypeRoot}.example\`)
with text + boolean + select fields. Edit \`propsSchema\` and \`render\` to
make it your own. Reference: [Block plugin guide](https://github.com/nexpress-cms/nexpress).`
}
`;

  // ────────────── src/index.tsx ──────────────
  const indexSource = interactive
    ? `import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

// Imported via the package's own \`./client\` subpath (not a relative
// path) so the bundler keeps an external import line — that's how
// Next.js detects the server → client boundary on this file. See
// \`tsup.config.ts\` for the matching \`external\` entry.
import { ${blockComponentName}Form } from "${packageName}/client";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

const ${blockComponentName}Block: NpBlockDefinition = {
  type: "${blockTypeRoot}.example",
  label: "${blockComponentName}",
  description: "Interactive block scaffolded by nexpress create block-plugin --interactive.",
  icon: "✨",
  defaultProps: {
    title: "Hello, ${blockComponentName}",
    placeholder: "Type something…",
  },
  propsSchema: [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      defaultValue: "Hello, ${blockComponentName}",
    },
    {
      name: "placeholder",
      label: "Input placeholder",
      type: "text",
      defaultValue: "Type something…",
    },
  ],
  render: (props) => {
    const title = readString(props.title, "Hello");
    const placeholder = readString(props.placeholder, "Type something…");

    const wrapperStyle: CSSProperties = {
      padding: "1.25rem 1.5rem",
      margin: "1rem 0",
      borderRadius: "0.5rem",
      border: "1px solid #e2e8f0",
      backgroundColor: "#f8fafc",
    };

    return (
      <section className="np-block-${blockTypeRoot}" style={wrapperStyle}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "1.125rem", fontWeight: 600 }}>
          {title}
        </h3>
        <${blockComponentName}Form placeholder={placeholder} />
      </section>
    );
  },
};

export const ${exportName} = definePlugin({
  manifest: {
    id: "${pluginId}",
    version: "0.1.0",
    name: "${packageName}",
    description: "Interactive block plugin.",
    author: { name: "" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [${blockComponentName}Block] satisfies NpBlockDefinition[],
});

export default ${exportName};
`
    : `import type { CSSProperties } from "react";

import type { NpBlockDefinition } from "@nexpress/blocks";
import { definePlugin } from "@nexpress/plugin-sdk";

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

const ${blockComponentName}Block: NpBlockDefinition = {
  type: "${blockTypeRoot}.example",
  label: "${blockComponentName}",
  description: "Example block scaffolded by nexpress create block-plugin.",
  icon: "✨",
  defaultProps: {
    title: "Hello, ${blockComponentName}",
    body: "Edit src/index.tsx to make this block your own.",
    showBorder: true,
  },
  propsSchema: [
    {
      name: "title",
      label: "Title",
      type: "text",
      required: true,
      defaultValue: "Hello, ${blockComponentName}",
    },
    {
      name: "body",
      label: "Body",
      type: "textarea",
      defaultValue: "Edit src/index.tsx to make this block your own.",
    },
    {
      name: "showBorder",
      label: "Show border",
      type: "boolean",
      defaultValue: true,
    },
  ],
  render: (props) => {
    const title = readString(props.title, "Hello");
    const body = readString(props.body, "");
    const showBorder = readBool(props.showBorder, true);

    const wrapperStyle: CSSProperties = {
      padding: "1.25rem 1.5rem",
      margin: "1rem 0",
      borderRadius: "0.5rem",
      border: showBorder ? "1px solid #e2e8f0" : "none",
      backgroundColor: "#f8fafc",
    };

    return (
      <div className="np-block-${blockTypeRoot}" style={wrapperStyle}>
        <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>{title}</h3>
        {body.length > 0 ? (
          <p style={{ margin: "0.375rem 0 0", color: "#475569", lineHeight: 1.55 }}>{body}</p>
        ) : null}
      </div>
    );
  },
};

export const ${exportName} = definePlugin({
  manifest: {
    id: "${pluginId}",
    version: "0.1.0",
    name: "${packageName}",
    description: "Example block plugin.",
    author: { name: "" },
    license: "MIT",
    nexpress: { minVersion: "0.1.0" },
  },
  blocks: [${blockComponentName}Block] satisfies NpBlockDefinition[],
});

export default ${exportName};
`;

  // ────────────── src/client.tsx (interactive only) ──────────────
  const clientSource = `"use client";

import { useState, type CSSProperties, type ChangeEvent } from "react";

interface ${blockComponentName}FormProps {
  placeholder: string;
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "0.625rem 0.875rem",
  borderRadius: "0.5rem",
  border: "1px solid #cbd5e1",
  fontSize: "0.95rem",
};

const echoStyle: CSSProperties = {
  marginTop: "0.5rem",
  padding: "0.5rem 0.75rem",
  borderRadius: "0.5rem",
  backgroundColor: "#e2e8f0",
  fontSize: "0.85rem",
  color: "#334155",
};

export function ${blockComponentName}Form({ placeholder }: ${blockComponentName}FormProps): React.ReactElement {
  const [value, setValue] = useState("");
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.value);
  };
  return (
    <div>
      <input type="text" value={value} onChange={onChange} placeholder={placeholder} style={inputStyle} />
      {value.length > 0 ? <p style={echoStyle}>You typed: {value}</p> : null}
    </div>
  );
}
`;

  const selfShimSource = `/**
 * Ambient declaration for this package's own \`./client\` subpath.
 * It keeps tsup's dts build from resolving through the package exports
 * map before \`dist/client.d.ts\` exists.
 */
declare module "${packageName}/client" {
  export { ${blockComponentName}Form } from "./client.js";
}
`;

  // ────────────── assemble ──────────────
  const files: Record<string, string> = {
    "package.json": packageJson,
    "tsconfig.json": tsconfig,
    "tsup.config.ts": tsupConfig,
    "README.md": readme,
    "src/index.tsx": indexSource,
  };
  if (interactive) {
    files["src/client.tsx"] = clientSource;
    files["src/self-shim.d.ts"] = selfShimSource;
  }

  await mkdir(resolve(pluginDir, "src"), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await writeFile(resolve(pluginDir, path), content, "utf-8");
  }

  return {
    files: Object.keys(files),
    packageDir: pluginDir,
    kind: "block",
    interactive,
  };
}
