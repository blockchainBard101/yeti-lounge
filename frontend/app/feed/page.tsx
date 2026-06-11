"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FeedPageRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <div className="text-center py-10 text-xs text-text-secondary">
      Redirecting to lounge feed...
    </div>
  );
}
