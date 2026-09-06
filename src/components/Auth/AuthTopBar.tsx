import React from "react";
import { Link } from "react-router-dom";
import { Button, Group } from "@mantine/core";

export const AuthTopBar: React.FC = () => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 24px",
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: "var(--bg-app)",
        height: "72px",
      }}
    >
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <div
          style={{
            textTransform: "uppercase",
            fontWeight: 800,
            fontSize: "20px",
            background: "linear-gradient(135deg, var(--color-teal), var(--color-blue))",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            letterSpacing: 1.5,
          }}
        >
          CoWatch
        </div>
      </Link>

      <Button
        component={Link}
        to="/"
        variant="subtle"
        color="violet"
        style={{ fontSize: "14px" }}
      >
        ← Back to home
      </Button>
    </div>
  );
};
