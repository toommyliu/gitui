import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite-plus"

const serverHost = process.env.SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.SERVER_PORT ?? "4600"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
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
