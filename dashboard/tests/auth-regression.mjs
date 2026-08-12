import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { createHandler } = require("../../landing/api/request-demo.js");
const landing = await readFile(new URL("../public/landing.html", import.meta.url), "utf8");
const sourceLanding = await readFile(new URL("../../landing/index.html", import.meta.url), "utf8");
const websocket = await readFile(new URL("../src/lib/websocket.tsx", import.meta.url), "utf8");

function responseRecorder() {
  return {
    body: undefined,
    headers: {},
    statusCode: undefined,
    json(body) {
      this.body = body;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
  };
}

test("public landing stays request-demo only", () => {
  assert.doesNotMatch(landing, /solprobe-demo-key/);
  assert.doesNotMatch(landing, /localStorage\.setItem\('solprobe-api-key'/);
  assert.doesNotMatch(landing, /data-dashboard/);
  assert.doesNotMatch(landing, /github\.com\/rutts29\/solprobe/);
  assert.doesNotMatch(landing, /View code/);
  assert.match(landing, /href="#how" class="btn btn-ghost">Explore architecture</);
  assert.match(landing, />Request technical demo(?: →)?</);
});

test("landing describes the portfolio scope and server-side request delivery", () => {
  assert.match(landing, /About the project/);
  assert.match(landing, /not continuously hosted/);
  assert.match(landing, /id="technical-demo-form"/);
  assert.match(landing, /type="email" name="email"[^>]*required/);
  assert.match(landing, /name="botcheck"/);
  assert.match(landing, /fetch\('\/api\/request-demo'/);
  assert.match(landing, /Delivery is handled server-side/);
  assert.doesNotMatch(landing, /web3forms/i);
  assert.doesNotMatch(landing, /mailto:/i);
  assert.doesNotMatch(landing, /console\./);
});

test("request-demo form posts entered details to the same-origin endpoint", async () => {
  const script = landing.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);

  let submit;
  let request;
  const fields = {
    email: "reviewer@example.com",
    name: "Reviewer",
    role: "ML engineer",
    interest: "Telemetry",
    botcheck: null,
  };
  const button = { disabled: false, textContent: "Request technical demo" };
  const form = {
    addEventListener(type, listener) {
      if (type === "submit") submit = listener;
    },
    querySelector(selector) {
      return selector === ".form-submit" ? button : null;
    },
    resetCalled: false,
    reset() {
      this.resetCalled = true;
    },
  };
  const status = { dataset: {}, hidden: true, textContent: "" };
  class TestFormData {
    get(name) {
      return fields[name] ?? null;
    }
  }

  runInNewContext(script, {
    document: {
      getElementById(id) {
        return {
          "technical-demo-form": form,
          "technical-demo-status": status,
        }[id] ?? null;
      },
    },
    FormData: TestFormData,
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });

  await submit({ preventDefault() {} });

  assert.equal(request.url, "/api/request-demo");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), {
    email: "reviewer@example.com",
    name: "Reviewer",
    role: "ML engineer",
    interest: "Telemetry",
    botcheck: false,
  });
  assert.equal(status.dataset.state, "success");
  assert.equal(form.resetCalled, true);
});

test("request-demo endpoint sends validated details through Resend", async () => {
  let outbound;
  const handler = createHandler({
    env: {
      RESEND_API_KEY: "test-key",
      REQUEST_DEMO_TO_EMAIL: "owner@example.com",
      REQUEST_DEMO_FROM_EMAIL: "SolProbe <demo@example.com>",
    },
    fetchImpl: async (url, options) => {
      outbound = { url, options };
      return { ok: true };
    },
  });
  const response = responseRecorder();

  await handler({
    method: "POST",
    body: {
      email: "reviewer@example.com",
      name: "Reviewer",
      role: "ML engineer",
      interest: "Telemetry",
      botcheck: false,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true });
  assert.equal(outbound.url, "https://api.resend.com/emails");
  assert.equal(outbound.options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(outbound.options.body), {
    from: "SolProbe <demo@example.com>",
    to: ["owner@example.com"],
    reply_to: "reviewer@example.com",
    subject: "SolProbe technical demo request",
    text: "SolProbe technical demo request\n\nEmail: reviewer@example.com\nName: Reviewer\nRole: ML engineer\nInterest: Telemetry",
  });
});

test("request-demo endpoint rejects invalid input, ignores honeypots, and protects configuration", async () => {
  let calls = 0;
  const configured = createHandler({
    env: {
      RESEND_API_KEY: "test-key",
      REQUEST_DEMO_TO_EMAIL: "owner@example.com",
      REQUEST_DEMO_FROM_EMAIL: "SolProbe <demo@example.com>",
    },
    fetchImpl: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  const invalid = responseRecorder();
  await configured({ method: "POST", body: { email: "not-an-email" } }, invalid);
  assert.equal(invalid.statusCode, 400);

  const honeypot = responseRecorder();
  await configured({ method: "POST", body: { email: "bot@example.com", botcheck: true } }, honeypot);
  assert.equal(honeypot.statusCode, 200);
  assert.equal(calls, 0);

  const unconfigured = responseRecorder();
  await createHandler({ env: {}, fetchImpl: async () => ({ ok: true }) })({
    method: "POST",
    body: { email: "reviewer@example.com" },
  }, unconfigured);
  assert.equal(unconfigured.statusCode, 503);
});

test("tracked landing copies stay synchronized", () => {
  assert.equal(sourceLanding, landing);
});

test("websocket connection failures do not trigger the Next console error overlay", () => {
  assert.doesNotMatch(websocket, /console\.error\("\[WebSocket\] error:/);
});
