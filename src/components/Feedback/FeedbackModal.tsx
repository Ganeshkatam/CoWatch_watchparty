import React from "react";
import { Modal, Loader } from "@mantine/core";
import {
  IconStar,
  IconStarFilled,
  IconMessageDots,
  IconCheck,
  IconAlertCircle,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  createSafeFeedbackContext,
  type FeedbackType,
  type FeedbackContext,
  type UserMessage,
} from "../../utils/userMessages";
import { submitUserFeedback } from "../../utils/feedbackClient";
import { MODAL_SIZES } from "../../utils/designSystem";
import styles from "./FeedbackModal.module.css";

interface FeedbackModalProps {
  opened: boolean;
  onClose: () => void;
  initialType?: FeedbackType;
  initialContext?: FeedbackContext;
  initialTrigger?: string;
}

const FEEDBACK_TYPES: { type: FeedbackType; label: string }[] = [
  { type: "problem", label: "Problem" },
  { type: "bug", label: "Bug" },
  { type: "suggestion", label: "Suggestion" },
  { type: "experience", label: "Experience" },
];

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  opened,
  onClose,
  initialType,
  initialContext,
  initialTrigger,
}) => {
  const safeConfig = React.useMemo(
    () =>
      createSafeFeedbackContext({
        type: initialType,
        context: initialContext,
        trigger: initialTrigger,
      }),
    [initialType, initialContext, initialTrigger]
  );

  const [type, setType] = React.useState<FeedbackType>(safeConfig.type);
  const [rating, setRating] = React.useState<number | null>(null);
  const [message, setMessage] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [statusMessage, setStatusMessage] = React.useState<UserMessage | null>(null);

  React.useEffect(() => {
    if (opened) {
      setType(safeConfig.type);
      setRating(null);
      setMessage("");
      setStatusMessage(null);
      setSubmitting(false);
    }
  }, [opened, safeConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || submitting) return;

    setSubmitting(true);
    setStatusMessage(null);

    const result = await submitUserFeedback({
      type,
      context: safeConfig.context,
      rating,
      message,
    });

    setSubmitting(false);
    setStatusMessage(result.userMessage);

    if (result.success) {
      setTimeout(() => {
        onClose();
      }, 1800);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size={MODAL_SIZES.md}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <IconMessageDots size={18} color="var(--color-violet)" />
          <span>Send Feedback</span>
        </div>
      }
      centered
      radius="md"
      overlayProps={{
        backgroundOpacity: 0.6,
        blur: 4,
      }}
    >
      <form onSubmit={handleSubmit} className={styles.modalContent}>
        {safeConfig.context !== "room" && (
          <div className={styles.contextBanner}>
            <IconInfoCircle size={15} />
            <span>
              Reporting for topic: <span className={styles.contextTag}>{safeConfig.context}</span>
            </span>
          </div>
        )}

        <div>
          <div className={styles.sectionLabel}>Feedback Type</div>
          <div className={styles.typeGrid}>
            {FEEDBACK_TYPES.map((item) => (
              <button
                key={item.type}
                type="button"
                className={`${styles.typeBtn} ${type === item.type ? styles.typeBtnActive : ""}`}
                onClick={() => setType(item.type)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className={styles.sectionLabel}>How was your experience? (Optional)</div>
          <div className={styles.ratingContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`${styles.starBtn} ${rating && rating >= star ? styles.starActive : ""}`}
                onClick={() => setRating(rating === star ? null : star)}
                title={`${star} star${star > 1 ? "s" : ""}`}
                aria-label={`Rate ${star} out of 5 stars`}
              >
                {rating && rating >= star ? (
                  <IconStarFilled size={22} color="#F59E0B" />
                ) : (
                  <IconStar size={22} />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.textareaContainer}>
          <label htmlFor="feedback-message-input" className={styles.sectionLabel}>
            Message
          </label>
          <textarea
            id="feedback-message-input"
            className={styles.textarea}
            placeholder="Tell us what happened or what can be improved..."
            value={message}
            maxLength={2000}
            onChange={(e) => setMessage(e.target.value)}
            disabled={submitting}
            required
          />
          <div className={styles.charCount}>{message.length} / 2000</div>
        </div>

        {statusMessage && (
          <div
            className={`${styles.messageBanner} ${
              statusMessage.severity === "success"
                ? styles.messageSuccess
                : statusMessage.severity === "warning"
                ? styles.messageWarning
                : styles.messageError
            }`}
            role="status"
          >
            {statusMessage.severity === "success" ? (
              <IconCheck size={16} />
            ) : (
              <IconAlertCircle size={16} />
            )}
            <span>{statusMessage.message}</span>
          </div>
        )}

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting || !message.trim()}
          >
            {submitting && <Loader size={14} color="white" />}
            <span>Submit Feedback</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
