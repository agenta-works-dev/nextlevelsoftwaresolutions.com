import http from "node:http";
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  stat,
  rename,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { handleOrderAPI } from "./order-api.js";
import { emptyLedger, reserveTrial, finishTrial } from "./trial-ledger.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv; charset=utf-8",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
};
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://challenges.cloudflare.com; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'";

export function readPrivateSettings(text) {
  const allowed = new Set([
    "AI_PROVIDER",
    "AI_MODEL",
    "OPENAI_API_KEY",
    "DASHSCOPE_API_KEY",
    "QWEN_WORKSPACE_ID",
    "QWEN_REGION",
    "TRIAL_SIGNING_SECRET",
    "MONTHLY_TRIAL_LIMIT",
    "DAILY_IP_LIMIT",
  ]);
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !allowed.has(match[1]))
      throw new Error("The private settings contain an unsupported setting.");
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return values;
}
export async function fileLedger(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "trial-usage.json");
  let state = emptyLedger();
  try {
    const text = await readFile(filename, "utf8");
    if (text.length > 2000000) throw new Error("Trial ledger is too large.");
    state = JSON.parse(text);
    if (state.version !== 1 || !state.visitors || !state.ips || !state.months)
      throw new Error("Trial ledger is invalid.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let queue = Promise.resolve();
  const mutate = (fn) => {
    const work = queue.then(async () => {
      const next = fn(state);
      const temporary = filename + ".tmp";
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, filename);
      state = next;
    });
    queue = work.catch(() => {});
    return work;
  };
  return {
    read: () => queue.then(() => structuredClone(state)),
    reserve: (input) => mutate((s) => reserveTrial(s, input)),
    finish: (visitor, status) => mutate((s) => finishTrial(s, visitor, status)),
  };
}
export async function startReviewServer({
  port = 8797,
  privateDirectory = path.resolve(ROOT, "../../work/order-checker-private"),
  env: overrides = {},
  fetcher,
} = {}) {
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  let settings = {};
  try {
    settings = readPrivateSettings(
      await readFile(path.join(privateDirectory, "settings.env"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let secret =
    process.env.TRIAL_SIGNING_SECRET || settings.TRIAL_SIGNING_SECRET;
  if (!secret) {
    const secretPath = path.join(privateDirectory, "trial-signing-secret");
    try {
      secret = await readFile(secretPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      secret = randomBytes(32).toString("hex");
      await writeFile(secretPath, secret, { mode: 0o600, flag: "wx" });
    }
  }
  const env = {
    ...settings,
    ...process.env,
    ...overrides,
    LOCAL_REVIEW: "1",
    TRIAL_SIGNING_SECRET: secret,
  };
  const ledger = await fileLedger(privateDirectory);
  let actualPort = port;
  const server = http.createServer(async (req, res) => {
    try {
      if (
        !new RegExp(`^(?:127\\.0\\.0\\.1|localhost):${actualPort}$`).test(
          req.headers.host || "",
        )
      ) {
        res.writeHead(403);
        res.end("This review server is local only.");
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/order-checker/")) {
        const abort = new AbortController();
        res.on("close", () => {
          if (!res.writableEnded) abort.abort();
        });
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method)
            ? {}
            : { body: req, duplex: "half" }),
          signal: abort.signal,
        });
        const result = await handleOrderAPI(
          request,
          env,
          ledger,
          fetcher ? { fetcher } : {},
        );
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(new Uint8Array(await result.arrayBuffer()));
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405);
        res.end();
        return;
      }
      let target;
      try {
        target = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (
        target.includes("\0") ||
        target.split("/").some((part) => part.startsWith(".")) ||
        /^\/(?:node_modules|server|tests|work|package(?:-lock)?\.json)(?:\/|$)/.test(
          target,
        )
      ) {
        res.writeHead(404);
        res.end("Not found.");
        return;
      }
      const resolved = path.resolve(
        ROOT,
        "." + target,
        target.endsWith("/") ? "index.html" : ".",
      );
      const file = await realpath(resolved);
      if (!file.startsWith(ROOT + path.sep) || !(await stat(file)).isFile()) {
        res.writeHead(404);
        res.end("Not found.");
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": CSP,
        "Referrer-Policy": "same-origin",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      if (!res.headersSent)
        res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("This resource could not be opened.");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  actualPort = server.address().port;
  return {
    server,
    url: `http://127.0.0.1:${actualPort}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const flag = process.argv.indexOf("--port"),
    port = flag >= 0 ? Number(process.argv[flag + 1]) : 8797;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a port between 1024 and 65535.");
  const app = await startReviewServer({ port });
  console.log(`Order Checker review: ${app.url}/order-check-next.html`);
  console.log(
    "Local review only. Private settings and usage records are outside the website directory.",
  );
}
