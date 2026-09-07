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
        backgroundColor: "rgba(10, 13, 20, 0.75)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        height: "72px",
        position: "relative",
        zIndex: 10,
      }}
    >
      <Link to="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
        <img
          className="cowatch-brand-logo"
          style={{ width: "32px", height: "32px", marginRight: "10px", objectFit: "contain" }}
          src="/logo192.png"
          alt="CoWatch"
        />
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
