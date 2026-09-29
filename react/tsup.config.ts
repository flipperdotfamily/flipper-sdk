import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2020",
  treeshake: false,
  external: ["react", "react-dom", "react/jsx-runtime", /^@flipperdotfamily\//, /^viem/],
  // client components: keep the directive at the top of the bundle for Next.js / RSC hosts
  banner: { js: '"use client";' },
});
