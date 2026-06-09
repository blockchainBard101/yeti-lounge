"use client";

import React, { useEffect } from "react";
import { EnokiFlowProvider, useAuthCallback } from "@mysten/enoki/react";

interface EnokiWrapperProps {
  children: React.ReactNode;
}

// Subcomponent to automatically handle the auth callback when redirected back from Google
function AuthCallbackHandler() {
  const { handled, state } = useAuthCallback();

  useEffect(() => {
    if (handled) {
      console.log("Enoki zkLogin Authentication callback handled successfully.", state);
    }
  }, [handled, state]);

  return null;
}

export function EnokiWrapper({ children }: EnokiWrapperProps) {
  const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY || "enoki_public_key_placeholder";

  if (apiKey === "enoki_public_key_placeholder") {
    console.warn(
      "Enoki SDK Warning: Please set a valid NEXT_PUBLIC_ENOKI_API_KEY in your .env.local file to enable Google zkLogin."
    );
  }

  return (
    <EnokiFlowProvider apiKey={apiKey}>
      <AuthCallbackHandler />
      {children}
    </EnokiFlowProvider>
  );
}

export default EnokiWrapper;
