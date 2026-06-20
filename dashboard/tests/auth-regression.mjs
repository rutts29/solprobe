import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const landing = await readFile(new URL("../public/landing.html", import.meta.url), "utf8");
const websocket = await readFile(new URL("../src/lib/websocket.tsx", import.meta.url), "utf8");

test("public landing stays request-access only", () => {
  assert.doesNotMatch(landing, /solprobe-demo-key/);
  assert.doesNotMatch(landing, /localStorage\.setItem\('solprobe-api-key'/);
  assert.doesNotMatch(landing, /data-dashboard/);
  assert.match(landing, /mailto:rutts291@gmail\.com/);
});

test("websocket connection failures do not trigger the Next console error overlay", () => {
  assert.doesNotMatch(websocket, /console\.error\("\[WebSocket\] error:/);
});
