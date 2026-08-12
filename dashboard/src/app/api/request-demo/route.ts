const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ROLES = new Set(["", "ML engineer", "Researcher", "AI infrastructure", "Other"]);

function text(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function declaredBodySize(request: Request) {
  const value = request.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return null;

  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : Number.POSITIVE_INFINITY;
}

function decodeChunks(chunks: Uint8Array[], byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readRequestBody(request: Request) {
  const contentLength = declaredBodySize(request);
  if (contentLength !== null && contentLength > MAX_REQUEST_BODY_BYTES) return { tooLarge: true };

  const reader = request.body?.getReader();
  if (!reader) return { body: null };

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {}
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { body: null };
  } finally {
    reader.releaseLock();
  }

  try {
    const body: unknown = JSON.parse(decodeChunks(chunks, byteLength));
    return isPlainObject(body) ? { body } : { body: null };
  } catch {
    return { body: null };
  }
}

export async function POST(request: Request) {
  const parsedRequest = await readRequestBody(request);
  if (parsedRequest.tooLarge) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }

  const { body } = parsedRequest;
  if (!body) return Response.json({ error: "Enter a valid email address." }, { status: 400 });

  if (body.botcheck === true || (typeof body.botcheck === "string" && body.botcheck.trim())) {
    return Response.json({ ok: true });
  }

  const email = text(body.email, 254).toLowerCase();
  const name = text(body.name, 120);
  const role = text(body.role, 80);
  const interest = text(body.interest, 1000);
  if (!EMAIL_PATTERN.test(email) || !ROLES.has(role)) {
    return Response.json({ error: "Enter a valid email address and role." }, { status: 400 });
  }

  const apiKey = text(process.env.RESEND_API_KEY, 500);
  const recipient = text(process.env.REQUEST_DEMO_TO_EMAIL, 254);
  const sender = text(process.env.REQUEST_DEMO_FROM_EMAIL, 320);
  if (!apiKey || !recipient || !sender) {
    return Response.json({ error: "Demo requests are not configured yet." }, { status: 503 });
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
      return Response.json({ error: "Unable to send your request right now. Please try again later." }, { status: 502 });
    }
  } catch {
    return Response.json({ error: "Unable to send your request right now. Please try again later." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
