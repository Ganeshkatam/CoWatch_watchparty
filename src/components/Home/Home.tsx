import React, { useContext } from "react";
import { Container, Title, Text, SimpleGrid, Card, ThemeIcon } from "@mantine/core";
import {
  IconBrandYoutubeFilled,
  IconBrowser,
  IconFile,
  IconLink,
  IconList,
  IconMessageFilled,
  IconRefresh,
  IconScreenShare,
  IconVideo,
  IconUsers,
} from "@tabler/icons-react";
import { NewRoomButton, SignInButton } from "../TopBar/TopBar";
import styles from "./Home.module.css";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

export const Home = () => {
  const { user } = useContext(MetadataContext);
  useDocumentMetadata({
    title: "Watch Party & Synchronized Streaming",
    description:
      "Watch together with friends. Chat and react in real time to the same stream, whether it's YouTube, your own video, or a virtual browser.",
  });
  return (
    <div className={styles.container}>
      {/* Primary Hero Section */}
      <div className={styles.hero}>
        <Container size="xl" className={styles.heroInner}>
          <div className={styles.heroContent}>
            <Title order={1} style={{ fontSize: "clamp(36px, 5vw, 48px)" }}>
              Watch together. <br /> Anywhere.
            </Title>
            <Text size="xl" c="dimmed" mt="md" style={{ maxWidth: 500 }}>
              Create a room, invite your friends, and watch together from anywhere.
            </Text>
            <div style={{ marginTop: "32px", display: "flex", gap: "16px", alignItems: "center" }}>
              <NewRoomButton size="xl" />
              {!user && (
                <div style={{ transform: "scale(1.2)" }}>
                   <SignInButton />
                </div>
              )}
            </div>
          </div>
          <div style={{ flex: "1 1 0", display: "flex", justifyContent: "flex-end" }}>
             <img
              alt="CoWatch interface preview"
              style={{ width: "100%", maxWidth: "600px", borderRadius: "12px", boxShadow: "var(--shadow-hero)" }}
              src="/screenshot_full.png"
            />
          </div>
        </Container>
      </div>

      {/* Main Features */}
      <Container size="xl" py="xl" style={{ marginTop: "40px", marginBottom: "80px" }}>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xl">
          <Feature
            Icon={IconBrowser}
            title="VBrowser"
            text="Watch together on a virtual browser running in the cloud."
          />
          <Feature
            Icon={IconBrandYoutubeFilled}
            title="YouTube"
            text="Watch videos together from YouTube."
          />
          <Feature
            Icon={IconScreenShare}
            title="Screensharing"
            text="Share a browser tab or your desktop."
          />
          <Feature
            Icon={IconFile}
            title="File Upload"
            text="Upload and stream your own video file."
          />
          <Feature
            Icon={IconLink}
            title="Direct URL"
            text="Paste in a video URL for everyone to watch."
          />
          <Feature
             Icon={IconUsers}
             title="Together"
             text="Invite friends instantly with a simple shareable link."
          />
        </SimpleGrid>
      </Container>

      {/* Secondary Hero Section */}
      <div className={styles.hero} style={{ background: "var(--bg-elevated)", padding: "80px 20px" }}>
        <Container size="xl" className={styles.heroInner}>
           <div style={{ flex: "1 1 0", display: "flex", justifyContent: "flex-start", marginRight: "40px" }}>
              <img
              alt="Reactions preview"
              style={{ width: "100%", maxWidth: "500px", borderRadius: "12px" }}
              src="/reactions_preview.png"
            />
          </div>
          <div className={styles.heroContent} style={{ paddingRight: 0 }}>
            <Title order={2}>React to moments together.</Title>
            <Text size="lg" c="dimmed" mt="sm">
              Find moments of shared joy even when you're apart.
            </Text>
            
            <SimpleGrid cols={2} spacing="lg" mt="xl">
               <FeatureCompact Icon={IconRefresh} title="Synchronized Play" text="Play, pause, and seek are synced perfectly." />
               <FeatureCompact Icon={IconMessageFilled} title="Live Chat" text="Memes and inside jokes encouraged." />
               <FeatureCompact Icon={IconList} title="Playlists" text="Queue up videos and rearrange easily." />
               <FeatureCompact Icon={IconVideo} title="Video Chat" text="Jump into video chat to see reactions face-to-face." />
            </SimpleGrid>
          </div>
        </Container>
      </div>
      
    </div>
  );
};

const Feature = ({ Icon, text, title }: { Icon: any; text: string; title: string }) => {
  return (
    <Card padding="xl" radius="md" className={styles.featureCard}>
      <ThemeIcon size={60} radius="md" variant="light" color="violet">
        <Icon size={34} stroke={1.5} />
      </ThemeIcon>
      <Text mt="md" fw={600} size="xl">
        {title}
      </Text>
      <Text size="sm" c="dimmed" mt="xs">
        {text}
      </Text>
    </Card>
  );
};

const FeatureCompact = ({ Icon, text, title }: { Icon: any; text: string; title: string }) => {
  return (
    <div>
      <ThemeIcon size={40} radius="md" variant="light" color="violet">
        <Icon size={24} stroke={1.5} />
      </ThemeIcon>
      <Text mt="sm" fw={600} size="lg">
        {title}
      </Text>
      <Text size="sm" c="dimmed">
        {text}
      </Text>
    </div>
  );
};
