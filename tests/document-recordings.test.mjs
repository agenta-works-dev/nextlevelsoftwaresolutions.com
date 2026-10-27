import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPair, clarifyKnownSample } from "../server/evaluate-samples.mjs";
import { validateRecording } from "../scripts/documents/recordings.js";
import { createProfile } from "../scripts/documents/profiles.js";

test("recorded real AI readings remain bound to the original files and preserve the complete learning loop", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../assets/order-samples/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  let profiles = [];
  for (const key of ["units", "repeat", "split", "unfamiliar"]) {
    const recording = JSON.parse(
        await readFile(
          new URL(
            `../assets/order-samples/readings/${key}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ),
      sources = await readPair(key);
    const { extraction, receipt } = validateRecording(
      recording,
      key,
      sources,
      manifest,
    );
    assert.equal(receipt.provider, "openai");
    assert.equal(receipt.mode, "recorded");
    assert.ok(receipt.usage.inputTokens > 0);
    const { result, steps } = clarifyKnownSample(
      key,
      extraction,
      sources,
      profiles,
    );
    assert.equal(result.questions.length, 0);
    if (key !== "unfamiliar") assert.equal(result.counts.unresolved, 0);
    assert.equal(
      result.findings.find((f) => f.title.startsWith("Quantity")).status,
      "match",
    );
    if (key === "units") {
      assert.equal(steps.length, 3);
      profiles = [
        createProfile({
          extraction,
          source: sources[1],
          confirmedRules: result.learnableRules,
          confirmedMappings: ["line.quantity", "line.date"],
        }),
      ];
    }
    if (key === "repeat") {
      assert.equal(steps.length, 0);
      assert.equal(result.usedRules.length, 3);
    }
    if (key === "split")
      assert.equal(
        result.findings.filter((f) => f.title.startsWith("Delivery date"))
          .length,
        2,
      );
    if (key === "unfamiliar") assert.equal(result.counts.extra, 1);
    const wrong = structuredClone(recording);
    wrong.receipt.sourceHashes[0].hash = "0".repeat(64);
    assert.throws(
      () => validateRecording(wrong, key, sources, manifest),
      /does not match/,
    );
  }
});
