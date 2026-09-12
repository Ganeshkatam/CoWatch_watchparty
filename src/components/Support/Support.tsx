import React from "react";
import { Link } from "react-router-dom";
import { Badge, Button } from "@mantine/core";
import {
  IconMicrophone,
  IconVideo,
  IconScreenShare,
  IconWifi,
  IconBrowser,
  IconShieldLock,
  IconMail,
  IconHelpCircle,
  IconBook,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Support.module.css";

interface TroubleshootingSection {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  items: Array<{
    highlight: string;
    description: string;
  }>;
}

const SECTIONS: TroubleshootingSection[] = [
  {
    icon: <IconMicrophone size={22} />,
    iconBg: "rgba(139, 92, 246, 0.15)",
    iconColor: "var(--color-violet)",
    title: "Audio & Microphone Issues",
    items: [
      {
        highlight: "Permission Check:",
        description:
          "Ensure your browser has granted microphone access to CoWatch. Look for the lock or tune icon in your browser address bar.",
      },
      {
        highlight: "Device Selection:",
        description:
          "Open Room Settings to verify that the correct input device is selected. Test your microphone volume level before unmuting.",
      },
      {
        highlight: "Echo Prevention:",
        description:
          "Wear headphones if other participants hear feedback or echo. CoWatch applies automatic echo cancellation, but open speakers can still reflect high-gain audio.",
      },
    ],
  },
  {
    icon: <IconVideo size={22} />,
    iconBg: "rgba(56, 189, 248, 0.15)",
    iconColor: "var(--color-cyan)",
    title: "Camera & Video Streaming",
    items: [
      {
        highlight: "Exclusive Device Access:",
        description:
          "Make sure no other desktop application (Zoom, Teams, Discord, OBS) is holding an exclusive hardware lock on your webcam.",
      },
      {
        highlight: "Browser Hardware Acceleration:",
        description:
          "Enable hardware acceleration in your browser settings (chrome://settings/system) to prevent CPU frame drops during multi-participant video feeds.",
      },
      {
        highlight: "Resolution Downscaling:",
        description:
          "On constrained networks, CoWatch automatically throttles camera feeds to preserve synchronized media playback and voice clarity.",
      },
    ],
  },
  {
    icon: <IconScreenShare size={22} />,
    iconBg: "rgba(236, 72, 153, 0.15)",
    iconColor: "var(--color-pink)",
    title: "Screen Sharing & Audio Capture",
    items: [
      {
        highlight: "System Audio Sharing:",
        description:
          "To stream computer audio with your screen share, select 'Entire Screen' or 'Browser Tab' and ensure the 'Also share system audio' checkbox is toggled on.",
      },
      {
        highlight: "DRM-Protected Content:",
        description:
          "Mainstream subscription services (Netflix, Disney+, Prime) enforce hardware DRM (HDCP) that causes screen shares to appear black. Use Virtual Browsers or direct media URLs instead.",
      },
      {
        highlight: "macOS Screen Recording Permissions:",
        description:
          "On macOS, verify that your browser has permission under System Settings > Privacy & Security > Screen Recording.",
      },
    ],
  },
  {
    icon: <IconWifi size={22} />,
    iconBg: "rgba(16, 185, 129, 0.15)",
    iconColor: "var(--color-success)",
    title: "Connectivity & WebRTC Quality",
    items: [
      {
        highlight: "Strict Firewalls & NAT:",
        description:
          "If voice or video feeds fail to connect, your network or corporate firewall may block UDP WebRTC traffic. CoWatch provisions encrypted TURN relay fallbacks on port 443.",
      },
      {
        highlight: "VPN & Proxy Interference:",
        description:
          "Commercial VPNs can route traffic through distant egress nodes, introducing latency and jitter. Temporarily pause your VPN if media drift occurs.",
      },
      {
        highlight: "Bandwidth Guidelines:",
        description:
          "A steady connection with at least 5 Mbps upload and 10 Mbps download is recommended for hosting synchronized HD streams.",
      },
    ],
  },
  {
    icon: <IconBrowser size={22} />,
    iconBg: "rgba(245, 158, 11, 0.15)",
    iconColor: "var(--color-warning)",
    title: "Cloud Virtual Browsers",
    items: [
      {
        highlight: "Host Control & Delegation:",
        description:
          "Only one participant can control the virtual browser cursor at a time. The room host can reassign or revoke control at any moment.",
      },
      {
        highlight: "Session Timeouts:",
        description:
          "Virtual browser sessions are provisioned on ephemeral cloud instances. Instances shut down automatically after periods of room inactivity to conserve resources.",
      },
      {
        highlight: "Acceptable Use Policy:",
        description:
          "Virtual browsers are monitored for abusive network usage including crypto-mining, automated scraping, or denial-of-service attempts.",
      },
    ],
  },
  {
    icon: <IconShieldLock size={22} />,
    iconBg: "rgba(99, 102, 241, 0.15)",
    iconColor: "var(--color-indigo)",
    title: "Account Security & Passcodes",
    items: [
      {
        highlight: "Email Confirmation:",
        description:
          "New accounts require email verification before joining rooms. Check your spam folder for the verification email if you have not received it.",
      },
      {
        highlight: "Room Passcodes:",
        description:
          "Hosts can require passcodes or lock room capacity to prevent unauthorized entry. Passcodes can be updated live from Room Settings.",
      },
      {
        highlight: "Moderation Controls:",
        description:
          "Room hosts can kick disruptive users, ban repeat offenders, or temporarily lock the room from accepting new connections.",
      },
    ],
  },
];

export const Support: React.FC = () => {
  useDocumentMetadata({
    title: "Support Center | CoWatch",
    description: "Get help with audio, video, screen sharing, WebRTC connectivity, and room moderation on CoWatch.",
  });

  return (
    <div className={styles.supportContainer}>
      <div className={styles.heroSection}>
        <Badge variant="outline" radius="sm" className={styles.heroBadge}>
          Help &amp; Diagnostics
        </Badge>
        <h1 className={styles.heroTitle}>
          CoWatch <span className={styles.gradientText}>Support Center</span>
        </h1>
        <p className={styles.heroSubtitle}>
          Troubleshooting guides, connectivity diagnostics, and resolution steps for audio,
          video, synchronized playback, and room management.
        </p>
      </div>

      <div className={styles.supportGrid}>
        {SECTIONS.map((section, idx) => (
          <div key={idx} className={styles.guideCard}>
            <div className={styles.cardHeader}>
              <div
                className={styles.cardIcon}
                style={{ backgroundColor: section.iconBg, color: section.iconColor }}
              >
                {section.icon}
              </div>
              <h3 className={styles.cardTitle}>{section.title}</h3>
            </div>
            <ul className={styles.cardList}>
              {section.items.map((item, itemIdx) => (
                <li key={itemIdx}>
                  <strong>{item.highlight}</strong> {item.description}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className={styles.contactBanner}>
        <h2 className={styles.contactTitle}>Still Need Assistance?</h2>
        <p className={styles.contactSubtitle}>
          Our engineering and support team is here to assist with persistent streaming defects,
          infrastructure issues, and trust and safety escalations.
        </p>
        <div className={styles.contactActions}>
          <Button
            component="a"
            href="mailto:support@cowatch.me"
            variant="gradient"
            gradient={{ from: "violet", to: "cyan", deg: 135 }}
            leftSection={<IconMail size={18} />}
          >
            Email Support (support@cowatch.me)
          </Button>
          <Button
            component={Link}
            to="/community-guidelines"
            variant="default"
            leftSection={<IconBook size={18} />}
          >
            Community Guidelines
          </Button>
          <Button
            component={Link}
            to="/faq"
            variant="default"
            leftSection={<IconHelpCircle size={18} />}
          >
            Frequently Asked Questions
          </Button>
        </div>
      </div>
    </div>
  );
};
