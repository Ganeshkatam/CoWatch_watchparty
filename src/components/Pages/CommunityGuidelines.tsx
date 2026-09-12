import React from "react";
import { Container, Paper, Title, Text, List, Button } from "@mantine/core";
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

export const CommunityGuidelines: React.FC = () => {
  useDocumentMetadata({
    title: "Community Guidelines | CoWatch",
    description: "Read the community standards and acceptable use guidelines for CoWatch rooms, chat, and live streaming.",
  });

  return (
    <Container style={containerStyle}>
      <BackButton />
      <Paper radius="md" style={paperStyle}>
        <Title order={1} mb="xl" style={{ color: "var(--color-violet)" }}>
          Community Guidelines
        </Title>

        <Text mb="lg" c="var(--text-secondary)" size="sm" style={{ lineHeight: 1.7 }}>
          CoWatch is dedicated to providing a safe, enjoyable, and collaborative space for watching
          media and connecting with friends. These guidelines apply to all interactions across rooms,
          voice/video streams, text chat, and shared virtual browsers.
        </Text>

        <Title order={2} size="h4" mb="sm">
          1. Respect &amp; Zero Tolerance for Harassment
        </Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            <strong>No Bullying or Harassment:</strong> Do not engage in targeted attacks, intimidation,
            stalking, or deliberate disruption of other participants.
          </List.Item>
          <List.Item>
            <strong>No Hate Speech:</strong> Content or language promoting hatred, violence, or discrimination
            based on race, ethnicity, nationality, religion, sexual orientation, gender identity, or disability
            is strictly prohibited.
          </List.Item>
          <List.Item>
            <strong>Respect Personal Privacy:</strong> Do not share personally identifiable information (doxxing),
            private contact details, or non-consensual images of any individual.
          </List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">
          2. Media Broadcasting &amp; Copyright Compliance
        </Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            <strong>Lawful Media Sharing:</strong> You may only stream or share media that you own, have
            licensed, or is publicly authorized for viewing.
          </List.Item>
          <List.Item>
            <strong>No Sexually Explicit or Exploitative Material:</strong> CoWatch strictly prohibits any
            sexually explicit broadcasts, pornography, or content depicting violence or abuse. Any material
            involving the exploitation of minors will result in immediate permanent termination and referral to law enforcement.
          </List.Item>
          <List.Item>
            <strong>Intellectual Property:</strong> Respect the copyrights and trademarks of content creators.
            Rooms found broadcasting pirated or unauthorized commercial streams are subject to termination upon notice.
          </List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">
          3. Responsible Virtual Browser &amp; Infrastructure Use
        </Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            <strong>Standard Interactive Use Only:</strong> Cloud virtual browsers are provisioned for
            interactive web browsing and media playback among room participants.
          </List.Item>
          <List.Item>
            <strong>Prohibited Activities:</strong> Do not use virtual browsers for cryptocurrency mining,
            denial-of-service (DoS) attacks, port scanning, malware distribution, or automated web scraping.
          </List.Item>
          <List.Item>
            <strong>No Bypass of Security Controls:</strong> Do not attempt to compromise virtual machine
            isolation, escalate privileges, or intercept traffic of other infrastructure resources.
          </List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">
          4. Room Host Responsibilities
        </Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            <strong>Host Authority:</strong> As a room creator or designated host, you have tools to maintain
            order, including room passcodes, participant locks, and kick/ban controls.
          </List.Item>
          <List.Item>
            <strong>Public Room Stewardship:</strong> If you operate a public room, you are expected to take
            reasonable action to moderate chat and remove disruptive or abusive attendees.
          </List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">
          5. Reporting &amp; Enforcement
        </Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            <strong>Reporting Violations:</strong> If you encounter harassment, hate speech, or prohibited
            content, use the in-room reporting options ("Report User" in the participant menu or "Report Room" in
            the room header) to submit a report for review.
          </List.Item>
          <List.Item>
            <strong>Progressive Sanctions:</strong> Violations may result in room removal, temporary access
            suspension, or permanent account termination depending on the severity and frequency of the infraction.
          </List.Item>
        </List>
      </Paper>
    </Container>
  );
};
