import { defineConfig, loadEnv } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import federation from "@originjs/vite-plugin-federation";

const coreRoot = resolve(__dirname, '../../../../packages/chatbox-core');

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const ollamaTarget = (env.VITE_OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  console.log(`Using Ollama host: ${ollamaTarget}`);
  const ollamaApiKey = (env.VITE_OLLAMA_API_KEY || '').replace(/^['"]|['"]$/g, '');
  console.log(`Using Ollama API key: ${ollamaApiKey}`);
  const ollamaProxy = {
    target: ollamaTarget,
    changeOrigin: true,
    // Strip trailing slashes — Ollama Cloud returns 404 for /api/tags/ but
    // 200 for /api/tags. Django proxy strips slashes before forwarding;
    // Vite proxy must do the same.
    rewrite: (path) => path.replace(/\/+$/, ''),
    ...(ollamaApiKey && {
      headers: { Authorization: `Bearer ${ollamaApiKey}` },
    }),
  };

  // Mirror the Django Ollama proxy path so chatbox-core's adapter works in dev.
  // Target is VITE_OLLAMA_HOST (same as /api proxy). In production, the Django
  // proxy reads x-ollama-host dynamically; in dev, the env var is the target.
  const djangoOllamaProxy = {
    target: ollamaTarget,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/apps\/tethysdash\/ollama-proxy/, '').replace(/\/+$/, ''),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        // Forward API key from header or env var
        const dynamicKey = req.headers['x-ollama-key'];
        const key = dynamicKey || ollamaApiKey;
        if (key) {
          proxyReq.setHeader('Authorization', `Bearer ${key}`);
        }
        // Remove chatbox-core custom headers before forwarding to Ollama
        proxyReq.removeHeader('x-ollama-host');
        proxyReq.removeHeader('x-ollama-key');
        proxyReq.removeHeader('x-csrftoken');
      });
    },
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
        shared: ["react", "react-dom", "styled-components"],
      }),
    ],
    resolve: {
      dedupe: ["react", "react-dom", "styled-components"],
      // In dev mode, resolve @chatbox/core to source files (not dist/)
      // so edits are reflected immediately via Vite HMR.
      // Production builds still use dist/ via the package.json exports map.
      ...(mode !== 'production' && {
        alias: {
          "@chatbox/core/components": resolve(coreRoot, "components/index.js"),
          "@chatbox/core/engine": resolve(coreRoot, "engine/index.js"),
          "@chatbox/core/engine/embeddings": resolve(coreRoot, "engine/embeddings.js"),
          "@chatbox/core/helpers": resolve(coreRoot, "helpers/index.js"),
          "@chatbox/core/conversation": resolve(coreRoot, "conversation/index.js"),
          "@chatbox/core/config": resolve(coreRoot, "config/index.js"),
          "@chatbox/core/messages": resolve(coreRoot, "messages/index.js"),
          "@chatbox/core/storage": resolve(coreRoot, "storage/mcpStorage.js"),
          "@chatbox/core/theme": resolve(coreRoot, "theme/index.js"),
          "@chatbox/core": resolve(coreRoot, "index.js"),
        },
      }),
    },
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
        "/apps/tethysdash/ollama-proxy/api": djangoOllamaProxy,
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
        "/apps/tethysdash/ollama-proxy/api": djangoOllamaProxy,
        "/api": ollamaProxy,
      },
    },
  };
})
