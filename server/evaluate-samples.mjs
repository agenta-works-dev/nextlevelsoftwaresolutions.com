// Operator-only: live evaluation of fictional sample documents. Not a public
// endpoint and not a way for visitors to reset the five-attempt allowance.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  parseWorkbook,
  parseDelimited,
  decodeText,
} from "../scripts/documents/spreadsheets.js";
import { pageTextAnchors } from "../scripts/documents/page-text.js";
import { LIMITS } from "../scripts/documents/schema.js";
import { SAMPLES, preparedSample } from "../scripts/documents/samples.js";
import { compareDocuments } from "../scripts/documents/compare.js";
import { createProfile, profileHints } from "../scripts/documents/profiles.js";
import { interpretDocuments, publicProviderStatus } from "./ai-provider.js";
import { readPrivateSettings } from "./local-order-checker.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pdfDirectory = path.join(ROOT, "node_modules/pdfjs-dist");
export async function readSample(name, role) {
  if (!Object.values(SAMPLES).some((s) => s.files.includes(name)))
    throw new Error(
      "Evaluation accepts only the checked-in fictional samples.",
    );
  const bytes = new Uint8Array(
      await readFile(path.join(ROOT, "assets/order-samples", name)),
    ),
    hash = createHash("sha256").update(bytes).digest("hex"),
    prefix = `${role}:${hash.slice(0, 16)}`;
  const format = path.extname(name).slice(1),
    source = {
      id: role,
      name,
      hash,
      bytes: bytes.length,
      format: format === "png" ? "image" : format,
      anchors: [],
      pages: [],
      sheets: [],
      warnings: [],
    };
  assert.ok(bytes.length < LIMITS.fileBytes);
  if (format === "xlsx" || format === "csv") {
    source.sheets =
      format === "xlsx"
        ? parseWorkbook(bytes).filter((s) => !s.hidden)
        : [parseDelimited(decodeText(bytes))];
    source.sheets.forEach((sheet, index) => {
      for (const row of sheet.rows)
        for (const c of row)
          if (c.text.trim())
            source.anchors.push({
              id: `${prefix}:s${index + 1}:${c.address}`,
              kind: "cell",
              sheet: sheet.name,
              cell: c.address,
              row: c.row,
              column: c.column,
              text: c.text,
              valueType: c.type,
              formula: c.formula,
              label: `${sheet.name}!${c.address}`,
            });
    });
  } else if (format === "pdf") {
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      cMapUrl: pdfDirectory + "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: pdfDirectory + "/standard_fonts/",
      wasmUrl: pdfDirectory + "/wasm/",
    });
    const pdf = await task.promise;
    try {
      assert.ok(pdf.numPages <= LIMITS.pages);
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number),
          base = page.getViewport({ scale: 1 }),
          viewport = page.getViewport({
            scale: Math.min(
              2.5,
              LIMITS.imageSide / base.width,
              LIMITS.imageSide / base.height,
            ),
          }),
          canvas = createCanvas(
            Math.min(LIMITS.imageSide, Math.ceil(viewport.width)),
            Math.min(LIMITS.imageSide, Math.ceil(viewport.height)),
          );
        await page.render({
          canvasContext: canvas.getContext("2d"),
          canvas,
          viewport,
        }).promise;
        const id = `${prefix}:p${number}`;
        source.pages.push({
          id,
          number,
          width: canvas.width,
          height: canvas.height,
          image: canvas.toDataURL("image/jpeg", 0.84),
        });
        source.anchors.push(
          {
            id,
            kind: "page",
            text: "",
            page: number,
            label: `Page ${number}`,
            bbox: [0, 0, 1, 1],
          },
          ...pageTextAnchors(
            await page.getTextContent(),
            viewport,
            canvas.width,
            canvas.height,
            id,
            number,
            pdfjs.Util.transform,
          ),
        );
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }
  } else {
    const image = await loadImage(bytes),
      scale = Math.min(
        1,
        LIMITS.imageSide / image.width,
        LIMITS.imageSide / image.height,
      ),
      canvas = createCanvas(
        Math.round(image.width * scale),
        Math.round(image.height * scale),
      ),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const id = `${prefix}:p1`;
    source.pages.push({
      id,
      number: 1,
      width: canvas.width,
      height: canvas.height,
      image: canvas.toDataURL("image/jpeg", 0.84),
    });
    source.anchors.push({
      id,
      kind: "page",
      page: 1,
      text: "",
      bbox: [0, 0, 1, 1],
      label: "Image 1",
    });
  }
  return source;
}
export async function readPair(key) {
  return Promise.all(
    SAMPLES[key].files.map((name, i) => readSample(name, i ? "ack" : "po")),
  );
}
export function clarifyKnownSample(key, extraction, sources, profiles) {
  const answers = {},
    po = extraction.documents.find((d) => d.id === "po"),
    ack = extraction.documents.find((d) => d.id === "ack");
  const steps = [];
  for (let pass = 0; pass < 8; pass++) {
    const result = compareDocuments({ extraction, sources, profiles, answers });
    if (!result.questions.length) return { result, answers, steps };
    let changed = false;
    for (const q of result.questions) {
      let value;
      if (q.id.startsWith("match:")) {
        const item = ack.lines.find((l) => l.id === q.id.slice(6));
        if (
          ["units", "repeat"].includes(key) &&
          item?.supplierPart.value === "H-G8"
        )
          value = po.lines[0].id;
        if (key === "unfamiliar" && item?.buyerPart.value === "BR-112")
          value = "extra";
      } else if (q.id === "unit:GSK-8|BOX->EA") value = "12";
      else if (q.id.startsWith("split:") && key === "split") value = "combine";
      else if (q.id.startsWith("date-kind:"))
        value =
          key === "unfamiliar" && q.role === "ack" ? "shipment" : "delivery";
      else if (
        q.id.startsWith("price-basis:") &&
        ["units", "repeat", "split", "unfamiliar"].includes(key)
      )
        value =
          q.role === "po"
            ? key === "unfamiliar"
              ? "100 EA"
              : "1 EA"
            : ["units", "repeat"].includes(key)
              ? "1 BOX"
              : "1 EA";
      if (value && !answers[q.id]) {
        answers[q.id] = { value, confirmedAt: new Date().toISOString() };
        steps.push({
          question: q.prompt,
          value,
          basis:
            "Operator-supplied ground truth for this fictional sample; not a model-generated answer.",
        });
        changed = true;
      }
    }
    if (!changed) return { result, answers, steps };
  }
  return {
    result: compareDocuments({ extraction, sources, profiles, answers }),
    answers,
    steps,
  };
}
async function run() {
  const dry = !process.argv.includes("--live");
  const privateDir = path.resolve(ROOT, "../../work/order-checker-private"),
    out = path.resolve(
      ROOT,
      "../../work/order-checker-evaluation",
      new Date().toISOString().replaceAll(":", "-"),
    );
  await mkdir(out, { recursive: true });
  let env = {};
  if (!dry) {
    env = {
      ...readPrivateSettings(
        await readFile(path.join(privateDir, "settings.env"), "utf8"),
      ),
      ...process.env,
    };
    if (!publicProviderStatus(env).configured)
      throw new Error(
        "Configure a private API credential first. No live call was made.",
      );
  }
  const manifest = JSON.parse(
      await readFile(
        path.join(ROOT, "assets/order-samples/manifest.json"),
        "utf8",
      ),
    ),
    summaries = [];
  let profiles = [];
  for (const key of ["units", "repeat", "split", "unfamiliar"]) {
    const sources = await readPair(key),
      interpretation = dry
        ? preparedSample(key, sources, manifest)
        : await interpretDocuments({
            sources,
            profileHints: profileHints(profiles, sources),
            env,
            onProviderResponse: (data) =>
              writeFile(
                path.join(out, key + "-provider-response.json"),
                JSON.stringify(data, null, 2),
              ),
          });
    const { result, answers, steps } = clarifyKnownSample(
      key,
      interpretation.extraction,
      sources,
      profiles,
    );
    await writeFile(
      path.join(out, key + ".json"),
      JSON.stringify(
        {
          mode: dry ? "prepared-source-validation" : "live-provider-evaluation",
          ...interpretation,
          result,
          answers,
          steps,
          sourceFiles: sources.map(({ id, name, hash }) => ({
            id,
            name,
            hash,
          })),
        },
        null,
        2,
      ),
    );
    assert.equal(
      result.questions.length,
      0,
      `${key}: unexpected extraction ambiguities require review`,
    );
    if (key !== "unfamiliar")
      assert.equal(
        result.counts.unresolved,
        0,
        `${key}: an answered interpretation must not leave a stale unresolved concern`,
      );
    const quantity = result.findings.find((f) =>
      f.title.startsWith("Quantity"),
    );
    assert.equal(
      quantity?.status,
      "match",
      `${key}: total quantity should match`,
    );
    if (key === "units") {
      assert.match(
        result.findings.find((f) => f.title.startsWith("Unit price"))?.actual ||
          "",
        /^0\.8 USD\/EA$/,
      );
      profiles = [
        createProfile({
          extraction: interpretation.extraction,
          source: sources[1],
          confirmedRules: result.learnableRules.filter((r) => r.role === "ack"),
          confirmedMappings: ["line.quantity", "line.date"],
        }),
      ];
    }
    if (key === "repeat") {
      assert.equal(
        Object.keys(answers).length,
        0,
        "repeat: confirmed profile should remove all clarification questions",
      );
      assert.ok(result.usedRules.length >= 2);
      assert.equal(quantity.expected, "180 EA");
    }
    if (key === "split") {
      const dates = result.findings.filter((f) =>
        /^Delivery date/.test(f.title),
      );
      assert.equal(dates.length, 2);
      assert.ok(dates.some((f) => f.actual === "2026-12-12"));
      assert.ok(dates.some((f) => f.actual === "2026-12-18"));
    }
    if (key === "unfamiliar") {
      assert.ok(result.findings.some((f) => f.status === "extra"));
      assert.ok(
        result.findings.some((f) => /shipment.*delivery/.test(f.explanation)),
      );
      assert.equal(
        result.findings.find((f) => f.title.startsWith("Unit price"))?.expected,
        "2 USD/EA",
      );
    }
    summaries.push({
      sample: key,
      mode: dry ? "prepared" : "live",
      sourceFormats: sources.map((s) => s.format),
      questionsAnswered: steps.length,
      profileVersions: result.profileVersions,
      usage: interpretation.receipt.usage || null,
    });
    console.log(
      `${key}: original formats read; ${steps.length} clarifications; ${result.usedRules.length} reused rules. ${dry ? "Prepared readings — not a live model test." : `Live model: ${interpretation.receipt.model}.`}`,
    );
  }
  await writeFile(
    path.join(out, "summary.json"),
    JSON.stringify(summaries, null, 2),
  );
  console.log(`Evaluation records: ${out}`);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
