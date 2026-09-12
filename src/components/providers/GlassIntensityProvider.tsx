"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type GlassIntensity = "subtle" | "full";

const STORAGE_KEY = "glass-intensity";

function applyGlassIntensity(value: GlassIntensity) {
  document.documentElement.setAttribute("data-glass", value);
}

function readStoredGlassIntensity(): GlassIntensity {
  if (typeof window === "undefined") return "subtle";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "full" ? "full" : "subtle";
}

const GlassIntensityContext = createContext<{
  glassIntensity: GlassIntensity;
  setGlassIntensity: (value: GlassIntensity) => void;
} | null>(null);

export function GlassIntensityProvider({ children }: { children: ReactNode }) {
  const [glassIntensity, setGlassIntensityState] = useState<GlassIntensity>("subtle");

  // Instant no-flash application from localStorage on mount.
  useEffect(() => {
    const stored = readStoredGlassIntensity();
    setGlassIntensityState(stored);
    applyGlassIntensity(stored);
  }, []);

  const setGlassIntensity = useCallback((value: GlassIntensity) => {
    setGlassIntensityState(value);
    applyGlassIntensity(value);
    window.localStorage.setItem(STORAGE_KEY, value);
  }, []);

  return (
    <GlassIntensityContext.Provider value={{ glassIntensity, setGlassIntensity }}>
      {children}
    </GlassIntensityContext.Provider>
  );
}

export function useGlassIntensity() {
  const ctx = useContext(GlassIntensityContext);
  if (!ctx) throw new Error("useGlassIntensity must be used within GlassIntensityProvider");
  return ctx;
}
