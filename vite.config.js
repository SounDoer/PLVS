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
    // Silences jsdom's "getContext not implemented" stderr spam from canvas-backed components.
    setupFiles: ["./vitest.setup.js"],
    // Nested git worktrees live under one prefix per agent -- see AGENTS.md -- with their own
    // node_modules. Their test files sit outside the default node_modules exclude, and collecting
    // them breaks this repo's suites two ways: importing them pulls in a second React copy, and
    // the `@` alias resolves to this checkout's src, so a worktree's tests run against code they
    // were never written for and fail somewhere that looks unrelated. All three prefixes are
    // listed even where no worktree exists today: a missing one only shows up once a worktree
    // happens to be open. Spread the defaults — setting exclude replaces them, and dropping
    // **/node_modules/** would be far worse than the problem being fixed.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/.codex/**", "**/.cursor/**"],
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
    // PLVS_BUILD_SOURCEMAP is for profiling, and is deliberately not TAURI_DEBUG: that one also
    // turns minification off, which changes the very shape being measured. This keeps the shipped
    // code exactly as it ships and only emits the map beside it, so a recorded frame can be named
    // (`scripts/webview-cpu-profile.mjs --dist`).
    sourcemap: !!process.env.TAURI_DEBUG || process.env.PLVS_BUILD_SOURCEMAP === "1",
    // PLVS is a local Tauri app with one primary route; keep the warning for real growth.
    chunkSizeWarningLimit: 900,
  },
});
