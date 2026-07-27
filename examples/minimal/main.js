/**
 * Minimal third-party host for Image Based RT.
 *
 * Imports ONLY `../../src/implementation.js` — no demo shell, no scene modules.
 * Serve the repo root: `python3 -m http.server 8080`
 * Open: http://localhost:8080/examples/minimal/
 *
 * Host contract
 * -------------
 * Objects need: mesh, position, scale, color, texture, cast, receive, enabled.
 * Optional: emissive, gloss, neon (demo toggle tag), reflectivity (0–1 fake glass),
 *           rotation, rotationZ.
 * `floorObject` MUST be the same reference as the floor entry in `objects`
 *   so the mirror pass can skip it.
 * Bump `contentVersion` when enabling/disabling objects that appear in mirrors
 *   (or when changing local-light composition that should invalidate temporal reuse).
 * Pass optional `lightColor` and `atmosphere` to tune the lit pass; omit for defaults.
 * Call `ibrt.dispose()` when tearing down the host (and/or `disposeMesh` on rebuilds).
 * Reflections stay a live mirrored-camera render — never a permanent bake.
 */

import {
  createImageBasedRT,
  recommendContextOptions,
  DEFAULT_ATMOSPHERE,
} from "../../src/implementation.js";

const canvas = document.querySelector("#viewport");
const quality = "low";
const gl = canvas.getContext("webgl2", recommendContextOptions(quality));
if (!gl) throw new Error("WebGL2 is required.");

const ibrt = createImageBasedRT(gl, { quality });
ibrt.allocateTargets();

const floorTex = ibrt.createTexture((ctx, w, h) => {
  ctx.fillStyle = "#1a222c";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(90, 120, 140, 0.25)";
  for (let i = 0; i < w; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, h);
    ctx.stroke();
  }
}, 64);

const propTex = ibrt.createTexture((ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#3a6a88");
  g.addColorStop(1, "#1e3a4c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}, 32);

const neonTex = ibrt.createTexture((ctx, w, h) => {
  ctx.fillStyle = "#ff66aa";
  ctx.fillRect(0, 0, w, h);
}, 16);

const glassTex = ibrt.createTexture((ctx, w, h) => {
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "#0a1820");
  g.addColorStop(0.5, "#c8f0ff");
  g.addColorStop(1, "#0a1820");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}, 32);

const floorMesh = ibrt.buildPlane();
const cubeMesh = ibrt.buildCube();
const sphereMesh = ibrt.buildSphere(12, 18);
const puddleMesh = ibrt.buildPuddle();

const floorObject = {
  mesh: floorMesh,
  position: [0, 0, 0],
  scale: [4.5, 1, 4.5],
  color: [0.85, 0.9, 0.95, 1],
  texture: floorTex,
  cast: false,
  receive: true,
  gloss: 70,
  enabled: true,
};

const objects = [
  floorObject,
  {
    mesh: cubeMesh,
    position: [-0.9, 0.55, -0.4],
    scale: [0.45, 0.55, 0.45],
    color: [0.55, 0.72, 0.85, 1],
    texture: propTex,
    cast: true,
    receive: true,
    gloss: 48,
    enabled: true,
  },
  {
    mesh: sphereMesh,
    position: [0.85, 0.55, 0.2],
    scale: [0.5, 0.5, 0.5],
    color: [0.78, 0.92, 0.98, 1],
    texture: glassTex,
    emissive: [0.02, 0.04, 0.05],
    cast: true,
    receive: true,
    gloss: 120,
    reflectivity: 0.55,
    enabled: true,
  },
];

const water = {
  mesh: puddleMesh,
  position: [0, 0.02, 0.9],
  scale: [1.1, 1, 0.85],
  color: [0.02, 0.07, 0.1],
  opacity: 0.96,
  planeY: 0,
};

const state = {
  yaw: 0.35,
  pitch: 0.28,
  distance: 6.2,
  target: [0, 0.45, 0.2],
  dragging: false,
  lastX: 0,
  lastY: 0,
  contentVersion: 0,
};

// Slightly warmer key light + default atmosphere (explicit so hosts see the knobs).
const lightColor = [1.0, 0.82, 0.62];
const atmosphere = {
  ...DEFAULT_ATMOSPHERE,
  fogStrength: 0.5,
};

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, ibrt.preset.maxPixelRatio);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

canvas.addEventListener("pointerdown", (e) => {
  state.dragging = true;
  state.lastX = e.clientX;
  state.lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => { state.dragging = false; });
canvas.addEventListener("pointercancel", () => { state.dragging = false; });
canvas.addEventListener("pointermove", (e) => {
  if (!state.dragging) return;
  state.yaw += (e.clientX - state.lastX) * 0.005;
  state.pitch = Math.max(0.08, Math.min(1.2, state.pitch + (e.clientY - state.lastY) * 0.004));
  state.lastX = e.clientX;
  state.lastY = e.clientY;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  state.distance = Math.max(3.5, Math.min(12, state.distance + e.deltaY * 0.01));
}, { passive: false });
window.addEventListener("resize", resize);

function frame(now) {
  resize();
  const aspect = canvas.width / Math.max(1, canvas.height);
  const camera = ibrt.buildOrbitCamera({
    yaw: state.yaw,
    pitch: state.pitch,
    distance: state.distance,
    target: state.target,
    aspect,
    bounds: { minX: -3, maxX: 3, minY: 0.2, maxY: 5, minZ: -3, maxZ: 3 },
  });
  const light = ibrt.buildOrthoLight({
    position: [2.4, 5.5, 2.2],
    lookAt: [0, 0.4, 0],
  });
  ibrt.renderFrame({
    canvas,
    camera,
    light,
    localLight: {
      position: [0.85, 1.1, 0.2],
      color: [1, 0.4, 0.7],
      intensity: 2.8,
    },
    objects,
    floorObject,
    water,
    textureEnabled: true,
    time: now / 1000,
    aspect,
    clearColor: [0.02, 0.04, 0.06, 1],
    contentVersion: state.contentVersion,
    lightColor,
    atmosphere,
  });
  requestAnimationFrame(frame);
}

window.addEventListener("pagehide", () => {
  ibrt.dispose();
});

resize();
requestAnimationFrame(frame);
