# CoWatch

![CoWatch Preview](./public/screenshot_full.png)

CoWatch is a private, proprietary synchronized video streaming and watch party platform built with React, TypeScript, Vite, Node.js, and Supabase. Watch movies, YouTube videos, streams, or browse the web together with synchronized controls, low-latency WebRTC video/audio chat, persistent rooms, and an integrated notification and transactional email subsystem.

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
- **Host Session Management & Delegation**:
  - **Dynamic Host Delegation**: When the active host leaves a room with remaining participants, the host can explicitly designate a successor before leaving or exit directly, triggering deterministic promotion of the next participant in the active roster.
  - **Automatic Owner Reclaim**: When the original room creator/owner returns to the room, hosting privileges automatically revert to the owner immediately, demoting interim hosts with real-time UI synchronization and notifications.
  - **In-Room Host Transfer**: Hosts can transfer host authority to any participant at any time via the participant user options menu.
  - **Separation of Ownership & Session Hosting**: Permanent room ownership (`owner_id` in PostgreSQL) governs database settings and room configuration, while session hosting controls live playback locks, kicking, and chat moderation.
- **Media Preflight (Green Room)**:
  - Pre-join hardware and device setup screen (`/preflight/:roomId`) enabling camera and microphone selection, audio level monitoring, local video preview, and speaker testing.
  - Diagnostic readiness checks verifying device availability, browser autoplay permissions, and audio output.
- **Notification Subsystem & Activity Center**:
  - **In-App Notification Center**: Slide-out drawer with unread counter badges, real-time WebSocket dispatches, and persistent PostgreSQL storage.
  - **Canonical Action Contract**: Unified action resolver guarantees deterministic behavior, labels, and target routing (`open_room`, `join_room`, `go_home`, `dismiss`), ensuring expired sessions and moderation sanctions safely route users to `/home`.
  - **Direct Username Invitations**: Authoritative server-side dispatch (`POST /api/notifications/invite`) with caller authorization, anti-enumeration safeguards, self-invite rejection, and sliding-window rate limiting.
  - **Room Lifecycle Alerts**: Authoritative session-bounded starts (`ROOM_STARTED`), clustered concurrency-safe 15-minute expiration advance notices (`ROOM_ENDING` via atomic `FOR UPDATE SKIP LOCKED`), and expiration notices (`ROOM_ENDED`).
  - **Recipient-Scoped Sanctions**: Explicit moderation notifications (`MODERATION_ACTION`) dispatched only to affected users upon kick or ban.
  - **Allocation-Scoped Diagnostics**: Virtual browser failure notifications (`VBROWSER_FAILURE`) delivered exclusively to the requesting controller.
  - **Granular User Preferences**: Category-level delivery toggles for room invitations, room lifecycle events, moderation alerts, and system announcements.
- **Provider-Agnostic Transactional Email Engine**:
  - **Decoupled Architecture**: Domain logic communicates through an abstract `EmailProvider` interface and dispatcher, decoupling business logic from external email services.
  - **Pluggable Adapters**: Built-in support for **Brevo (Sendinblue)**, **Generic SMTP** (Mailtrap, Ethereal, Amazon SES, Postmark, Gmail), and **Resend**.
  - **Durable PostgreSQL Outbox**: Atomic row-level leasing (`FOR UPDATE SKIP LOCKED`), exponential backoff retry scheduling, and automatic stalled-lease recovery.
  - **Privacy-Preserving Suppressions**: SHA-256 recipient hashing ensures bounced or unsubscribed addresses are suppressed with zero plaintext email exposure in suppression records.
  - **Cryptographic Webhook Verification**: Tamper-proof, anti-replay webhook normalizers (Svix for Resend, authentication tokens for Brevo) for delivery status tracking.
  - **Zero-Credential Dry-Run**: Built-in simulation fallback for local development or pre-domain environments without third-party email accounts.
- **Security & Room Access**:
  - **Mandatory Room Passcodes**: Every room is protected with a secure passcode.
  - **Shareable Invites**: One-click invite modal with auto-generated links, room ID, passcode sharing, and direct CoWatch username invitation.
  - **Room Lock Controls**: Hosts can lock controls to prevent unauthorized media changes or playback interruptions.
  - **Host Start Gate**: Rooms require the host to start the session before non-hosts can join the live stage.
  - **Dedicated Post-Room Destination**: Clean post-session landing page (`/room-ended`) when sessions conclude.
- **Modern User Interface**:
  - Built with Mantine v8 component library and curated semantic design tokens.
  - Dark and light theme modes with instant switching.
  - Mobile-optimized responsive layout with a dedicated bottom navigation bar for handheld devices.
  - Picture-in-Picture (PiP) and MediaSession API integration for OS-level lock screen and notification controls.
- **Authentication & Persistence**:
  - User accounts, user profiles, and email verification powered by Supabase.
  - Persistent room management with custom room titles, descriptions, and cover photos.
  - Room lifecycle management tracking scheduled, active, and completed watch sessions.

---

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript
- **Bundler**: Vite 7
- **UI Components**: Mantine v8 (`@mantine/core`, `@mantine/notifications`, `@mantine/dates`, `@mantine/hooks`)
- **Icons**: Tabler Icons (`@tabler/icons-react`)
- **Streaming Players**: HLS.js, Dash.js, WebTorrent
- **Real-Time Client**: Socket.IO Client, Mediasoup Client

### Backend
- **Runtime**: Node.js (v20+) with `tsx`
- **Server Framework**: Express 5
- **WebSockets**: Socket.IO 4
- **Database**: PostgreSQL (via Supabase) with `pg` connection pool
- **Cache & Message Broker**: Redis / Upstash (via `ioredis`)
- **Email Delivery**: Provider-agnostic engine with Brevo, SMTP (Nodemailer), and Resend adapters
- **Process Management**: PM2

---

## Quick Start

### 1. Prerequisites
- Node.js (version 20 or higher)
- npm (version 9 or higher)
- A Supabase project (for PostgreSQL database, migrations, and authentication)

### 2. Repository Access
Clone the repository:
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

# Transactional Email Configuration (brevo | smtp | resend)
EMAIL_PROVIDER=smtp
EMAIL_FROM_ADDRESS=noreply@example.com
EMAIL_FROM_NAME=CoWatch

# Brevo (if EMAIL_PROVIDER=brevo)
BREVO_API_KEY=xkeysib-...
BREVO_WEBHOOK_SECRET=your_brevo_webhook_secret

# Generic SMTP (if EMAIL_PROVIDER=smtp, e.g. Ethereal, Mailtrap, SES, Gmail)
EMAIL_SMTP_HOST=smtp.ethereal.email
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USERNAME=your_smtp_username
EMAIL_SMTP_PASSWORD=your_smtp_password
EMAIL_SMTP_SECURE=false

# Resend (if EMAIL_PROVIDER=resend)
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...

# Optional: Media and Infrastructure
YOUTUBE_API_KEY=your_youtube_api_key
REDIS_URL=rediss://default:[PASSWORD]@[ENDPOINT].upstash.io:6379
```

> **Development Note (No Domain Required)**: You do not need a registered custom domain to run or test CoWatch.
> - In-app notifications work locally out of the box.
> - If `EMAIL_PROVIDER` credentials are left blank, the email outbox runs in built-in **Dry Run** mode, printing delivery events to the server logs.
> - For simulated inbox delivery without a domain, configure free test SMTP credentials via [Ethereal Email](https://ethereal.email) or Mailtrap.

### 5. Run Database Migrations
Apply the migrations in `sql/migrations/` sequentially to your Supabase PostgreSQL database:
- `20260911_notify_001_initial_schema.sql`: Notification and outbox tables.
- `20260911_notify_001a_delivery_hardening.sql`: Lease tracking, indexes, and suppression hashes.
- `20260912_notify_002_provider_agnostic_outbox.sql`: Provider metadata and normalization fields.
- `20260912_notify_003_ending_soon_and_actions.sql`: Ending advance warning tracking.

### 6. Run the Application

Start the backend server:
```bash
npm run dev
```

In a separate terminal, start the frontend Vite development server:
```bash
npm run ui
```

Access the client at `http://localhost:5173` (or the port displayed by Vite).

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

## Test & Verification Suites

CoWatch includes a suite of automated adversarial, contractual, and invariant tests:

```bash
# Domain events integration (invitations, lifecycle, moderation, vbrowser)
npm run test:domain-events

# Canonical action contract unit tests (routing, labels, safety fallbacks)
npm run test:action-contract

# Provider boundary lock (verifies zero provider adapter leakage in domain code)
npm run test:provider-leakage

# Universal EmailProvider contract suite (Brevo, Resend, SMTP)
npm run test:provider-contract

# Webhook payload normalization and auto-suppression verification
npm run test:provider-webhooks

# Brevo end-to-end delivery and bounce simulation
npm run test:brevo-e2e

# Outbox worker adversarial resilience, backoff, and lease tests
npm run test:worker-adversarial

# Webhook cryptographic verification and anti-replay tests
npm run test:webhook-adversarial

# Notification consistency and SQL template invariants
npm run test:notifications

# Client UI loading and state machine matrix (24 cases)
npm run test:state-matrix

# Host delegation and owner reclaim tests
npx tsx src/utils/hostDelegation.test.ts

# Media preflight and green room diagnostic tests
npx tsx src/utils/mediaPreflight.test.ts
```

---

## Advanced Configurations

### YouTube Search API
To enable in-app YouTube video search inside the room media dock:
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
