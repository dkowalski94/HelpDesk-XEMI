// Spike 2026-11-24: `getViteConfig()` from `astro/config` loads the @astrojs/cloudflare adapter, which
// starts its workerd runner and fails ("module is not defined"), so this is the plain Vitest fallback
// with only the `@` alias and no Astro config; `@/lib/openai` (the one `astro:env/server` reader) is mocked.
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const TEST_ENV_KEYS = ["SUPABASE_URL", "SUPABASE_KEY"];

export default defineConfig(({ mode }) => {
  // Only the Supabase connection reaches the tests — never OPENAI_API_KEY.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    test: {
      include: ["src/**/*.test.ts"],
      environment: "node",
      // A missing variable stays missing, so the persona helper fails with its setup hint.
      env: Object.fromEntries(TEST_ENV_KEYS.filter((key) => key in env).map((key) => [key, env[key]])),
    },
  };
});
