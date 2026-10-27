import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

// eslint-plugin-react still uses context APIs removed in ESLint 10; wrap it until it ships native support.
const reactPlugin = fixupPluginRules(pluginReact);

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [eslintPluginReactHooks.configs.flat["recommended-latest"]],
  plugins: { react: reactPlugin },
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...pluginReact.configs.flat.recommended.rules,
    "react/react-in-jsx-scope": "off",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  languageOptions: {
    // astro-eslint-parser does not support projectService yet and warns on every file; hand it a project path instead.
    parserOptions: { projectService: false, project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: {
    globals: { console: true, process: true, fetch: true, URLSearchParams: true, AbortSignal: true },
  },
  rules: { "no-console": "off" },
});

// UI contract (CLAUDE.md → "UI contract"): the views on design tokens may not reintroduce palette
// classes, arbitrary px/rem values or colour functions. Same pattern as the plan's hard-coded-value scan.
const HARD_CODED_UI_VALUE =
  "/#[0-9a-fA-F]{3,8}\\b|rgba?\\(|hsla?\\(|oklch\\(|-\\[[0-9.]+(px|rem)\\]|\\b(bg|text|border|ring|outline|from|via|to|fill|stroke|shadow|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\\b/";
const HARD_CODED_UI_MESSAGE =
  "Hard-coded colour or arbitrary value in a view on the UI contract — use a token role (bg-card, text-muted-foreground, text-destructive…) or a component from src/components/ui. See CLAUDE.md → UI contract.";
// `class` / `className` / `class:list` / `style` attributes (JSX in .tsx, astro-eslint-parser in .astro), `cn(...)`
// arguments outside those attributes (inside them they are already covered — no double report), and class strings
// kept in constants, matched by name (`linkClass` in Topbar, `heading`/`hint` in report-error, `FOCUS_RING`,
// `INNER_CARD`, `FIXED_ROWS` in format.ts) so copy and fixture text such as "kod #4012" is not checked.
const UI_CLASS_CONTEXTS = [
  "JSXAttribute[name.name=/^(class|className|style)$/]",
  "JSXAttribute[name.namespace.name='class']",
  "CallExpression[callee.name='cn']:not(JSXAttribute CallExpression)",
  "VariableDeclarator[id.name=/Class(es)?$|_(CLASS|RING|CARD|ROWS)$|^(heading|hint)$/]",
];

const uiContractConfig = defineConfig({
  files: [
    "src/pages/report-error.astro",
    "src/components/error-resolution/**",
    "src/components/Topbar.astro",
    "src/dev/ui-kitchen-sink.astro",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      ...UI_CLASS_CONTEXTS.flatMap((context) => [
        { selector: `${context} Literal[value=${HARD_CODED_UI_VALUE}]`, message: HARD_CODED_UI_MESSAGE },
        { selector: `${context} TemplateElement[value.raw=${HARD_CODED_UI_VALUE}]`, message: HARD_CODED_UI_MESSAGE },
      ]),
    ],
  },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  // Agent tooling installed under .claude/ is not project source; typed linting has no tsconfig for it.
  { ignores: [".claude/**"] },
  // Generated from the database schema by `supabase gen types typescript`. Its empty-object and
  // redundant-union shapes come from the generator, and any fix here is lost on the next run.
  { ignores: ["src/database.types.ts"] },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  scriptsConfig,
  uiContractConfig,
  eslintPluginPrettier,
);
