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
      "**/vitest.workspace.ts",
      "**/drizzle.config.ts",
      "**/next.config.ts",
      "**/next-env.d.ts",
      "**/postcss.config.mjs",
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
