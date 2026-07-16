import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    // Opt in to jsdom per file with `/** @vitest-environment jsdom */`. Building a jsdom costs
    // ~1.4s per file, and most suites here are pure logic (math, layout, protocol) that never
    // touch the DOM — defaulting every file to jsdom spent ~115s of aggregate setup to run 0.76s
    // of assertions. A file that needs the DOM and forgets the docblock fails loudly.
    environment: "node",
    globals: true,
    // Nested git worktrees live under .claude/ with their own node_modules. Their test files sit
    // outside the default node_modules exclude, and importing them pulls in a second React copy
    // that breaks unrelated suites in this repo. Spread the defaults — setting exclude replaces
    // them, and dropping **/node_modules/** would be far worse than the problem being fixed.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/generated/**", "src/components/ui/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri injects TAURI_ENV_PLATFORM during `tauri build`; plain `vite build` must keep a modern target.
    target: (() => {
      const p = process.env.TAURI_ENV_PLATFORM;
      if (p === "windows") return "chrome105";
      if (p === "darwin" || p === "linux" || p === "android" || p === "ios") return "safari16";
      return undefined;
    })(),
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_DEBUG,
    // PLVS is a local Tauri app with one primary route; keep the warning for real growth.
    chunkSizeWarningLimit: 900,
  },
});
