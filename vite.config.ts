import { loadEnvFile } from "node:process";
import fs from "node:fs";

if (fs.existsSync(".env")) {
  try {
    loadEnvFile();
  } catch (e) {
    // ignore
  }
}

export default {
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          (warning.message?.includes("use client") || warning.message?.includes('"use client"'))
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          mantine: ["@mantine/core", "@mantine/hooks"],
          icons: ["@tabler/icons-react"],
          supabase: ["@supabase/supabase-js"],
          hls: ["hls.js"],
          dashjs: ["dashjs"],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      "@tabler/icons-react",
      "@mantine/core",
      "@mantine/hooks",
      "react",
      "react-dom",
      "react-router-dom",
      "@supabase/supabase-js",
    ],
  },
  server: {
    https:
      process.env.SSL_CRT_FILE && process.env.SSL_KEY_FILE
        ? {
            key: fs.readFileSync(process.env.SSL_KEY_FILE),
            cert: fs.readFileSync(process.env.SSL_CRT_FILE),
          }
        : null,
    allowedHosts: true,
    proxy: {
      "/socket.io": {
        target: "http://localhost:8080",
        ws: true,
      },
      "^/(ping|subtitle|downloadSubtitles|searchSubtitles|stats|api|health|timeSeries|youtube|youtubePlaylist|createRoom|updateRoomCover|updateRoomSettings|deleteAccount|metadata|roomData|resolveShard|listRooms|roomDetails|extendRoom|deleteRoom|generateName|proxy)": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
};
