import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { WebSocketProvider } from "@/lib/websocket";

export const metadata: Metadata = {
  title: "SolProbe Dashboard",
  description: "Autonomous fault detection and recovery for distributed AI training",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <WebSocketProvider>
          <AppShell>{children}</AppShell>
        </WebSocketProvider>
      </body>
    </html>
  );
}
