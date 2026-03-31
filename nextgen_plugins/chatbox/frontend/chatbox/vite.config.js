import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import federation from "@originjs/vite-plugin-federation";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const ollamaTarget = (env.VITE_OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');

  const ollamaProxy = {
    target: ollamaTarget,
    changeOrigin: true,
  };

  return {
    plugins: [
      react(),
      federation({
        name: "mfe_nrds_chatbox",
        filename: "remoteEntry.js",
        exposes: {
          "./Chatbox": "./src/chatbox",
          "./ChartPanel": "./src/panels/ChartPanel",
          "./MapPanel": "./src/panels/MapPanel",
          "./MarkdownPanel": "./src/panels/MarkdownPanel",
          "./QueryPanel": "./src/panels/QueryPanel",
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
        "/api": ollamaProxy,
      },
    },
    preview: {
      cors: true,
      proxy: {
        "/sse": {
          target: "http://127.0.0.1:9000",
          changeOrigin: true,
        },
        "/messages": {
          target: "http://127.0.0.1:9000",
          changeOrigin: true,
        },
        "/api": ollamaProxy,
      },
    },
  };
})
