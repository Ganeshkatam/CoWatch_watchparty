import React from "react";
import { Link } from "react-router-dom";
import { Button, Tooltip } from "@mantine/core";
import {
  IconSparkles,
  IconBrandGithub,
  IconBrandLinkedin,
  IconMail,
  IconDeviceTv,
  IconCompass,
  IconCirclePlusFilled,
  IconCheck,
  IconCpu,
  IconNetwork,
  IconShieldLock,
  IconDeviceDesktop,
  IconCode,
  IconBolt,
  IconArrowRight,
  IconBrandTypescript,
  IconLayersLinked,
  IconExternalLink,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Creator.module.css";

interface Pillar {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  tags: string[];
}

const PILLARS: Pillar[] = [
  {
    id: "realtime",
    icon: <IconNetwork size={24} />,
    title: "Real-Time Distributed Synchronization",
    description:
      "Designed proprietary drift compensation algorithms maintaining sub-50ms continuous synchronization across geographically separated participants with WebSocket state epochs.",
    tags: ["WebSockets", "WebRTC Mesh", "Drift Compensation", "State Epochs"],
  },
  {
    id: "media",
    icon: <IconDeviceTv size={24} />,
    title: "Multi-Source Media Engine",
    description:
      "Architected unified media abstraction interfaces supporting native MP4/WebM, HLS/m3u8, MPEG-DASH, WebTorrent peer-to-peer swarms, Document Picture-in-Picture, and YouTube embeds.",
    tags: ["HTML5 Video", "HLS.js", "Dash.js", "WebTorrent", "Document PiP"],
  },
  {
    id: "security",
    icon: <IconShieldLock size={24} />,
    title: "Zero-Trust Authorization & Privacy",
    description:
      "Engineered secure role-based room boundaries with host-only privileges, masked passcodes, strict server-side command validation, and PostgreSQL Row Level Security.",
    tags: ["Supabase RLS", "PostgreSQL", "Role Auth", "Room Isolation"],
  },
  {
    id: "frontend",
    icon: <IconBrandTypescript size={24} />,
    title: "Type-Safe High-Performance Frontend",
    description:
      "Crafted resilient React 18 and TypeScript application architecture with Mantine design primitives, smooth cubic animations, dynamic dark mode, and zero external runtime dependencies.",
    tags: ["TypeScript", "React 18", "Mantine UI", "CSS Modules"],
  },
  {
    id: "webrtc",
    icon: <IconCpu size={24} />,
    title: "P2P WebRTC Audio/Video Mesh",
    description:
      "Built multi-peer audio, video, and screen sharing infrastructure with adaptive bitrate negotiation, voice activity detection, and automatic reconnection resiliency.",
    tags: ["WebRTC P2P", "Mesh Topology", "VAD", "Screen Share"],
  },
  {
    id: "infra",
    icon: <IconBolt size={24} />,
    title: "Low-Latency Scalable Infrastructure",
    description:
      "Dockerized micro-service pipeline with ephemeral virtual browsers, Redis caching, Node.js concurrency handling, and optimized zero-downtime production deployment.",
    tags: ["Node.js", "Docker", "Neko VBrowser", "Vite", "PM2"],
  },
];

export const Creator: React.FC = () => {
  useDocumentMetadata({
    title: "Ganesh Katam | Creator & Software Architect of CoWatch",
    description:
      "Explore the engineering portfolio, architectural design principles, and background of Ganesh Katam, creator and lead full-stack architect of CoWatch.",
  });

  return (
    <div className={styles.pageRoot}>
      <div className={styles.container}>
        {/* Hero Presentation Card */}
        <header className={styles.heroCard}>
          <div className={styles.heroContent}>
            <div className={styles.avatarColumn}>
              <div className={styles.avatarRing}>
                <div className={styles.avatarOrb} aria-label="Ganesh Katam Initials">
                  GK
                </div>
              </div>
              <div className={styles.availabilityBadge}>
                <span className={styles.availabilityDot} aria-hidden="true" />
                <span>Creator &amp; Architect</span>
              </div>
            </div>

            <div className={styles.introColumn}>
              <div className={styles.eyebrow}>
                <IconSparkles size={16} />
                <span>Software Architect &amp; Full-Stack Engineer</span>
              </div>

              <h1 className={styles.heroName}>Ganesh Katam</h1>

              <p className={styles.heroHeadline}>
                Crafting synchronous living rooms, distributed real-time systems, and human-centered web software.
              </p>

              <p className={styles.heroBio}>
                I am the sole creator, designer, and full-stack software architect behind CoWatch. My focus is building
                resilient, sub-second real-time platforms where deep low-level networking primitives (WebRTC,
                WebSockets, media pipelines) meet meticulous user experience craft.
              </p>

              <div className={styles.heroActions}>
                <Button
                  component="a"
                  href="https://github.com/Ganeshkatam"
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  variant="default"
                  leftSection={<IconBrandGithub size={16} />}
                  id="creator-github-btn"
                >
                  GitHub Profile
                </Button>
                <Button
                  component="a"
                  href="https://github.com/Ganeshkatam/CoWatch_watchparty"
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  variant="default"
                  leftSection={<IconCode size={16} />}
                  id="creator-repo-btn"
                >
                  CoWatch Repository
                </Button>
                <Button
                  component={Link}
                  to="/create"
                  size="sm"
                  variant="gradient"
                  gradient={{ from: "violet", to: "teal", deg: 135 }}
                  leftSection={<IconCirclePlusFilled size={16} />}
                  id="creator-create-room-btn"
                >
                  Launch a Room
                </Button>
                <Button
                  component={Link}
                  to="/about"
                  size="sm"
                  variant="subtle"
                  color="violet"
                  leftSection={<IconLayersLinked size={16} />}
                  id="creator-manifesto-btn"
                >
                  Read Manifesto
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Metrics Strip */}
        <section className={styles.metricsStrip} aria-label="Engineering Metrics">
          <div className={styles.metricCard}>
            <div className={styles.metricValue}>100%</div>
            <div className={styles.metricLabel}>Independent Architecture</div>
            <div className={styles.metricDesc}>Designed, coded, and maintained end-to-end.</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricValue}>&lt; 50ms</div>
            <div className={styles.metricLabel}>Media Sync Drift</div>
            <div className={styles.metricDesc}>Continuous client clock compensation.</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricValue}>0</div>
            <div className={styles.metricLabel}>Extensions Required</div>
            <div className={styles.metricDesc}>Pure browser-native HTML5 &amp; WebRTC.</div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricValue}>Multi-Source</div>
            <div className={styles.metricLabel}>Unified Media Engine</div>
            <div className={styles.metricDesc}>MP4, HLS, DASH, Torrents &amp; YouTube.</div>
          </div>
        </section>

        {/* Core Pillars / Competencies */}
        <section aria-labelledby="pillars-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionEyebrow}>
              <IconCpu size={14} />
              <span>Architectural Competence</span>
            </div>
            <h2 id="pillars-heading" className={styles.sectionTitle}>
              Systems Architecture &amp; Craft
            </h2>
            <p className={styles.sectionSubtitle}>
              The foundational engineering disciplines that went into building CoWatch into a high-concurrency,
              frictionless watch-party experience.
            </p>
          </div>

          <div className={styles.pillarsGrid} style={{ marginTop: 28 }}>
            {PILLARS.map((pillar) => (
              <article key={pillar.id} className={styles.pillarCard}>
                <div className={styles.pillarIconOrb}>{pillar.icon}</div>
                <h3 className={styles.pillarTitle}>{pillar.title}</h3>
                <p className={styles.pillarDesc}>{pillar.description}</p>
                <div className={styles.pillarTags}>
                  {pillar.tags.map((tag) => (
                    <span key={tag} className={styles.techTag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Behind CoWatch: Engineering Story */}
        <section aria-labelledby="story-heading">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionEyebrow}>
              <IconCode size={14} />
              <span>Engineering Journey</span>
            </div>
            <h2 id="story-heading" className={styles.sectionTitle}>
              Building CoWatch From Scratch
            </h2>
            <p className={styles.sectionSubtitle}>
              Key technical breakthroughs and design decisions that separate CoWatch from conventional video apps.
            </p>
          </div>

          <div className={styles.storyGrid} style={{ marginTop: 28 }}>
            <div className={styles.storyCard}>
              <div className={styles.storyBadge}>
                <IconNetwork size={14} />
                <span>Drift Synchronization</span>
              </div>
              <h3 className={styles.storyTitle}>Authoritative State &amp; Time Travel</h3>
              <p className={styles.storyBody}>
                Standard countdowns fail because browser threads drift independently. CoWatch implements an
                authoritative host timeline with epoch stamping. Clients run smooth micro-rate adjustments
                (0.95x - 1.05x) to eliminate sync drift invisibly without jarring audio skips.
              </p>
              <div className={styles.codeSnippetBox}>
                <code>
                  {`// Continuous micro-drift correction\nconst delta = sharerTime - clientTime;\nif (Math.abs(delta) > 0.05 && Math.abs(delta) < 0.5) {\n  video.playbackRate = delta > 0 ? 1.05 : 0.95;\n} else if (Math.abs(delta) >= 0.5) {\n  video.currentTime = sharerTime;\n}`}
                </code>
              </div>
            </div>

            <div className={styles.storyCard}>
              <div className={styles.storyBadge}>
                <IconShieldLock size={14} />
                <span>Strict Security Boundaries</span>
              </div>
              <h3 className={styles.storyTitle}>Host Authority &amp; Data Hygiene</h3>
              <p className={styles.storyBody}>
                Every room action is verified by cryptographically signed host sessions and PostgreSQL Row Level
                Security. Non-hosts are strictly prevented from unmasking passcodes, altering room locks, or accessing
                moderation controls. Rooms auto-purge when abandoned.
              </p>
              <div className={styles.codeSnippetBox}>
                <code>
                  {`-- Host Authorization Verification\nCREATE POLICY "Host authority check" ON room_members\nFOR ALL USING (\n  EXISTS (SELECT 1 FROM rooms WHERE id = room_id AND host_id = auth.uid())\n);`}
                </code>
              </div>
            </div>
          </div>
        </section>

        {/* Philosophy & Vision */}
        <section className={styles.philosophyCard} aria-labelledby="philosophy-heading">
          <div className={styles.quoteBlock}>
            &ldquo;Software that connects people should never feel like software. It should feel like sitting right next
            to them on the couch.&rdquo;
          </div>

          <div className={styles.philosophyGrid}>
            <div className={styles.philosophyItem}>
              <div className={styles.philosophyItemTitle}>
                <IconCheck size={16} color="var(--color-teal)" />
                <span>Zero Dark Patterns</span>
              </div>
              <div className={styles.philosophyItemDesc}>
                No tracking cookies, no invasive browser extensions, and no attention harvesting. Built for genuine
                human connection.
              </div>
            </div>

            <div className={styles.philosophyItem}>
              <div className={styles.philosophyItemTitle}>
                <IconCheck size={16} color="var(--color-teal)" />
                <span>Obsessive Performance</span>
              </div>
              <div className={styles.philosophyItemDesc}>
                Instant sub-second room startup, zero-install guest access, and lightweight memory footprint that runs
                effortlessly on any device.
              </div>
            </div>

            <div className={styles.philosophyItem}>
              <div className={styles.philosophyItemTitle}>
                <IconCheck size={16} color="var(--color-teal)" />
                <span>Crafted With Intention</span>
              </div>
              <div className={styles.philosophyItemDesc}>
                Handwritten codebases, meticulous design tokens, and refined micro-interactions built with pride and
                dedication.
              </div>
            </div>
          </div>
        </section>

        {/* Connect & Colophon */}
        <footer className={styles.colophonCard} id="contact">
          <div className={styles.colophonInfo}>
            <h2 className={styles.colophonTitle}>Connect with Ganesh Katam</h2>
            <p className={styles.colophonSubtitle}>
              Open to technical discussions, architectural inquiries, collaborations, and engineering feedback.
            </p>
          </div>

          <div className={styles.connectLinks}>
            <Button
              component="a"
              href="https://github.com/Ganeshkatam"
              target="_blank"
              rel="noopener noreferrer"
              variant="default"
              size="sm"
              leftSection={<IconBrandGithub size={16} />}
              id="colophon-github"
            >
              GitHub
            </Button>
            <Button
              component="a"
              href="mailto:katamganesh61@gmail.com"
              variant="default"
              size="sm"
              leftSection={<IconMail size={16} />}
              id="colophon-email"
            >
              Email
            </Button>
            <Button
              component={Link}
              to="/about"
              variant="light"
              color="violet"
              size="sm"
              rightSection={<IconArrowRight size={14} />}
              id="colophon-about"
            >
              The Manifesto
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
};
