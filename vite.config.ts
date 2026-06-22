import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Split heavy vendor libraries into their own chunks so the Launch Hub isn't
  // forced to download the terminal/grid/highlighter code up front, and the
  // single >500 KB warning chunk is broken into cacheable pieces.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
          grid: ["react-grid-layout"],
          prism: ["prismjs"],
          vendor: ["zustand", "lucide-react"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
