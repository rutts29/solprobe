const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ROLES = new Set(["", "ML engineer", "Researcher", "AI infrastructure", "Other"]);
const config = {
  api: {
    bodyParser: {
      sizeLimit: "16kb",
    },
  },
};

function respond(response, status, body) {
  response.status(status).json(body);
}

function text(value, maxLength) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maxLength);
}

function contentLength(request) {
  const headers = request.headers;
  const value = typeof headers?.get === "function"
    ? headers.get("content-length")
    : headers?.["content-length"] ?? headers?.["Content-Length"];
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;

  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : Number.POSITIVE_INFINITY;
}

function serializedByteLength(body) {
  if (body === undefined) return 0;

  try {
    const serialized = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    return typeof serialized === "string" || Buffer.isBuffer(serialized)
      ? Buffer.byteLength(serialized, "utf8")
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function requestBody(request) {
  if (contentLength(request) > MAX_REQUEST_BODY_BYTES || serializedByteLength(request.body) > MAX_REQUEST_BODY_BYTES) {
    return { tooLarge: true };
  }

  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    try {
      return { body: JSON.parse(request.body.toString()) };
    } catch {
      return { body: null };
    }
  }

  return { body: request.body && typeof request.body === "object" ? request.body : null };
}

function createHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function requestDemo(request, response) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      respond(response, 405, { error: "Method not allowed." });
      return;
    }

    const parsedRequest = requestBody(request);
    if (parsedRequest.tooLarge) {
      respond(response, 413, { error: "Request is too large." });
      return;
    }

    const { body } = parsedRequest;
    if (!body) {
      respond(response, 400, { error: "Enter a valid email address." });
      return;
    }

    if (body.botcheck === true || (typeof body.botcheck === "string" && body.botcheck.trim())) {
      respond(response, 200, { ok: true });
      return;
    }

    const email = text(body.email, 254).toLowerCase();
    const name = text(body.name, 120);
    const role = text(body.role, 80);
    const interest = text(body.interest, 1000);
    if (!EMAIL_PATTERN.test(email) || !ROLES.has(role)) {
      respond(response, 400, { error: "Enter a valid email address and role." });
      return;
    }

    const apiKey = text(env.RESEND_API_KEY, 500);
    const recipient = text(env.REQUEST_DEMO_TO_EMAIL, 254);
    const sender = text(env.REQUEST_DEMO_FROM_EMAIL, 320);
    if (!apiKey || !recipient || !sender || typeof fetchImpl !== "function") {
      respond(response, 503, { error: "Demo requests are not configured yet." });
      return;
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
      const resendResponse = await fetchImpl("https://api.resend.com/emails", {
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
        respond(response, 502, { error: "Unable to send your request right now. Please try again later." });
        return;
      }
    } catch {
      respond(response, 502, { error: "Unable to send your request right now. Please try again later." });
      return;
    }

    respond(response, 200, { ok: true });
  };
}

module.exports = createHandler();
module.exports.config = config;
module.exports.createHandler = createHandler;
