// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

/**
 * Pages that exist only under `astro dev`. They live outside `src/pages/`, so a production
 * build never sees them: no route (a plain 404) and no client chunk in `dist/`.
 * @type {import("astro").AstroIntegration}
 */
const devOnlyRoutes = {
  name: "dev-only-routes",
  hooks: {
    "astro:config:setup": ({ command, injectRoute }) => {
      if (command !== "dev") return;
      injectRoute({ pattern: "/dev/ui-kitchen-sink", entrypoint: "./src/dev/ui-kitchen-sink.astro" });
    },
  },
};

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap(), devOnlyRoutes],
  vite: {
    plugins: [tailwindcss()],
    server: {
      watch: {
        ignored: ["**/.vs/**"],
      },
    },
  },
  adapter: cloudflare({ imageService: "passthrough" }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENAI_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
