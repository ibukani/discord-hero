import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../../",
  plugins: [react(), cloudflare()],
  define: {
    "import.meta.env.VITE_DISCORD_CLIENT_ID": JSON.stringify(process.env.VITE_DISCORD_CLIENT_ID ?? ""),
    "import.meta.env.VITE_WORKER_HOST": JSON.stringify(process.env.VITE_WORKER_HOST ?? ""),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    sourcemap: true,
  },
});
