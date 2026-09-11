import React, { useContext } from "react";
import { Redirect, useLocation } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";

export const RequireGuest = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(MetadataContext);
  const location = useLocation();

  // Always allow viewing /signup, /forgot-password, or /reset-password directly without blocking or redirecting
  if (location.pathname.startsWith("/signup")) {
    return <>{children}</>;
  }

  // Only redirect away from /login if user is already confirmed and logged in
  if (user && user.email_confirmed_at != null) {
    const params = new URLSearchParams(location.search);
    let redirect = params.get("redirect") || params.get("next") || "/myrooms";
    if (
      redirect.startsWith("/login") ||
      redirect.startsWith("/signup") ||
      redirect.startsWith("/forgot-password") ||
      redirect.startsWith("/reset-password") ||
      redirect.startsWith("/verify-email")
    ) {
      redirect = "/myrooms";
    }
    return <Redirect to={redirect.startsWith("/") ? redirect : `/${redirect}`} />;
  }

  // Otherwise, allow immediate access to guest routes without blocking
  return <>{children}</>;
};
