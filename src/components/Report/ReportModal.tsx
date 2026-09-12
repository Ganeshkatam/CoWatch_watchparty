import React, { useState, useEffect } from "react";
import { Modal, Select, Textarea, Button, Text, Stack, Alert } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconAlertCircle, IconCheck } from "@tabler/icons-react";
import {
  submitAbuseReport,
  type AbuseReportCategory,
} from "../../utils/abuseReportClient";
import { MODAL_SIZES } from "../../utils/designSystem";

export interface ReportModalProps {
  opened: boolean;
  onClose: () => void;
  targetUserId?: string | null;
  targetUsername?: string | null;
  targetRoomId?: string | null;
  context?: Record<string, any>;
}

const CATEGORY_OPTIONS: { value: AbuseReportCategory; label: string }[] = [
  { value: "harassment", label: "Harassment or Bullying" },
  { value: "hate_speech", label: "Hate Speech or Discrimination" },
  { value: "inappropriate_content", label: "Inappropriate or Explicit Media" },
  { value: "spam", label: "Spam or Deliberate Disruption" },
  { value: "copyright", label: "Copyright or IP Infringement" },
  { value: "other", label: "Other Policy Violation" },
];

export const ReportModal: React.FC<ReportModalProps> = ({
  opened,
  onClose,
  targetUserId,
  targetUsername,
  targetRoomId,
  context,
}) => {
  const [category, setCategory] = useState<AbuseReportCategory>("harassment");
  const [reason, setReason] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setCategory("harassment");
      setReason("");
      setSubmitting(false);
      setErrorMessage(null);
    }
  }, [opened]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 5) {
      setErrorMessage("Please enter at least 5 characters explaining the issue.");
      return;
    }

    setSubmitting(true);

    const result = await submitAbuseReport({
      category,
      reason: trimmedReason,
      targetUserId,
      targetRoomId,
      context,
    });

    setSubmitting(false);

    if (result.success) {
      notifications.show({
        title: "Report Submitted",
        message: "Thank you for helping keep CoWatch safe. Our moderation team will review this report.",
        color: "teal",
        icon: <IconCheck size={18} />,
        autoClose: 5000,
      });
      onClose();
    } else {
      setErrorMessage(result.error || "Failed to submit abuse report.");
      notifications.show({
        title: "Report Failed",
        message: result.error || "Failed to submit report. Please try again.",
        color: "red",
        icon: <IconAlertCircle size={18} />,
      });
    }
  };

  const modalTitle = targetUsername
    ? `Report User: ${targetUsername}`
    : targetRoomId
    ? `Report Room: ${targetRoomId}`
    : "Report Violation";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 600 }}>
          <IconAlertTriangle size={20} color="var(--color-danger, #ef4444)" />
          <span>{modalTitle}</span>
        </div>
      }
      centered
      size={MODAL_SIZES.md}
      radius="md"
    >
      <form onSubmit={handleSubmit}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Submit a confidential report to CoWatch Trust &amp; Safety. Reports are reviewed by human moderators
            according to our Community Guidelines.
          </Text>

          {errorMessage && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="Submission Error"
              color="red"
              variant="light"
            >
              {errorMessage}
            </Alert>
          )}

          <Select
            label="Violation Category"
            description="Select the primary reason for this report"
            value={category}
            onChange={(val) => val && setCategory(val as AbuseReportCategory)}
            data={CATEGORY_OPTIONS}
            required
            allowDeselect={false}
          />

          <Textarea
            label="Explanation &amp; Evidence"
            description="Describe the specific behavior, timestamp, or content violating community standards (5-1000 characters)"
            placeholder="Provide context regarding the incident..."
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            minRows={4}
            maxRows={8}
            maxLength={1000}
            required
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <Button variant="default" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              color="red"
              loading={submitting}
              disabled={reason.trim().length < 5}
            >
              Submit Report
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
};
