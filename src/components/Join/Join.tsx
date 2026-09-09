import React, { useContext, useEffect, useMemo, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { Alert, Button, Container, Paper, Text, TextInput, Title } from "@mantine/core";
import { IconArrowRight, IconUsers } from "@tabler/icons-react";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Join.module.css";

interface JoinRouteParams {
  roomId?: string;
}

const normalizeRoomId = (value: string) => value.trim().replace(/^\/+|\/+$/g, "");

export const Join = () => {
  const history = useHistory();
  const { roomId: routeRoomId } = useParams<JoinRouteParams>();
  const { user } = useContext(MetadataContext);
  const [roomId, setRoomId] = useState(() => normalizeRoomId(routeRoomId || ""));
  const [error, setError] = useState("");

  useDocumentMetadata({
    title: "Join a Watch Party",
    description: "Enter a CoWatch room code or invite link to join a watch party.",
  });

  useEffect(() => {
    setRoomId(normalizeRoomId(routeRoomId || ""));
    setError("");
  }, [routeRoomId]);

  const target = useMemo(() => {
    const normalized = normalizeRoomId(roomId);
    return normalized ? `/watch/${encodeURIComponent(normalized)}` : "";
  }, [roomId]);

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    const normalized = normalizeRoomId(roomId);
    if (!normalized) {
      setError("Enter a room code or room link to continue.");
      return;
    }

    if (normalized.length > 200) {
      setError("That room code is too long.");
      return;
    }

    const watchPath = `/watch/${encodeURIComponent(normalized)}`;

    if (user === undefined) {
      return;
    }

    if (!user) {
      history.push(`/login?redirect=${encodeURIComponent(watchPath)}`);
      return;
    }

    if (user.email_confirmed_at == null) {
      history.push(`/verify-email?next=${encodeURIComponent(watchPath)}`);
      return;
    }

    history.push(watchPath);
  };

  return (
    <div className={styles.page}>
      <Container size="sm" className={styles.container}>
        <Paper withBorder radius="xl" p={36} className={styles.card}>
          <div className={styles.iconWrap} aria-hidden="true">
            <IconUsers size={30} stroke={1.8} />
          </div>

          <Title order={1} ta="center" className={styles.title}>
            Join a watch party
          </Title>
          <Text ta="center" c="dimmed" className={styles.description}>
            Enter the room code from your invite, or paste the room link below.
          </Text>

          {error && (
            <Alert color="red" mb="md" title="Can't join yet">
              {error}
            </Alert>
          )}

          <form onSubmit={handleJoin} className={styles.form}>
            <TextInput
              label="Room code or link"
              placeholder="e.g. abc123 or https://.../watch/abc123"
              value={roomId}
              onChange={(event) => setRoomId(event.currentTarget.value)}
              autoFocus
              required
              maxLength={300}
              size="md"
            />

            <Button
              type="submit"
              size="lg"
              fullWidth
              rightSection={<IconArrowRight size={20} />}
              disabled={!target || user === undefined}
              loading={user === undefined}
            >
              Join room
            </Button>
          </form>

          <Text size="xs" c="dimmed" ta="center" mt="lg">
            You may be asked to sign in or verify your email before entering the room.
          </Text>
        </Paper>
      </Container>
    </div>
  );
};
