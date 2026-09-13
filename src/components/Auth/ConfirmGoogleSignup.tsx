import React from "react";
import { Redirect } from "react-router-dom";

/**
 * Legacy Google Confirmation Route Handler
 * Converted to a clean redirect to /login in alignment with Model A
 * (Pure Supabase-Native authentication where Supabase Auth owns all
 * verification lifecycles and no secondary application token layer exists).
 */
export const ConfirmGoogleSignup = () => {
  return <Redirect to="/login" />;
};

