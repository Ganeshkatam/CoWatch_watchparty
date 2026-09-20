import React from "react";
import { Title, Text, Button } from "@mantine/core";
import { Link, useHistory, useLocation } from "react-router-dom";
import { IconHome, IconSearch, IconHelp, IconArrowLeft, IconInfoCircle } from "@tabler/icons-react";
import { useDocumentMetadata } from "../../utils/useDocumentMetadata";
import { parseNotFoundParams } from "../../utils/routeParams";
import styles from "./Pages.module.css";

export const NotFound: React.FC = () => {
  const location = useLocation();
  const history = useHistory();
  const { resource } = parseNotFoundParams(location.search);

  const isRoom = resource === "room";
  const title = isRoom ? "Room Not Found | CoWatch" : "Page or Room Not Found | CoWatch";
  const heading = isRoom ? "Room Not Found" : "Page or Room Not Found";
  const description = isRoom
    ? "We couldn't find the watch party room you were looking for. The link may be incorrect, or the room may have concluded and expired."
    : "We couldn't find the page you were looking for. The link may be incorrect or the page may have been moved.";

  useDocumentMetadata({
    title,
    description,
  });

  return (
    <div className={styles.notFoundContainer}>
      <div className={styles.notFoundCard}>
        <div className={styles.notFoundCode}>404</div>

        <h1 className={styles.notFoundTitle}>{heading}</h1>

        <p className={styles.notFoundDesc}>{description}</p>

        <div className={styles.notFoundActions}>
          <Button
            variant="default"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => history.goBack()}
          >
            Go Back
          </Button>
          <Button
            component={Link}
            to="/"
            leftSection={<IconHome size={16} />}
            style={{
              background: "linear-gradient(135deg, var(--color-violet), var(--color-pink))",
              color: "#ffffff",
            }}
          >
            Return Home
          </Button>
          <Button
            component={Link}
            to="/myrooms"
            variant="default"
            leftSection={<IconSearch size={16} />}
          >
            Browse My Rooms
          </Button>
          <Button
            component={Link}
            to="/support"
            variant="subtle"
            color="gray"
            leftSection={<IconHelp size={16} />}
          >
            Help & Support
          </Button>
          <Button
            component={Link}
            to="/about"
            variant="subtle"
            color="gray"
            leftSection={<IconInfoCircle size={16} />}
          >
            About CoWatch
          </Button>
        </div>
      </div>
    </div>
  );
};
