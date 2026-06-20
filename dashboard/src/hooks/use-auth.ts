"use client";

import { useCallback, useEffect, useState } from "react";
import { API_KEY_STORAGE, AUTH_CHANGED_EVENT, clearStoredApiKey, setStoredApiKey } from "@/lib/auth";

/**
 * Stores the backend API key in localStorage and keeps same-tab hooks in sync.
 */
export function useAuth() {
  const [apiKey, setApiKey] = useState<string | null>(() => (
    typeof window !== "undefined" ? localStorage.getItem(API_KEY_STORAGE) : null
  ));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    function syncFromStorage() {
      const stored = typeof window !== "undefined" ? localStorage.getItem(API_KEY_STORAGE) : null;
      setApiKey(stored);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating auth state after SSR, one-time
    setLoaded(true);
    window.addEventListener(AUTH_CHANGED_EVENT, syncFromStorage);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, syncFromStorage);
  }, []);

  const signIn = useCallback((key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return false;
    setStoredApiKey(trimmed);
    setApiKey(trimmed);
    return true;
  }, []);

  const signOut = useCallback(() => {
    clearStoredApiKey();
    setApiKey(null);
  }, []);

  return { apiKey, loaded, isAuthenticated: !!apiKey, signIn, signOut };
}
