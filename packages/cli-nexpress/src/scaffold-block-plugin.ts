import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
}

export interface ScaffoldResult {
  /** Files written, relative to `outDir`. Used by the CLI for the success message. */
  files: string[];
  /** Path to the new plugin directory. */
  pluginDir: string;
}

export async function scaffoldBlockPlugin(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir } = options;
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

  const files: Record<string, string> = {
    "package.json": JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        description: `Block plugin: ${packageName}`,
        license: "MIT",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
        files: ["dist"],
        engines: { node: ">=20" },
        peerDependencies: {
          react: "^19.0.0",
        },
        dependencies: {
          "@nexpress/blocks": "workspace:*",
          "@nexpress/plugin-sdk": "workspace:*",
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
    ) + "\n",

    "tsconfig.json":
      JSON.stringify(
        {
          extends: "../../tsconfig.base.json",
          compilerOptions: {
            outDir: "dist",
            rootDir: "src",
            jsx: "react-jsx",
          },
          include: ["src"],
        },
        null,
        2,
      ) + "\n",

    "tsup.config.ts": `import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: ["react"],
});
`,

    "README.md": `# ${packageName}

A NexPress block plugin scaffolded by \`nexpress create block-plugin\`.

## Develop

\`\`\`bash
pnpm --filter ${packageName} dev    # rebuild on changes
pnpm --filter ${packageName} build  # one-shot
\`\`\`

## Register in your project

\`\`\`ts
// nexpress.config.ts
import { ${exportName} } from "${packageName}";

export default defineConfig({
  // ...
  plugins: [${exportName}],
});
\`\`\`

## What's inside

\`src/index.tsx\` defines a single example block (\`${blockTypeRoot}.example\`)
with text + boolean + select fields. Edit \`propsSchema\` and \`render\` to
make it your own. Reference: [Block plugin guide](https://github.com/hahabsw/nexpress).
`,

    "src/index.tsx": `import type { CSSProperties } from "react";

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
  blocks: [${blockComponentName}Block],
});

export default ${exportName};
`,
  };

  await mkdir(resolve(pluginDir, "src"), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await writeFile(resolve(pluginDir, path), content, "utf-8");
  }

  return {
    files: Object.keys(files),
    pluginDir,
  };
}
