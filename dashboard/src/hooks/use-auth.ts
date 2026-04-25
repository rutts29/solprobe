"use client";

import { useCallback, useEffect, useState } from "react";

const API_KEY_STORAGE = "solprobe-api-key";

/**
 * Local-dev auth: stores an API key in localStorage. No server validation —
 * any non-empty string is accepted. Intended for local-only use until a real
 * auth/session layer is built.
 */
export function useAuth() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(API_KEY_STORAGE) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating from localStorage after SSR, one-time
    setApiKey(stored);
    setLoaded(true);
  }, []);

  const signIn = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return false;
    localStorage.setItem(API_KEY_STORAGE, trimmed);
    setApiKey(trimmed);
    return true;
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(API_KEY_STORAGE);
    setApiKey(null);
  }, []);

  return { apiKey, loaded, isAuthenticated: !!apiKey, signIn, signOut };
}
