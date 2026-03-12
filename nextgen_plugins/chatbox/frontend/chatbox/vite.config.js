import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from "@originjs/vite-plugin-federation";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "mfe_nrds_chatbox",
      filename: "remoteEntry.js",
      exposes: {
        "./Chatbox": "./src/chatbox",
      },
      shared: ["react", "react-dom"],
    }),
    cssInjectedByJsPlugin(),
  ],
  build: {
    target: "esnext",
  },
  server: {
    proxy: {
      "/sse": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
      },
      "/messages": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/sse": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
      },
      "/messages": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
      },
    },
  },
})
