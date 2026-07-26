/**
 * Image Based RT — demo shell (UI, input, scene switcher, render loop).
 *
 * Responsibilities:
 *   - Boot WebGL2 with low-power context hints
 *   - Switch between authored scenes (`src/scenes/*`)
 *   - Orbit / WASD / light controls
 *   - Call `ibrt.renderFrame(...)` each animation frame
 *
 * Scene content (meshes, materials, water) lives in scene modules.
 * The portable RT method lives in `implementation.js`.
 */

import {
  QUALITY_PRESETS,
  clamp,
  createImageBasedRT,
  recommendContextOptions,
} from "./implementation.js";
import { buildNeonAtrium, neonAtriumMeta } from "./scenes/neonAtrium.js";
import { buildMidnightBar, midnightBarMeta } from "./scenes/midnightBar.js";

// ---------------------------------------------------------------------------
// DOM / WebGL bootstrap (low-power defaults)
// ---------------------------------------------------------------------------

const canvas = document.querySelector("#viewport");
const initialQuality = "balanced";
const gl = canvas.getContext("webgl2", recommendContextOptions(initialQuality));

const el = {
  renderer: document.querySelector("#cellReadout"),
  shadow: document.querySelector("#blendReadout"),
  draws: document.querySelector("#passReadout"),
  frame: document.querySelector("#frameReadout"),
  accents: document.querySelector("#blendToggle"),
  neon: document.querySelector("#neonToggle"),
  neonLabel: document.querySelector("#neonToggleLabel"),
  neonHint: document.querySelector("#neonToggleHint"),
  debug: document.querySelector("#debugToggle"),
  quality: document.querySelector("#qualitySelect"),
  scene: document.querySelector("#sceneSelect"),
  sceneCode: document.querySelector("#sceneCode"),
  sceneTitle: document.querySelector("#sceneTitle"),
  sceneBlurb: document.querySelector("#sceneBlurb"),
  legendNote: document.querySelector("#legendNote"),
  tryThis: document.querySelector("#tryThisNote"),
  reset: document.querySelector("#resetButton"),
};

if (!gl) {
  const message = document.createElement("div");
  message.className = "webgl-error";
  message.textContent = "WebGL2 is required for the 3D shadow prototype.";
  document.querySelector(".viewport-wrap").append(message);
  throw new Error("WebGL2 is not available in this browser.");
}

const ibrt = createImageBasedRT(gl, { quality: initialQuality });

// Registry of demo scenes. Default is Midnight Bar (denser reflection stress test).
const SCENES = {
  bar: { meta: midnightBarMeta, build: buildMidnightBar },
  atrium: { meta: neonAtriumMeta, build: buildNeonAtrium },
};

const state = {
  sceneId: "bar", // "bar" | "atrium"
  yaw: 0.18,
  pitch: 0.22,
  distance: 8.6,
  target: [0, 1.15, 0.85],
  lightX: 2.6,
  lightZ: 2.0,
  imageAccents: true, // sample procedural albedo textures
  neon: true,         // show neon-tagged objects + local colored light
  debug: false,       // draw key-light marker sphere
  shadowQuality: initialQuality,
  dragging: false,
  lastPointerX: 0,
  lastPointerY: 0,
};

const keys = new Set();
let viewportWidth = 1;
let viewportHeight = 1;
let lastFrame = performance.now();
let fps = 60;
let telemetryTick = 0;
/** Bumped when neon/object composition changes so RT temporal reuse invalidates. */
let contentVersion = 0;
let sceneObjects = [];
let floorObject = null;
let puddleObject = null;
let enabledDrawCount = 0;
let activeScene = null;
let debugMesh = null;
let debugTexture = null;

// ---------------------------------------------------------------------------
// Scene rebuild / UI sync
// ---------------------------------------------------------------------------

function applySceneMeta(meta) {
  if (el.sceneCode) el.sceneCode.textContent = meta.code;
  if (el.sceneTitle) el.sceneTitle.textContent = meta.title;
  if (el.sceneBlurb) el.sceneBlurb.textContent = meta.blurb;
  if (el.legendNote) el.legendNote.textContent = meta.legendNote;
  if (el.tryThis && meta.tryThis) el.tryThis.textContent = meta.tryThis;
  if (el.neonLabel) el.neonLabel.textContent = meta.neonLabel;
  if (el.neonHint) el.neonHint.textContent = meta.neonHint;
}

function applyCameraDefaults(camera) {
  state.yaw = camera.yaw;
  state.pitch = camera.pitch;
  state.distance = camera.distance;
  state.target = [...camera.target];
  state.lightX = camera.lightX;
  state.lightZ = camera.lightZ;
}

/** Rebuild meshes for the active scene (also runs on GPU quality change). */
function rebuildScene({ resetCamera = false } = {}) {
  const entry = SCENES[state.sceneId] || SCENES.bar;
  const built = entry.build(ibrt, ibrt.preset);
  activeScene = built;
  sceneObjects = built.objects;
  // Same object reference as in `objects` so the mirror pass can skip the floor.
  floorObject = built.floorObject;
  puddleObject = built.water;
  debugMesh = built.debugMesh || sceneObjects.find((o) => o.mesh)?.mesh;
  debugTexture = built.debugTexture || sceneObjects.find((o) => o.texture)?.texture;
  applySceneMeta(entry.meta);
  if (resetCamera) applyCameraDefaults(built.camera);
  syncNeonEnabled();
}

/** Toggle objects tagged `neon: true` and recount opaque draws for telemetry. */
function syncNeonEnabled() {
  enabledDrawCount = 0;
  sceneObjects.forEach((object) => {
    object.enabled = !object.neon || state.neon;
    if (object.enabled) enabledDrawCount += 1;
  });
  contentVersion += 1;
}

function buildLocalLight() {
  const base = activeScene?.localLight || { position: [0, 3, 0], color: [1, 1, 1], intensity: 3 };
  return {
    position: base.position,
    color: base.color,
    intensity: state.neon ? base.intensity : 0,
  };
}

// ---------------------------------------------------------------------------
// Frame / camera / input
// ---------------------------------------------------------------------------

function renderScene(now) {
  const aspect = viewportWidth / viewportHeight;
  const bounds = activeScene?.bounds || { minX: -6, maxX: 6, minY: 0.3, maxY: 8, minZ: -5, maxZ: 5.5 };
  const camera = ibrt.buildOrbitCamera({
    yaw: state.yaw,
    pitch: state.pitch,
    distance: state.distance,
    target: state.target,
    aspect,
    bounds,
  });
  const light = ibrt.buildOrthoLight({
    position: [state.lightX, 7.2, state.lightZ],
    lookAt: activeScene?.lightLookAt || [0, 1.2, -1],
  });
  const localLight = buildLocalLight();

  const debugMarker = state.debug && debugMesh && debugTexture ? {
    mesh: debugMesh,
    position: light.lightPosition,
    scale: [0.16, 0.16, 0.16],
    color: [1, 0.45, 0.12, 1],
    texture: debugTexture,
    emissive: [1.3, 0.2, 0.02],
    receive: false,
    gloss: 100,
    enabled: true,
  } : null;

  const stats = ibrt.renderFrame({
    canvas,
    camera,
    light,
    localLight,
    objects: sceneObjects,
    floorObject,
    water: puddleObject,
    textureEnabled: state.imageAccents,
    debugMarker,
    time: now / 1000,
    aspect,
    clearColor: activeScene?.clearColor || [0.016, 0.038, 0.055, 1],
    contentVersion,
  });

  telemetryTick += 1;
  if (telemetryTick % 8 === 0) {
    el.renderer.textContent = "WEBGL2";
    el.shadow.textContent = `${stats.reflectionSize}px`;
    el.draws.textContent = `${enabledDrawCount} + 2`;
    el.frame.textContent = `${Math.round(fps)} FPS`;
    el.shadow.title = `Reflection ${stats.reflectionSize}px / shadow ${stats.shadowSize}px (${stats.quality})`;
    el.draws.title = "Scene draws plus shadow and reflection passes";
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  viewportWidth = Math.max(1, rect.width);
  viewportHeight = Math.max(1, rect.height);
  const maxRatio = ibrt.preset.maxPixelRatio;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxRatio);
  canvas.width = Math.floor(viewportWidth * pixelRatio);
  canvas.height = Math.floor(viewportHeight * pixelRatio);
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function resetView() {
  if (activeScene?.camera) applyCameraDefaults(activeScene.camera);
}

function moveCamera(deltaTime) {
  const speed = keys.has("shift") ? 4.8 : 2.7;
  const forward = [-Math.sin(state.yaw), 0, -Math.cos(state.yaw)];
  const right = [Math.cos(state.yaw), 0, -Math.sin(state.yaw)];
  if (keys.has("w")) { state.target[0] += forward[0] * speed * deltaTime; state.target[2] += forward[2] * speed * deltaTime; }
  if (keys.has("s")) { state.target[0] -= forward[0] * speed * deltaTime; state.target[2] -= forward[2] * speed * deltaTime; }
  if (keys.has("a")) { state.target[0] -= right[0] * speed * deltaTime; state.target[2] -= right[2] * speed * deltaTime; }
  if (keys.has("d")) { state.target[0] += right[0] * speed * deltaTime; state.target[2] += right[2] * speed * deltaTime; }
  if (keys.has("q")) state.lightX = clamp(state.lightX - 2.8 * deltaTime, -5.5, 5.5);
  if (keys.has("e")) state.lightX = clamp(state.lightX + 2.8 * deltaTime, -5.5, 5.5);
  const clampBox = activeScene?.targetClamp || { minX: -3.8, maxX: 3.8, minZ: -3.8, maxZ: 1.8 };
  state.target[0] = clamp(state.target[0], clampBox.minX, clampBox.maxX);
  state.target[2] = clamp(state.target[2], clampBox.minZ, clampBox.maxZ);
}

canvas.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  state.lastPointerX = event.clientX;
  state.lastPointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  state.yaw -= (event.clientX - state.lastPointerX) * 0.008;
  state.pitch = clamp(state.pitch - (event.clientY - state.lastPointerY) * 0.005, -0.25, 1.05);
  state.lastPointerX = event.clientX;
  state.lastPointerY = event.clientY;
});

function stopDragging(event) {
  state.dragging = false;
  if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.distance = clamp(state.distance + event.deltaY * 0.008, 5.4, 14);
}, { passive: false });

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d", "q", "e", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
    event.preventDefault();
    const mapped = key === "arrowup" ? "w" : key === "arrowdown" ? "s" : key === "arrowleft" ? "a" : key === "arrowright" ? "d" : key;
    if (mapped === "q" && !keys.has("q")) state.lightX = clamp(state.lightX - 0.35, -5.5, 5.5);
    if (mapped === "e" && !keys.has("e")) state.lightX = clamp(state.lightX + 0.35, -5.5, 5.5);
    keys.add(mapped);
  }
  if (key === "r") resetView();
});

window.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  keys.delete(key);
  if (key === "arrowup") keys.delete("w");
  if (key === "arrowdown") keys.delete("s");
  if (key === "arrowleft") keys.delete("a");
  if (key === "arrowright") keys.delete("d");
});

el.accents.addEventListener("change", () => {
  state.imageAccents = el.accents.checked;
  contentVersion += 1;
});
el.neon.addEventListener("change", () => {
  state.neon = el.neon.checked;
  syncNeonEnabled();
});
el.debug.addEventListener("change", () => { state.debug = el.debug.checked; });
el.quality.addEventListener("change", () => {
  state.shadowQuality = el.quality.value;
  ibrt.setQuality(state.shadowQuality);
  rebuildScene({ resetCamera: false });
  resize();
});
if (el.scene) {
  el.scene.addEventListener("change", () => {
    state.sceneId = el.scene.value;
    rebuildScene({ resetCamera: true });
  });
}
el.reset.addEventListener("click", resetView);
window.addEventListener("resize", resize);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.clearDepth(1);
if (el.scene) el.scene.value = state.sceneId;
rebuildScene({ resetCamera: true });
resize();

window.IBRT = {
  version: "0.7.0",
  qualityPresets: QUALITY_PRESETS,
  renderer: ibrt,
  state,
  scenes: Object.keys(SCENES),
};

function frame(now) {
  const deltaTime = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  fps = fps * 0.9 + (1 / Math.max(deltaTime, 0.001)) * 0.1;
  moveCamera(deltaTime);
  renderScene(now);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
