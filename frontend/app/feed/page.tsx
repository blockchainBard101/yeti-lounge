"use client";

import React, { Suspense } from "react";
import MemeFeed from "@/components/MemeFeed";

export default function FeedPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="text-center py-10 text-xs text-text-secondary">Thawing feed...</div>}>
        <MemeFeed />
      </Suspense>
    </div>
  );
}
