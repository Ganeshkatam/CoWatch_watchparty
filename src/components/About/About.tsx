import React from "react";
import { Link } from "react-router-dom";
import { Badge, Button } from "@mantine/core";
import {
  IconPlayerPlay,
  IconVideo,
  IconMessageDots,
  IconShare,
  IconBrowser,
  IconShieldLock,
  IconBrandGithub,
  IconArrowRight,
  IconCheck,
  IconExternalLink,
  IconHeartHandshake,
  IconSparkles,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./About.module.css";

const EXPERIENCE_TENETS = [
  {
    icon: <IconPlayerPlay size={20} />,
    title: "Watch in Sync",
    text: "Intelligent playback coordination with automatic drift compensation across YouTube, cloud Virtual Browsers, direct video streams, and screen shares.",
  },
  {
    icon: <IconVideo size={20} />,
    title: "Talk in Real Time",
    text: "Integrated low-latency WebRTC audio and video chat right inside the theater, letting you see and hear your friends' authentic reactions.",
  },
  {
    icon: <IconMessageDots size={20} />,
    title: "React Together",
    text: "Synchronized in-room text chat, timestamped messages, and non-intrusive floating reactions that capture the shared living-room atmosphere.",
  },
  {
    icon: <IconShare size={20} />,
    title: "Share Effortlessly",
    text: "Single-link invitations, one-tap QR codes with embedded credentials, and a Green Room preflight check that prevents unexpected microphone feedback.",
  },
];

const BROWSER_BENEFITS = [
  {
    title: "Zero Downloads or Installers",
    description:
      "Nobody in your group needs to download an executable, run an installer, or worry about desktop operating system compatibility.",
  },
  {
    title: "No Invasive Browser Extensions",
    description:
      "Unlike traditional watch party tools that require custom browser plugins which often break on browser updates, CoWatch runs natively in standard web browsers.",
  },
  {
    title: "Cross-Device by Design",
    description:
      "A room link opens seamlessly across laptops, desktops, tablets, and mobile devices, with responsive theater layouts tailored to each screen.",
  },
  {
    title: "Lower Friction for Guests",
    description:
      "Friends can join instantly through a clean URL and passcode, verify their camera and microphone in the Green Room, and jump straight into the party.",
  },
];

const SECURITY_PRINCIPLES = [
  {
    title: "Controlled Admission",
    text: "Rooms are protected with mandatory passcodes, token-based session issuance, and zero credential exposure in browser address bars or logs.",
  },
  {
    title: "Authoritative Host Controls",
    text: "Hosts retain complete authority over playback locking, member permissions, door locking (PARTICIPANTS_LOCKED), and moderation tools.",
  },
  {
    title: "Zero Watch-History Tracking",
    text: "We believe shared viewing should remain private. CoWatch does not profile, track, or store a history of the media you and your friends stream.",
  },
  {
    title: "Ephemeral Room Lifecycles",
    text: "Inactive rooms auto-deactivate after 30 seconds of zero participants, ensuring temporary watch parties are purged cleanly after use.",
  },
];

const TECH_STACK = [
  "React 18",
  "TypeScript",
  "Node.js",
  "Socket.IO",
  "PostgreSQL",
  "Supabase",
  "Redis",
  "WebRTC",
  "Mantine UI",
];

export const About: React.FC = () => {
  useDocumentMetadata({
    title: "About CoWatch | The Social Watch Party Platform",
    description:
      "Learn about CoWatch: why it was built, our browser-first philosophy, privacy principles, and how we bring friends together through synchronized viewing.",
  });

  return (
    <main className={styles.aboutContainer} id="about-main-content">
      {/* 1. Header & Identity */}
      <header className={styles.headerSection}>
        <span className={styles.eyebrow}>About CoWatch</span>
        <h1 className={styles.pageTitle}>
          Bringing People Together Through Shared Viewing
        </h1>
        <p className={styles.leadText}>
          CoWatch is an independent, browser-based social watch party platform designed
          to make watching media together feel as natural and connected as sitting on the same couch.
        </p>
      </header>

      {/* 2. Why CoWatch Exists */}
      <section className={styles.contentSection} aria-labelledby="why-cowatch-heading">
        <h2 id="why-cowatch-heading" className={styles.sectionHeading}>
          Why CoWatch Exists
        </h2>
        <div className={styles.prose}>
          <p>
            Friends, families, and communities are increasingly separated by distance, busy schedules,
            and time zones. Yet watching movies, shows, anime, and online videos remains one of our most
            universal social rituals.
          </p>
          <p>
            For years, sharing a viewing experience online meant juggling disconnected tools:
            opening a video call in one window, playing video in another, counting down
            &ldquo;3, 2, 1, press play&rdquo; over text, or enduring laggy, low-framerate screen shares
            where audio constantly drifted out of sync. Browser extensions promised a fix, but they
            often required invasive permissions, broke on browser updates, and only worked for a single
            streaming website.
          </p>
          <div className={styles.quoteBox}>
            CoWatch was built around the idea that watching together should be a true shared experience,
            not simply one person broadcasting a screen to a passive audience.
          </div>
          <p>
            We set out to create a unified space where high-fidelity media synchronization, low-latency
            face-to-face communication, and interactive room controls coexist seamlessly inside one browser window.
          </p>
        </div>
      </section>

      {/* 3. The CoWatch Experience */}
      <section className={styles.contentSection} aria-labelledby="experience-heading">
        <h2 id="experience-heading" className={styles.sectionHeading}>
          The CoWatch Experience
        </h2>
        <div className={styles.prose}>
          <p>
            CoWatch is not a single media player or a generic video chat app. It is a shared room
            environment organized around four core tenets:
          </p>
        </div>

        <div className={styles.tenetsGrid}>
          {EXPERIENCE_TENETS.map((tenet, idx) => (
            <div key={idx} className={styles.tenetCard}>
              <div className={styles.tenetHeader}>
                <div className={styles.tenetIcon}>{tenet.icon}</div>
                <h3 className={styles.tenetTitle}>{tenet.title}</h3>
              </div>
              <p className={styles.tenetText}>{tenet.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Built for the Browser */}
      <section className={styles.contentSection} aria-labelledby="browser-heading">
        <h2 id="browser-heading" className={styles.sectionHeading}>
          Built for the Browser
        </h2>
        <div className={styles.prose}>
          <p>
            One of our earliest and most important architectural decisions was making CoWatch
            <strong> 100% browser-native</strong>. We intentionally avoided building required
            desktop apps or mandatory browser extensions.
          </p>
          <p>
            That decision shapes everything about how CoWatch operates:
          </p>
        </div>

        <ul className={styles.benefitList}>
          {BROWSER_BENEFITS.map((benefit, idx) => (
            <li key={idx} className={styles.benefitItem}>
              <IconCheck size={18} className={styles.benefitIcon} />
              <div>
                <strong>{benefit.title}: </strong>
                <span>{benefit.description}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Privacy, Security & Room Control */}
      <section className={styles.contentSection} aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className={styles.sectionHeading}>
          Privacy, Security &amp; Room Control
        </h2>
        <div className={styles.prose}>
          <p>
            Because CoWatch hosts shared spaces where people communicate, view media, and interact,
            security and privacy are built into the foundation of the platform:
          </p>
        </div>

        <div className={styles.principlesGrid}>
          {SECURITY_PRINCIPLES.map((principle, idx) => (
            <div key={idx} className={styles.principleCard}>
              <h3 className={styles.principleTitle}>
                <IconShieldLock size={18} />
                <span>{principle.title}</span>
              </h3>
              <p className={styles.principleText}>{principle.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 6. Technology Behind CoWatch */}
      <section className={styles.contentSection} aria-labelledby="tech-heading">
        <h2 id="tech-heading" className={styles.sectionHeading}>
          Built with Modern Web Technology
        </h2>
        <div className={styles.prose}>
          <p>
            CoWatch combines a modern React client with real-time server infrastructure,
            PostgreSQL persistence, Redis distributed coordination, and browser-native media capabilities:
          </p>
        </div>

        <div className={styles.techRow}>
          {TECH_STACK.map((tech, idx) => (
            <span key={idx} className={styles.techPill}>
              {tech}
            </span>
          ))}
        </div>
      </section>

      {/* 7. Open Source & Independent Development */}
      <section className={styles.contentSection} aria-labelledby="open-source-heading">
        <h2 id="open-source-heading" className={styles.sectionHeading}>
          Open Source &amp; Independent
        </h2>
        <div className={styles.prose}>
          <p>
            CoWatch is developed as an independent open-source project. We believe in transparency,
            open collaboration, and building software that respects its users.
          </p>
        </div>

        <div className={styles.openSourceCard}>
          <div className={styles.openSourceHeader}>
            <h3 className={styles.openSourceTitle}>Public Source Repository</h3>
            <Badge variant="filled" color="violet">
              Open on GitHub
            </Badge>
          </div>
          <p className={styles.openSourceText}>
            Our codebase, issue tracker, release notes, and documentation are publicly accessible.
            You can inspect how CoWatch works, report bugs, suggest features, or contribute code.
          </p>
          <Button
            component="a"
            href="https://github.com/Ganeshkatam/CoWatch_watchparty"
            target="_blank"
            rel="noopener noreferrer"
            variant="default"
            size="sm"
            leftSection={<IconBrandGithub size={16} />}
            rightSection={<IconExternalLink size={14} />}
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            Explore on GitHub
          </Button>
        </div>
      </section>

      {/* 8. The Road Ahead */}
      <section className={styles.contentSection} aria-labelledby="roadmap-heading">
        <h2 id="roadmap-heading" className={styles.sectionHeading}>
          The Road Ahead
        </h2>
        <div className={styles.prose}>
          <p>
            We are dedicated to making CoWatch the most dependable and enjoyable way to watch together online.
          </p>
        </div>

        <div className={styles.roadmapGrid}>
          <div className={styles.roadmapColumn}>
            <div className={`${styles.roadmapStatus} ${styles.roadmapStatusCurrent}`}>
              Current Focus
            </div>
            <h3 className={styles.roadmapHeading}>V1 Stability &amp; Polish</h3>
            <ul className={styles.roadmapList}>
              <li className={styles.roadmapItem}>
                <IconCheck size={16} />
                <span>Synchronized YouTube and direct video playback</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconCheck size={16} />
                <span>Dedicated cloud Virtual Browsers (VBrowser)</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconCheck size={16} />
                <span>WebRTC audio and video communication</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconCheck size={16} />
                <span>Unified token-driven invitation links &amp; QR codes</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconCheck size={16} />
                <span>Durable session recovery on page refreshes</span>
              </li>
            </ul>
          </div>

          <div className={styles.roadmapColumn}>
            <div className={`${styles.roadmapStatus} ${styles.roadmapStatusUpcoming}`}>
              Upcoming Horizons
            </div>
            <h3 className={styles.roadmapHeading}>Continuous Evolution</h3>
            <ul className={styles.roadmapList}>
              <li className={styles.roadmapItem}>
                <IconSparkles size={16} />
                <span>Enhanced mobile cinema and portrait viewing modes</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconSparkles size={16} />
                <span>Expanded Virtual Browser performance and regions</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconSparkles size={16} />
                <span>Interactive group playlists and collaborative queues</span>
              </li>
              <li className={styles.roadmapItem}>
                <IconSparkles size={16} />
                <span>Ongoing reliability and network resilience tuning</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 9. Bottom Navigation Box */}
      <section className={styles.actionBox} aria-label="Explore Further">
        <div className={styles.actionInfo}>
          <h2 className={styles.actionTitle}>Ready to Experience CoWatch?</h2>
          <p className={styles.actionSubtitle}>
            Launch a watch party in seconds or explore our documentation, FAQ, and guidelines.
          </p>
        </div>
        <div className={styles.actionButtons}>
          <Button
            component={Link}
            to="/create"
            size="md"
            variant="filled"
            color="violet"
            rightSection={<IconArrowRight size={16} />}
          >
            Start a Watch Party
          </Button>
          <Button
            component={Link}
            to="/faq"
            size="md"
            variant="default"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            Read FAQ
          </Button>
          <Button
            component={Link}
            to="/community-guidelines"
            size="md"
            variant="subtle"
            style={{ color: "var(--text-secondary)" }}
          >
            Guidelines
          </Button>
        </div>
      </section>
    </main>
  );
};
