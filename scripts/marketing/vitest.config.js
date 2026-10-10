import { defineConfig } from "vitest/config";

// The marketing tools are not part of the app, and their suites launch FFmpeg, Node and heavy
// file copies whose duration follows machine load. They run through `npm run test:marketing`
// instead of the merge gate (`vite.config.js` excludes this directory), so a promo-video script
// cannot stop an app release.
export default defineConfig({
  test: {
    include: ["scripts/marketing/**/*.test.{js,mjs}"],
    testTimeout: 30_000,
  },
});
