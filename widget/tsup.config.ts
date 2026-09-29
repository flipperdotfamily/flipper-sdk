import { defineConfig } from "tsup";

// ESM for bundlers: dependencies stay external (the host's bundler dedupes lit / viem / @flipperdotfamily/sdk).
// The single-file CDN builds (dist/cdn/*) come from scripts/cdn.mjs.
export default defineConfig({
  entry: { index: "src/index.ts", element: "src/element-entry.ts", host: "src/host/index.ts", embed: "src/embed/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  splitting: true,
  treeshake: true,
  external: [/^lit/, /^@flipperdotfamily\/sdk/, /^viem/],
});
