import React, { useContext } from "react";
import { Redirect } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { Loader, Center } from "@mantine/core";

export const RequireGuest = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(MetadataContext);

  if (user === undefined) {
    return (
      <Center style={{ minHeight: "100vh", width: "100%" }}>
        <Loader color="violet" size="lg" />
      </Center>
    );
  }

  if (user === null) {
    return <>{children}</>;
  }

  // Password-reset flows or other unconfirmed states
  if (user && user.email_confirmed_at == null) {
    return <Redirect to="/verify-email" />;
  }

  return <Redirect to="/rooms" />;
};
