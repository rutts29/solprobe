// REPLACE: dashboard/src/app/layout.tsx
// Adds <ThemeProvider> wrapping <AppShell>. Default theme stays dark.

import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { WebSocketProvider } from "@/lib/websocket";
import { ThemeProvider } from "@/components/ui/theme-provider";

export const metadata: Metadata = {
  title: "SolProbe Dashboard",
  description: "Autonomous fault detection and recovery for distributed AI training",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className="dark" suppressHydrationWarning>
      <head>
        <Script src="/theme-init.js" strategy="beforeInteractive" />
      </head>
      <body className="antialiased">
        <ThemeProvider defaultTheme="dark">
          <WebSocketProvider>
            <AppShell>{children}</AppShell>
          </WebSocketProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
