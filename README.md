# CoWatch

![CoWatch Preview](./public/screenshot_full.png)

CoWatch is a private, proprietary synchronized video streaming and watch party platform built with React, TypeScript, Vite, Node.js, and Supabase. Watch movies, YouTube videos, streams, or browse the web together with synchronized controls, low-latency WebRTC video/audio chat, and persistent rooms.

---

## Key Features

- **Real-Time Video Synchronization**: Host and room member play, pause, and seek events are synchronized with sub-second accuracy across all participants.
- **Multiple Media Sources**:
  - **YouTube Integration**: Search and play YouTube videos directly within the room with unified playback controls.
  - **Direct Video Streams**: Supports direct HTTP/HTTPS media URLs (MP4, WebM) and adaptive bitrate HLS (.m3u8) streams.
  - **WebTorrent (P2P)**: Stream torrent magnet links directly in the browser with peer-to-peer acceleration.
  - **Screen Sharing**: Low-latency screen and tab sharing via peer-to-peer WebRTC or relay server streaming.
  - **Virtual Browsers (VBrowser)**: Cloud-hosted interactive Chromium sessions inside the room via Neko containers.
  - **File Sharing & Auto-Transcoding**: Stream local video files directly or transcode on-the-fly.
- **Security & Room Access**:
  - **Mandatory Room Passcodes**: Every room is protected with a secure passcode.
  - **Shareable Invites**: One-click invite modal with auto-generated links, room ID, and passcode sharing.
  - **Room Lock Controls**: Hosts can lock controls to prevent unauthorized media changes or pause/seek interruptions.
- **Modern User Interface**:
  - Built with Mantine v8 component library and curated semantic design tokens.
  - Dark and light theme modes with instant switching.
  - Mobile-optimized responsive layout with a dedicated bottom navigation bar for handheld devices.
  - Picture-in-Picture (PiP) and MediaSession API integration for OS-level lock screen and notification controls.
- **Authentication & Persistence**:
  - User accounts and email verification powered by Supabase.
  - Persistent room management with custom room titles, descriptions, and cover photos.
  - Room lifecycle management tracking scheduled, active, and completed watch sessions.

---

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Bundler**: Vite 7
- **UI Components**: Mantine v8 (`@mantine/core`)
- **Icons**: Tabler Icons (`@tabler/icons-react`)
- **Streaming Players**: HLS.js, Dash.js, WebTorrent
- **Real-Time Client**: Socket.IO Client, Mediasoup Client

### Backend
- **Runtime**: Node.js (v20+) with `tsx`
- **Server Framework**: Express 5
- **WebSockets**: Socket.IO 4
- **Database**: PostgreSQL (via Supabase) with `pg` connection pool
- **Cache & Message Broker**: Redis / Upstash (via `ioredis`)
- **Process Management**: PM2

---

## Quick Start

### 1. Prerequisites
- Node.js (version 20 or higher)
- npm (version 9 or higher)
- A Supabase project (for database and authentication)

### 2. Repository Access
Clone the repository (authorized team access):
```bash
git clone https://github.com/Ganeshkatam/CoWatch_watchparty.git
cd CoWatch_watchparty
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Duplicate `.env.example` to create `.env`:
```bash
cp .env.example .env
```

Configure your credentials in `.env`:
```env
# Server Configuration
PORT=8080
HOST=0.0.0.0

# Database (PostgreSQL via Supabase)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?pgbouncer=true

# Supabase Server Auth (Backend)
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_SECRET_KEY=your_supabase_service_role_secret_key

# Supabase Client Auth (Frontend)
VITE_SUPABASE_URL=https://[PROJECT_REF].supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_public_key

# Optional: YouTube API Key (for in-room video search)
YOUTUBE_API_KEY=your_youtube_api_key

# Optional: Redis (for multi-shard coordination and session store)
REDIS_URL=rediss://default:[PASSWORD]@[ENDPOINT].upstash.io:6379
```

### 5. Run the Application

Start the backend server:
```bash
npm run dev
```

In a separate terminal, start the frontend Vite development server:
```bash
npm run ui
```

Access the client at `http://localhost:5173` (or the URL displayed by Vite).

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the server in watch mode using `tsx`. |
| `npm run ui` | Starts the Vite development server for the React client. |
| `npm run build` | Builds the client production bundle and typechecks the server. |
| `npm run buildReact` | Compiles the React application with Vite and runs client typechecking. |
| `npm run typecheck` | Runs TypeScript static analysis on client source code (`src/`). |
| `npm run typecheckServer` | Runs TypeScript static analysis on server source code (`server/`). |
| `npm run start` | Runs the production backend entrypoint. |
| `npm run pm2` | Starts clustered backend shards using PM2. |

---

## Advanced Configurations

### YouTube Search API
To enable in-app YouTube video search inside the room media dock, obtain an API key from the Google Cloud Console:
1. Enable the **YouTube Data API v3** in your Google Cloud project.
2. Create an API key and assign it to `YOUTUBE_API_KEY` in `.env`.
3. Restart the backend server.

### Virtual Browser (VBrowser) Setup
CoWatch supports spawning dedicated virtual browsers running Neko Chromium containers:
- Run locally with Docker:
  ```bash
  docker run -d --rm --name=vbrowser --net=host --shm-size=1g --cap-add="SYS_ADMIN" -e DISPLAY=":99.0" -e NEKO_PASSWORD=user -e NEKO_PASSWORD_ADMIN=admin -e NEKO_BIND=":5100" -e NEKO_EPR=":59000-59100" -e NEKO_H264="1" howardc93/vbrowser
  ```
- Configure `VM_MANAGER_CONFIG` in your environment to manage cloud or remote Docker pools via `server/vmWorker.ts`.

---

## Proprietary & Confidential

Copyright (c) 2024-2026 CoWatch. All rights reserved.

This software, source code, and associated documentation are proprietary and confidential. Unauthorized copying, distribution, public display, reproduction, or modification, via any medium, is strictly prohibited. See [LICENSE](./LICENSE) for details.
