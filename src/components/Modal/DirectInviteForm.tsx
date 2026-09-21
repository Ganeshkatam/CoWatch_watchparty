import React, { useState } from "react";
import { TextInput, Button, Text } from "@mantine/core";
import { IconAt, IconSend, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import { apiFetch } from "../../utils/utils";
import styles from "./DirectInviteForm.module.css";

interface DirectInviteFormProps {
  roomId: string;
  onSuccess?: (targetUsername: string) => void;
}

export const DirectInviteForm: React.FC<DirectInviteFormProps> = ({
  roomId,
  onSuccess,
}) => {
  const [username, setUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const cleanRoomId = roomId.replace(/^\//, "").trim();

  const handleSendInvite = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetUsername = username.replace(/^@/, "").trim();

    if (!targetUsername) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      await apiFetch("/api/notifications/invite", {
        method: "POST",
        requireAuth: true,
        body: {
          roomId: cleanRoomId,
          targetUsername,
        },
      });

      setFeedback({
        type: "success",
        message: `Invitation successfully sent to @${targetUsername}!`,
      });
      setUsername("");
      if (onSuccess) {
        onSuccess(targetUsername);
      }
    } catch (err: any) {
      let msg = err.message || "Failed to send invitation";
      if (err.status === 403) {
        msg = "Only the room host or owner can send invitations.";
      } else if (err.status === 429) {
        msg = "Invitation rate limit reached. Please wait a moment.";
      } else if (err.status === 404) {
        msg = "Room not found.";
      }
      setFeedback({ type: "error", message: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>
          <IconAt size={14} />
          Invite by CoWatch Username
        </span>
      </div>

      <form onSubmit={handleSendInvite} className={styles.formRow}>
        <div className={styles.inputWrapper}>
          <TextInput
            placeholder="Enter username (e.g. alex)"
            value={username}
            onChange={(e) => {
              setUsername(e.currentTarget.value);
              if (feedback) setFeedback(null);
            }}
            disabled={isSubmitting}
            size="sm"
            leftSection={<IconAt size={14} />}
            aria-label="Target CoWatch username"
          />
        </div>

        <Button
          type="submit"
          loading={isSubmitting}
          disabled={!username.trim()}
          variant="gradient"
          gradient={{ from: "violet", to: "indigo", deg: 135 }}
          className={styles.sendButton}
          size="sm"
          leftSection={<IconSend size={14} />}
        >
          Send Invite
        </Button>
      </form>

      {feedback && (
        <div className={styles.statusMessage}>
          {feedback.type === "success" ? (
            <Text size="xs" className={styles.successText}>
              <IconCheck size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              {feedback.message}
            </Text>
          ) : (
            <Text size="xs" className={styles.errorText}>
              <IconAlertCircle size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              {feedback.message}
            </Text>
          )}
        </div>
      )}
    </div>
  );
};
