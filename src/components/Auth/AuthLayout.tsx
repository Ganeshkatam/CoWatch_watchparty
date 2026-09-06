import React from "react";
import { AuthTopBar } from "./AuthTopBar";
import { AuthShell } from "./AuthShell";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => {
  return (
    <>
      <AuthTopBar />
      <AuthShell>
        {children}
      </AuthShell>
    </>
  );
};
