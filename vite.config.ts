import { loadEnvFile } from "node:process";
import fs from "node:fs";

try {
  loadEnvFile();
} catch (e) {
  console.log(e);
}

export default {
  build: {
    outDir: "build",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          mantine: ["@mantine/core", "@mantine/hooks"],
          icons: ["@tabler/icons-react"],
          supabase: ["@supabase/supabase-js"],
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
