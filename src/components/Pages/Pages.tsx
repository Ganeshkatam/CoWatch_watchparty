import React from "react";
import { Container, Paper, Title, Text, Accordion, List, Anchor, Button } from "@mantine/core";
import { useHistory } from "react-router-dom";
import { IconArrowLeft } from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";

const containerStyle: React.CSSProperties = {
  maxWidth: "840px",
  padding: "24px 20px 64px",
  marginTop: "20px",
  marginBottom: "40px",
};

const paperStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  padding: "36px",
  borderRadius: "16px",
  boxShadow: "var(--shadow-md)",
  color: "var(--text-primary)",
};

const BackButton = () => {
  const history = useHistory();
  return (
    <Button 
      variant="subtle" 
      color="gray" 
      onClick={() => history.goBack()} 
      leftSection={<IconArrowLeft size={16} />}
      mb="lg"
      px="xs"
      style={{
        color: "var(--text-secondary)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      Go back
    </Button>
  );
};

export const Privacy = () => {
  useDocumentMetadata({
    title: "Privacy Policy | CoWatch",
    description: "Read the privacy policy for CoWatch. Learn how we handle rooms, data, transactional notifications, and user privacy.",
  });

  return (
    <Container style={containerStyle}>
      <BackButton />
      <Paper radius="md" style={paperStyle}>
        <Title order={1} mb="xl" style={{ color: "var(--color-violet)" }}>
          Privacy Policy
        </Title>

        <Title order={2} size="h4" mb="sm">Rooms & Viewing History</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>By default, rooms are temporary and expire after inactivity.</List.Item>
          <List.Item>Room owners have the option to make rooms permanent, which can be changed at any time.</List.Item>
          <List.Item>We do not track, profile, or retain logs of the media content you watch in rooms.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Account Information</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>An account is required to host rooms or save preferences. Your username, display name, and avatar are displayed to participants in rooms you join.</List.Item>
          <List.Item>We never sell your personal information or email address to third parties.</List.Item>
          <List.Item>
            You can delete your account and associated profile data at any time from your Account Settings, or by contacting <Anchor href="mailto:support@cowatch.me" c="var(--color-violet)">support@cowatch.me</Anchor>.
          </List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Transactional Notifications & Email</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>We send transactional communications (such as room invitations, room expiration notices, and security alerts) based on your account activity.</List.Item>
          <List.Item>You can customize or disable email notification categories at any time in your Account Preferences.</List.Item>
          <List.Item>To protect your privacy, invalid or unsubscribed email addresses are protected using one-way cryptographic hashes rather than storing plaintext suppression records.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Live Audio, Video & WebRTC</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>Real-time voice, webcam, and screen sharing are delivered via encrypted WebRTC connections.</List.Item>
          <List.Item>Direct peer-to-peer media streaming inherently exchanges network addresses (IP addresses) between participants in the room to route audio and video.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Virtual Browsers</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>Cloud virtual browser containers are dedicated to your session and are automatically recycled and wiped upon session conclusion.</List.Item>
          <List.Item>Interactive control commands are encrypted in-transit between your browser and the cloud virtual machine.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Third-Party Services</Title>
        <List mb="sm" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            Searching and streaming YouTube videos within CoWatch utilizes the YouTube API Services. Your interaction with YouTube content is governed by the <Anchor href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" c="var(--color-violet)">Google Privacy Policy</Anchor>.
          </List.Item>
        </List>
      </Paper>
    </Container>
  );
};

export const Terms = () => {
  useDocumentMetadata({
    title: "Terms of Service | CoWatch",
    description: "Read the terms of service for using CoWatch watch party platform.",
  });

  return (
    <Container style={containerStyle}>
      <BackButton />
      <Paper radius="md" style={paperStyle}>
        <Title order={1} mb="xl" style={{ color: "var(--color-violet)" }}>
          Terms of Service
        </Title>
        
        <Text mb="md" c="var(--text-primary)" fw={500}>By using CoWatch, you agree to the following terms:</Text>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item><strong>Age Requirement:</strong> You must be at least 18 years of age to register an account or use the service.</List.Item>
          <List.Item><strong>User Content & Rights:</strong> You warrant that you have all necessary rights, licenses, or permissions for any media content, URLs, files, or streams you share or broadcast in rooms.</List.Item>
          <List.Item><strong>Prohibited Conduct:</strong> You may not use the service to transmit illegal, infringing, defamatory, harassing, abusive, or sexually explicit material. Violating content will result in immediate termination.</List.Item>
          <List.Item><strong>Virtual Browser Acceptable Use:</strong> Shared virtual browser instances must be used solely for standard interactive browsing and media playback. Automated vulnerability scanning, cryptocurrency mining, denial-of-service attacks, and network probing are strictly prohibited.</List.Item>
          <List.Item><strong>Room Management & Moderation:</strong> Room hosts have authority over their rooms, including setting passcodes, participant locks, and kicking or banning users who disrupt the session. Users must respect room rules and host moderation actions.</List.Item>
          <List.Item><strong>Service Availability:</strong> CoWatch is provided on an "as is" and "as available" basis without warranties of uninterrupted uptime or error-free operation.</List.Item>
          <List.Item><strong>Account Suspension & Termination:</strong> We reserve the right to suspend or terminate accounts that violate these Terms, our Community Guidelines, or applicable laws.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">YouTube Content</Title>
        <Text mb="sm" c="var(--text-secondary)">
          When playing YouTube videos through CoWatch, you are accessing YouTube content directly and agree to be bound by the <Anchor href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" c="var(--color-violet)">YouTube Terms of Service</Anchor>.
        </Text>
      </Paper>
    </Container>
  );
};

export const FAQ = () => {
  useDocumentMetadata({
    title: "Frequently Asked Questions | CoWatch",
    description: "Frequently asked questions about CoWatch, virtual browsers, screensharing, and watch party features.",
  });

  return (
    <Container style={containerStyle}>
      <BackButton />
      <Title order={1} mb="xl" style={{ color: "var(--color-violet)", textAlign: "center", fontWeight: 800 }}>
        Frequently Asked Questions
      </Title>
      
      <Accordion variant="separated" styles={{
        item: {
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "14px",
          boxShadow: "var(--shadow-sm)",
          transition: "all 0.2s ease",
          marginBottom: "12px",
          overflow: "hidden",
        },
        control: {
          padding: "16px 20px",
          borderRadius: "14px",
          '&:hover': {
            backgroundColor: "var(--surface-hover)",
          },
        },
        label: {
          color: "var(--text-primary)",
        },
        content: {
          color: "var(--text-secondary)",
          lineHeight: 1.7,
          fontSize: "15px",
          padding: "0 20px 20px 20px",
        },
        chevron: {
          color: "var(--text-muted)",
        },
      }}>
        <Accordion.Item value="vbrowser">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              What's a VBrowser?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            A virtual browser (VBrowser) is a cloud-hosted Chromium session that room members can connect to simultaneously. Everyone in the room sees the same screen in real-time with shared controls, making it ideal for watching videos, browsing media sites, or collaborating together.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="vbrowser-stop">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              Why did my VBrowser session stop?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            Virtual browsers terminate automatically when a room becomes empty or inactive to conserve server capacity. Individual sessions also have a standard maximum duration of 24 hours.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="vbrowser-not-available">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              How do I access sites that show a "not available" message in the VBrowser?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            Certain streaming providers block data center and cloud IP addresses. When encountering geo-restrictions or data center blocks, you can install a VPN or proxy extension inside the virtual browser session.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="audio-screensharing">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              How do I share audio when screensharing?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            To share system or media audio, use a Chromium-based browser (Google Chrome, Microsoft Edge, Brave) and select "Share tab audio" or "Share system audio" when prompted by your operating system.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="room-limit">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              Is there a limit to how many people can be in a room?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            CoWatch rooms have an authoritative maximum limit of 10 participants per room. This ceiling ensures sub-second playback synchronization, low-latency peer-to-peer WebRTC video/audio chat, and stable streaming performance for all attendees.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="cowatch-link">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              I own a website and I'd like to have a link that generates a CoWatch room with a specific video already set. How do I do this?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            You can link to <Anchor href={`${typeof window !== "undefined" ? window.location.origin : ""}/create?video=URL_HERE`} target="_blank" rel="noopener noreferrer" c="var(--color-violet)">{`${typeof window !== "undefined" ? window.location.origin : ""}/create?video=URL_HERE`}</Anchor> to do this!
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Container>
  );
};
