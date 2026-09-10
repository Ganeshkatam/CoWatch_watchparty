import React, { useContext, useState } from "react";
import { useHistory, Link } from "react-router-dom";
import {
  Container,
  Title,
  Text,
  Button,
  TextInput,
  Badge,
  Tabs,
  Accordion,
} from "@mantine/core";
import {
  IconCirclePlusFilled,
  IconUsers,
  IconArrowRight,
  IconScreenShare,
  IconBrandYoutubeFilled,
  IconBrowser,
  IconFile,
  IconMagnet,
  IconRefresh,
  IconMessageFilled,
  IconVideo,
  IconLock,
  IconCheck,
  IconX,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconCompass,
  IconAlertCircle,
  IconFlame,
} from "@tabler/icons-react";
import styles from "./Home.module.css";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

import { parseRoomInput } from "../../utils/utils";
export { parseRoomInput };

export const Home: React.FC = () => {
  const history = useHistory();
  const { user } = useContext(MetadataContext);

  const [quickJoinInput, setQuickJoinInput] = useState("");
  const [quickJoinError, setQuickJoinError] = useState<string | null>(null);

  useDocumentMetadata({
    title: "CoWatch - Watch Together with Friends",
    description:
      "A shared place to watch movies, shows, and streams with friends. Built-in voice, video, chat, reactions, and flexible ways to bring your media in.",
    canonicalUrl: "https://cowatch.tv/",
    url: "https://cowatch.tv/",
  });

  const handleStartWatchParty = () => {
    if (user) {
      history.push("/create");
    } else {
      history.push("/login?next=%2Fcreate");
    }
  };

  const handleQuickJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickJoinError(null);

    const roomId = parseRoomInput(quickJoinInput);
    if (roomId) {
      history.push(`/join/${roomId}`);
    } else {
      setQuickJoinError("Please enter a valid room code (e.g. rebel-structure-balance) or room link.");
    }
  };

  return (
    <main className={styles.container}>
      {/* 1. Hero Section */}
      <section className={styles.hero} aria-label="Introduction">
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.statusDot} aria-hidden="true" />
            <span>The Social Watch Party Platform</span>
          </div>

          <h1 className={styles.heroHeadline}>
            Watch Together. <br />
            <span className={styles.gradientText}>Feel Like You're There.</span>
          </h1>

          <p className={styles.heroSubtitle}>
            Watch movies, shows, videos, and live streams together with friends — with built-in voice, video, chat,
            reactions, and flexible ways to bring your media in.
          </p>

          <div className={styles.actionDockWrapper}>
            <div className={styles.actionDock}>
              <Button
                size="lg"
                variant="gradient"
                gradient={{ from: "violet", to: "teal", deg: 135 }}
                leftSection={<IconCirclePlusFilled size={20} />}
                onClick={handleStartWatchParty}
                id="hero-start-party-btn"
                className={styles.startPartyButton}
              >
                Start a Watch Party
              </Button>

              <div className={styles.actionDockDivider} aria-hidden="true" />

              <form className={styles.quickJoinForm} onSubmit={handleQuickJoinSubmit}>
                <TextInput
                  size="md"
                  className={styles.quickJoinInput}
                  placeholder="Paste room link or code..."
                  value={quickJoinInput}
                  onChange={(e) => {
                    setQuickJoinInput(e.target.value);
                    if (quickJoinError) setQuickJoinError(null);
                  }}
                  aria-label="Room code or link"
                  leftSection={<IconCompass size={18} color="var(--text-muted)" />}
                />
                <Button
                  type="submit"
                  size="md"
                  variant="default"
                  rightSection={<IconArrowRight size={16} />}
                  id="hero-quick-join-btn"
                  className={styles.joinPartyButton}
                >
                  Join
                </Button>
              </form>
            </div>

            {quickJoinError && (
              <div className={styles.quickJoinError} role="alert">
                <IconAlertCircle size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                {quickJoinError}
              </div>
            )}

            <div className={styles.heroTrustLine}>
              <span>Completely browser-based</span>
              <span className={styles.trustDot}>•</span>
              <span>No downloads or extensions</span>
              <span className={styles.trustDot}>•</span>
              <span>Free for everyone</span>
            </div>
          </div>
        </div>

        {/* Browser-style CoWatch Interface Showcase */}
        <div className={styles.showcaseWrapper} aria-label="CoWatch interface preview">
          <div className={styles.showcaseGlow} aria-hidden="true" />

          {/* Floating Experience Badges */}
          <div className={`${styles.floatingBadge} ${styles.floatingTopRight}`} aria-hidden="true">
            <IconFlame size={16} color="var(--color-warning, #f59e0b)" />
            <span>Reactions +24</span>
          </div>

          <div className={`${styles.floatingBadge} ${styles.floatingBottomLeft}`} aria-hidden="true">
            <IconVideo size={16} color="var(--color-teal, #14b8a6)" />
            <span>Voice & Video</span>
          </div>

          <div className={styles.studioFrame}>
            <div className={styles.studioTopBar}>
              <div className={styles.browserDots} aria-hidden="true">
                <span className={`${styles.browserDot} ${styles.browserDotClose}`} />
                <span className={`${styles.browserDot} ${styles.browserDotMin}`} />
                <span className={`${styles.browserDot} ${styles.browserDotMax}`} />
              </div>

              <div className={styles.browserUrlPill}>
                <IconLock size={12} color="var(--text-muted)" />
                <span>cowatch.tv/join/movie-night</span>
              </div>

              <div className={styles.studioStatusPill}>
                <IconUsers size={14} color="var(--text-muted)" />
                <span>12 watching</span>
              </div>
            </div>

            <div className={styles.studioImageContainer}>
              <img
                src="/screenshot_full.png"
                alt="CoWatch watch party live room with synchronized video playback, active friends, and live reactions"
                className={styles.studioScreenshot}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 2. Proof & Capabilities Strip */}
      <section className={styles.proofStrip} aria-label="Key highlights">
        <div className={styles.proofGrid}>
          <div className={styles.proofItem}>
            <div className={styles.proofIconBox}>
              <IconVideo size={20} />
            </div>
            <div>
              <div className={styles.proofTitle}>Watch Together</div>
              <div className={styles.proofText}>
                Multiple flexible ways to bring movies, shows, videos, and live streams into your room.
              </div>
            </div>
          </div>

          <div className={styles.proofItem}>
            <div className={styles.proofIconBox}>
              <IconMessageFilled size={20} />
            </div>
            <div>
              <div className={styles.proofTitle}>Talk & React</div>
              <div className={styles.proofText}>
                Voice, video, live chat, and reactions built right alongside the video screen.
              </div>
            </div>
          </div>

          <div className={styles.proofItem}>
            <div className={styles.proofIconBox}>
              <IconBrowser size={20} />
            </div>
            <div>
              <div className={styles.proofTitle}>Completely Browser-Based</div>
              <div className={styles.proofText}>
                No apps to download and no browser extensions to install. Open any room link and start watching immediately.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Explore Media Sources (Tabs: What It Solves -> Key Capabilities -> Preview) */}
      <section className={styles.section} aria-labelledby="sources-heading">
        <Container size="xl">
          <div className={styles.sectionHeadingWrapper}>
            <div className={styles.sectionBadge}>Media Sources</div>
            <Title id="sources-heading" order={2} className={styles.sectionTitle}>
              Five ways to bring something to the party.
            </Title>
            <Text className={styles.sectionSubtitle}>
              Whether it is YouTube, a streaming service via cloud browser, a local video file, or your own screen, CoWatch makes it easy to share what you love.
            </Text>
          </div>

          <div className={styles.sourcesCard}>
            <Tabs defaultValue="vbrowser" color="violet" variant="outline">
              <Tabs.List grow>
                <Tabs.Tab value="vbrowser" leftSection={<IconBrowser size={16} />}>
                  Cloud VBrowser
                </Tabs.Tab>
                <Tabs.Tab value="youtube" leftSection={<IconBrandYoutubeFilled size={16} />}>
                  YouTube Synced
                </Tabs.Tab>
                <Tabs.Tab value="screenshare" leftSection={<IconScreenShare size={16} />}>
                  Screen & Tab
                </Tabs.Tab>
                <Tabs.Tab value="videofile" leftSection={<IconFile size={16} />}>
                  Video Files & URLs
                </Tabs.Tab>
                <Tabs.Tab value="torrent" leftSection={<IconMagnet size={16} />}>
                  WebTorrent
                </Tabs.Tab>
              </Tabs.List>

              {/* Tab 1: Cloud VBrowser */}
              <Tabs.Panel value="vbrowser">
                <div className={styles.sourceTabContent}>
                  <div className={styles.sourceDetails}>
                    <div className={styles.sourceTitle}>Cloud VBrowser</div>
                    <div className={styles.sourceWhatItSolves}>
                      Watch supported streaming services through a dedicated remote browser when conventional
                      browser capture isn't suitable.
                    </div>
                    <div className={styles.capabilityList}>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Remote cloud Chromium session isolated from your personal machine</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Interactive control passing between room participants</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Zero host upload bandwidth strain while streaming web media</span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sourcePreviewVisual}>
                    <div className={styles.sourcePreviewBadge}>Remote Cloud Environment</div>
                    <img
                      src="/screenshot_full.png"
                      alt="Virtual Browser in room session"
                      className={styles.sourcePreviewImage}
                    />
                  </div>
                </div>
              </Tabs.Panel>

              {/* Tab 2: YouTube Synced */}
              <Tabs.Panel value="youtube">
                <div className={styles.sourceTabContent}>
                  <div className={styles.sourceDetails}>
                    <div className={styles.sourceTitle}>YouTube Synchronized</div>
                    <div className={styles.sourceWhatItSolves}>
                      Search, queue, and enjoy YouTube videos in high quality with shared playback controls.
                    </div>
                    <div className={styles.capabilityList}>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Integrated video search directly inside your watch party room</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Collaborative playlist queue for continuous viewing</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Independent local audio volume control for each listener</span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sourcePreviewVisual}>
                    <div className={styles.sourcePreviewBadge}>Native Player Integration</div>
                    <img
                      src="/previews/youtube.jpg"
                      alt="YouTube streaming interface"
                      className={styles.sourcePreviewImage}
                    />
                  </div>
                </div>
              </Tabs.Panel>

              {/* Tab 3: Screen & Tab */}
              <Tabs.Panel value="screenshare">
                <div className={styles.sourceTabContent}>
                  <div className={styles.sourceDetails}>
                    <div className={styles.sourceTitle}>Screen & Tab Sharing</div>
                    <div className={styles.sourceWhatItSolves}>
                      Share presentations, gameplay, design reviews, or browser tabs with room members.
                    </div>
                    <div className={styles.capabilityList}>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Share any active application window, desktop, or specific browser tab</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Integrated system audio forwarding directly to connected guests</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>No auxiliary drivers or virtual audio cables required</span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sourcePreviewVisual}>
                    <div className={styles.sourcePreviewBadge}>Browser Screen Capture</div>
                    <img
                      src="/previews/spring.jpg"
                      alt="Screen sharing showcase"
                      className={styles.sourcePreviewImage}
                    />
                  </div>
                </div>
              </Tabs.Panel>

              {/* Tab 4: Video Files & URLs */}
              <Tabs.Panel value="videofile">
                <div className={styles.sourceTabContent}>
                  <div className={styles.sourceDetails}>
                    <div className={styles.sourceTitle}>Video Files & Direct URLs</div>
                    <div className={styles.sourceWhatItSolves}>
                      Stream self-hosted videos, cloud files, or direct MP4/HLS links with synchronized seeking.
                    </div>
                    <div className={styles.capabilityList}>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Direct support for MP4, WebM, and HLS (.m3u8) video streams</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Drag and drop local video files directly into your room player</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Support for external subtitle files (.srt, .vtt)</span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sourcePreviewVisual}>
                    <div className={styles.sourcePreviewBadge}>Direct Stream Player</div>
                    <img
                      src="/previews/sintel.jpg"
                      alt="Direct video file playback"
                      className={styles.sourcePreviewImage}
                    />
                  </div>
                </div>
              </Tabs.Panel>

              {/* Tab 5: WebTorrent */}
              <Tabs.Panel value="torrent">
                <div className={styles.sourceTabContent}>
                  <div className={styles.sourceDetails}>
                    <div className={styles.sourceTitle}>WebTorrent Streams</div>
                    <div className={styles.sourceWhatItSolves}>
                      Stream video content directly from torrent magnet links using peer-to-peer web technology.
                    </div>
                    <div className={styles.capabilityList}>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Stream video on the fly without waiting for complete downloads</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Peer-to-peer mesh transfers directly inside modern web browsers</span>
                      </div>
                      <div className={styles.capabilityItem}>
                        <IconCheck size={18} className={styles.capabilityCheck} />
                        <span>Fully synchronized playback state across all connected room viewers</span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.sourcePreviewVisual}>
                    <div className={styles.sourcePreviewBadge}>Peer-to-Peer Streaming</div>
                    <img
                      src="/previews/bunny.jpg"
                      alt="WebTorrent streaming player"
                      className={styles.sourcePreviewImage}
                    />
                  </div>
                </div>
              </Tabs.Panel>
            </Tabs>
          </div>
        </Container>
      </section>

      {/* 4. How It Works (Three Steps) */}
      <section className={styles.section} style={{ background: "var(--bg-elevated)" }} aria-labelledby="how-it-works-heading">
        <Container size="xl">
          <div className={styles.sectionHeadingWrapper}>
            <div className={styles.sectionBadge}>Frictionless Flow</div>
            <Title id="how-it-works-heading" order={2} className={styles.sectionTitle}>
              How CoWatch works in three steps.
            </Title>
            <Text className={styles.sectionSubtitle}>
              From creating a room to streaming together in seconds.
            </Text>
          </div>

          <div className={styles.stepsGrid}>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>01</div>
              <div className={styles.stepTitle}>Create Your Room</div>
              <div className={styles.stepDescription}>
                Set your room title, configure optional passcodes for privacy, and choose between temporary or
                persistent rooms.
              </div>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>02</div>
              <div className={styles.stepTitle}>Share Link & Passcode</div>
              <div className={styles.stepDescription}>
                Send the room link and passcode directly to your friends via WhatsApp, Telegram, Discord, or quick
                copy.
              </div>
            </div>

            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>03</div>
              <div className={styles.stepTitle}>Watch, Talk & React</div>
              <div className={styles.stepDescription}>
                Guests enter the passcode at the gateway to join immediately in their browser. Talk, react, and
                hang out together.
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* 5. Platform Capabilities (Bento Grid) */}
      <section className={styles.section} aria-labelledby="capabilities-heading">
        <Container size="xl">
          <div className={styles.sectionHeadingWrapper}>
            <div className={styles.sectionBadge}>Party Features</div>
            <Title id="capabilities-heading" order={2} className={styles.sectionTitle}>
              Everything you need to hang out.
            </Title>
            <Text className={styles.sectionSubtitle}>
              Built from the ground up for watching together, talking together, and enjoying the moment.
            </Text>
          </div>

          <div className={styles.bentoGrid}>
            {/* Bento 1: Everything You Need for a Watch Party */}
            <div className={`${styles.bentoCard} ${styles.bentoLarge}`}>
              <div>
                <div className={styles.bentoIconWrapper}>
                  <IconVideo size={22} />
                </div>
                <div className={styles.bentoTitle} style={{ marginTop: 14 }}>
                  Everything You Need for a Watch Party
                </div>
                <div className={styles.bentoText}>
                  A unified shared theater combining video streaming, real-time voice and video, live text chat,
                  reactions, and collaborative controls in one seamless view.
                </div>
              </div>
              <div className={styles.partyDiagram} aria-hidden="true">
                <div className={styles.partyDiagramHeader}>
                  <span>Shared Room Experience</span>
                  <span style={{ color: "var(--color-success)", display: "flex", alignItems: "center", gap: 4 }}>
                    <IconCheck size={14} /> All-in-One Interface
                  </span>
                </div>
                <div className={styles.partyDiagramPills}>
                  <span className={styles.partyPill}>
                    <IconVideo size={14} color="var(--color-blue)" /> Video Chat
                  </span>
                  <span className={styles.partyPill}>
                    <IconMessageFilled size={14} color="var(--color-cyan)" /> Live Chat
                  </span>
                  <span className={styles.partyPill}>
                    <IconUsers size={14} color="var(--color-pink)" /> Friends Grid
                  </span>
                  <span className={styles.partyPill}>
                    <IconRefresh size={14} color="var(--color-violet)" /> Shared Playback
                  </span>
                </div>
              </div>
            </div>

            {/* Bento 2: Video & Voice Chat */}
            <div className={styles.bentoCard}>
              <div>
                <div className={styles.bentoIconWrapper}>
                  <IconMessageFilled size={22} />
                </div>
                <div className={styles.bentoTitle} style={{ marginTop: 14 }}>
                  Voice, Video & Live Reactions
                </div>
                <div className={styles.bentoText}>
                  Jump into voice or video chat with your friends right next to the stream. Real-time text messaging,
                  custom reactions, and presence keep everyone connected.
                </div>
              </div>
              <div className={styles.bentoImageWrapper}>
                <img
                  src="/reactions_preview.png"
                  alt="Real-time live reactions and chat preview"
                  className={styles.bentoPreviewImage}
                />
              </div>
            </div>

            {/* Bento 3: Host Permissions & Controls */}
            <div className={styles.bentoCard}>
              <div>
                <div className={styles.bentoIconWrapper}>
                  <IconLock size={22} />
                </div>
                <div className={styles.bentoTitle} style={{ marginTop: 14 }}>
                  Make the Room Yours
                </div>
                <div className={styles.bentoText}>
                  Flexible host controls, private room passcodes, collaborative playlists, and persistent rooms for
                  regular hangout nights.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Badge size="sm" variant="light" color="teal">
                  Passcode Protected
                </Badge>
                <Badge size="sm" variant="light" color="violet">
                  Host Only
                </Badge>
              </div>
            </div>

            {/* Bento 4: Completely Browser-Based (Large) */}
            <div className={`${styles.bentoCard} ${styles.bentoLarge}`}>
              <div>
                <div className={styles.bentoIconWrapper}>
                  <IconBrowser size={22} />
                </div>
                <div className={styles.bentoTitle} style={{ marginTop: 14 }}>
                  Completely Browser-Based. Zero Installs.
                </div>
                <div className={styles.bentoText}>
                  CoWatch runs 100% inside your web browser. No desktop software, mobile app downloads, or browser extensions required. Friends just click the link on phone, tablet, or computer and join the party instantly.
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                  <IconCheck size={16} color="var(--color-success)" />
                  <span>Chrome, Safari, Firefox & Edge</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                  <IconCheck size={16} color="var(--color-success)" />
                  <span>Mobile & Desktop Web</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                  <IconCheck size={16} color="var(--color-success)" />
                  <span>No Extensions Needed</span>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* 6. Why CoWatch (Comparison Table) */}
      <section className={styles.section} style={{ background: "var(--bg-elevated)" }} aria-labelledby="comparison-heading">
        <Container size="xl">
          <div className={styles.sectionHeadingWrapper}>
            <div className={styles.sectionBadge}>Comparison</div>
            <Title id="comparison-heading" order={2} className={styles.sectionTitle}>
              Why friends choose CoWatch.
            </Title>
            <Text className={styles.sectionSubtitle}>
              A dedicated social watch room designed for hanging out together without the friction of screen-sharing tools or browser extensions.
            </Text>
          </div>

          <div className={styles.tableContainer}>
            <table className={styles.comparisonTable}>
              <thead>
                <tr>
                  <th>Capability</th>
                  <th className={styles.highlightColumn}>CoWatch</th>
                  <th>Discord Screen Share</th>
                  <th>Browser Extensions</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Completely Browser-Based (No Downloads)</td>
                  <td className={styles.highlightColumn}>
                    <IconCheck size={18} className={styles.checkIcon} /> 100% in browser
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> App recommended
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Extension required
                  </td>
                </tr>
                <tr>
                  <td>Cloud VBrowser for Capture-Restricted Sites</td>
                  <td className={styles.highlightColumn}>
                    <IconCheck size={18} className={styles.checkIcon} /> Yes (Remote VM)
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Often restricted
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Extension dependent
                  </td>
                </tr>
                <tr>
                  <td>Mobile Web Browser Support</td>
                  <td className={styles.highlightColumn}>
                    <IconCheck size={18} className={styles.checkIcon} /> Yes (Direct in browser)
                  </td>
                  <td>
                    <IconCheck size={18} className={styles.checkIcon} /> Requires mobile app
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Desktop only
                  </td>
                </tr>
                <tr>
                  <td>Shared Playback Across Clients</td>
                  <td className={styles.highlightColumn}>
                    <IconCheck size={18} className={styles.checkIcon} /> Shared room sync
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Stream broadcast only
                  </td>
                  <td>
                    <IconCheck size={18} className={styles.checkIcon} /> Variable
                  </td>
                </tr>
                <tr>
                  <td>Integrated Voice, Video & Chat in One Window</td>
                  <td className={styles.highlightColumn}>
                    <IconCheck size={18} className={styles.checkIcon} /> All-in-one
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Separate channel
                  </td>
                  <td>
                    <IconX size={18} className={styles.crossIcon} /> Chat only
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      {/* 7. Frequently Asked Questions (FAQ Accordion) */}
      <section className={styles.section} aria-labelledby="faq-heading">
        <Container size="xl">
          <div className={styles.sectionHeadingWrapper}>
            <div className={styles.sectionBadge}>Frequently Asked Questions</div>
            <Title id="faq-heading" order={2} className={styles.sectionTitle}>
              Everything you need to know.
            </Title>
            <Text className={styles.sectionSubtitle}>
              Clear answers to common questions about CoWatch rooms, features, and security.
            </Text>
          </div>

          <div className={styles.faqWrapper}>
            <Accordion variant="separated" radius="md">
              <Accordion.Item value="guests" className={styles.faqItem}>
                <Accordion.Control className={styles.faqControl}>
                  Do guests need to create an account to join?
                </Accordion.Control>
                <Accordion.Panel className={styles.faqPanel}>
                  No. Guests can join watch parties without an account using the room link and room passcode
                  provided by the host. Hosts create an account to manage and persist rooms.
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="vbrowser" className={styles.faqItem}>
                <Accordion.Control className={styles.faqControl}>
                  Why does CoWatch use a Cloud VBrowser?
                </Accordion.Control>
                <Accordion.Panel className={styles.faqPanel}>
                  Some streaming sites restrict conventional browser capture. CoWatch can use a remote browser
                  environment for supported services, allowing the shared viewing experience to work without
                  relying on ordinary local screen capture.
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="installs" className={styles.faqItem}>
                <Accordion.Control className={styles.faqControl}>
                  Do I or my guests need to install any app or browser extension?
                </Accordion.Control>
                <Accordion.Panel className={styles.faqPanel}>
                  No. CoWatch is completely browser-based. Neither hosts nor guests need to install software,
                  mobile apps, or browser extensions. Simply open the room link in any modern browser on your
                  phone, tablet, or computer.
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="mobile" className={styles.faqItem}>
                <Accordion.Control className={styles.faqControl}>
                  Can I use CoWatch on mobile devices?
                </Accordion.Control>
                <Accordion.Panel className={styles.faqPanel}>
                  Yes. CoWatch works directly in modern mobile browsers like Safari and Chrome with full playback,
                  voice, video, and chat. No mobile app download required.
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="pricing" className={styles.faqItem}>
                <Accordion.Control className={styles.faqControl}>
                  Is CoWatch free to use?
                </Accordion.Control>
                <Accordion.Panel className={styles.faqPanel}>
                  Yes, creating and joining rooms on CoWatch is free for community watch parties.
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item value="passcode" className={styles.faqItem}>
                <Accordion.Control className={styles.faqControl}>
                  How do room passcodes protect my session?
                </Accordion.Control>
                <Accordion.Panel className={styles.faqPanel}>
                  Protected rooms require non-host guests to enter the room passcode upon arrival at the gateway
                  before gaining access to the stream and chat.
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </div>
        </Container>
      </section>

      {/* 8. Bottom Final Call to Action */}
      <section className={styles.finalCtaSection} aria-label="Call to action">
        <div className={styles.finalCtaBanner}>
          <div className={styles.finalCtaContent}>
            <h2 className={styles.finalCtaTitle}>Ready for your next watch party?</h2>
            <p className={styles.finalCtaSubtitle}>
              Create a room, send the link to your friends, and start streaming together in seconds.
            </p>
            <div className={styles.finalCtaButtons}>
              <Button
                size="lg"
                variant="gradient"
                gradient={{ from: "violet", to: "teal", deg: 135 }}
                leftSection={<IconCirclePlusFilled size={20} />}
                onClick={handleStartWatchParty}
                id="footer-start-party-btn"
              >
                Start a Watch Party
              </Button>
              <Button
                component={Link}
                to="/join"
                size="lg"
                variant="default"
                leftSection={<IconCompass size={18} />}
                id="footer-join-party-btn"
                className={styles.finalCtaSecondaryBtn}
              >
                Join Existing Room
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
