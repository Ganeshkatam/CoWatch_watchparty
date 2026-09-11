import React, { useState, useEffect } from "react";
import { Modal, Button, Text, Radio } from "@mantine/core";
import { IconCrown, IconDoorExit } from "@tabler/icons-react";
import styles from "./AssignHostModal.module.css";

interface AssignHostModalProps {
  opened: boolean;
  onClose: () => void;
  participants: { id: string; [key: string]: any }[];
  nameMap: Record<string, string>;
  pictureMap: Record<string, string>;
  currentClientId: string;
  onAssignAndLeave: (targetClientId: string) => void;
  onLeaveDirectly: () => void;
}

export const AssignHostModal: React.FC<AssignHostModalProps> = ({
  opened,
  onClose,
  participants,
  nameMap,
  pictureMap,
  currentClientId,
  onAssignAndLeave,
  onLeaveDirectly,
}) => {
  // Filter out the active host
  const candidates = participants.filter((p) => p.id !== currentClientId);
  const [selectedClientId, setSelectedClientId] = useState<string>("");

  // Select first available candidate whenever modal opens or candidates change
  useEffect(() => {
    if (opened) {
      if (candidates.length > 0) {
        setSelectedClientId((prev) => {
          const exists = candidates.some((c) => c.id === prev);
          return exists ? prev : candidates[0].id;
        });
      } else {
        setSelectedClientId("");
      }
    }
  }, [opened, participants, currentClientId]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      title="Leave Room"
      radius="md"
      size={460}
      className={styles.modalRoot}
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 4,
      }}
    >
      <Text className={styles.subtitle}>
        You are the host of this room. Choose a new host to manage the room before you exit, or leave directly.
      </Text>

      <div className={styles.participantList}>
        {candidates.length === 0 ? (
          <div className={styles.emptyState}>
            No other participants are currently in this room.
          </div>
        ) : (
          candidates.map((participant) => {
            const isSelected = selectedClientId === participant.id;
            const displayName = nameMap[participant.id] || participant.id;
            const photoUrl = pictureMap[participant.id];
            const initial = (displayName.charAt(0) || "U").toUpperCase();

            return (
              <div
                key={participant.id}
                className={`${styles.participantItem} ${
                  isSelected ? styles.participantItemSelected : ""
                }`}
                onClick={() => setSelectedClientId(participant.id)}
              >
                <div className={styles.participantInfo}>
                  {photoUrl ? (
                    <img
                      src={photoUrl}
                      alt={displayName}
                      className={styles.avatar}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className={styles.avatarFallback}>{initial}</div>
                  )}
                  <div className={styles.textGroup}>
                    <span className={styles.displayName} title={displayName}>
                      {displayName}
                    </span>
                    <span className={styles.clientIdHint}>
                      ID: {participant.id.slice(0, 10)}
                    </span>
                  </div>
                </div>

                <Radio
                  checked={isSelected}
                  onChange={() => setSelectedClientId(participant.id)}
                  color="violet"
                  size="sm"
                  aria-label={`Select ${displayName}`}
                />
              </div>
            );
          })
        )}
      </div>

      <div className={styles.actionRow}>
        <Button variant="subtle" color="gray" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {candidates.length === 0 && (
          <Button
            variant="light"
            color="red"
            size="sm"
            leftSection={<IconDoorExit size={15} />}
            onClick={onLeaveDirectly}
          >
            Leave
          </Button>
        )}
        <Button
          variant="filled"
          color="violet"
          size="sm"
          leftSection={<IconCrown size={15} />}
          disabled={!selectedClientId}
          onClick={() => {
            if (selectedClientId) {
              onAssignAndLeave(selectedClientId);
            }
          }}
        >
          Assign & Leave
        </Button>
      </div>
    </Modal>
  );
};
