"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function getInitialTheme(defaultTheme: Theme): Theme {
  if (typeof window === "undefined") return defaultTheme;
  const stored = localStorage.getItem("solprobe-theme");
  return stored === "dark" || stored === "light" ? stored : defaultTheme;
}

/** Standalone theme hook if you don't want to wrap with <ThemeProvider>. */
export function useTheme(defaultTheme: Theme = "dark") {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme(defaultTheme));

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
