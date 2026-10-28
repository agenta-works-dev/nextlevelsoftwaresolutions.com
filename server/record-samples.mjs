// Save validated real-model readings of the fictional originals for a free,
// honestly labeled replay. Never records a visitor upload or private profile.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readPair } from "./evaluate-samples.mjs";
import { validateRecording } from "../scripts/documents/recordings.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const input = process.argv[2];
if (!input)
  throw new Error(
    "Supply a successful live evaluation directory; this command makes no AI call.",
  );
const directory = path.resolve(input),
  out = path.join(root, "assets/order-samples/readings"),
  manifest = JSON.parse(
    await readFile(
      path.join(root, "assets/order-samples/manifest.json"),
      "utf8",
    ),
  );
const recordings = [];
for (const sample of ["units", "repeat", "split", "unfamiliar"]) {
  const run = JSON.parse(
    await readFile(path.join(directory, sample + ".json"), "utf8"),
  );
  if (
    run.mode !== "live-provider-evaluation" ||
    run.result.questions.length ||
    (sample !== "unfamiliar" && run.result.counts.unresolved)
  )
    throw new Error(
      `The ${sample} evaluation still requires review; no recordings written.`,
    );
  const recording = {
    version: 1,
    sample,
    extraction: run.extraction,
    receipt: { ...run.receipt, mode: "recorded" },
    notice:
      "Actual AI extraction recorded from these exact fictional sample files. Replaying it makes no new model call. The visitor supplies clarifications and optionally saves their own profile locally.",
  };
  validateRecording(recording, sample, await readPair(sample), manifest);
  recordings.push(recording);
}
await mkdir(out, { recursive: true });
for (const recording of recordings)
  await writeFile(
    path.join(out, recording.sample + ".json"),
    JSON.stringify(recording, null, 2) + "\n",
  );
console.log(
  "Saved four hash-bound recordings of actual AI extraction. No private key, visitor content or saved profile was included.",
);
