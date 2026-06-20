import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const landing = await readFile(new URL("../public/landing.html", import.meta.url), "utf8");
const websocket = await readFile(new URL("../src/lib/websocket.tsx", import.meta.url), "utf8");

test("landing sign-in validates the API key before storing it", () => {
  assert.match(landing, /id="signin-error"/);
  const validateIndex = landing.indexOf("await validateKey(trimmed)");
  const storageIndex = landing.indexOf("localStorage.setItem('solprobe-api-key', trimmed)");
  assert.notEqual(validateIndex, -1);
  assert.notEqual(storageIndex, -1);
  assert.ok(validateIndex < storageIndex);
});

test("websocket connection failures do not trigger the Next console error overlay", () => {
  assert.doesNotMatch(websocket, /console\.error\("\[WebSocket\] error:/);
});
