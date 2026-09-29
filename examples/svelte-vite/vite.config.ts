import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// base "./": the build works from any path (the examples showcase serves it at /svelte/)
export default defineConfig({ base: "./", plugins: [svelte()], build: { target: "es2022" } });
