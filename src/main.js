/**
 * Image Based RT — Neon Atrium demo scene.
 *
 * Scene authorship, UI, and input live here. The reusable image-based RT
 * method (shadow map + mirrored reflection image + water composite) lives in
 * `implementation.js` so companies can adopt the same approach without this
 * demo shell.
 */

import {
  QUALITY_PRESETS,
  clamp,
  createImageBasedRT,
  recommendContextOptions,
} from "./implementation.js";

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
  debug: document.querySelector("#debugToggle"),
  quality: document.querySelector("#qualitySelect"),
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

const state = {
  yaw: 0.12,
  pitch: 0.34,
  distance: 8.8,
  target: [0, 1.45, -0.55],
  lightX: 3.4,
  lightZ: 2.4,
  imageAccents: true,
  neon: true,
  debug: false,
  shadowQuality: initialQuality,
  dragging: false,
  lastPointerX: 0,
  lastPointerY: 0,
};

const keys = new Set();
const meshCache = {};
let textures = null;
let viewportWidth = 1;
let viewportHeight = 1;
let lastFrame = performance.now();
let fps = 60;
let telemetryTick = 0;
let sceneObjects = [];
let floorObject = null;
let puddleObject = null;
let enabledDrawCount = 0;

// ---------------------------------------------------------------------------
// Procedural textures (cached across quality rebuilds)
// ---------------------------------------------------------------------------

function createDemoTextures() {
  if (textures) return textures;

  const floorTexture = ibrt.createTexture((ctx, width, height) => {
    const wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, "#0c1a22");
    wash.addColorStop(1, "#122833");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(120, 220, 215, .22)";
    ctx.lineWidth = 1.5;
    for (let line = 0; line <= width; line += 32) {
      ctx.beginPath();
      ctx.moveTo(line + 0.5, 0);
      ctx.lineTo(line + 0.5, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, line + 0.5);
      ctx.lineTo(width, line + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 170, 110, .08)";
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
  }, 128);

  const accentTexture = ibrt.createTexture((ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#153844");
    gradient.addColorStop(0.5, "#1a2748");
    gradient.addColorStop(1, "#3d2460");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(110, 230, 220, .45)";
    for (let line = -height; line < width + height; line += 34) {
      ctx.save();
      ctx.translate(line, 0);
      ctx.rotate(-0.5);
      ctx.fillRect(0, 0, 3, height * 1.7);
      ctx.restore();
    }
    ctx.fillStyle = "rgba(255, 180, 120, .55)";
    ctx.fillRect(24, 48, 70, 4);
    ctx.fillRect(140, 160, 40, 3);
  }, 128);

  const neonTexture = ibrt.createTexture((ctx, width, height) => {
    ctx.fillStyle = "#03141a";
    ctx.fillRect(0, 0, width, height);
    const tube = ctx.createLinearGradient(0, 0, 0, height);
    tube.addColorStop(0, "rgba(6, 36, 42, 1)");
    tube.addColorStop(0.42, "rgba(170, 255, 248, 0.95)");
    tube.addColorStop(0.5, "rgba(255, 255, 255, 1)");
    tube.addColorStop(0.58, "rgba(120, 255, 240, 0.95)");
    tube.addColorStop(1, "rgba(6, 36, 42, 1)");
    ctx.fillStyle = tube;
    ctx.fillRect(20, 0, width - 40, height);
  }, 64);

  const orbTexture = ibrt.createTexture((ctx, width, height) => {
    const gradient = ctx.createRadialGradient(78, 66, 6, 128, 128, 160);
    gradient.addColorStop(0, "#ffe7b0");
    gradient.addColorStop(0.2, "#ff9a45");
    gradient.addColorStop(0.55, "#d03a1c");
    gradient.addColorStop(1, "#4a0e18");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 240, 200, .55)";
    ctx.beginPath();
    ctx.ellipse(74, 58, 14, 8, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }, 128);

  const darkTexture = ibrt.createTexture((ctx, width, height) => {
    ctx.fillStyle = "#152a34";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(100, 210, 205, .14)";
    for (let line = 0; line < width; line += 28) {
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, height);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 160, 100, .28)";
    ctx.fillRect(0, 100, width, 2);
  }, 128);

  textures = { floorTexture, accentTexture, neonTexture, orbTexture, darkTexture };
  return textures;
}

// ---------------------------------------------------------------------------
// Neon letter sign — strokes are baked into 2–3 meshes (few draw calls)
// ---------------------------------------------------------------------------

function pushStroke(list, position, scale, rotationZ = 0) {
  list.push({ position, scale, rotation: 0, rotationZ });
}

function pushVert(list, x, y, z, halfHeight, tube) {
  pushStroke(list, [x, y, z], [tube, halfHeight, tube]);
}

function pushHoriz(list, x, y, z, halfWidth, tube) {
  pushStroke(list, [x, y, z], [halfWidth, tube, tube]);
}

function pushDiag(list, x, y, z, spanX, spanY, tube) {
  const halfLen = Math.hypot(spanX, spanY) * 0.5;
  const tilt = Math.atan2(spanX, spanY);
  pushStroke(list, [x, y, z], [tube, halfLen, tube], tilt);
}

function pushOval(list, cx, y, z, radiusX, radiusY, tube, segments) {
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * radiusX;
    const y0 = y + Math.sin(a0) * radiusY;
    const x1 = cx + Math.cos(a1) * radiusX;
    const y1 = y + Math.sin(a1) * radiusY;
    const halfLen = Math.hypot(x1 - x0, y1 - y0) * 0.8;
    const tilt = Math.atan2(x1 - x0, y1 - y0);
    pushStroke(list, [(x0 + x1) * 0.5, (y0 + y1) * 0.5, z], [tube, halfLen, tube], tilt);
  }
}

function buildNeonSign(detail = "balanced") {
  const y = 3.95;
  const z = 0.35;
  const tube = detail === "low" ? 0.075 : 0.058;
  const h = 0.64;
  const ovalSegments = detail === "low" ? 10 : detail === "high" ? 18 : 12;
  const cyan = [];
  const magenta = [];
  const housing = [];

  pushStroke(housing, [0, y, z - 0.16], [3.05, 0.95, 0.06]);
  pushStroke(housing, [0, y - 1.05, z - 0.1], [0.09, 0.6, 0.09]);
  // Thin accent frame on the housing
  pushStroke(housing, [0, y + 0.9, z - 0.1], [2.95, 0.018, 0.02]);
  pushStroke(housing, [0, y - 0.9, z - 0.1], [2.95, 0.018, 0.02]);

  const nX = -2.2;
  pushVert(cyan, nX, y, z, h, tube);
  pushVert(cyan, nX + 0.9, y, z, h, tube);
  pushDiag(cyan, nX + 0.45, y, z, 0.9, h * 2, tube);

  const eX = -0.85;
  pushVert(magenta, eX - 0.32, y, z, h, tube);
  pushHoriz(magenta, eX + 0.12, y + h - tube, z, 0.38, tube);
  pushHoriz(magenta, eX + 0.06, y, z, 0.3, tube);
  pushHoriz(magenta, eX + 0.12, y - h + tube, z, 0.38, tube);

  pushOval(cyan, 0.7, y, z, 0.42, h, tube * 0.92, ovalSegments);

  const n2X = 1.55;
  pushVert(magenta, n2X, y, z, h, tube);
  pushVert(magenta, n2X + 0.9, y, z, h, tube);
  pushDiag(magenta, n2X + 0.45, y, z, 0.9, h * 2, tube);

  const tex = createDemoTextures();
  return [
    {
      mesh: ibrt.mergeCubeInstances(housing),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: [0.1, 0.13, 0.15, 1],
      texture: tex.darkTexture,
      emissive: [0.025, 0.04, 0.045],
      neon: true,
      cast: false,
      receive: true,
      gloss: 36,
      enabled: true,
    },
    {
      mesh: ibrt.mergeCubeInstances(cyan),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: [0.1, 1, 0.96, 1],
      texture: tex.neonTexture,
      emissive: [0.08, 2.1, 1.75],
      neon: true,
      cast: false,
      receive: false,
      gloss: 140,
      enabled: true,
    },
    {
      mesh: ibrt.mergeCubeInstances(magenta),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: [1, 0.2, 0.58, 1],
      texture: tex.neonTexture,
      emissive: [2.0, 0.08, 0.5],
      neon: true,
      cast: false,
      receive: false,
      gloss: 140,
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Scene rebuild
// ---------------------------------------------------------------------------

function rebuildScene() {
  const preset = ibrt.preset;
  const tex = createDemoTextures();
  meshCache.cube = ibrt.buildCube();
  meshCache.plane = ibrt.buildPlane();
  meshCache.sphere = ibrt.buildSphere(preset.neonDetail === "low" ? 9 : 11, preset.neonDetail === "low" ? 12 : 16);
  meshCache.puddle = ibrt.buildPuddle(preset.puddleSegments, preset.puddleRings);
  meshCache.debugTexture = tex.accentTexture;

  const neonBatches = buildNeonSign(preset.neonDetail);

  sceneObjects = [
    { mesh: meshCache.plane, position: [0, 0, 0], scale: [8, 1, 6], color: [0.92, 0.97, 1, 1], texture: tex.floorTexture, cast: false, receive: true, gloss: 55, enabled: true },
    { mesh: meshCache.cube, position: [0, 3.9, -5.5], scale: [7.2, 3.9, 0.15], color: [0.58, 0.78, 0.86, 1], texture: tex.darkTexture, cast: true, receive: true, gloss: 60, enabled: true },
    { mesh: meshCache.cube, position: [0, 0.45, -1.15], scale: [1.8, 0.45, 1.55], color: [0.28, 0.55, 0.62, 1], texture: tex.darkTexture, rotation: 0.18, cast: true, receive: true, gloss: 58, enabled: true },
    { mesh: meshCache.cube, position: [-3.2, 1.7, -0.6], scale: [0.55, 1.7, 0.55], color: [0.66, 0.42, 1, 1], texture: tex.accentTexture, cast: true, receive: true, gloss: 75, enabled: true },
    { mesh: meshCache.cube, position: [0, 2.2, -1.1], scale: [0.75, 2.2, 0.75], color: [0.34, 0.94, 0.88, 1], texture: tex.accentTexture, cast: true, receive: true, gloss: 82, enabled: true },
    { mesh: meshCache.cube, position: [2.8, 0.9, -0.35], scale: [1.0, 0.9, 1.0], color: [1, 0.52, 0.3, 1], texture: tex.accentTexture, rotation: -0.2, cast: true, receive: true, gloss: 40, enabled: true },
    { mesh: meshCache.cube, position: [3.8, 0.65, -2.6], scale: [0.8, 0.65, 0.8], color: [0.7, 0.48, 1, 1], texture: tex.accentTexture, rotation: 0.32, cast: true, receive: true, gloss: 50, enabled: true },
    { mesh: meshCache.sphere, position: [1.9, 2.45, 1.2], scale: [0.48, 0.48, 0.48], color: [1, 0.2, 0.08, 1], texture: tex.orbTexture, emissive: [0.28, 0.04, 0.01], cast: true, receive: true, gloss: 130, enabled: true },
    { mesh: meshCache.cube, position: [-4.7, 0.75, -2.5], scale: [0.75, 0.75, 0.75], color: [0.35, 0.82, 0.96, 1], texture: tex.accentTexture, rotation: 0.45, cast: true, receive: true, gloss: 65, enabled: true },
    ...neonBatches,
  ];

  floorObject = sceneObjects[0];
  puddleObject = {
    mesh: meshCache.puddle,
    position: [-0.05, 0.016, 1.2],
    scale: [1.12, 1, 1.1],
    color: [0.012, 0.08, 0.105],
    opacity: 0.96,
    planeY: 0,
  };
  syncNeonEnabled();
}

function syncNeonEnabled() {
  enabledDrawCount = 0;
  sceneObjects.forEach((object) => {
    object.enabled = !object.neon || state.neon;
    if (object.enabled) enabledDrawCount += 1;
  });
}

// ---------------------------------------------------------------------------
// Frame / camera / input
// ---------------------------------------------------------------------------

function buildNeonLight() {
  return {
    position: [0, 3.95, 0.5],
    color: [0.45, 0.88, 1.0],
    intensity: state.neon ? 3.4 : 0,
  };
}

function renderScene(now) {
  const aspect = viewportWidth / viewportHeight;
  const camera = ibrt.buildOrbitCamera({
    yaw: state.yaw,
    pitch: state.pitch,
    distance: state.distance,
    target: state.target,
    aspect,
    bounds: { minX: -6.1, maxX: 6.1, minY: 0.35, maxY: 8.2, minZ: -4.8, maxZ: 5.8 },
  });
  const light = ibrt.buildOrthoLight({
    position: [state.lightX, 7.2, state.lightZ],
  });
  const localLight = buildNeonLight();

  const debugMarker = state.debug ? {
    mesh: meshCache.sphere,
    position: light.lightPosition,
    scale: [0.16, 0.16, 0.16],
    color: [1, 0.45, 0.12, 1],
    texture: meshCache.debugTexture,
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
    clearColor: [0.016, 0.038, 0.055, 1],
  });

  telemetryTick += 1;
  if (telemetryTick % 8 === 0) {
    el.renderer.textContent = "WEBGL2";
    el.shadow.textContent = `${stats.reflectionSize}px`;
    el.draws.textContent = `${enabledDrawCount} + 2`;
    el.frame.textContent = `${Math.round(fps)} FPS`;
    el.shadow.title = `Reflection ${stats.reflectionSize}px / shadow ${stats.shadowSize}px (${stats.quality})`;
    el.draws.title = "Batched scene draws plus shadow and reflection passes";
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
  state.yaw = 0.12;
  state.pitch = 0.34;
  state.distance = 8.8;
  state.target = [0, 1.45, -0.55];
  state.lightX = 3.4;
  state.lightZ = 2.4;
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
  state.target[0] = clamp(state.target[0], -3.8, 3.8);
  state.target[2] = clamp(state.target[2], -3.8, 1.8);
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
    // Nudge light immediately so quick taps register, then hold continues in the loop.
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

el.accents.addEventListener("change", () => { state.imageAccents = el.accents.checked; });
el.neon.addEventListener("change", () => {
  state.neon = el.neon.checked;
  syncNeonEnabled();
});
el.debug.addEventListener("change", () => { state.debug = el.debug.checked; });
el.quality.addEventListener("change", () => {
  state.shadowQuality = el.quality.value;
  ibrt.setQuality(state.shadowQuality);
  rebuildScene();
  resize();
});
el.reset.addEventListener("click", resetView);
window.addEventListener("resize", resize);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.clearDepth(1);
rebuildScene();
resize();

window.IBRT = {
  version: "0.5.2",
  qualityPresets: QUALITY_PRESETS,
  renderer: ibrt,
  state,
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
