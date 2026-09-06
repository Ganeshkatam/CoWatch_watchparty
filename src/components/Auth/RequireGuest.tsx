import React, { useContext } from "react";
import { Redirect } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { Loader } from "@mantine/core";

export const RequireGuest = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(MetadataContext);

  if (user === undefined) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '100px' }}>
        <Loader color="violet" />
      </div>
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
