import React, { useContext, useEffect, useState } from "react";
import { Redirect, useLocation } from "react-router-dom";
import { MetadataContext } from "../../MetadataContext";
import { Loader, Center } from "@mantine/core";

export const RequireVerifiedEmail = ({ children }: { children: React.ReactNode }) => {
  const { user } = useContext(MetadataContext);
  const location = useLocation();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (user === undefined) {
      const timer = setTimeout(() => {
        setTimedOut(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [user]);

  if (user === undefined) {
    if (!timedOut) {
      return (
        <Center style={{ minHeight: "100vh", width: "100%" }}>
          <Loader color="violet" size="lg" />
        </Center>
      );
    }
    return <Redirect to="/login" />;
  }

  if (user === null) {
    return <Redirect to="/login" />;
  }

  if (user.email_confirmed_at == null) {
    return <Redirect to={`/verify-email?next=${encodeURIComponent(location.pathname)}`} />;
  }

  return <>{children}</>;
};
