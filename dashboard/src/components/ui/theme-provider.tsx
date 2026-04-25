"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(defaultTheme: Theme): Theme {
  if (typeof window === "undefined") return defaultTheme;

  const stored = localStorage.getItem("solprobe-theme");
  if (stored === "dark" || stored === "light") return stored;

  const current = document.documentElement.getAttribute("data-theme");
  return current === "light" || current === "dark" ? current : defaultTheme;
}

export function ThemeProvider({ children, defaultTheme = "dark" }: { children: ReactNode; defaultTheme?: Theme }) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme(defaultTheme));

  // Apply to <html> as data-theme — globals.css keys off this attribute
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof window !== "undefined") localStorage.setItem("solprobe-theme", t);
  }, []);

  return (
    <ThemeContext value={{ theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") }}>
      {children}
    </ThemeContext>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
