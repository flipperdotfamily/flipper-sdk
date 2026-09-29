import { defineConfig } from "vite";

// The runtime kit every demo site imports from /_showcase/kit.js (viem bundled in: one small ES module).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    lib: { entry: "kit/index.ts", formats: ["es"], fileName: () => "kit.js" },
  },
});
