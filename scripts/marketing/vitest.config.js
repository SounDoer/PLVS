import { defineConfig } from "vitest/config";

// The marketing tools are not part of the app, and their suites' duration follows machine load.
// They run through `npm run test:marketing` instead of the merge gate (`vite.config.js` excludes
// this directory), so a marketing script cannot stop an app release.
export default defineConfig({
  test: {
    include: ["scripts/marketing/**/*.test.{js,mjs}"],
    testTimeout: 30_000,
  },
});
