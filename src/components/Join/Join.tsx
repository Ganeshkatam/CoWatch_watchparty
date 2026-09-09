import React, { useContext, useEffect, useMemo, useState } from "react";
import { useHistory, useParams, Link } from "react-router-dom";
import { Button, Text, TextInput } from "@mantine/core";
import {
  IconArrowRight,
  IconUsers,
  IconLink,
  IconAlertCircle,
} from "@tabler/icons-react";
import { MetadataContext } from "../../MetadataContext";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import styles from "./Join.module.css";

interface JoinRouteParams {
  roomId?: string;
}

const normalizeRoomId = (value: string) =>
  value.trim().replace(/^\/+|\/+$/g, "");

export const Join = () => {
  const history = useHistory();
  const { roomId: routeRoomId } = useParams<JoinRouteParams>();
  const { user } = useContext(MetadataContext);
  const [roomId, setRoomId] = useState(() =>
    normalizeRoomId(routeRoomId || "")
  );
  const [error, setError] = useState("");

  useDocumentMetadata({
    title: "Join a Watch Party",
    description:
      "Enter a CoWatch room code or invite link to join a watch party.",
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
      {/* Minimal Header */}
      <header className={styles.header}>
        <Link to="/" className={styles.brandLink}>
          <img
            src="/logo192.png"
            alt="CoWatch"
            className={styles.logo}
          />
          <span className={styles.brandName}>CoWatch</span>
        </Link>
        <div className={styles.headerActions}>
          <Link to="/faq" className={styles.headerLink}>
            Support
          </Link>
          <Button
            component={Link}
            to="/create"
            size="xs"
            variant="default"
            className={styles.headerBtn}
          >
            Create Room
          </Button>
        </div>
      </header>

      {/* Main Form Section */}
      <main className={styles.main}>
        <div className={styles.contentWrapper}>
          <div className={styles.iconWrap} aria-hidden="true">
            <IconUsers size={26} stroke={1.8} />
          </div>

          <h1 className={styles.title}>Join a Room</h1>
          <p className={styles.subtitle}>
            Enter your room code or paste an invite link to jump in.
          </p>

          <form onSubmit={handleJoin} className={styles.form} noValidate>
            <div className={styles.inputWrapper}>
              <TextInput
                label="Room Code or Invite Link"
                placeholder="Enter room code or invite link"
                value={roomId}
                onChange={(event) => {
                  setRoomId(event.currentTarget.value);
                  if (error) setError("");
                }}
                autoFocus={!routeRoomId}
                required
                maxLength={300}
                size="md"
                leftSection={<IconLink size={18} stroke={1.5} />}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "join-error-message" : undefined}
              />
              {error && (
                <div
                  id="join-error-message"
                  className={styles.inlineError}
                  role="alert"
                >
                  <IconAlertCircle size={15} stroke={1.8} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              fullWidth
              variant="gradient"
              gradient={{ from: "violet", to: "indigo", deg: 135 }}
              rightSection={<IconArrowRight size={18} />}
              disabled={!target || user === undefined}
              loading={user === undefined}
              className={styles.submitBtn}
            >
              {user === undefined ? "Joining..." : "Join Room"}
            </Button>
          </form>

          <p className={styles.legalText}>
            By joining, you agree to CoWatch's{" "}
            <Link to="/terms" className={styles.legalLink}>
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className={styles.legalLink}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className={styles.footer}>
        <span className={styles.copyright}>
          © {new Date().getFullYear()} CoWatch
        </span>
        <div className={styles.footerLinks}>
          <Link to="/privacy" className={styles.footerLink}>
            Privacy
          </Link>
          <Link to="/terms" className={styles.footerLink}>
            Terms
          </Link>
          <Link to="/faq" className={styles.footerLink}>
            Support
          </Link>
        </div>
      </footer>
    </div>
  );
};
