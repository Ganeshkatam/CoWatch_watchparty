import React, { useContext } from "react";
import { Redirect, useLocation } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { Loader, Center } from "@mantine/core";

export const RequireVerifiedEmail = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(MetadataContext);
  const location = useLocation();

  if (user === undefined) {
    return (
      <Center style={{ minHeight: "100vh", width: "100%" }}>
        <Loader color="violet" size="lg" />
      </Center>
    );
  }

  if (user === null) {
    return <Redirect to="/login" />;
  }

  if (user.email_confirmed_at == null) {
    return <Redirect to={`/verify-email?next=${encodeURIComponent(location.pathname)}`} />;
  }

  return <>{children}</>;
};
