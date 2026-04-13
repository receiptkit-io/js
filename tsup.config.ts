import { defineConfig } from "tsup";

export default defineConfig({
  // Entry points — one per public subpath export.
  // The ./internal subpath is intentionally omitted from the published build.
  entry: {
    index: "src/index.ts",
    "http/index": "src/http/index.ts",
    "mqtt/index": "src/mqtt/index.ts",
    "react/index": "src/react/index.ts",
    "server/index": "src/server/index.ts",
  },
  // Ship both ESM and CJS so the package works in all Node/bundler configs.
  format: ["esm", "cjs"],
  // Generate .d.ts declaration files.
  dts: true,
  // Clean dist/ on each build.
  clean: true,
  // Split shared code into chunks (avoids duplicating types across entries).
  splitting: true,
  // Source maps for better debugging in consuming projects.
  sourcemap: true,
  // Target modern environments — consuming projects polyfill for older targets.
  target: "es2020",
  // External dependencies — consumers must install these themselves.
  external: ["react", "react-dom", "mqtt"],
  // Shims for __dirname etc. in ESM output.
  shims: true,
});
