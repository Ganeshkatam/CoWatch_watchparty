# CoWatch

![CoWatch Preview](./public/screenshot_full.png)

CoWatch is a private, real-time synchronized video streaming and collaborative watch party platform built with React 18, TypeScript, Vite 7, Node.js (v20+ / v24 LTS), Express 5, Socket.IO 4, and PostgreSQL via Supabase. Watch movies, YouTube videos, live streams, torrents, or browse the web together with sub-second synchronization, low-latency WebRTC video and audio chat, persistent room management, and an enterprise transactional notification and email subsystem.

---

## Key Features

### 1. Real-Time Video Synchronization & Media Engines
- **Sub-Second Playback Sync**: Host-authoritative and shared playback states keep play, pause, seek, and track changes synchronized across all room participants with sub-second accuracy.
- **Dedicated Seek Controls**: One-click 10-second rewind (`-10s`) and forward (`+10s`) controls with eager client-side seek dispatch and visual badge feedback.
- **Multiple Supported Media Formats**:
  - **YouTube Integration**: In-dock YouTube video search via the YouTube Data API v3 and direct URL pasting with unified player controls.
  - **Direct Video Streams**: Supports direct HTTP and HTTPS media files (MP4, WebM) with native hardware acceleration.
  - **Adaptive Bitrate Streaming**: Smooth playback of HTTP Live Streaming (HLS `.m3u8` via `hls.js`) and MPEG-DASH (`.mpd` via `dashjs`).
  - **WebTorrent (P2P)**: In-browser peer-to-peer torrent streaming directly from magnet links with swarm acceleration.
  - **Screen Sharing**: High-framerate, low-latency screen and audio sharing routed directly into the primary player viewport via WebRTC.
  - **Virtual Browsers (VBrowser)**: Cloud-hosted interactive Chromium sessions inside the room powered by isolated Neko containers.
  - **Local File Streaming**: Stream local video files directly to participants or transcode on-the-fly.
  - **Interactive Playlist Dock**: Drawer-based playlist queue supporting reordering, queue additions, and instant switching.
- **Cross-Platform Picture-in-Picture (PiP)**: Full support for native browser Picture-in-Picture on both desktop and mobile devices, integrated with the browser MediaSession API for OS-level lock screen and media center controls.

### 2. Real-Time Video Chat & Audio Engineering
- **Multi-Party Video & Voice Mesh**: Ultra-low latency camera and microphone streaming powered by WebRTC and Mediasoup.
- **Enhanced Voice Clarity & Gain Booster**: Web Audio API gain booster and automatic gain control (AGC) constraints ensure clear vocal volume even alongside loud movie audio.
- **Acoustic Echo Cancellation**: Isolated audio pipelines and separated device audio routing eliminate feedback loops and dual-playback echo between video chat and stream playback.
- **Media Preflight ("Green Room")**: Dedicated pre-join device verification screen (`/preflight/:roomId`) enabling camera and microphone selection, audio level VU monitoring, local video preview, speaker test sounds, and browser autoplay permission checks before entering the live stage.

### 3. In-Room Chat & Interactive Social Features
- **Real-Time Messaging**: Socket.IO-powered chat with optimistic zero-latency delivery and automatic reconnection recovery.
- **Rich Message Capabilities**: Interactive emoji reaction picker (`@emoji-mart/react`), inline message editing, deletion, URL auto-linkification, and user mentions.
- **Embedded Video Cards**: Shared media links generate rich embedded cards (`ChatVideoCard`) directly inside the chat timeline with one-click queue and play actions.
- **Live Participant Roster**: Real-time presence list with participant status badges, audio/video indicators, and host management menus.

### 4. Circular Quadrant Navigation Dial
- **Corner-Docked Frosted Dial**: Minimalist, corner-docked circular quadrant navigation wheel (`CircularNavigationWheel`) built with clean frosted glassmorphism and permanent section labels.
- **Smart Viewport Adaptation**:
  - **Desktop**: Subtle quadrant dial positioned in the corner with boundary-restricted hover activation.
  - **Mobile**: Dedicated floating trigger button that opens the radial quadrant dial for comfortable one-thumb navigation.
- **Instant Destination Access**: Direct 1-tap switching between Home, Create Room, My Rooms, and Join Room.

### 5. Room Management & Persistence ("My Rooms")
- **Centralized Room Hub**: Dedicated room management portal at `/myrooms` and deep inspection view at `/myrooms/:roomId`.
- **Ephemeral vs. Permanent Rooms**:
  - **Ephemeral Rooms**: Temporary sessions with automatic expiration and cleanup upon conclusion.
  - **Permanent Rooms**: Authoritative database-backed permanent rooms (`set_room_permanence_authoritative`) that remain open and reusable for recurring watch parties.
- **Room Customization & Details**: Configure custom room titles, descriptions, cover images, passcodes, and view creation dates and lifecycle status.
- **Post-Room Landing Page**: Dedicated post-session conclusion screen (`/room-ended`) providing party summaries and return routing.

### 6. Host Session Governance & Security Boundaries
- **Host Start Gate**: Rooms require the host to formally start the session before non-host participants can join the live watch stage.
- **Dynamic Host Delegation**: When an active host exits a room with active participants, the host can explicitly assign a successor or allow the platform to deterministically promote the next participant in the active roster.
- **Automatic Owner Reclaim**: When the original room owner re-enters their room, host authority automatically and immediately reverts to the owner, demoting interim hosts with real-time UI synchronization.
- **Strict Host-Only UI Exclusion**: Non-hosts are strictly prevented from viewing or interacting with host controls. Moderation menus, passcodes, room settings, participant kick/ban controls, invite triggers, and playback locks are conditionally excluded from rendering rather than merely hidden via CSS.
- **Mandatory Room Passcodes**: Every room is protected with a secure passcode verified server-side.
- **Moderation Tools**: In-room host capability to mute, kick, or ban disruptive participants by user ID and session.

### 7. User Accounts, Authentication & Safety
- **Supabase Authentication**: Secure email and password registration, session management, and password reset flows.
- **Mandatory Email Verification**: Gated route protection (`RequireVerifiedEmail`) ensures unverified accounts cannot create or join rooms until verified.
- **Google OAuth Integration**: One-click Google sign-in with automatic synchronization of age eligibility and terms of service acceptance.
- **User Profiles**: Profile customizer (`/account/profile`) for display names, avatars, and appearance modes (Light, Dark, System).
- **Compliance & Safety**: Mandatory age verification, Terms of Service (`/terms`), Privacy Policy (`/privacy`), Community Guidelines (`/community-guidelines`), FAQ (`/faq`), and User Abuse Reporting (`/support`).

### 8. Notification Subsystem & Outbox Email Engine
- **In-App Notification Center**: Slide-out notification drawer with live unread counter badges, WebSocket push updates, and persistent PostgreSQL storage.
- **Canonical Action Contract**: Deterministic routing resolver (`open_room`, `join_room`, `go_home`, `dismiss`) guaranteeing safe user navigation across expired sessions and moderation actions.
- **Direct Username Invitations**: Authoritative server-side dispatch (`POST /api/notifications/invite`) with caller authorization, anti-enumeration safeguards, and rate limiting.
- **Provider-Agnostic Transactional Email Engine**: Pluggable email delivery subsystem with adapters for:
  - **Brevo (Sendinblue)**: API-based delivery and status tracking.
  - **Generic SMTP**: Compatible with Mailtrap, Ethereal, Amazon SES, Postmark, and Gmail.
  - **Resend**: Modern email API with cryptographic Svix webhook verification.
- **Durable PostgreSQL Outbox**: Atomic row leasing via `FOR UPDATE SKIP LOCKED`, exponential backoff retry scheduling, stalled-lease reclamation, and SHA-256 hashed privacy suppressions.
- **Zero-Credential Dry Run**: Built-in development simulation mode for local testing without external credentials.

### 9. Multi-Tier Distributed Redis Architecture
- **Flexible Configuration**: Supports single-instance Redis for local development or a 3-tier distributed cluster in production:
  - **Redis Core**: Distributed leases, locks, idempotency tokens, and rate limiting.
  - **Redis Edge**: High-volume disposable cache and real-time user presence.
  - **Redis Metrics**: Telemetry, operational statistics, and rate quota counters.

---

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript 5
- **Bundler**: Vite 7
- **UI System**: Mantine v8 (`@mantine/core`, `@mantine/notifications`, `@mantine/dates`, `@mantine/hooks`)
- **Icons**: Tabler Icons (`@tabler/icons-react`)
- **Streaming & Media**: HLS.js, Dash.js, WebTorrent, srt-webvtt
- **Real-Time & WebRTC**: Socket.IO Client 4, Mediasoup Client 3
- **Social & Interactive**: Emoji Mart (`@emoji-mart/react`), React QR Code, Recharts

### Backend
- **Runtime**: Node.js (v20+ / v24 LTS) with `tsx`
- **Framework**: Express 5
- **WebSockets**: Socket.IO 4
- **Database**: PostgreSQL (via Supabase) with `pg` connection pool
- **Cache & Message Broker**: Redis / Upstash (via `ioredis`)
- **Email Delivery**: Nodemailer, Brevo API, Resend API
- **Process Manager**: PM2

---

## Quick Start

### 1. Prerequisites
- **Node.js**: v20 or v24 LTS
- **npm**: v9 or higher
- **Supabase Project**: For PostgreSQL database, authentication, and storage
- **Redis Instance** (Optional for local development, recommended for multi-worker scaling)

### 2. Clone the Repository
```bash
git clone <your-repository-url>
cd cowatch
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Copy `.env.example` to create your local `.env`:
```bash
cp .env.example .env
```

Populate the required configuration variables:
```env
# Server Configuration
PORT=8080
HOST=0.0.0.0
NODE_ENV=development
APP_URL=http://localhost:8080

# Database (PostgreSQL via Supabase)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres?pgbouncer=true

# Supabase Server Auth (Backend)
SUPABASE_URL=https://[PROJECT_REF].supabase.co
SUPABASE_SECRET_KEY=your_supabase_service_role_secret_key

# Supabase Client Auth (Frontend)
VITE_SUPABASE_URL=https://[PROJECT_REF].supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_public_key
VITE_SERVER_HOST=http://localhost:8080

# Transactional Email Configuration (smtp | brevo | resend)
EMAIL_PROVIDER=smtp
EMAIL_FROM_ADDRESS=noreply@example.com
EMAIL_FROM_NAME=CoWatch

# Generic SMTP (Default local development)
EMAIL_SMTP_HOST=smtp.ethereal.email
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USERNAME=your_smtp_username
EMAIL_SMTP_PASSWORD=your_smtp_password
EMAIL_SMTP_SECURE=false

# Optional: Redis Architecture
REDIS_URL=rediss://default:[PASSWORD]@[ENDPOINT].upstash.io:6379

# Optional: Media Infrastructure
YOUTUBE_API_KEY=your_youtube_api_key
VIRTUAL_BROWSER_ENABLED=false
```

### 5. Initialize the Database
CoWatch maintains an authoritative standalone bootstrap schema and ordered migrations:
- **Authoritative Bootstrap Schema**: `sql/schema.sql` contains the complete production schema including extensions, tables, row-level security (RLS) policies, and stored procedures.
- **Incremental Migrations**: Located in `sql/migrations/` for schema versioning and incremental updates.

Run `sql/schema.sql` in the Supabase SQL Editor or via the Supabase CLI to bootstrap your database.

### 6. Run the Application

Start the backend server:
```bash
npm run dev
```

In a separate terminal, start the frontend client:
```bash
npm run ui
```

Access the application in your browser at `http://localhost:5173`.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Express backend server with hot-reload via `tsx watch`. |
| `npm run ui` | Starts the Vite development server for the React frontend. |
| `npm run start` | Runs the production backend entrypoint via `tsx`. |
| `npm run build` | Builds the client production bundle and typechecks the server. |
| `npm run buildReact` | Compiles the React client with Vite and performs client typechecking. |
| `npm run typecheck` | Runs TypeScript static analysis on client code (`src/`). |
| `npm run typecheckServer` | Runs TypeScript static analysis on server code (`server/`). |
| `npm run pm2` | Starts clustered backend workers with PM2. |
| `npm run deploy` | Fetches release branch, resets workspace, and restarts PM2 clusters. |
| `npm run prettier` | Formats the codebase using Prettier. |
| `npm run analyze` | Generates a visual bundle size report using `source-map-explorer`. |
| `npm run db:strip-slashes` | Runs the database utility to clean escaped slashes in room records. |
| `npm run testvBrowser` | Spawns a local Neko Chromium virtual browser container via Docker. |
| `npm run testvlc` | Spawns a local Neko VLC player container via Docker. |

---

## Test & Verification Suites

CoWatch provides an automated test suite covering contractual invariants, security boundaries, and concurrency safeguards:

```bash
# Domain & Notification Suites
npm run test:domain-events            # Domain event integration (invites, lifecycle, moderation, vbrowser)
npm run test:action-contract          # Canonical action routing contracts and fallback policies
npm run test:notifications            # Notification consistency and SQL template invariants
npm run test:delivery-profiles        # Email delivery profile bindings and multi-sender routing
npm run test:durable-rate-limit       # Sliding-window rate limit durability and sliding recovery

# Email & Outbox Worker Verification
npm run test:provider-contract        # Universal EmailProvider contract across Brevo, Resend, and SMTP
npm run test:provider-leakage         # Verifies zero provider adapter leakage into domain business logic
npm run test:provider-webhooks        # Webhook payload normalization and auto-suppression verification
npm run test:worker-adversarial       # Outbox worker resilience, backoff, and lease recovery tests
npm run test:webhook-adversarial      # Cryptographic webhook signature and anti-replay tests
npm run test:brevo-e2e                # Brevo end-to-end delivery and bounce simulation

# Security & Authorization Matrices
npm run test:gate1-auth               # Gate 1 authentication boundary tests
npm run test:gate3-quota              # Gate 3 concurrency quota and room limit tests
npm run test:auth-matrix              # Role-based authorization matrix across endpoints
npm run test:host-privileges          # Strict host privilege security and non-host boundary tests
npm run test:url-security             # URL-driven access control and parameter injection defense
npm run test:google-verification      # Google OAuth verification flow and metadata sync
npm run test:duplicate-signup-security # Duplicate signup prevention and account race defense
npm run test:age-policy               # Age policy and minor protection validation
npm run test:room-data-boundaries     # Room data isolation and leakage prevention
npm run test:admission                # Participant admission and roster boundary E2E tests

# Client & Navigation Tests
npm run test:state-matrix             # Client UI loading and state machine matrix (24 cases)
npm run test:navigation               # Circular quadrant navigation policy and route rules
npm run test:update-policy            # Client chunk recovery and update notification policy
npx tsx src/utils/hostDelegation.test.ts # Host delegation and owner reclaim unit tests
npx tsx src/utils/mediaPreflight.test.ts # Media preflight green room diagnostic unit tests

# Resilience & Release Certification
npm run test:failure-injection        # Chaos resilience and upstream failure injection
npm run test:quota-concurrency        # Concurrent room quota race tests
npm run test:reports                  # User abuse report submission and verification tests
npm run test:production-surfaces      # Production surface area and route exposure checks
npm run test:integration-certification # End-to-end integration certification suite
npm run test:release-matrix           # Multi-phase release validation matrix
npm run test:smoke                    # Production health smoke test
```

---

## Advanced Configurations

### 1. YouTube Search API
To enable the YouTube search modal inside the media dock:
1. Enable the **YouTube Data API v3** in the Google Cloud Console.
2. Generate an API key and set `YOUTUBE_API_KEY=your_api_key` in `.env`.
3. Restart the server.

### 2. Virtual Browser (VBrowser) Setup
To run interactive virtual browser sessions:
- Launch a local Neko Docker container:
  ```bash
  npm run testvBrowser
  ```
- Or run manually:
  ```bash
  docker run -d --rm --name=vbrowser --net=host --shm-size=1g --cap-add="SYS_ADMIN" \
    -e DISPLAY=":99.0" -e NEKO_PASSWORD=user -e NEKO_PASSWORD_ADMIN=admin \
    -e NEKO_BIND=":5100" -e NEKO_EPR=":59000-59100" -e NEKO_H264="1" \
    howardc93/vbrowser
  ```
- Set `VIRTUAL_BROWSER_ENABLED=true` in `.env`.

### 3. Distributed Redis Tiering
In production environments with multiple Node.js instances or PM2 clusters, configure dedicated Redis instances in `.env`:
- `REDIS_CORE_URL`: Manages atomic outbox leases, distributed locks, and rate limit counters.
- `REDIS_EDGE_URL`: Handles ephemeral presence data, cache lookups, and session tokens.
- `REDIS_METRICS_URL`: Records aggregate metrics and operational telemetry.

---

## Security & Architecture Principles

1. **Server-Authoritative Control**: Room state, playback permissions, participant capacity, and session life cycles are authoritative on the backend. Client commands are strictly validated and authorized before broadcast.
2. **Strict Host Isolation**: Controls and sensitive information intended solely for the host (such as room passcodes, moderation dialogs, participant kick/ban tools, and room configuration forms) are never delivered to non-host clients and are conditionally excluded from the component tree.
3. **Privacy-Preserving Architecture**: Email suppression lists and bounce tracking store cryptographic SHA-256 hashes rather than plaintext email addresses.
4. **Resilient Outbox Pattern**: Asynchronous side effects (such as transactional emails and notifications) utilize durable PostgreSQL outbox tables with atomic leasing (`FOR UPDATE SKIP LOCKED`) to guarantee at-least-once delivery with zero duplicate processing.

---

## Proprietary & Confidential

Copyright (c) 2024-2026 CoWatch. All rights reserved.

This software, source code, and associated documentation are proprietary and confidential. Unauthorized copying, distribution, public display, reproduction, or modification, via any medium, is strictly prohibited. See [LICENSE](./LICENSE) for details.
