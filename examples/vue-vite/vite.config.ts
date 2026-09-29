import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// base "./": the build works from any path (the examples showcase serves it at /vue/)
export default defineConfig({ base: "./", plugins: [vue()], build: { target: "es2022" } });
