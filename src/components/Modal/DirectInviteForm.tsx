import React, { useState } from "react";
import { TextInput, Button, Text } from "@mantine/core";
import { IconAt, IconSend, IconCheck, IconAlertCircle } from "@tabler/icons-react";
import { serverPath } from "../../utils/utils";
import { getAccessToken } from "../../utils/supabaseClient";
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
    const targetUsername = username.trim();
    if (!targetUsername || isSubmitting) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setFeedback({
          type: "error",
          message: "Please sign in to send invitations.",
        });
        return;
      }

      const response = await fetch(`${serverPath}/api/notifications/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roomId: cleanRoomId,
          targetUsername,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        let msg = data?.error || "Failed to send invitation";
        if (response.status === 403) {
          msg = "Only the room host or owner can send invitations.";
        } else if (response.status === 429) {
          msg = "Invitation rate limit reached. Please wait a moment.";
        } else if (response.status === 404) {
          msg = "Room not found.";
        }
        setFeedback({ type: "error", message: msg });
        return;
      }

      setFeedback({
        type: "success",
        message: data?.message || "Invitation sent successfully!",
      });
      setUsername("");
      if (onSuccess) {
        onSuccess(targetUsername);
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Network error sending invitation. Please try again.",
      });
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
          onClick={() => handleSendInvite()}
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
