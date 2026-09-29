import { defineConfig } from "tsup";

const external = ["react", "react-dom", "react/jsx-runtime", "wagmi", "viem", "@tanstack/react-query", "motion", "motion/react"];

export default defineConfig([
  {
    entry: { index: "src/index.ts", abis: "src/abis/index.ts", avatar: "src/avatar/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2022",
    treeshake: false,
    external,
  },
  {
    // The widget is a client component: keep the directive at the top of the bundle for Next.js hosts.
    entry: { react: "src/react/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2022",
    treeshake: false,
    external,
    banner: { js: '"use client";' },
  },
]);
