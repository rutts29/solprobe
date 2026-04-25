// The root URL "/" is rewritten to /landing.html (see next.config.ts
// beforeFiles). This React page is a safety net: if the rewrite ever breaks,
// users get bounced to /overview, where AppShell's auth gate sends them
// back to "/" — which the rewrite then serves as the static landing HTML.

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/overview");
}
