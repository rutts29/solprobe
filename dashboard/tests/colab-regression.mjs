import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const trainingPage = await readFile(new URL("../src/app/training/page.tsx", import.meta.url), "utf8");

test("training page links the bundled Colab notebook", () => {
  assert.match(trainingPage, /Google Colab T4/);
  assert.match(trainingPage, /\/colab\/solprobe_colab_t4_demo\.ipynb/);
});

test("bundled Colab notebook streams metrics to the REST batch endpoint", async () => {
  const notebook = await readFile(
    new URL("../public/colab/solprobe_colab_t4_demo.ipynb", import.meta.url),
    "utf8",
  );
  assert.match(notebook, /SolProbeColabClient/);
  assert.match(notebook, /\/api\/v1\/metrics\/batches/);
});
