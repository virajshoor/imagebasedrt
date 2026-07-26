#!/usr/bin/env node
/**
 * Headless browser QA for live vs baked reflection combine paths.
 * Writes screenshots under /opt/cursor/artifacts/screenshots/.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = "/opt/cursor/artifacts/screenshots";
const PORT = Number(process.env.QA_PORT || 8770);
const CHROME = process.env.BAKE_CHROME || [
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].find((candidate) => existsSync(candidate));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
};

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
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        });
      })
      .on("error", () => res.writeHead(404).end("Not found"))
      .pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const require = createRequire(import.meta.url);
  const puppeteer = require("/tmp/ibrt-bake/node_modules/puppeteer-core");
  await mkdir(OUT, { recursive: true });
  const server = await startStaticServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1440,900",
    ],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  });

  const results = [];
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => window.IBRT?.renderer && document.querySelector("#cellReadout"), {
      timeout: 30000,
    });
    // Wait for bootBaked to finish applying the manifest.
    await page.waitForFunction(() => {
      const status = document.querySelector("#bakeStatus")?.textContent || "";
      return status.includes("Baked") || status.includes("Live") || status.includes("No assets");
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));

    async function shot(name) {
      const file = path.join(OUT, name);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    }

    async function readState() {
      return page.evaluate(() => {
        const stats = window.IBRT.renderer.getBakedReflection();
        return {
          version: window.IBRT.version,
          useBaked: window.IBRT.state.useBaked,
          reflectionMode: window.IBRT.renderer.reflectionMode,
          baked: stats,
          rendererLabel: document.querySelector("#cellReadout")?.textContent,
          reflectLabel: document.querySelector("#blendReadout")?.textContent,
          bakeStatus: document.querySelector("#bakeStatus")?.textContent,
          scene: window.IBRT.state.sceneId,
          quality: window.IBRT.state.shadowQuality,
          glError: window.IBRT.renderer.gl.getError(),
        };
      });
    }

    // Default boot should prefer baked when manifest exists.
    let state = await readState();
    results.push({ step: "boot-default", ...state });
    await shot("01-bar-baked-balanced.png");

    // Toggle live and confirm regen mode.
    await page.click("#bakedToggle");
    await page.waitForFunction(() => {
      const ibrt = window.IBRT;
      return ibrt.renderer.reflectionMode === "live"
        && document.querySelector("#cellReadout")?.textContent === "WEBGL2";
    }, { timeout: 5000 });
    state = await readState();
    results.push({ step: "bar-live", ...state });
    await shot("02-bar-live-balanced.png");

    // Back to baked.
    await page.click("#bakedToggle");
    await page.waitForFunction(() => {
      const ibrt = window.IBRT;
      return ibrt.renderer.reflectionMode === "baked"
        && document.querySelector("#cellReadout")?.textContent === "BAKED";
    }, { timeout: 5000 });
    state = await readState();
    results.push({ step: "bar-baked-again", ...state });

    // Side orbit — puddle should still read with baked planar probe.
    await page.evaluate(() => {
      window.IBRT.state.yaw = 1.1;
      window.IBRT.state.pitch = 0.12;
      window.IBRT.state.distance = 9.2;
    });
    await new Promise((r) => setTimeout(r, 700));
    await shot("03-bar-baked-side.png");

    // Grazing angle.
    await page.evaluate(() => {
      window.IBRT.state.yaw = 0.35;
      window.IBRT.state.pitch = 0.05;
      window.IBRT.state.distance = 8.0;
    });
    await new Promise((r) => setTimeout(r, 700));
    await shot("04-bar-baked-grazing.png");

    // Switch scene + quality while baked.
    await page.select("#sceneSelect", "atrium");
    await new Promise((r) => setTimeout(r, 800));
    state = await readState();
    results.push({ step: "atrium-baked", ...state });
    await shot("05-atrium-baked-balanced.png");

    await page.select("#qualitySelect", "high");
    await page.waitForFunction(() => {
      const ibrt = window.IBRT;
      return ibrt.state.shadowQuality === "high"
        && ibrt.renderer.reflectionMode === "baked"
        && ibrt.renderer.getBakedReflection()?.size === 1536
        && document.querySelector("#cellReadout")?.textContent === "BAKED"
        && document.querySelector("#blendReadout")?.textContent === "1536px";
    }, { timeout: 8000 });
    state = await readState();
    results.push({ step: "atrium-baked-high", ...state });
    await shot("06-atrium-baked-high.png");

    // Also screenshot the raw baked reflection PNGs via dedicated pages.
    for (const rel of [
      "assets/baked/bar/reflection-balanced.png",
      "assets/baked/bar/reflection-high.png",
      "assets/baked/atrium/reflection-balanced.png",
    ]) {
      await page.goto(`http://127.0.0.1:${PORT}/${rel}`, { waitUntil: "networkidle0" });
      await shot(`raw-${rel.replaceAll("/", "-")}`);
    }

    // Verify bake API still works (no download).
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.IBRT?.bakeImages, { timeout: 30000 });
    const bakeProbe = await page.evaluate(async () => {
      const result = await window.IBRT.bakeImages({ download: false });
      return {
        fileCount: result?.files?.length || 0,
        entryCount: result?.manifest?.entries?.length || 0,
        sizes: result?.manifest?.entries?.map((e) => [e.sceneId, e.quality, e.size]) || [],
      };
    });
    results.push({ step: "rebake-probe", ...bakeProbe, errors });

    await writeResults(results, errors);
    console.log(JSON.stringify({ ok: errors.length === 0, results, errors }, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

async function writeResults(results, errors) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(OUT, "qa-results.json"), `${JSON.stringify({ results, errors }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
