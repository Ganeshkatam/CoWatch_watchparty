import React, { useState, useEffect } from "react";
import { Modal, Tooltip, ActionIcon } from "@mantine/core";
import {
  IconCheck,
  IconCopy,
  IconUsers,
  IconLock,
} from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";
import { apiFetch } from "../../utils/utils";
import { supabase } from "../../utils/supabaseClient";
import { QRShare } from "./QRShare";
import { DirectInviteForm } from "./DirectInviteForm";
import { ShareActions } from "./ShareActions";
import styles from "./InviteModal.module.css";

interface RoomDetailsResponse {
  currentPasscode?: string | null;
  roomTitle?: string | null;
}

interface CreateInvitationResponse {
  invitationUrl?: string;
  token?: string;
  invitationId?: string;
}

interface InviteModalProps {
  roomId?: string;
  passcode?: string;
  closeInviteModal: () => void;
  isHost?: boolean;
  isOwner?: boolean;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  roomId,
  passcode: propPasscode,
  closeInviteModal,
  isHost,
  isOwner,
}) => {
  const canManageCredentials = Boolean(isHost || isOwner);
  const [passcodeCopied, setPasscodeCopied] = useState(false);
  const [fetchedPasscode, setFetchedPasscode] = useState<string>("");
  const [roomTitle, setRoomTitle] = useState<string>("");
  const [inviterName, setInviterName] = useState<string>("");
  const [invitationUrl, setInvitationUrl] = useState<string>("");

  const pathParts = window.location.pathname.split("/");
  const roomIdOrVanity = roomId || pathParts[pathParts.length - 1] || "";
  const cleanId = roomIdOrVanity.replace(/[^a-zA-Z0-9_-]/g, "");

  // Non-hosts are strictly forbidden from inviting users
  if (!canManageCredentials) {
    return null;
  }

  useEffect(() => {
    let isCancelled = false;
    if (canManageCredentials && cleanId) {
      (async () => {
        try {
          const { data } = await supabase.auth.getUser();
          const user = data.user;
          if (user && !isCancelled) {
            setInviterName(
              user.user_metadata?.full_name ||
              user.user_metadata?.name ||
              user.email?.split("@")[0] ||
              "The Host"
            );
          }

          if (user) {
            // 1. Fetch room details
            const freshData = await apiFetch<RoomDetailsResponse>(
              `/roomDetails?roomId=${encodeURIComponent(cleanId)}`,
              { requireAuth: true }
            );
            if (!isCancelled && freshData) {
              if (freshData?.currentPasscode && !propPasscode) {
                setFetchedPasscode(freshData.currentPasscode.trim());
              }
              if (freshData?.roomTitle) {
                setRoomTitle(freshData.roomTitle.trim());
              }
            }

            // 2. Generate or fetch reusable room invitation token
            const inviteData = await apiFetch<CreateInvitationResponse>(`/api/invitations`, {
              method: "POST",
              requireAuth: true,
              body: {
                roomId: cleanId,
                isReusable: true,
              },
            });

            if (!isCancelled && inviteData?.invitationUrl) {
              setInvitationUrl(inviteData.invitationUrl);
            }
          }
        } catch {
          // Silent fallback
        }
      })();
    }
    return () => {
      isCancelled = true;
    };
  }, [canManageCredentials, propPasscode, cleanId]);

  const resolvedPasscode = canManageCredentials
    ? (propPasscode ? propPasscode.trim() : fetchedPasscode.trim())
    : "";

  const effectiveInvitationUrl = invitationUrl || `${window.location.origin}/join/${cleanId}`;

  const handleCopyPasscode = () => {
    if (!resolvedPasscode) return;
    navigator.clipboard.writeText(resolvedPasscode);
    setPasscodeCopied(true);
    setTimeout(() => setPasscodeCopied(false), 2000);
  };

  return (
    <Modal
      opened
      centered
      onClose={closeInviteModal}
      className={styles.modalRoot}
      size={MODAL_SIZES.md}
      title={
        <div className={styles.modalHeader}>
          <div className={styles.headerIconBadge}>
            <IconUsers size={22} />
          </div>
          <div className={styles.headerMeta}>
            <span className={styles.headerTitle}>Invite Friends</span>
            <span className={styles.headerSubtitle}>
              Invite participants to your watch party via QR code, username, or apps
            </span>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        {canManageCredentials && !propPasscode && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Room Passcode: Required to join this room.
            </span>
          </div>
        )}

        {/* 1. QR Code Section: Encodes the opaque invitation token URL */}
        <QRShare roomId={cleanId} invitationUrl={effectiveInvitationUrl} />

        {/* 2. Direct Username Invitation: Creates targeted room_invitations and sends notification */}
        <DirectInviteForm roomId={cleanId} />

        {/* 3. Share to External Apps: Canonical human-readable invitation message with URL and fallback credentials */}
        <ShareActions
          roomId={cleanId}
          roomTitle={roomTitle || cleanId}
          passcode={resolvedPasscode}
          invitationUrl={effectiveInvitationUrl}
          inviterName={inviterName}
        />

        {/* Passcode Card - Strictly restricted to host or room owner */}
        {canManageCredentials && (
          <div className={styles.credentialsGrid}>
            <div
              className={styles.credentialCard}
              onClick={resolvedPasscode ? handleCopyPasscode : undefined}
              title={resolvedPasscode ? "Click to copy Passcode" : "No passcode required"}
              style={{ cursor: resolvedPasscode ? "pointer" : "default" }}
            >
              <div className={styles.credentialHeader}>
                <span className={styles.credentialTitle}>
                  <IconLock size={13} />
                  Room Passcode (Required to join this room)
                </span>
                {resolvedPasscode ? (
                  <Tooltip label={passcodeCopied ? "Copied!" : "Copy Passcode"} withArrow position="top">
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color={passcodeCopied ? "teal" : "gray"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPasscode();
                      }}
                      title="Copy Passcode"
                    >
                      {passcodeCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Open</span>
                )}
              </div>
              <div className={styles.credentialValue}>
                <span>{resolvedPasscode || "None (Open)"}</span>
                {resolvedPasscode && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: passcodeCopied ? "#10b981" : "var(--text-muted)", transition: "color 0.2s" }}>
                    {passcodeCopied ? "Copied!" : "Copy"}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
