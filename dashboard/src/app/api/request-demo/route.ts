import { NextResponse } from "next/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["", "ML engineer", "Researcher", "AI infrastructure", "Other"]);

function text(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (body.botcheck === true || (typeof body.botcheck === "string" && body.botcheck.trim())) {
    return NextResponse.json({ ok: true });
  }

  const email = text(body.email, 254).toLowerCase();
  const name = text(body.name, 120);
  const role = text(body.role, 80);
  const interest = text(body.interest, 1000);
  if (!EMAIL_PATTERN.test(email) || !ROLES.has(role)) {
    return NextResponse.json({ error: "Enter a valid email address and role." }, { status: 400 });
  }

  const apiKey = text(process.env.RESEND_API_KEY, 500);
  const recipient = text(process.env.REQUEST_DEMO_TO_EMAIL, 254);
  const sender = text(process.env.REQUEST_DEMO_FROM_EMAIL, 320);
  if (!apiKey || !recipient || !sender) {
    return NextResponse.json({ error: "Demo requests are not configured yet." }, { status: 503 });
  }

  const message = [
    "SolProbe technical demo request",
    "",
    `Email: ${email}`,
    `Name: ${name || "Not provided"}`,
    `Role: ${role || "Not provided"}`,
    `Interest: ${interest || "Not provided"}`,
  ].join("\n");

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        reply_to: email,
        subject: "SolProbe technical demo request",
        text: message,
      }),
    });

    if (!resendResponse.ok) {
      return NextResponse.json({ error: "Unable to send your request right now. Please try again later." }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "Unable to send your request right now. Please try again later." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
