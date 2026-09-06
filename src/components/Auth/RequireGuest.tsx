import React, { useContext, useEffect, useState } from "react";
import { Redirect } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { Loader, Center } from "@mantine/core";

export const RequireGuest = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(MetadataContext);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (user === undefined) {
      const timer = setTimeout(() => {
        setTimedOut(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [user]);

  if (user === undefined && !timedOut) {
    return (
      <Center style={{ minHeight: "100vh", width: "100%" }}>
        <Loader color="violet" size="lg" />
      </Center>
    );
  }

  if (user === null || timedOut) {
    return <>{children}</>;
  }

  // Password-reset flows or other unconfirmed states
  if (user && user.email_confirmed_at == null) {
    return <Redirect to="/verify-email" />;
  }

  return <Redirect to="/rooms" />;
};
