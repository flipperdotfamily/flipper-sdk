import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./": the build works from any path (the examples showcase serves it at /react/)
export default defineConfig({ base: "./", plugins: [react()], build: { target: "es2022" } });
