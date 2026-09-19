import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@mantine/core";
import {
  IconCirclePlusFilled,
  IconCompass,
  IconHelpCircle,
  IconArrowRight,
  IconCheck,
  IconX,
  IconShieldLock,
  IconLock,
  IconEyeOff,
  IconCpu,
  IconPlayerPlay,
  IconVideo,
  IconScreenShare,
  IconLayersLinked,
  IconSparkles,
  IconDeviceTv,
} from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./About.module.css";

const CHAPTERS = [
  { id: "chapter-genesis", index: "01", label: "The Genesis" },
  { id: "chapter-principles", index: "02", label: "First Principles" },
  { id: "chapter-engine", index: "03", label: "The Engine Room" },
  { id: "chapter-pledge", index: "04", label: "Non-Negotiables" },
  { id: "chapter-creator", index: "05", label: "Creator's Note" },
];

const PILLARS = [
  {
    num: "01",
    title: "Absolute Temporal Parity",
    badge: "Synchrony Core",
    explanation:
      "A watch party is only as good as its timing. If a friend laughs or gasps, you must hear it at the exact millisecond of the scene. CoWatch continuously calculates clock skew and applies dynamic drift compensation without causing audio distortion.",
    specs: ["Sub-50ms Drift Target", "Continuous Rate Calibration", "Multi-Source Timeline Orchestration"],
  },
  {
    num: "02",
    title: "Frictionless Hospitality",
    badge: "Browser Native",
    explanation:
      "Inviting someone to a watch party should feel as natural as welcoming them through your front door. Guests never need to download an executable or install a brittle browser plugin. A clean room link and our Green Room hardware check get them into the theater instantly.",
    specs: ["Zero Installers or Extensions", "Green Room Device Preflight", "Responsive Desktop & Mobile Viewports"],
  },
  {
    num: "03",
    title: "Spatial Human Presence",
    badge: "WebRTC Mesh",
    explanation:
      "Media without reaction is just lonely streaming. CoWatch integrates peer-to-peer WebRTC cameras, voice feeds, and floating reactions directly alongside the video display, capturing authentic living-room presence without obscuring the content.",
    specs: ["Low-Latency WebRTC Video & Voice", "Dynamic Reaction Streams", "In-Room Synchronized Text Chat"],
  },
  {
    num: "04",
    title: "Host Sovereignty & Protection",
    badge: "Access Guard",
    explanation:
      "A room belongs to its creator. Hosts maintain uncompromising authority over door locking (PARTICIPANTS_LOCKED), passcode admission, playback control locks, and moderation tools, backed by strict server-side authorization checks.",
    specs: ["One-Click Door Locking", "Granular Playback Lock Permissions", "Server-Side Role Verification"],
  },
];

const ARCHITECTURE_NODES = {
  sync: {
    title: "Real-Time Synchronization Protocol",
    description:
      "A stateful event coordination pipeline that harmonizes video playback, client playheads, and user interactions across distributed networks with low overhead.",
    terminalTitle: "protocols/drift-correction.ts",
    lines: [
      { text: "// Authoritative timecode alignment loop", type: "comment" },
      { text: "const clientNow = performance.now();", type: "code" },
      { text: "const calculatedServerTime = clientNow + clockSkewOffset;", type: "code" },
      { text: "const currentDrift = Math.abs(player.currentTime - roomTimecode);", type: "code" },
      { text: "if (currentDrift > DRIFT_TOLERANCE_MS) {", type: "keyword" },
      { text: "  player.smoothSeek(roomTimecode);", type: "function" },
      { text: "  telemetry.recordAdjustment(currentDrift);", type: "string" },
      { text: "}", type: "keyword" },
    ],
  },
  webrtc: {
    title: "Peer-to-Peer WebRTC Media Fabric",
    description:
      "Direct mesh audio and video topologies that connect room members with minimal latency. Microphone echo cancellation and bandwidth-adaptive downscaling preserve stream clarity.",
    terminalTitle: "webrtc/mesh-signaling.ts",
    lines: [
      { text: "// WebRTC peer connection negotiation", type: "comment" },
      { text: "const peer = new RTCPeerConnection(rtcConfiguration);", type: "code" },
      { text: "peer.ontrack = (event) => attachRemoteMediaStream(event);", type: "function" },
      { text: "peer.onconnectionstatechange = () => {", type: "keyword" },
      { text: "  if (peer.connectionState === 'connected') {", type: "keyword" },
      { text: "    monitorPeerBitrate(peer.getStats());", type: "function" },
      { text: "  }", type: "keyword" },
      { text: "};", type: "code" },
    ],
  },
  security: {
    title: "Hardened Relational Database & Row Security",
    description:
      "Enterprise PostgreSQL architecture enforcing Row Level Security (RLS) across 100% of tables, token-driven admission gateways, and ephemeral 30-second vacancy cleanup.",
    terminalTitle: "database/row-level-security.sql",
    lines: [
      { text: "-- Hardened Row Level Security boundary", type: "comment" },
      { text: "ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;", type: "keyword" },
      { text: "CREATE POLICY 'rooms_owner_access' ON public.rooms", type: "code" },
      { text: "  FOR ALL USING (", type: "keyword" },
      { text: "    owner_id = (SELECT auth.uid())", type: "function" },
      { text: "  );", type: "keyword" },
      { text: "-- Auto-purges inactive sessions after 30s vacancy", type: "comment" },
    ],
  },
};

export const About: React.FC = () => {
  useDocumentMetadata({
    title: "About CoWatch | The Studio & Manifesto",
    description:
      "A personal engineering manifesto by the creator of CoWatch: why it was built, foundational design tenets, real-time architecture, and our commitment to privacy.",
  });

  const [activeChapter, setActiveChapter] = useState<string>("chapter-genesis");
  const [activeLabNode, setActiveLabNode] = useState<"sync" | "webrtc" | "security">("sync");

  // Scroll spy to update active chapter indicator as user scrolls
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 180;
      for (let i = CHAPTERS.length - 1; i >= 0; i--) {
        const el = document.getElementById(CHAPTERS[i].id);
        if (el && el.offsetTop <= scrollPosition) {
          setActiveChapter(CHAPTERS[i].id);
          break;
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToChapter = (chapterId: string) => {
    const el = document.getElementById(chapterId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const currentLab = ARCHITECTURE_NODES[activeLabNode];

  return (
    <div className={styles.pageRoot}>
      <div className={styles.studioContainer}>
        {/* Left Sticky Sidebar (Editorial Index & Creator Badge) */}
        <aside className={styles.studioSidebar} aria-label="Manifesto Chapters">
          <div className={styles.stickySidebarInner}>
            <div className={styles.studioEmblemGroup}>
              <div className={styles.studioEmblemTag}>
                <span className={styles.studioEmblemDot} aria-hidden="true" />
                <span>CoWatch Studio</span>
              </div>
              <h2 className={styles.studioTitle}>The Manifesto</h2>
              <p className={styles.studioSubtext}>
                The personal vision, craft, and architectural principles behind CoWatch.
              </p>
            </div>

            {/* Chapter Navigation */}
            <nav className={styles.chapterNav} aria-label="Chapter Table of Contents">
              {CHAPTERS.map((chapter) => {
                const isActive = activeChapter === chapter.id;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`${styles.chapterNavLink} ${isActive ? styles.chapterNavLinkActive : ""}`}
                    onClick={() => scrollToChapter(chapter.id)}
                  >
                    <span>{chapter.label}</span>
                    <span className={styles.chapterIndexNum}>{chapter.index}</span>
                  </button>
                );
              })}
            </nav>

            {/* Creator Profile Hallmark */}
            <Link to="/creator" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div className={styles.creatorSidebarCard}>
                <div className={styles.creatorNameRow}>
                  <div className={styles.creatorAvatarOrb} aria-hidden="true">
                    GRK
                  </div>
                  <div className={styles.creatorMeta}>
                    <div className={styles.creatorName}>Ganesh Reddy Katam</div>
                    <div className={styles.creatorRole}>Creator &amp; Architect</div>
                  </div>
                </div>
                <div className={styles.creatorNameRow} style={{ marginTop: 8 }}>
                  <div
                    className={styles.creatorAvatarOrb}
                    style={{ background: "linear-gradient(135deg, var(--color-teal), #ec4899)" }}
                    aria-hidden="true"
                  >
                    PL
                  </div>
                  <div className={styles.creatorMeta}>
                    <div className={styles.creatorName}>Prasanna Lakshmi Challa</div>
                    <div className={styles.creatorRole}>Co-Creator &amp; Product Engineer</div>
                  </div>
                </div>
                <div className={styles.creatorPill} style={{ marginTop: 10 }}>View Creators Profile &rarr;</div>
              </div>
            </Link>
          </div>
        </aside>

        {/* Right Column (Narrative Reading Stream) */}
        <main className={styles.manifestoCanvas} id="manifesto-content">
          {/* Mission Lead Header */}
          <header className={styles.leadHeader}>
            <div className={styles.leadEyebrow}>
              <IconSparkles size={14} />
              <span>Independent Engineering Manifesto</span>
            </div>
            <h1 className={styles.leadTitle}>
              We didn&rsquo;t build another video chat app.
              <br />
              <span className={styles.leadEmphasis}>We built a synchronous living room.</span>
            </h1>
            <p className={styles.leadParagraph}>
              Watching media together is one of our most universal human rituals. CoWatch was built
              out of a personal obsession: making shared viewing across long distances feel as natural,
              fluid, and intimate as sharing the same couch.
            </p>
          </header>

          {/* Chapter 01: The Genesis */}
          <section id="chapter-genesis" className={styles.chapterSection} aria-labelledby="heading-genesis">
            <div className={styles.chapterHeader}>
              <div className={styles.chapterNumBadge} aria-hidden="true">
                01
              </div>
              <h2 id="heading-genesis" className={styles.chapterSectionTitle}>
                The Genesis: Reclaiming the Living Room
              </h2>
              <p className={styles.chapterSectionSubtitle}>
                Why traditional tools failed social viewing, and why we started from scratch.
              </p>
            </div>

            <div className={styles.proseBody}>
              <p>
                Like millions of people separated from friends and family by distance, my movie nights had
                become an exercise in frustration.
              </p>
              <p>
                We all know the routine: opening Zoom or Discord in one window, playing video in another,
                and doing the agonizing &ldquo;3, 2, 1, press play&rdquo; countdown over text. Someone&rsquo;s
                player would inevitably buffer. Five minutes in, one person was laughing at a punchline the
                other person wouldn&rsquo;t see for another eight seconds. The emotional momentum was instantly
                shattered.
              </p>
              <div className={styles.manifestoCallout}>
                &ldquo;When audio and video fall out of sync, human empathy falls out of sync. Shared viewing is
                not just about seeing the same pixels; it is about feeling the same second.&rdquo;
              </div>
              <p>
                Existing solutions took the wrong shortcuts. Some built invasive browser extensions that
                required terrifying permissions, tracked web activity, and broke with every Chrome update. Others
                attempted screen sharing that dropped frames, muted system sound, and produced black boxes on
                protected video.
              </p>
              <p>
                I believed there was a better way: build directly on the open web&rsquo;s modern primitives
                (WebRTC, HTML5 Media, WebSockets) to create a pure browser-native theater that requires zero
                installs and zero compromises.
              </p>
            </div>

            <div className={styles.frictionGrid}>
              <div className={styles.frictionCard}>
                <div className={styles.frictionCardHeader}>
                  <div className={`${styles.frictionIconOrb} ${styles.frictionIconOrbBad}`}>
                    <IconX size={18} />
                  </div>
                  <h3 className={styles.frictionCardTitle}>The Old Compromises</h3>
                </div>
                <p className={styles.frictionCardDesc}>
                  Laggy countdowns, invasive third-party extensions, split-screen app juggling, and passive
                  choppy screen shares that mute computer audio.
                </p>
              </div>

              <div className={styles.frictionCard}>
                <div className={styles.frictionCardHeader}>
                  <div className={`${styles.frictionIconOrb} ${styles.frictionIconOrbGood}`}>
                    <IconCheck size={18} />
                  </div>
                  <h3 className={styles.frictionCardTitle}>The CoWatch Standard</h3>
                </div>
                <p className={styles.frictionCardDesc}>
                  Sub-50ms continuous drift compensation, peer-to-peer WebRTC video, pristine system audio
                  forwarding, and instant guest entry with zero downloads.
                </p>
              </div>
            </div>
          </section>

          {/* Chapter 02: First Principles */}
          <section id="chapter-principles" className={styles.chapterSection} aria-labelledby="heading-principles">
            <div className={styles.chapterHeader}>
              <div className={styles.chapterNumBadge} aria-hidden="true">
                02
              </div>
              <h2 id="heading-principles" className={styles.chapterSectionTitle}>
                First Principles of the Theater
              </h2>
              <p className={styles.chapterSectionSubtitle}>
                Four foundational tenets that govern every engineering decision in CoWatch.
              </p>
            </div>

            <div className={styles.pillarsStream}>
              {PILLARS.map((pillar, idx) => (
                <div key={idx} className={styles.pillarCard}>
                  <div className={styles.pillarIndex}>{pillar.num}</div>
                  <div className={styles.pillarBody}>
                    <div className={styles.pillarTitleRow}>
                      <h3 className={styles.pillarTitle}>{pillar.title}</h3>
                      <span className={styles.pillarBadge}>{pillar.badge}</span>
                    </div>
                    <p className={styles.pillarExplanation}>{pillar.explanation}</p>
                    <div className={styles.pillarSpecsList}>
                      {pillar.specs.map((spec, sIdx) => (
                        <span key={sIdx} className={styles.pillarSpecItem}>
                          <IconCheck size={12} />
                          <span>{spec}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Chapter 03: The Engine Room */}
          <section id="chapter-engine" className={styles.chapterSection} aria-labelledby="heading-engine">
            <div className={styles.chapterHeader}>
              <div className={styles.chapterNumBadge} aria-hidden="true">
                03
              </div>
              <h2 id="heading-engine" className={styles.chapterSectionTitle}>
                The Engine Room: Architecture Lab
              </h2>
              <p className={styles.chapterSectionSubtitle}>
                A peek into the real-time protocols and data pipelines that power CoWatch rooms.
              </p>
            </div>

            <div className={styles.labConsole}>
              <div className={styles.labConsoleTopBar}>
                <div className={styles.labConsoleDots}>
                  <span className={`${styles.labConsoleDot} ${styles.labDot1}`} />
                  <span className={`${styles.labConsoleDot} ${styles.labDot2}`} />
                  <span className={`${styles.labConsoleDot} ${styles.labDot3}`} />
                </div>
                <span className={styles.labConsoleTitle}>COWATCH_CORE_ENGINE // v1.2.1</span>
              </div>

              <div className={styles.labConsoleNav} role="tablist" aria-label="Engine Components">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLabNode === "sync"}
                  className={`${styles.labNavBtn} ${activeLabNode === "sync" ? styles.labNavBtnActive : ""}`}
                  onClick={() => setActiveLabNode("sync")}
                >
                  <IconLayersLinked size={16} />
                  <span>Clock Synchronization</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLabNode === "webrtc"}
                  className={`${styles.labNavBtn} ${activeLabNode === "webrtc" ? styles.labNavBtnActive : ""}`}
                  onClick={() => setActiveLabNode("webrtc")}
                >
                  <IconVideo size={16} />
                  <span>WebRTC Mesh</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeLabNode === "security"}
                  className={`${styles.labNavBtn} ${activeLabNode === "security" ? styles.labNavBtnActive : ""}`}
                  onClick={() => setActiveLabNode("security")}
                >
                  <IconShieldLock size={16} />
                  <span>PostgreSQL RLS</span>
                </button>
              </div>

              <div className={styles.labConsoleBody}>
                <div className={styles.labActiveMeta}>
                  <h3 className={styles.labActiveHeader}>{currentLab.title}</h3>
                  <p className={styles.labActiveDesc}>{currentLab.description}</p>
                </div>

                <div className={styles.labTerminalWindow}>
                  <div style={{ color: "#64748b", marginBottom: 8, fontSize: 11 }}>
                    // Source: {currentLab.terminalTitle}
                  </div>
                  {currentLab.lines.map((line, lIdx) => (
                    <div key={lIdx}>
                      {line.type === "comment" && <span className={styles.labCodeComment}>{line.text}</span>}
                      {line.type === "keyword" && <span className={styles.labCodeKeyword}>{line.text}</span>}
                      {line.type === "function" && <span className={styles.labCodeFunction}>{line.text}</span>}
                      {line.type === "string" && <span className={styles.labCodeString}>{line.text}</span>}
                      {line.type === "code" && <span>{line.text}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Chapter 04: Non-Negotiables */}
          <section id="chapter-pledge" className={styles.chapterSection} aria-labelledby="heading-pledge">
            <div className={styles.chapterHeader}>
              <div className={styles.chapterNumBadge} aria-hidden="true">
                04
              </div>
              <h2 id="heading-pledge" className={styles.chapterSectionTitle}>
                The Non-Negotiables
              </h2>
              <p className={styles.chapterSectionSubtitle}>
                Privacy and sovereignty are not optional feature toggles. They are core architectural boundaries.
              </p>
            </div>

            <div className={styles.pledgeGrid}>
              <div className={styles.pledgeCard}>
                <div className={styles.pledgeHeader}>
                  <div className={styles.pledgeIconOrb}>
                    <IconEyeOff size={18} />
                  </div>
                  <h3 className={styles.pledgeTitle}>Zero Watch-History Profiling</h3>
                </div>
                <p className={styles.pledgeDesc}>
                  We believe your entertainment taste belongs only to you and your friends. CoWatch never tracks,
                  logs, or sells what media is streamed in your rooms.
                </p>
              </div>

              <div className={styles.pledgeCard}>
                <div className={styles.pledgeHeader}>
                  <div className={styles.pledgeIconOrb}>
                    <IconLock size={18} />
                  </div>
                  <h3 className={styles.pledgeTitle}>Tokenized Admission</h3>
                </div>
                <p className={styles.pledgeDesc}>
                  Passcodes and room credentials are authenticated strictly on our server. They are never exposed in
                  browser address bars, URL queries, or shared link previews.
                </p>
              </div>

              <div className={styles.pledgeCard}>
                <div className={styles.pledgeHeader}>
                  <div className={styles.pledgeIconOrb}>
                    <IconCpu size={18} />
                  </div>
                  <h3 className={styles.pledgeTitle}>Ephemeral Room Lifecycles</h3>
                </div>
                <p className={styles.pledgeDesc}>
                  Rooms are temporary living rooms, not permanent tracking hubs. Once a room is empty for 30 seconds,
                  its state automatically deactivates and resources are cleanly purged.
                </p>
              </div>

              <div className={styles.pledgeCard}>
                <div className={styles.pledgeHeader}>
                  <div className={styles.pledgeIconOrb}>
                    <IconShieldLock size={18} />
                  </div>
                  <h3 className={styles.pledgeTitle}>Defense-in-Depth Relational RLS</h3>
                </div>
                <p className={styles.pledgeDesc}>
                  100% of our database tables enforce strict PostgreSQL Row Level Security. Data is isolated by tenant
                  and role, with zero reliance on client-side security trust.
                </p>
              </div>
            </div>
          </section>

          {/* Chapter 05: Creator's Note */}
          <section id="chapter-creator" className={styles.chapterSection} aria-labelledby="heading-creator">
            <div className={styles.chapterHeader}>
              <div className={styles.chapterNumBadge} aria-hidden="true">
                05
              </div>
              <h2 id="heading-creator" className={styles.chapterSectionTitle}>
                From the Creator
              </h2>
              <p className={styles.chapterSectionSubtitle}>
                A personal reflection on craftsmanship, independence, and the road ahead.
              </p>
            </div>

            <div className={styles.creatorNoteContainer}>
              <div className={styles.creatorNoteEyebrow}>
                <IconSparkles size={14} />
                <span>Founder&rsquo;s Perspective</span>
              </div>

              <h3 className={styles.creatorNoteTitle}>
                Crafted with intention. Built for people who care about watching together.
              </h3>

              <div className={styles.creatorLetterProse}>
                <p>
                  CoWatch was not created in a corporate venture committee or designed to harvest attention. It
                  was built by hand because I genuinely wanted a better way to share movies, anime, and late-night
                  conversations with people I love across time zones.
                </p>
                <p>
                  Every line of TypeScript, every database migration, every WebRTC renegotiation check, and every
                  subtle animation has been tuned with deep craftsmanship. I wanted software that felt fast,
                  respectful, and completely transparent—where you can send a link to a friend, see their smile
                  in WebRTC, and lose yourself in a great story together without wrestling with tech.
                </p>
                <p>
                  CoWatch remains a proud, independent platform. Thank you for hosting your movie nights here,
                  for trusting our architecture, and for being part of this journey.
                </p>
              </div>

              <div className={styles.creatorSignatureBlock}>
                <div className={styles.creatorSignMeta}>
                  <div className={styles.creatorSignAvatar} aria-hidden="true">
                    GRK
                  </div>
                  <div
                    className={styles.creatorSignAvatar}
                    style={{ background: "linear-gradient(135deg, var(--color-teal), #ec4899)", marginLeft: -10 }}
                    aria-hidden="true"
                  >
                    PL
                  </div>
                  <div className={styles.creatorSignInfo}>
                    <div className={styles.creatorSignName}>Ganesh Reddy Katam &amp; Prasanna Lakshmi Challa</div>
                    <div className={styles.creatorSignTitle}>Creators &amp; Architects, CoWatch</div>
                  </div>
                </div>

                <div className={styles.creatorHallmark}>
                  <Button
                    component={Link}
                    to="/creator"
                    size="xs"
                    variant="light"
                    color="violet"
                    rightSection={<IconArrowRight size={12} />}
                  >
                    Designed &amp; Developed by Ganesh Reddy Katam &amp; Prasanna Lakshmi Challa
                  </Button>
                  <span className={styles.creatorHallmarkDate}>Version 1.2.1 • September 2026</span>
                </div>
              </div>
            </div>
          </section>

          {/* Studio Action Dock (Bottom of Narrative) */}
          <section className={styles.studioActionDock} aria-label="Launch Watch Party">
            <div className={styles.dockInfo}>
              <h3 className={styles.dockTitle}>Ready to host your own room?</h3>
              <p className={styles.dockSubtitle}>
                Launch a watch party in seconds, invite your friends with a clean link, and experience synchronous
                playback together.
              </p>
            </div>

            <div className={styles.dockButtonGroup}>
              <Button
                component={Link}
                to="/create"
                size="md"
                variant="gradient"
                gradient={{ from: "violet", to: "teal", deg: 135 }}
                leftSection={<IconCirclePlusFilled size={18} />}
                id="manifesto-dock-start-btn"
              >
                Start a Watch Party
              </Button>
              <Button
                component={Link}
                to="/join"
                size="md"
                variant="default"
                leftSection={<IconCompass size={16} />}
                id="manifesto-dock-join-btn"
              >
                Join Existing Room
              </Button>
              <Button
                component={Link}
                to="/faq"
                size="md"
                variant="subtle"
                leftSection={<IconHelpCircle size={16} />}
                id="manifesto-dock-faq-btn"
              >
                Read FAQ
              </Button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};
