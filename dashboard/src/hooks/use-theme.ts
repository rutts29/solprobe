"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/** Standalone theme hook if you don't want to wrap with <ThemeProvider>. */
export function useTheme(defaultTheme: Theme = "dark") {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? (localStorage.getItem("solprobe-theme") as Theme | null) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrating theme from localStorage after SSR, one-time
    if (stored === "dark" || stored === "light") setThemeState(stored);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    if (typeof window !== "undefined") localStorage.setItem("solprobe-theme", t);
  };

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
