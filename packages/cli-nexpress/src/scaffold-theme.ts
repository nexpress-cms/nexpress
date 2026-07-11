import { resolve } from "node:path";

import { packageToThemeIdentifier } from "./config-editor.js";
import {
  assertDirAvailable,
  camelCase,
  frameworkDependencyRanges,
  pascalCase,
  resolveTsconfigExtends,
  writeScaffoldFiles,
  type ScaffoldDependencyRanges,
  type ScaffoldResult,
} from "./scaffold-utils.js";

interface ThemeScaffoldNames {
  packageName: string;
  themeId: string;
  exportName: string;
  cssExportName: string;
  shellName: string;
  headerName: string;
  footerName: string;
  pageTemplateName: string;
  themeDir: string;
  displayName: string;
}

export interface ThemeScaffoldOptions {
  slug: string;
  outDir: string;
  dependencyRanges?: ScaffoldDependencyRanges;
}

function splitScopedPackage(value: string): { scope: string | null; name: string } {
  const match = value.match(/^(@[^/]+)\/(.+)$/);
  if (!match) return { scope: null, name: value };
  return { scope: match[1] ?? null, name: match[2] ?? value };
}

function ensureThemePackageName(name: string): string {
  return /^theme[-_]/.test(name) ? name : `theme-${name}`;
}

export function packageNameFromThemeSlug(slug: string): string {
  const { scope, name } = splitScopedPackage(slug);
  const packageName = ensureThemePackageName(name);
  return scope ? `${scope}/${packageName}` : packageName;
}

function themeIdFromPackageName(packageName: string): string {
  const { name } = splitScopedPackage(packageName);
  const tail = name.replace(/^theme[-_]/, "");
  const parts = tail.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(
      `Cannot derive a theme id from "${packageName}". Use a slug like "my-brand" or "@scope/theme-my-brand".`,
    );
  }
  return parts.map((part) => part.toLowerCase()).join("-");
}

function titleCaseThemeId(themeId: string): string {
  return themeId
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function deriveThemeNames(slug: string, outDir: string): ThemeScaffoldNames {
  const packageName = packageNameFromThemeSlug(slug);
  const themeId = themeIdFromPackageName(packageName);
  const exportName = packageToThemeIdentifier(packageName);
  const prefix = pascalCase(themeId);
  const identifier = camelCase(themeId);
  return {
    packageName,
    themeId,
    exportName,
    cssExportName: `${identifier}Css`,
    shellName: `${prefix}Shell`,
    headerName: `${prefix}Header`,
    footerName: `${prefix}Footer`,
    pageTemplateName: `${prefix}PageTemplate`,
    themeDir: resolve(outDir, themeId),
    displayName: titleCaseThemeId(themeId),
  };
}

function packageJson(
  names: ThemeScaffoldNames,
  dependencyRanges?: ScaffoldDependencyRanges,
): string {
  return (
    JSON.stringify(
      {
        name: names.packageName,
        version: "0.1.0",
        description: `${names.displayName} theme for NexPress.`,
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
          next: "^16.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
        dependencies: {
          ...frameworkDependencyRanges(dependencyRanges, ["@nexpress/blocks", "@nexpress/theme"]),
        },
        devDependencies: {
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
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
    ) + "\n"
  );
}

function tsconfig(names: ThemeScaffoldNames): string {
  const extendsPath = resolveTsconfigExtends(names.themeDir);
  return (
    JSON.stringify(
      {
        ...(extendsPath ? { extends: extendsPath } : {}),
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          isolatedModules: true,
          declaration: true,
          declarationMap: true,
          sourceMap: true,
          outDir: "dist",
          rootDir: "src",
          jsx: "react-jsx",
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n"
  );
}

function tsupConfig(): string {
  return `import { defineConfig } from "tsup";

const fast = process.env.NP_DEV_FAST === "1";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: !fast,
  clean: true,
  sourcemap: !fast,
  external: ["react", "react-dom", "next", "@nexpress/blocks", "@nexpress/theme"],
});
`;
}

function indexSource(names: ThemeScaffoldNames): string {
  return `import { defineTheme } from "@nexpress/theme";

import { ${names.footerName} } from "./footer.js";
import { ${names.headerName} } from "./header.js";
import { ${names.shellName} } from "./shell.js";
import { ${names.cssExportName} } from "./styles.js";
import { ${names.pageTemplateName} } from "./templates/page-default.js";

export const ${names.exportName} = defineTheme({
  manifest: {
    id: "${names.themeId}",
    version: "0.1.0",
    name: "${names.displayName}",
    description: "Custom NexPress theme.",
    author: { name: "Theme author" },
    nexpress: { minVersion: "0.1.0" },
  },
  impl: {
    shell: ${names.shellName},
    slots: {
      header: ${names.headerName},
      footer: ${names.footerName},
    },
    css: ${names.cssExportName},
    templates: {
      pages: {
        default: {
          label: "Default",
          description: "Readable page layout with authored blocks.",
          component: ${names.pageTemplateName},
        },
      },
    },
  },
});

export default ${names.exportName};
`;
}

function shellSource(names: ThemeScaffoldNames): string {
  return `import type { NpThemeShellProps } from "@nexpress/theme";

export function ${names.shellName}({ children }: NpThemeShellProps) {
  return <div className="np-${names.themeId}-shell">{children}</div>;
}
`;
}

function headerSource(names: ThemeScaffoldNames): string {
  return `export function ${names.headerName}() {
  return (
    <header className="np-${names.themeId}-header">
      <a className="np-${names.themeId}-brand" href="/">
        ${names.displayName}
      </a>
      <nav className="np-${names.themeId}-nav" aria-label="Primary navigation">
        <a href="/blog">Blog</a>
        <a href="/about">About</a>
        <a href="/search">Search</a>
      </nav>
    </header>
  );
}
`;
}

function footerSource(names: ThemeScaffoldNames): string {
  return `export function ${names.footerName}() {
  return (
    <footer className="np-${names.themeId}-footer">
      <p>Built with NexPress.</p>
      <a href="/admin">Admin</a>
    </footer>
  );
}
`;
}

function pageTemplateSource(names: ThemeScaffoldNames): string {
  return `import { renderBlocks, type NpPageBlocks } from "@nexpress/blocks";
import type { NpTemplateRenderProps } from "@nexpress/theme";

export function ${names.pageTemplateName}({ doc, blockCtx }: NpTemplateRenderProps) {
  const page = doc as { title?: string; blocks?: NpPageBlocks };
  return (
    <main className="np-${names.themeId}-page">
      <div className="np-${names.themeId}-page-inner">
        <h1>{page.title ?? "Untitled"}</h1>
        {page.blocks ? renderBlocks(page.blocks, { ctx: blockCtx }) : null}
      </div>
    </main>
  );
}
`;
}

function stylesSource(names: ThemeScaffoldNames): string {
  return `export const ${names.cssExportName} = \`
.np-${names.themeId}-shell {
  min-height: 100vh;
  color: var(--np-color-foreground, #111827);
  background: var(--np-color-background, #ffffff);
}

.np-${names.themeId}-header,
.np-${names.themeId}-footer {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.np-${names.themeId}-header {
  padding: 22px 0;
  border-bottom: 1px solid var(--np-color-border, #e5e7eb);
}

.np-${names.themeId}-brand {
  color: inherit;
  font-weight: 800;
  text-decoration: none;
}

.np-${names.themeId}-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 0.95rem;
}

.np-${names.themeId}-nav a,
.np-${names.themeId}-footer a {
  color: var(--np-color-muted-foreground, #4b5563);
  text-decoration: none;
}

.np-${names.themeId}-nav a:hover,
.np-${names.themeId}-footer a:hover {
  color: var(--np-color-primary, #2563eb);
}

.np-${names.themeId}-page {
  padding: 56px 0 72px;
}

.np-${names.themeId}-page-inner {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto;
}

.np-${names.themeId}-page h1 {
  margin: 0 0 24px;
  font-size: 3.5rem;
  line-height: 1;
}

.np-${names.themeId}-footer {
  padding: 28px 0 40px;
  border-top: 1px solid var(--np-color-border, #e5e7eb);
  color: var(--np-color-muted-foreground, #4b5563);
}

@media (max-width: 640px) {
  .np-${names.themeId}-header,
  .np-${names.themeId}-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .np-${names.themeId}-page h1 {
    font-size: 2.25rem;
  }
}
\`;
`;
}

function readmeSource(names: ThemeScaffoldNames): string {
  return `# ${names.packageName}

A NexPress theme scaffolded by \`nexpress create theme\`.

## Develop

\`\`\`bash
pnpm --filter ${names.packageName} dev
pnpm --filter ${names.packageName} build
\`\`\`

## Register in your project

\`\`\`bash
# From your NexPress project root:
pnpm --filter ${names.packageName} build
pnpm exec nexpress theme add ${names.packageName} --yes
pnpm db:generate && pnpm db:migrate
\`\`\`

\`theme add\` installs the local workspace package when it lives under
\`packages/themes/*\`, updates the \`nexpress.config.ts\` theme markers, and
prints the activation step. Restart your dev server or redeploy after building
so the boot-time theme registry sees the package.

Activate the theme in Admin -> Settings -> Theme.

## What's inside

- \`src/index.ts\` exports \`${names.exportName}\` via \`defineTheme(...)\`.
- \`src/shell.tsx\`, \`src/header.tsx\`, and \`src/footer.tsx\` define the site chrome.
- \`src/templates/page-default.tsx\` renders page documents and authored blocks.
- \`src/styles.ts\` contains active-theme CSS injected by the framework.

Reference: https://github.com/nexpress-cms/nexpress/blob/main/docs/theme-authoring.md
`;
}

export async function scaffoldTheme(options: ThemeScaffoldOptions): Promise<ScaffoldResult> {
  const { slug, outDir, dependencyRanges } = options;
  const names = deriveThemeNames(slug, outDir);
  assertDirAvailable(names.themeDir);

  const files: Record<string, string> = {
    "package.json": packageJson(names, dependencyRanges),
    "tsconfig.json": tsconfig(names),
    "tsup.config.ts": tsupConfig(),
    "README.md": readmeSource(names),
    "src/index.ts": indexSource(names),
    "src/shell.tsx": shellSource(names),
    "src/header.tsx": headerSource(names),
    "src/footer.tsx": footerSource(names),
    "src/styles.ts": stylesSource(names),
    "src/templates/page-default.tsx": pageTemplateSource(names),
  };

  return {
    files: await writeScaffoldFiles(names.themeDir, files),
    packageDir: names.themeDir,
    kind: "theme",
    interactive: false,
  };
}
