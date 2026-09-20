import React from "react";
import { List, Button, Text } from "@mantine/core";
import { useHistory } from "react-router-dom";
import { IconArrowLeft } from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Pages.module.css";

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
    <div className={styles.pageContainer}>
      <BackButton />
      <div className={styles.contentCard}>
        <h1 className={styles.pageTitle}>Community Guidelines</h1>

        <Text mb="lg" c="var(--text-secondary)" size="sm" style={{ lineHeight: 1.7 }}>
          CoWatch is dedicated to providing a safe, enjoyable, and collaborative space for watching
          media and connecting with friends. These guidelines apply to all interactions across rooms,
          voice/video streams, text chat, and shared virtual browsers.
        </Text>

        <h2 className={styles.sectionTitle}>
          1. Respect &amp; Zero Tolerance for Harassment
        </h2>
        <List className={styles.list} spacing="sm">
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

        <h2 className={styles.sectionTitle}>
          2. Media Broadcasting &amp; Copyright Compliance
        </h2>
        <List className={styles.list} spacing="sm">
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

        <h2 className={styles.sectionTitle}>
          3. Responsible Virtual Browser &amp; Infrastructure Use
        </h2>
        <List className={styles.list} spacing="sm">
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

        <h2 className={styles.sectionTitle}>
          4. Room Host Responsibilities
        </h2>
        <List className={styles.list} spacing="sm">
          <List.Item>
            <strong>Host Authority:</strong> As a room creator or designated host, you have tools to maintain
            order, including room passcodes, participant locks, and kick/ban controls.
          </List.Item>
          <List.Item>
            <strong>Public Room Stewardship:</strong> If you operate a public room, you are expected to take
            reasonable action to moderate chat and remove disruptive or abusive attendees.
          </List.Item>
        </List>

        <h2 className={styles.sectionTitle}>
          5. Reporting &amp; Enforcement
        </h2>
        <List className={styles.list} spacing="sm">
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
      </div>
    </div>
  );
};
