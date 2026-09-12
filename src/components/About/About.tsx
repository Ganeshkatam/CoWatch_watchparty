import React from "react";
import { Link } from "react-router-dom";
import { Badge, Button } from "@mantine/core";
import {
  IconPlayerPlay,
  IconDeviceTv,
  IconShieldLock,
  IconUsers,
  IconBrowser,
  IconSparkles,
  IconArrowRight,
  IconLayersIntersect,
  IconBrandYoutube,
  IconClock,
  IconHeartHandshake,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./About.module.css";

interface PillarItem {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
}

const PILLARS: PillarItem[] = [
  {
    icon: <IconPlayerPlay size={22} />,
    iconBg: "rgba(139, 92, 246, 0.15)",
    iconColor: "var(--color-violet)",
    title: "Sub-Second Playback Sync",
    description:
      "Proprietary drift-compensation algorithms synchronize play, pause, seek, and buffer recovery across global participants within milliseconds.",
  },
  {
    icon: <IconDeviceTv size={22} />,
    iconBg: "rgba(56, 189, 248, 0.15)",
    iconColor: "var(--color-cyan)",
    title: "Universal Media Dock",
    description:
      "Seamlessly stream YouTube videos, direct MP4 and HLS streams, peer-to-peer WebTorrent magnet links, or live screen shares directly in the browser.",
  },
  {
    icon: <IconBrowser size={22} />,
    iconBg: "rgba(236, 72, 153, 0.15)",
    iconColor: "var(--color-pink)",
    title: "Interactive Virtual Browsers",
    description:
      "Spin up dedicated cloud Chromium sessions powered by containerized Neko instances to browse any web content together with shared control.",
  },
  {
    icon: <IconShieldLock size={22} />,
    iconBg: "rgba(16, 185, 129, 0.15)",
    iconColor: "var(--color-success)",
    title: "Privacy-First Architecture",
    description:
      "Rooms are protected with mandatory passcodes and zero watch-history tracking. Ephemeral rooms and virtual machines are automatically purged after use.",
  },
  {
    icon: <IconUsers size={22} />,
    iconBg: "rgba(245, 158, 11, 0.15)",
    iconColor: "var(--color-warning)",
    title: "Dynamic Host Delegation",
    description:
      "Automatic leader promotion and instant owner reclaim ensure sessions never stall when hosts disconnect, with fine-grained playback permission controls.",
  },
  {
    icon: <IconLayersIntersect size={22} />,
    iconBg: "rgba(59, 130, 246, 0.15)",
    iconColor: "var(--color-blue)",
    title: "Activity Hub & Notifications",
    description:
      "Comprehensive in-app notifications and transactional delivery keep participants updated on room invites, starts, expiration warnings, and transfers.",
  },
];

export const About: React.FC = () => {
  useDocumentMetadata({
    title: "About | CoWatch Synchronized Watch Party Platform",
    description:
      "Learn about CoWatch, the synchronized video streaming and watch party platform built for sub-second precision, private rooms, and interactive group media experiences.",
  });

  return (
    <main className={styles.aboutContainer}>
      {/* Hero Section */}
      <section className={styles.heroSection}>
        <Badge variant="outline" className={styles.heroBadge}>
          Modern Watch Party Platform
        </Badge>
        <h1 className={styles.heroTitle}>
          Synchronized Viewing,{" "}
          <span className={styles.gradientText}>Zero Distance</span>
        </h1>
        <p className={styles.heroSubtitle}>
          CoWatch brings friends, families, and communities together through high-fidelity,
          sub-second synchronized video streaming, low-latency audio/video chat, and collaborative
          virtual browsing experiences.
        </p>
        <div className={styles.heroActions}>
          <Button
            component={Link}
            to="/create"
            size="md"
            variant="filled"
            color="violet"
            rightSection={<IconArrowRight size={18} />}
          >
            Create a Watch Party
          </Button>
          <Button
            component={Link}
            to="/"
            size="md"
            variant="default"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            Browse Public Rooms
          </Button>
        </div>
      </section>

      {/* Metrics Banner */}
      <section className={styles.statsGrid} aria-label="Platform Highlights">
        <div className={styles.statCard}>
          <div className={styles.statValue}>&lt; 150ms</div>
          <div className={styles.statLabel}>Global Sync Precision</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>5+</div>
          <div className={styles.statLabel}>Supported Media Formats</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>100%</div>
          <div className={styles.statLabel}>Ephemeral Privacy Available</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>0</div>
          <div className={styles.statLabel}>Watch History Stored</div>
        </div>
      </section>

      {/* Core Technology Pillars */}
      <section aria-labelledby="pillars-heading">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionEyebrow}>Engineered for Groups</div>
          <h2 id="pillars-heading" className={styles.sectionTitle}>
            Everything You Need for the Ultimate Watch Party
          </h2>
          <p className={styles.sectionSubtitle}>
            Built from the ground up with modern web standards, resilient state management, and
            cutting-edge media protocols.
          </p>
        </div>

        <div className={styles.pillarsGrid}>
          {PILLARS.map((pillar, index) => (
            <div key={index} className={styles.pillarCard}>
              <div
                className={styles.pillarIconWrapper}
                style={{ background: pillar.iconBg, color: pillar.iconColor }}
              >
                {pillar.icon}
              </div>
              <h3 className={styles.pillarTitle}>{pillar.title}</h3>
              <p className={styles.pillarDescription}>{pillar.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works Section */}
      <section aria-labelledby="how-it-works-heading">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionEyebrow}>Simple &amp; Frictionless</div>
          <h2 id="how-it-works-heading" className={styles.sectionTitle}>
            How CoWatch Works
          </h2>
          <p className={styles.sectionSubtitle}>
            No downloads or extensions required. Start streaming with your group in three steps.
          </p>
        </div>

        <div className={styles.stepsGrid}>
          <div className={styles.stepCard}>
            <span className={styles.stepNumber}>Step 01</span>
            <h3 className={styles.stepTitle}>Create Your Room</h3>
            <p className={styles.stepText}>
              Launch a room instantly with custom titles, optional permanent persistence, and
              protective passcodes. Configure playback permissions and guest admission controls.
            </p>
          </div>

          <div className={styles.stepCard}>
            <span className={styles.stepNumber}>Step 02</span>
            <h3 className={styles.stepTitle}>Invite Your Friends</h3>
            <p className={styles.stepText}>
              Share a secure link directly or send targeted in-app invitations to CoWatch usernames.
              Guests verify audio and video in the Green Room preflight before entering.
            </p>
          </div>

          <div className={styles.stepCard}>
            <span className={styles.stepNumber}>Step 03</span>
            <h3 className={styles.stepTitle}>Watch Together</h3>
            <p className={styles.stepText}>
              Queue YouTube videos, paste HLS/MP4 stream URLs, start a cloud Virtual Browser, or
              share local files. Every play, pause, and seek action stays perfectly in sync.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA Box */}
      <section className={styles.ctaBox}>
        <h2 className={styles.ctaTitle}>Ready to Host Your Next Watch Party?</h2>
        <p className={styles.ctaSubtitle}>
          Join thousands of viewers enjoying movies, shows, and streams together in real time.
        </p>
        <div className={styles.heroActions}>
          <Button
            component={Link}
            to="/create"
            size="lg"
            variant="filled"
            color="violet"
            rightSection={<IconSparkles size={18} />}
          >
            Start a Watch Party Now
          </Button>
          <Button
            component={Link}
            to="/faq"
            size="lg"
            variant="subtle"
            style={{ color: "var(--text-primary)" }}
          >
            Have Questions? Read FAQ
          </Button>
        </div>
      </section>
    </main>
  );
};
