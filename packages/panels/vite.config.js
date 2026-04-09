import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "./index.js",
      name: "panels",
      fileName: "panels",
      formats: ["es"],
    },
    rollupOptions: {
      external: [/^react/, "styled-components", /^@chatbox\/core/],
    },
  },
});
