import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const serverPort = Number(process.env.TEST_CENTER_SERVER_PORT ?? 4780);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.TEST_CENTER_CONSOLE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
      "/ws": {
        target: `ws://127.0.0.1:${serverPort}`,
        ws: true,
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
