import { resolve } from "node:path"
import solid from "@solidjs/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite-plus"

const serverHost = process.env.SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.SERVER_PORT ?? "4600"

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    {
      name: "dev-favicon",
      apply: "serve",
      transformIndexHtml: (html) => html.replace("/favicon.svg", "/favicon-dev.svg"),
    },
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  optimizeDeps: { exclude: ["@ui-sdk/core"] },
  test: { environment: "node" },
  worker: { format: "es" },
  server: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/rpc": { target: `ws://${serverHost}:${serverPort}`, ws: true },
    },
  },
})
