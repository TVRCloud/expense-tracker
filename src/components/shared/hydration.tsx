"use client";

import { useEffect } from "react";

// Whether the first client render (hydration of the server HTML) is done.
// Entrance animations read it at render time: content that is already in
// the server HTML must not start invisible (it would stay hidden until the
// JS loads, then fade in — a slower first paint for no reason), while
// content that mounts later (client navigation, data arriving) still
// animates in. Server render and hydration both see `false`, so there is
// no hydration mismatch.
let hydrated = false;

export function hasHydrated() {
  return hydrated;
}

/** Mount once near the root. */
export function HydrationMarker() {
  useEffect(() => {
    hydrated = true;
  }, []);
  return null;
}
