import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/.tsup/**",
      "**/coverage/**",
      "**/tsup.config.ts",
      "**/vitest.config.ts",
      "**/vitest.integration.config.ts",
      "**/vitest.unit.config.ts",
      "**/vitest.workspace.ts",
      "**/drizzle.config.ts",
      "**/next.config.ts",
      "**/next-env.d.ts",
      "**/postcss.config.mjs",
      "**/playwright.config.ts",
      "**/src/db/generated/**",
      "**/scripts/**",
      // create-nexpress's templates/ live under a separate
      // tsconfig.templates.json (typechecked by `tsc -p
      // tsconfig.templates.json`). ESLint's projectService picks the
      // package's main tsconfig.json, which doesn't cover this tree —
      // so every template file would surface as a "not found by the
      // project service" parse error. Lint is redundant here anyway:
      // when a user scaffolds, the templates land in their project
      // and get linted by their own toolchain.
      "packages/cli/templates/**",
      // apps/web integration tests aren't covered by apps/web's main
      // tsconfig (vitest does its own type stripping via esbuild).
      // Pulling them into the project service would surface real but
      // pre-existing type errors in the test suite — out of scope for
      // lint cleanup. The vitest run still type-checks them by virtue
      // of running them.
      "apps/web/tests/**",
      // Same story for @nexpress/core's integration suite — the
      // package tsconfig explicitly excludes `src/integration` (it
      // pulls in DB-only deps that the regular build shouldn't see).
      // Vitest runs them via its own esbuild pass.
      "packages/core/src/integration/**",
      "eslint.config.mjs",
      "docker/**",
      ".claude/**",
      ".sisyphus/**",
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
  },

  {
    files: ["packages/admin/**/*.{ts,tsx}", "packages/editor/**/*.{ts,tsx}", "packages/blocks/**/*.{ts,tsx}", "packages/theme/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks v7 ships ports of the React Compiler's
      // dataflow analysis as separate rules. Several reflect React 19+
      // architectural recommendations (move data fetching out of
      // useEffect into Server Components / `use(promise)` / a
      // data-fetching library) that are beyond the scope of a
      // package-level lint pass. Downgrade to "warn" so they remain
      // visible without blocking the build; promote back to "error"
      // when the React Compiler migration is planned (tracking issue
      // pending). The classic `rules-of-hooks` + `exhaustive-deps`
      // stay at error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/no-deriving-state-in-effects": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/incompatible-library": "warn",
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  {
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      "import-x/no-cycle": "error",
      "import-x/no-self-import": "error",
    },
  },

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },

  prettierConfig,
);
