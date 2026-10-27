import { build } from "esbuild";
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  out = path.join(root, "assets/order-checker");
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { app: "scripts/documents/app.js" },
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "linked",
  chunkNames: "chunks/[name]-[hash]",
  sourcemap: false,
});
const pdfPackage = JSON.parse(
  await readFile(
    path.join(root, "node_modules/pdfjs-dist/package.json"),
    "utf8",
  ),
);
const pdfOut = path.join(out, `pdfjs-${pdfPackage.version}`);
await mkdir(pdfOut, { recursive: true });
await cp(
  path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  path.join(pdfOut, "pdf.worker.min.mjs"),
);
for (const directory of ["cmaps", "standard_fonts", "wasm"])
  await cp(
    path.join(root, "node_modules/pdfjs-dist", directory),
    path.join(pdfOut, directory),
    { recursive: true },
  );
await cp(
  path.join(root, "node_modules/pdfjs-dist/LICENSE"),
  path.join(pdfOut, "PDFJS-LICENSE.txt"),
);
const notices = [];
for (const name of ["fflate", "saxes", "xmlchars"]) {
  const directory = path.join(root, "node_modules", name);
  const pkg = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const license = (await readdir(directory)).find((file) =>
    /^LICEN[CS]E(?:\..+)?$/i.test(file),
  );
  const licensePath = license
    ? path.join(directory, license)
    : path.join(root, "licenses", `${name}-${pkg.version}.txt`);
  notices.push(
    `${name} ${pkg.version}\n\n${await readFile(licensePath, "utf8")}`,
  );
}
await writeFile(
  path.join(out, "THIRD-PARTY-NOTICES.txt"),
  notices.join("\n\n-----\n\n"),
);
const hash = (content) => createHash("sha256").update(content).digest("hex");
const htmlPath = path.join(root, "order-check-next.html"),
  html = await readFile(htmlPath, "utf8");
const jsHash = hash(await readFile(path.join(out, "app.js"))).slice(0, 12),
  cssHash = hash(await readFile(path.join(root, "order-documents.css"))).slice(
    0,
    12,
  );
await writeFile(
  htmlPath,
  html
    .replace(
      /order-documents\.css\?v=[^" ]+/g,
      `order-documents.css?v=${cssHash}`,
    )
    .replace(
      /assets\/order-checker\/app\.js\?v=[^" ]+/g,
      `assets/order-checker/app.js?v=${jsHash}`,
    ),
);
const sampleDirectory = path.join(root, "assets/order-samples"),
  manifest = {};
for (const name of (await readdir(sampleDirectory)).sort())
  if (/\.(pdf|png|xlsx|csv)$/.test(name))
    manifest[name] = hash(await readFile(path.join(sampleDirectory, name)));
await writeFile(
  path.join(sampleDirectory, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Built review application. Script ${jsHash}; styles ${cssHash}; ${Object.keys(manifest).length} original-format sample files.`,
);
