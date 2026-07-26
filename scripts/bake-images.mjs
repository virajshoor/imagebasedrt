#!/usr/bin/env node
/**
 * Bake Image Based RT reflection images once for permanent reuse.
 *
 * Live mode keeps the mirrored "reflection image" only in GPU VRAM and
 * regenerates it most frames before the water combine pass samples it.
 * This command captures those combine inputs at each scene's authored camera
 * for every quality preset and writes them under assets/baked/.
 *
 * Usage (from repo root):
 *   node scripts/bake-images.mjs
 *
 * Optional:
 *   BAKE_PORT=8765 node scripts/bake-images.mjs
 *   BAKE_CHROME=/usr/bin/google-chrome node scripts/bake-images.mjs
 *
 * Requires network-free local Chrome + puppeteer-core (installed on demand).
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile, access } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "baked");
const PORT = Number(process.env.BAKE_PORT || 8765);
const CHROME = process.env.BAKE_CHROME || [
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => existsSync(candidate));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function startStaticServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const filePath = path.join(ROOT, pathname.replace(/^\//, ""));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    createReadStream(filePath)
      .on("open", () => {
        res.writeHead(200, { "Content-Type": contentType(filePath) });
      })
      .on("error", () => {
        res.writeHead(404).end("Not found");
      })
      .pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function ensurePuppeteer() {
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join("/tmp/ibrt-bake/node_modules/puppeteer-core"),
    path.join(ROOT, "node_modules/puppeteer-core"),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "package.json"));
      return require(candidate);
    } catch {
      // keep looking
    }
  }
  console.log("Installing puppeteer-core into /tmp/ibrt-bake …");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      ["install", "--no-save", "--prefix", "/tmp/ibrt-bake", "puppeteer-core@24"],
      { stdio: "inherit" },
    );
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`npm exit ${code}`))));
  });
  return require("/tmp/ibrt-bake/node_modules/puppeteer-core");
}

async function main() {
  if (!CHROME) {
    throw new Error("Chrome not found. Set BAKE_CHROME to a Chromium binary.");
  }

  const puppeteer = await ensurePuppeteer();
  const server = await startStaticServer();
  console.log(`Serving ${ROOT} at http://127.0.0.1:${PORT}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--window-size=1280,800`,
    ],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });

  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      if (text) console.log(`[browser] ${text}`);
    });
    page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => window.IBRT?.bakeImages && window.IBRT?.renderer, {
      timeout: 30000,
    });

    // Confirm WebGL2 came up under SwiftShader / GPU.
    const glOk = await page.evaluate(() => {
      const gl = window.IBRT.renderer.gl;
      return Boolean(gl) && gl instanceof WebGL2RenderingContext && gl.getError() === gl.NO_ERROR;
    });
    if (!glOk) throw new Error("WebGL2 context is not healthy in the bake browser.");

    console.log("Capturing reflection images for all scenes × qualities…");
    const result = await page.evaluate(async () => window.IBRT.bakeImages({ download: false }));
    if (!result?.manifest || !result?.files?.length) {
      throw new Error("bakeImages() returned no files.");
    }

    await mkdir(OUT_DIR, { recursive: true });
    for (const file of result.files) {
      const outPath = path.join(OUT_DIR, file.path);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, Buffer.from(file.bytes));
      console.log(`Wrote ${path.relative(ROOT, outPath)} (${file.bytes.length} bytes)`);
    }
    const manifestPath = path.join(OUT_DIR, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`);
    console.log(`Wrote ${path.relative(ROOT, manifestPath)}`);
    console.log(`Done. ${result.files.length} reflection images ready for permanent reuse.`);
    console.log("Enable “Use baked images” in the demo (on by default when manifest exists).");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
