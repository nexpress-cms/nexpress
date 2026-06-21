export interface PluginInstallHints {
  packageName: string;
  installCommand: string;
  packageInstallCommand: string;
  registerSnippet: string;
  verifyCommand: string;
  projectVerifyCommand: string;
  restartHint: string;
  note: string;
}

function toIdentifierSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "plugin";
  const parts = cleaned.split(/\s+/);
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function pluginImportName(packageName: string): string {
  const packageStem = packageName.includes("/")
    ? (packageName.split("/").pop() ?? packageName)
    : packageName;
  const withoutPrefix = packageStem.replace(/^nexpress-plugin-/u, "").replace(/^plugin-/u, "");
  const base = toIdentifierSegment(withoutPrefix);
  const prefixed = /^[a-zA-Z_$]/u.test(base) ? base : `plugin${base}`;
  return prefixed.endsWith("Plugin") ? prefixed : `${prefixed}Plugin`;
}

export function buildPluginInstallHints(packageName: string): PluginInstallHints {
  const importName = pluginImportName(packageName);
  return {
    packageName,
    installCommand: `pnpm exec nexpress plugin add ${packageName}`,
    packageInstallCommand: `pnpm add ${packageName}`,
    registerSnippet: [
      `import { defineConfig } from "@nexpress/core";`,
      `import ${importName} from ${JSON.stringify(packageName)};`,
      "",
      "export default defineConfig({",
      "  plugins: [",
      `    ${importName},`,
      "  ],",
      "});",
    ].join("\n"),
    verifyCommand: "nexpress ops plugins doctor --json",
    projectVerifyCommand: "pnpm --silent run ops:plugins -- doctor --json",
    restartHint:
      "Restart pnpm dev or redeploy so plugin hooks, routes, blocks, and tasks load at boot.",
    note: "Run the NexPress CLI from the project root. It installs the package and updates the plugin marker block; use the manual package command and config snippet only when a custom config shape prevents automatic editing.",
  };
}
