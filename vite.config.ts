import { defineConfig, type Plugin } from "vite";
import type { RollupLog } from "rollup";
import { loadEnvFile } from "node:process";
import fs from "node:fs";
import { execSync } from "node:child_process";

if (fs.existsSync(".env")) {
  try {
    loadEnvFile();
  } catch (e) {
    // ignore
  }
}

function getCommitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA;
  }
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function generateBuildId(commitSha: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const mins = String(now.getUTCMinutes()).padStart(2, "0");
  const shortSha = commitSha && commitSha !== "unknown" ? commitSha.slice(0, 7) : "dev";
  return `${year}${month}${day}-${hours}${mins}-${shortSha}`;
}

const commitSha = getCommitSha();
const buildId = generateBuildId(commitSha);

let appVersion = "1.2.2";
try {
  const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
  if (pkg.version) {
    appVersion = pkg.version;
  }
} catch {
  // ignore
}

const buildInfo = {
  buildId,
  commit: commitSha,
  appVersion,
  protocolVersion: 1,
  deploymentTime: new Date().toISOString(),
};

function versionManifestPlugin(): Plugin {
  return {
    name: "version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(buildInfo, null, 2),
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && (req.url === "/version.json" || req.url.startsWith("/version.json?"))) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
          res.end(JSON.stringify(buildInfo, null, 2));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_BUILD_INFO__: JSON.stringify(buildInfo),
  },
  plugins: [versionManifestPlugin()],
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onwarn(warning: RollupLog, warn: (warning: RollupLog | string) => void) {
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
        : undefined,
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
});
