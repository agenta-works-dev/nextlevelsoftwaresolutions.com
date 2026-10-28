import { SAMPLES } from "./samples.js";
import { validateExtraction, DocumentError } from "./schema.js";

export function validateRecording(recording, key, sources, manifest) {
  if (
    recording?.version !== 1 ||
    recording.sample !== key ||
    recording.receipt?.mode !== "recorded" ||
    !recording.receipt.requestId ||
    !recording.receipt.model ||
    !SAMPLES[key] ||
    sources.length !== 2 ||
    sources.some(
      (s, i) =>
        s.name !== SAMPLES[key].files[i] ||
        s.hash !== manifest[s.name] ||
        !recording.receipt.sourceHashes?.some(
          (v) => v.role === s.id && v.hash === s.hash,
        ),
    )
  )
    throw new DocumentError(
      "This recorded sample does not match the original document files. No substitute reading is used.",
      "sample_source",
    );
  return {
    extraction: validateExtraction(recording.extraction, sources),
    receipt: recording.receipt,
  };
}
export async function loadRecordedSample(key, sources, manifest) {
  const response = await fetch(
    `assets/order-samples/readings/${encodeURIComponent(key)}.json`,
  );
  if (!response.ok)
    throw new DocumentError(
      "The recorded AI sample could not be loaded. Your own files can still use the configured live interpretation service.",
      "sample_source",
    );
  return validateRecording(await response.json(), key, sources, manifest);
}
