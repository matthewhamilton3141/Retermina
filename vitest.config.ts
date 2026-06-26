import { defineConfig } from "vitest/config";

// Unit tests run only against the pure logic modules under src/lib — no DOM,
// no Tauri `invoke`, no React. A plain node environment keeps them fast and
// keeps this config independent of the Tauri-tailored vite.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
