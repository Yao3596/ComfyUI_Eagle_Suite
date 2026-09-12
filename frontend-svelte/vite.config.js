import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    emptyOutDir: false,
    sourcemap: false,
    target: "es2022",
    lib: {
      entry: resolve(import.meta.dirname, "src/entries/h3-review-workspace.js"),
      formats: ["es"],
      fileName: () => "h3-review-workspace.js",
      cssFileName: "h3-review-workspace",
    },
    outDir: resolve(import.meta.dirname, "../web/svelte-dist"),
  },
});
