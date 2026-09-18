import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button } from "@mantine/core";
import {
  IconCirclePlusFilled,
  IconArrowRight,
  IconCheck,
  IconX,
  IconSparkles,
  IconPlayerPlay,
  IconVideo,
  IconScreenShare,
  IconShieldLock,
  IconServer,
  IconCpu,
  IconDatabase,
  IconLayersLinked,
  IconEyeOff,
  IconCode,
  IconCompass,
  IconLock,
  IconDeviceTv,
  IconHelpCircle,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./About.module.css";

const METRICS = [
  {
    number: "100%",
    label: "Browser Native",
    detail: "Zero desktop downloads, executables, or mandatory browser extensions.",
  },
  {
    number: "<50ms",
    label: "Sync Drift Target",
    detail: "Sub-second continuous playback drift correction across all peers.",
  },
  {
    number: "10 Peers",
    label: "Mesh Real-Time Media",
    detail: "Direct WebRTC low-latency audio, video feeds, and live reactions.",
  },
  {
    number: "0 KB",
    label: "Watch History Stored",
    detail: "Strict zero-knowledge policy with ephemeral room lifecycle auto-purges.",
  },
];

const TENETS = [
  {
    title: "Synchronized Playback Coordination",
    badge: "Playback Core",
    badgeBg: "rgba(139, 92, 246, 0.15)",
    badgeColor: "var(--color-violet)",
    icon: <IconPlayerPlay size={24} color="var(--color-violet)" />,
    iconBg: "rgba(139, 92, 246, 0.12)",
    text: "Sub-second playback alignment across YouTube, direct video streams, screen sharing, and WebTorrent with automatic drift compensation.",
    highlights: [
      "Sub-second continuous clock synchronization",
      "Unified timeline controls across heterogeneous media",
      "Seamless host-lock state authority",
    ],
  },
  {
    title: "Real-Time Human Connection",
    badge: "WebRTC Mesh",
    badgeBg: "rgba(20, 184, 166, 0.15)",
    badgeColor: "var(--color-teal)",
    icon: <IconVideo size={24} color="var(--color-teal)" />,
    iconBg: "rgba(20, 184, 166, 0.12)",
    text: "Integrated low-latency audio, camera video, and floating reactions inside the theater, making shared reactions instant and authentic.",
    highlights: [
      "Low-latency WebRTC mesh audio and video",
      "Dynamic non-intrusive floating reaction stream",
      "In-room persistent timestamped text chat",
    ],
  },
  {
    title: "Screen & System Audio Sharing",
    badge: "Display Capture",
    badgeBg: "rgba(34, 211, 238, 0.15)",
    badgeColor: "var(--color-cyan)",
    icon: <IconScreenShare size={24} color="var(--color-cyan)" />,
    iconBg: "rgba(34, 211, 238, 0.12)",
    text: "Direct browser-to-browser screen and window capture with native system audio forwarding, letting you stream presentations, games, and web media effortlessly.",
    highlights: [
      "Share any application window, desktop, or browser tab",
      "Integrated system audio forwarding without extra drivers",
      "Hardware-accelerated encoding for smooth framerates",
    ],
  },
  {
    title: "Authoritative Host Sovereignty",
    badge: "Host Security",
    badgeBg: "rgba(245, 158, 11, 0.15)",
    badgeColor: "var(--color-warning)",
    icon: <IconShieldLock size={24} color="var(--color-warning)" />,
    iconBg: "rgba(245, 158, 11, 0.12)",
    text: "Hosts maintain definitive authority over room settings, playback locks, door locking (PARTICIPANTS_LOCKED), and moderation tools.",
    highlights: [
      "Strict server-side authorization boundaries",
      "One-click door lock to prevent new admissions",
      "Granular participant playback permission locks",
    ],
  },
];

const ARCHITECTURE_LAYERS = {
  sync: {
    badge: "Synchronization Layer",
    title: "Real-Time State Coordination Engine",
    description:
      "A clustered Socket.IO and Redis architecture that continuously harmonizes playback state, participant presence, and interactive room events with sub-50ms precision.",
    points: [
      "Dynamic clock sync protocol accounting for round-trip latency and client jitter",
      "Automatic drift compensation seeking or rate-adjusting when desync exceeds thresholds",
      "Durable heartbeat monitoring that recovers state across transient network drops",
    ],
    terminalTitle: "engine/sync-protocol.ts",
    terminalLines: [
      { text: "// Sub-second drift correction loop", type: "comment" },
      { text: "const clientNow = performance.now();", type: "code" },
      { text: "const serverTime = clientNow + clockOffset;", type: "code" },
      { text: "const delta = Math.abs(currentMediaTime - authoritativeTime);", type: "code" },
      { text: "if (delta > DRIFT_THRESHOLD_MS) {", type: "keyword" },
      { text: "  player.seekTo(authoritativeTime, true);", type: "accent" },
      { text: "  metrics.recordSyncCorrection(delta);", type: "value" },
      { text: "}", type: "keyword" },
    ],
  },
  client: {
    badge: "Client Architecture",
    title: "Native Browser Theater Interface",
    description:
      "A high-performance React 18 and TypeScript application utilizing hardware-accelerated rendering, HTML5 Media APIs, and Mantine UI design primitives without external desktop runtimes.",
    points: [
      "Pure browser runtime: Zero installers, plugins, or background daemons required",
      "Hardware-accelerated CSS layouts responsive from 4K theater displays to mobile screens",
      "Preflight Green Room device checks ensuring seamless camera and mic handshakes",
    ],
    terminalTitle: "client/theater-runtime.tsx",
    terminalLines: [
      { text: "// Responsive theater viewport mount", type: "comment" },
      { text: "<TheaterViewport", type: "keyword" },
      { text: "  videoSource={activeRoom.source}", type: "accent" },
      { text: "  rtcMesh={connectedPeers}", type: "value" },
      { text: "  hardwareAcceleration='enabled'", type: "code" },
      { text: "  driftCompensation='continuous'", type: "code" },
      { text: "/>", type: "keyword" },
    ],
  },
  media: {
    badge: "Media Pipeline",
    title: "Multi-Source Media & WebTorrent Pipeline",
    description:
      "A versatile media orchestration engine supporting synchronized YouTube playback, direct MP4/HLS streams, and peer-to-peer WebTorrent mesh transfers.",
    points: [
      "Direct support for MP4, WebM, and adaptive HLS (.m3u8) video streaming",
      "Peer-to-peer WebTorrent mesh streaming directly inside browser memory",
      "Unified seek, pause, and rate synchronization across all media types",
    ],
    terminalTitle: "media/pipeline-coordinator.ts",
    terminalLines: [
      { text: "// Multi-source playback orchestrator", type: "comment" },
      { text: "const player = mediaCoordinator.initialize({", type: "keyword" },
      { text: "  sourceType: room.mediaSource.type,", type: "code" },
      { text: "  mediaUrl: room.mediaSource.url,", type: "code" },
      { text: "  hlsAdaptiveStreaming: true,", type: "accent" },
      { text: "  webtorrentP2P: true,", type: "value" },
      { text: "});", type: "keyword" },
    ],
  },
  security: {
    badge: "Security & Persistence",
    title: "Hardened Relational & Authorization Layer",
    description:
      "Enterprise PostgreSQL database with Row Level Security (RLS) across all tables, Supabase token issuance, atomic concurrency quotas, and zero-knowledge room lifecycles.",
    points: [
      "100% table coverage for Row Level Security (RLS) policies",
      "Privileged stored procedures configured with SECURITY DEFINER and empty search paths",
      "Automatic ephemeral cleanup purging inactive rooms 30 seconds after vacancy",
    ],
    terminalTitle: "database/authorization-policy.sql",
    terminalLines: [
      { text: "-- Hardened Row Level Security boundary", type: "comment" },
      { text: "ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;", type: "keyword" },
      { text: "CREATE POLICY 'rooms_select_policy' ON public.rooms", type: "code" },
      { text: "  FOR SELECT USING (", type: "keyword" },
      { text: "    owner_id = (SELECT auth.uid()) OR is_private = false", type: "accent" },
      { text: "  );", type: "keyword" },
    ],
  },
};

const TECH_CATEGORIES = [
  {
    category: "Frontend Runtime",
    icon: <IconCode size={16} color="var(--color-violet)" />,
    skills: ["React 18", "TypeScript", "Mantine UI", "Vite", "Tabler Icons", "WebRTC PeerConnection"],
  },
  {
    category: "Real-Time & Media",
    icon: <IconLayersLinked size={16} color="var(--color-cyan)" />,
    skills: ["Socket.IO", "WebRTC MediaStream", "WebTorrent", "HLS.js", "YouTube IFrame API"],
  },
  {
    category: "Backend & Engine",
    icon: <IconServer size={16} color="var(--color-teal)" />,
    skills: ["Node.js", "Express", "Socket.IO Clustering", "WebRTC Mesh Signaling", "Redis Coordination"],
  },
  {
    category: "Data & Security",
    icon: <IconDatabase size={16} color="var(--color-pink)" />,
    skills: ["PostgreSQL", "Supabase Auth & RLS", "Redis Pub/Sub", "Strict Content-Security-Policy"],
  },
];

const SECURITY_PILLARS = [
  {
    title: "Controlled Admission",
    icon: <IconLock size={18} />,
    description:
      "Rooms enforce token-driven session verification. Passcodes are evaluated server-side and never leaked in browser query parameters or telemetry.",
  },
  {
    title: "Authoritative Host Controls",
    icon: <IconShieldLock size={18} />,
    description:
      "Room playback locks, door locks (PARTICIPANTS_LOCKED), and moderation tools strictly evaluate authorization before broadcasting state changes.",
  },
  {
    title: "Zero Watch-History Profiling",
    icon: <IconEyeOff size={18} />,
    description:
      "We believe shared entertainment should stay between friends. CoWatch never tracks, profiles, or sells records of media streamed in rooms.",
  },
  {
    title: "Ephemeral Room Purging",
    icon: <IconCpu size={18} />,
    description:
      "Inactive sessions automatically deactivate within 30 seconds of room vacancy, purging transient signaling channels and releasing resources.",
  },
];

export const About: React.FC = () => {
  useDocumentMetadata({
    title: "About CoWatch | The Social Watch Party Platform",
    description:
      "Discover the engineering, architecture, and philosophy behind CoWatch: browser-native synchronization, low-latency WebRTC media, and privacy by design.",
  });

  const [activeLayer, setActiveLayer] = useState<"sync" | "client" | "media" | "security">("sync");
  const currentLayer = ARCHITECTURE_LAYERS[activeLayer];

  return (
    <main className={styles.aboutContainer} id="about-main-content">
      {/* 1. Hero Section */}
      <section className={styles.heroSection} aria-label="About CoWatch Introduction">
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.statusBeacon} aria-hidden="true" />
            <span>Platform Vision &amp; Architecture</span>
            <span className={styles.badgeDivider} aria-hidden="true" />
            <span className={styles.badgeHighlight}>v1.2.0 Hardened</span>
          </div>

          <h1 className={styles.heroHeadline}>
            The Shared Living Room,
            <br />
            <span className={styles.gradientAccent}>Reimagined for the Open Web.</span>
          </h1>

          <p className={styles.heroSubtitle}>
            CoWatch is an independent, browser-native social viewing platform engineered to unite
            friends across distances through sub-second playback synchronization, crystal-clear WebRTC video,
            and zero-compromise privacy.
          </p>

          <div className={styles.heroActionGroup}>
            <Button
              component={Link}
              to="/create"
              size="lg"
              variant="gradient"
              gradient={{ from: "violet", to: "teal", deg: 135 }}
              leftSection={<IconCirclePlusFilled size={20} />}
              id="about-hero-start-btn"
            >
              Start a Watch Party
            </Button>
            <Button
              component={Link}
              to="/join"
              size="lg"
              variant="default"
              leftSection={<IconCompass size={18} />}
              id="about-hero-join-btn"
              className={styles.heroSecondaryBtn}
            >
              Join a Watch Party
            </Button>
            <Button
              component={Link}
              to="/faq"
              size="lg"
              variant="subtle"
              leftSection={<IconHelpCircle size={18} />}
              id="about-hero-faq-btn"
              className={styles.heroSecondaryBtn}
            >
              Platform FAQ
            </Button>
          </div>
        </div>
      </section>

      {/* 2. Engineering Benchmarks Strip */}
      <section className={styles.metricsStrip} aria-label="Platform Engineering Metrics">
        <div className={styles.metricsGrid}>
          {METRICS.map((metric, idx) => (
            <div key={idx} className={styles.metricCard}>
              <div className={styles.metricNumber}>{metric.number}</div>
              <div className={styles.metricLabel}>{metric.label}</div>
              <div className={styles.metricDetail}>{metric.detail}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. The Problem We Solved (The Two Worlds) */}
      <section className={styles.sectionContainer} aria-labelledby="philosophy-heading">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>The Core Philosophy</span>
          <h2 id="philosophy-heading" className={styles.sectionTitle}>
            Why We Engineered CoWatch
          </h2>
          <p className={styles.sectionDescription}>
            Watching media together online used to mean balancing disconnected voice calls, desynced countdowns,
            and invasive plugins. We unified the entire experience into a single browser tab.
          </p>
        </div>

        <div className={styles.comparisonGrid}>
          {/* The Old Way */}
          <div className={`${styles.comparisonCard} ${styles.comparisonCardOld}`}>
            <div className={styles.comparisonHeader}>
              <div className={styles.comparisonTitleGroup}>
                <div className={`${styles.comparisonIconBox} ${styles.comparisonIconBoxOld}`}>
                  <IconX size={20} />
                </div>
                <h3 className={styles.comparisonTitle}>The Fragmented Past</h3>
              </div>
              <Badge color="red" variant="light">
                High Friction
              </Badge>
            </div>

            <ul className={styles.comparisonList}>
              <li className={styles.comparisonItem}>
                <IconX size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconOld}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>The &ldquo;3, 2, 1, Play&rdquo; Countdown</div>
                  <p className={styles.comparisonItemDesc}>
                    Desynchronized audio where laughing at a joke or gasping at a plot twist happens 10 seconds apart.
                  </p>
                </div>
              </li>
              <li className={styles.comparisonItem}>
                <IconX size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconOld}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>Invasive &amp; Brittle Browser Extensions</div>
                  <p className={styles.comparisonItemDesc}>
                    Third-party plugins that require sweeping permissions, track browsing data, and break on Chrome updates.
                  </p>
                </div>
              </li>
              <li className={styles.comparisonItem}>
                <IconX size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconOld}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>Laggy, DRM-Blacked Screen Shares</div>
                  <p className={styles.comparisonItemDesc}>
                    Low-framerate desktop screen shares that mute system audio, drop frames, and display black boxes on protected media.
                  </p>
                </div>
              </li>
              <li className={styles.comparisonItem}>
                <IconX size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconOld}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>Window Juggling Across Apps</div>
                  <p className={styles.comparisonItemDesc}>
                    Splitting screens between Discord, Zoom, and a media window, creating a chaotic multi-tasking mess.
                  </p>
                </div>
              </li>
            </ul>
          </div>

          {/* The CoWatch Way */}
          <div className={`${styles.comparisonCard} ${styles.comparisonCardNew}`}>
            <div className={styles.comparisonHeader}>
              <div className={styles.comparisonTitleGroup}>
                <div className={`${styles.comparisonIconBox} ${styles.comparisonIconBoxNew}`}>
                  <IconSparkles size={20} />
                </div>
                <h3 className={styles.comparisonTitle}>The CoWatch Living Room</h3>
              </div>
              <Badge color="violet" variant="filled">
                Native Unified
              </Badge>
            </div>

            <ul className={styles.comparisonList}>
              <li className={styles.comparisonItem}>
                <IconCheck size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconNew}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>Continuous Sub-Second Drift Correction</div>
                  <p className={styles.comparisonItemDesc}>
                    Active timecode synchronization keeps every viewer on the exact same frame across YouTube, files, and screenshares.
                  </p>
                </div>
              </li>
              <li className={styles.comparisonItem}>
                <IconCheck size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconNew}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>100% Browser-Native with Zero Installs</div>
                  <p className={styles.comparisonItemDesc}>
                    Guests join in seconds via clean URLs. The Green Room verifies audio and camera devices before entry.
                  </p>
                </div>
              </li>
              <li className={styles.comparisonItem}>
                <IconCheck size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconNew}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>Screen &amp; Tab Audio Forwarding</div>
                  <p className={styles.comparisonItemDesc}>
                    Share any application window, desktop, or browser tab with pristine forwarded system audio and no extra software.
                  </p>
                </div>
              </li>
              <li className={styles.comparisonItem}>
                <IconCheck size={18} className={`${styles.comparisonStatusIcon} ${styles.comparisonStatusIconNew}`} />
                <div>
                  <div className={styles.comparisonItemTitle}>Authoritative Host Sovereignty</div>
                  <p className={styles.comparisonItemDesc}>
                    Hosts have complete control over door locks, passcode protection, playback permissions, and moderation.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 4. Four Core Tenets */}
      <section className={styles.sectionContainer} aria-labelledby="tenets-heading">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>Platform Pillars</span>
          <h2 id="tenets-heading" className={styles.sectionTitle}>
            Architected for Authentic Connection
          </h2>
          <p className={styles.sectionDescription}>
            Every design decision in CoWatch is guided by four immutable principles that preserve
            the warmth, fidelity, and sovereignty of shared viewing.
          </p>
        </div>

        <div className={styles.tenetsGrid}>
          {TENETS.map((tenet, idx) => (
            <div key={idx} className={styles.tenetCard}>
              <div className={styles.tenetTopRow}>
                <div className={styles.tenetIconBox} style={{ background: tenet.iconBg }}>
                  {tenet.icon}
                </div>
                <span
                  className={styles.tenetBadge}
                  style={{ background: tenet.badgeBg, color: tenet.badgeColor }}
                >
                  {tenet.badge}
                </span>
              </div>

              <h3 className={styles.tenetTitle}>{tenet.title}</h3>
              <p className={styles.tenetText}>{tenet.text}</p>

              <ul className={styles.tenetHighlights}>
                {tenet.highlights.map((item, itemIdx) => (
                  <li key={itemIdx} className={styles.tenetHighlightItem}>
                    <IconCheck size={14} className={styles.tenetHighlightCheck} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Interactive System Architecture Blueprint */}
      <section className={styles.sectionContainer} aria-labelledby="architecture-heading">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>Technical Blueprint</span>
          <h2 id="architecture-heading" className={styles.sectionTitle}>
            Under the Hood: System Architecture
          </h2>
          <p className={styles.sectionDescription}>
            Explore the four layers of the CoWatch real-time stack, from client-side WebRTC topologies
            to multi-source media streaming and PostgreSQL persistence.
          </p>
        </div>

        <div className={styles.blueprintContainer}>
          <div className={styles.blueprintTabsList} role="tablist" aria-label="Architecture Layers">
            <button
              type="button"
              role="tab"
              aria-selected={activeLayer === "sync"}
              className={`${styles.blueprintTabBtn} ${activeLayer === "sync" ? styles.blueprintTabBtnActive : ""}`}
              onClick={() => setActiveLayer("sync")}
            >
              <IconLayersLinked size={18} />
              <span>Real-Time Sync Engine</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeLayer === "client"}
              className={`${styles.blueprintTabBtn} ${activeLayer === "client" ? styles.blueprintTabBtnActive : ""}`}
              onClick={() => setActiveLayer("client")}
            >
              <IconCode size={18} />
              <span>Native Web Client</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeLayer === "media"}
              className={`${styles.blueprintTabBtn} ${activeLayer === "media" ? styles.blueprintTabBtnActive : ""}`}
              onClick={() => setActiveLayer("media")}
            >
              <IconDeviceTv size={18} />
              <span>Media Pipeline</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeLayer === "security"}
              className={`${styles.blueprintTabBtn} ${activeLayer === "security" ? styles.blueprintTabBtnActive : ""}`}
              onClick={() => setActiveLayer("security")}
            >
              <IconDatabase size={18} />
              <span>Security &amp; PostgreSQL</span>
            </button>
          </div>

          <div className={styles.blueprintContent}>
            <div className={styles.blueprintDetails}>
              <div className={styles.blueprintLayerBadge}>
                <IconSparkles size={14} />
                <span>{currentLayer.badge}</span>
              </div>
              <h3 className={styles.blueprintLayerTitle}>{currentLayer.title}</h3>
              <p className={styles.blueprintLayerDesc}>{currentLayer.description}</p>

              <div className={styles.blueprintKeyPoints}>
                {currentLayer.points.map((pt, pIdx) => (
                  <div key={pIdx} className={styles.blueprintPoint}>
                    <IconCheck size={16} className={styles.blueprintPointIcon} />
                    <span>{pt}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.blueprintTerminal} aria-label="Architecture code preview">
              <div className={styles.terminalTopBar}>
                <span className={`${styles.terminalDot} ${styles.terminalDotClose}`} />
                <span className={`${styles.terminalDot} ${styles.terminalDotMin}`} />
                <span className={`${styles.terminalDot} ${styles.terminalDotMax}`} />
                <span className={styles.terminalTitle}>{currentLayer.terminalTitle}</span>
              </div>

              {currentLayer.terminalLines.map((line, lIdx) => (
                <div key={lIdx} className={styles.terminalLine}>
                  {line.type === "comment" && <span style={{ color: "#64748b" }}>{line.text}</span>}
                  {line.type === "keyword" && <span className={styles.terminalKeyword}>{line.text}</span>}
                  {line.type === "accent" && <span className={styles.terminalAccent}>{line.text}</span>}
                  {line.type === "value" && <span className={styles.terminalValue}>{line.text}</span>}
                  {line.type === "code" && <span>{line.text}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. Privacy & Security Console */}
      <section className={styles.sectionContainer} aria-labelledby="security-heading">
        <div className={styles.securityConsole}>
          <div className={styles.securityHeaderRow}>
            <div className={styles.securityHeaderTitleGroup}>
              <div className={styles.securityShieldIcon}>
                <IconShieldLock size={24} />
              </div>
              <div>
                <h2 id="security-heading" className={styles.securityConsoleTitle}>
                  Privacy &amp; Security Protocol
                </h2>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                  Defense-in-depth architecture verified in PostgreSQL &amp; client layers
                </span>
              </div>
            </div>

            <div className={styles.securityStatusBadge}>
              <span className={styles.statusBeacon} aria-hidden="true" />
              <span>100% RLS Enforced • Zero Tracking</span>
            </div>
          </div>

          <div className={styles.securityPrinciplesGrid}>
            {SECURITY_PILLARS.map((sec, sIdx) => (
              <div key={sIdx} className={styles.securityCard}>
                <div className={styles.securityCardHeader}>
                  <span className={styles.securityCardIcon}>{sec.icon}</span>
                  <h3 className={styles.securityCardTitle}>{sec.title}</h3>
                </div>
                <p className={styles.securityCardText}>{sec.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. Technology Stack Badges */}
      <section className={styles.sectionContainer} aria-labelledby="tech-stack-heading">
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>Core Foundations</span>
          <h2 id="tech-stack-heading" className={styles.sectionTitle}>
            Modern Web Technologies
          </h2>
          <p className={styles.sectionDescription}>
            Constructed with standard open-web APIs, battle-tested real-time protocols, and modular architectures.
          </p>
        </div>

        <div className={styles.techCategoryGroup}>
          {TECH_CATEGORIES.map((cat, cIdx) => (
            <div key={cIdx} className={styles.techCategoryRow}>
              <div className={styles.techCategoryLabel}>
                {cat.icon}
                <span>{cat.category}</span>
              </div>
              <div className={styles.techPillsList}>
                {cat.skills.map((skill, sIdx) => (
                  <span key={sIdx} className={styles.techBadge}>
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 8. Production Release & Roadmap (Dual Panel) */}
      <section className={styles.sectionContainer} aria-labelledby="milestones-heading">
        <div className={styles.dualSectionGrid}>
          {/* Production Release Panel */}
          <div className={styles.releasePanel}>
            <div className={styles.releaseBadgeRow}>
              <Badge color="violet" variant="filled">
                Production Release
              </Badge>
              <Badge color="gray" variant="light">
                Version v1.2.0
              </Badge>
            </div>

            <h3 className={styles.releaseTitle}>Enterprise-Grade Reliability</h3>
            <p className={styles.releaseText}>
              Every build of CoWatch undergoes rigorous automated testing, database hardening, and concurrency
              verification. We engineer platform uptime, strict Row Level Security, and sub-50ms synchronization into every layer.
            </p>

            <div className={styles.releaseActions}>
              <Button
                component={Link}
                to="/faq"
                variant="filled"
                color="violet"
                leftSection={<IconHelpCircle size={18} />}
              >
                Platform FAQ
              </Button>
              <Button
                component={Link}
                to="/support"
                variant="default"
                leftSection={<IconShieldLock size={18} />}
                className={styles.heroSecondaryBtn}
              >
                Support Center
              </Button>
            </div>
          </div>

          {/* Roadmap Panel */}
          <div className={styles.roadmapPanel}>
            <div className={styles.roadmapHeader}>
              <h3 className={styles.roadmapTitle} style={{ margin: 0 }}>
                Continuous Evolution
              </h3>
              <Badge color="teal" variant="light">
                Active Roadmap
              </Badge>
            </div>

            <ul className={styles.roadmapList}>
              <li className={styles.roadmapItem}>
                <IconCheck size={18} className={styles.roadmapItemIconShipped} />
                <div>
                  <strong>Shipped in v1.2.0: </strong>
                  <span>
                    Durable server admission gateway, hardened database catalog, real-time presence recovery, and
                    in-app update detector.
                  </span>
                </div>
              </li>
              <li className={styles.roadmapItem}>
                <IconSparkles size={18} className={styles.roadmapItemIconNext} />
                <div>
                  <strong>Mobile Cinema Optimization: </strong>
                  <span>
                    Enhanced touch-gesture scrubbing, smart video orientation toggles, and compact theater viewports.
                  </span>
                </div>
              </li>
              <li className={styles.roadmapItem}>
                <IconSparkles size={18} className={styles.roadmapItemIconNext} />
                <div>
                  <strong>Collaborative Playlists: </strong>
                  <span>
                    Interactive queues allowing guests to submit video URLs with host moderation and vote-skipping.
                  </span>
                </div>
              </li>
              <li className={styles.roadmapItem}>
                <IconSparkles size={18} className={styles.roadmapItemIconNext} />
                <div>
                  <strong>Multi-Region Edge Signaling: </strong>
                  <span>
                    Lowering connection latency by routing WebSocket and WebRTC signaling through distributed edge nodes.
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 9. Final Call to Action Banner */}
      <section className={styles.finalCtaSection} aria-label="Call to action">
        <div className={styles.finalCtaBanner}>
          <div className={styles.finalCtaContent}>
            <h2 className={styles.finalCtaTitle}>Experience CoWatch Today</h2>
            <p className={styles.finalCtaSubtitle}>
              Create a room, send the link to your friends, and start watching together in seconds.
              No downloads, no installations, no friction.
            </p>
            <div className={styles.finalCtaButtons}>
              <Button
                component={Link}
                to="/create"
                size="lg"
                variant="gradient"
                gradient={{ from: "violet", to: "teal", deg: 135 }}
                leftSection={<IconCirclePlusFilled size={20} />}
                id="about-cta-start-btn"
              >
                Start a Watch Party
              </Button>
              <Button
                component={Link}
                to="/myrooms"
                size="lg"
                variant="default"
                leftSection={<IconDeviceTv size={18} />}
                id="about-cta-myrooms-btn"
                className={styles.finalCtaSecondaryBtn}
              >
                Browse My Rooms
              </Button>
              <Button
                component={Link}
                to="/faq"
                size="lg"
                variant="default"
                leftSection={<IconHelpCircle size={18} />}
                id="about-cta-faq-btn"
                className={styles.finalCtaSecondaryBtn}
              >
                Read FAQ
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
