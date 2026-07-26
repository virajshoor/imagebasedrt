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
  yaw: 0,
  pitch: 0.28,
  distance: 9.2,
  target: [0, 1.35, -0.85],
  lightX: 3.8,
  lightZ: 2.8,
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
let viewportWidth = 1;
let viewportHeight = 1;
let lastFrame = performance.now();
let fps = 60;
let sceneObjects = [];
let floorObject = null;
let puddleObject = null;
let neonObjects = [];

// ---------------------------------------------------------------------------
// Procedural textures (demo content, not part of the portable method)
// ---------------------------------------------------------------------------

function createDemoTextures() {
  const floorTexture = ibrt.createTexture((ctx, width, height) => {
    ctx.fillStyle = "#10212b";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(113, 230, 227, .28)";
    ctx.lineWidth = 2;
    for (let line = 0; line <= width; line += 32) {
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, line);
      ctx.lineTo(width, line);
      ctx.stroke();
    }
  }, 128);

  const accentTexture = ibrt.createTexture((ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#123b49");
    gradient.addColorStop(0.55, "#18254c");
    gradient.addColorStop(1, "#4b2670");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(113, 230, 227, .62)";
    for (let line = -height; line < width + height; line += 27) {
      ctx.save();
      ctx.translate(line, 0);
      ctx.rotate(-0.56);
      ctx.fillRect(0, 0, 5, height * 1.7);
      ctx.restore();
    }
  }, 128);

  const neonTexture = ibrt.createTexture((ctx, width, height) => {
    ctx.fillStyle = "#04181f";
    ctx.fillRect(0, 0, width, height);
    const tube = ctx.createLinearGradient(0, 0, 0, height);
    tube.addColorStop(0, "rgba(8, 40, 48, 1)");
    tube.addColorStop(0.45, "rgba(180, 255, 250, 0.95)");
    tube.addColorStop(0.55, "rgba(255, 255, 255, 0.98)");
    tube.addColorStop(0.65, "rgba(120, 255, 240, 0.9)");
    tube.addColorStop(1, "rgba(8, 40, 48, 1)");
    ctx.fillStyle = tube;
    ctx.fillRect(18, 0, width - 36, height);
  }, 128);

  const orbTexture = ibrt.createTexture((ctx, width, height) => {
    const gradient = ctx.createRadialGradient(82, 70, 8, 128, 128, 170);
    gradient.addColorStop(0, "#ffe0a1");
    gradient.addColorStop(0.18, "#ff9b4d");
    gradient.addColorStop(0.58, "#cf3e22");
    gradient.addColorStop(1, "#5b1020");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }, 128);

  const darkTexture = ibrt.createTexture((ctx, width, height) => {
    ctx.fillStyle = "#18313c";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(113, 230, 227, .2)";
    for (let line = 0; line < width; line += 24) {
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, height);
      ctx.stroke();
    }
  }, 128);

  return { floorTexture, accentTexture, neonTexture, orbTexture, darkTexture };
}

// ---------------------------------------------------------------------------
// Neon letter sign (demo geometry; detail scales with quality preset)
// ---------------------------------------------------------------------------

function neonStroke(position, scale, style = {}) {
  return {
    mesh: meshCache.cube,
    position,
    scale,
    color: style.color || [0.08, 1, 0.92, 1],
    texture: style.texture,
    emissive: style.emissive || [0.03, 1.55, 1.35],
    neon: true,
    cast: false,
    receive: false,
    gloss: 140,
    rotation: style.rotation || 0,
    rotationZ: style.rotationZ || 0,
  };
}

function neonCap(position, radius, style = {}) {
  return {
    mesh: meshCache.sphere,
    position,
    scale: [radius, radius, radius],
    color: style.color || [0.08, 1, 0.92, 1],
    texture: style.texture,
    emissive: style.emissive || [0.03, 1.55, 1.35],
    neon: true,
    cast: false,
    receive: false,
    gloss: 140,
  };
}

function neonVert(strokes, x, y, z, halfHeight, tube, style, withCaps) {
  strokes.push(neonStroke([x, y, z], [tube, halfHeight, tube], style));
  if (withCaps) {
    strokes.push(neonCap([x, y + halfHeight, z], tube * 1.15, style));
    strokes.push(neonCap([x, y - halfHeight, z], tube * 1.15, style));
  }
}

function neonHoriz(strokes, x, y, z, halfWidth, tube, style, withCaps) {
  strokes.push(neonStroke([x, y, z], [halfWidth, tube, tube], style));
  if (withCaps) {
    strokes.push(neonCap([x - halfWidth, y, z], tube * 1.15, style));
    strokes.push(neonCap([x + halfWidth, y, z], tube * 1.15, style));
  }
}

function neonDiag(strokes, x, y, z, spanX, spanY, tube, style, withCaps) {
  const halfLen = Math.hypot(spanX, spanY) * 0.5;
  const tilt = Math.atan2(spanX, spanY);
  strokes.push(neonStroke([x, y, z], [tube, halfLen, tube], { ...style, rotationZ: tilt }));
  if (withCaps) {
    strokes.push(neonCap([x - Math.sin(tilt) * halfLen, y + Math.cos(tilt) * halfLen, z], tube * 1.15, style));
    strokes.push(neonCap([x + Math.sin(tilt) * halfLen, y - Math.cos(tilt) * halfLen, z], tube * 1.15, style));
  }
}

function neonOval(strokes, cx, y, z, radiusX, radiusY, tube, style, segments) {
  for (let index = 0; index < segments; index += 1) {
    const a0 = (index / segments) * Math.PI * 2;
    const a1 = ((index + 1) / segments) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * radiusX;
    const y0 = y + Math.sin(a0) * radiusY;
    const x1 = cx + Math.cos(a1) * radiusX;
    const y1 = y + Math.sin(a1) * radiusY;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const halfLen = Math.hypot(x1 - x0, y1 - y0) * 0.78;
    const tilt = Math.atan2(x1 - x0, y1 - y0);
    strokes.push(neonStroke([mx, my, z], [tube, halfLen, tube], { ...style, rotationZ: tilt }));
  }
}

function buildNeonSign(textures, detail = "balanced") {
  const strokes = [];
  const y = 3.95;
  const z = 0.35;
  const tube = detail === "low" ? 0.07 : 0.055;
  const h = 0.62;
  const withCaps = detail === "high";
  const ovalSegments = detail === "low" ? 12 : detail === "high" ? 24 : 16;
  const cyan = { color: [0.08, 1, 0.96, 1], emissive: [0.05, 1.85, 1.55], texture: textures.neonTexture };
  const magenta = { color: [1, 0.18, 0.58, 1], emissive: [1.8, 0.05, 0.42], texture: textures.neonTexture };

  strokes.push({
    mesh: meshCache.cube,
    position: [0, y, z - 0.16],
    scale: [3.05, 0.95, 0.06],
    color: [0.08, 0.11, 0.13, 1],
    texture: textures.darkTexture,
    emissive: [0.02, 0.035, 0.04],
    neon: true,
    cast: false,
    receive: true,
    gloss: 34,
  });
  strokes.push({
    mesh: meshCache.cube,
    position: [0, y - 1.05, z - 0.1],
    scale: [0.09, 0.6, 0.09],
    color: [0.16, 0.2, 0.22, 1],
    texture: textures.darkTexture,
    neon: true,
    cast: false,
    receive: true,
    gloss: 28,
  });

  const nX = -2.2;
  neonVert(strokes, nX, y, z, h, tube, cyan, withCaps);
  neonVert(strokes, nX + 0.9, y, z, h, tube, cyan, withCaps);
  neonDiag(strokes, nX + 0.45, y, z, 0.9, h * 2, tube, cyan, withCaps);

  const eX = -0.85;
  neonVert(strokes, eX - 0.32, y, z, h, tube, magenta, withCaps);
  neonHoriz(strokes, eX + 0.12, y + h - tube, z, 0.38, tube, magenta, withCaps);
  neonHoriz(strokes, eX + 0.06, y, z, 0.3, tube, magenta, withCaps);
  neonHoriz(strokes, eX + 0.12, y - h + tube, z, 0.38, tube, magenta, withCaps);

  neonOval(strokes, 0.7, y, z, 0.42, h, tube * 0.92, cyan, ovalSegments);

  const n2X = 1.55;
  neonVert(strokes, n2X, y, z, h, tube, magenta, withCaps);
  neonVert(strokes, n2X + 0.9, y, z, h, tube, magenta, withCaps);
  neonDiag(strokes, n2X + 0.45, y, z, 0.9, h * 2, tube, magenta, withCaps);

  return strokes;
}

// ---------------------------------------------------------------------------
// Scene rebuild (meshes + objects scale with the active quality preset)
// ---------------------------------------------------------------------------

function rebuildScene() {
  const preset = ibrt.preset;
  const textures = createDemoTextures();
  meshCache.cube = ibrt.buildCube();
  meshCache.plane = ibrt.buildPlane();
  meshCache.sphere = ibrt.buildSphere(preset.neonDetail === "low" ? 10 : 12, preset.neonDetail === "low" ? 14 : 18);
  meshCache.puddle = ibrt.buildPuddle(preset.puddleSegments, preset.puddleRings);

  neonObjects = buildNeonSign(textures, preset.neonDetail);

  sceneObjects = [
    { mesh: meshCache.plane, position: [0, 0, 0], scale: [8, 1, 6], color: [0.9, 0.96, 1, 1], texture: textures.floorTexture, cast: false, receive: true, gloss: 42 },
    { mesh: meshCache.cube, position: [0, 3.9, -5.5], scale: [7.2, 3.9, 0.15], color: [0.62, 0.82, 0.88, 1], texture: textures.darkTexture, cast: true, receive: true, gloss: 55 },
    { mesh: meshCache.cube, position: [0, 0.45, -1.15], scale: [1.8, 0.45, 1.55], color: [0.3, 0.58, 0.65, 1], texture: textures.darkTexture, rotation: 0.18, cast: true, receive: true, gloss: 52 },
    { mesh: meshCache.cube, position: [-3.2, 1.7, -0.6], scale: [0.55, 1.7, 0.55], color: [0.62, 0.4, 1, 1], texture: textures.accentTexture, cast: true, receive: true, gloss: 70 },
    { mesh: meshCache.cube, position: [0, 2.2, -1.1], scale: [0.75, 2.2, 0.75], color: [0.36, 0.92, 0.86, 1], texture: textures.accentTexture, cast: true, receive: true, gloss: 78 },
    { mesh: meshCache.cube, position: [2.8, 0.9, -0.35], scale: [1.0, 0.9, 1.0], color: [1, 0.5, 0.28, 1], texture: textures.accentTexture, rotation: -0.2, cast: true, receive: true, gloss: 35 },
    { mesh: meshCache.cube, position: [3.8, 0.65, -2.6], scale: [0.8, 0.65, 0.8], color: [0.68, 0.48, 1, 1], texture: textures.accentTexture, rotation: 0.32, cast: true, receive: true, gloss: 48 },
    { mesh: meshCache.sphere, position: [1.85, 2.55, 1.15], scale: [0.5, 0.5, 0.5], color: [1, 0.18, 0.06, 1], texture: textures.orbTexture, emissive: [0.18, 0.025, 0.006], cast: true, receive: true, gloss: 120 },
    { mesh: meshCache.cube, position: [-4.7, 0.75, -2.5], scale: [0.75, 0.75, 0.75], color: [0.35, 0.8, 0.95, 1], texture: textures.accentTexture, rotation: 0.45, cast: true, receive: true, gloss: 60 },
    ...neonObjects,
  ];

  floorObject = sceneObjects[0];
  puddleObject = {
    mesh: meshCache.puddle,
    position: [-0.1, 0.018, 1.15],
    scale: [1.08, 1, 1.08],
    color: [0.014, 0.085, 0.11],
    opacity: 0.94,
    planeY: 0,
  };

  // Keep a reference texture for the debug light marker.
  meshCache.debugTexture = textures.accentTexture;
}

// ---------------------------------------------------------------------------
// Frame / camera / input
// ---------------------------------------------------------------------------

function buildNeonLight() {
  return {
    position: [0, 3.95, 0.45],
    color: [0.4, 0.82, 0.95],
    intensity: state.neon ? 3.2 : 0,
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

  const objects = sceneObjects.map((object) => ({
    ...object,
    enabled: !object.neon || state.neon,
  }));

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
    objects,
    floorObject,
    water: puddleObject,
    textureEnabled: state.imageAccents,
    debugMarker,
    time: now / 1000,
    aspect,
  });

  el.renderer.textContent = "WEBGL2";
  el.shadow.textContent = `${stats.shadowSize}px`;
  el.draws.textContent = `${objects.filter((o) => o.enabled).length} + 2`;
  el.frame.textContent = `${Math.round(fps)} FPS`;
  el.shadow.title = `Shadow ${stats.shadowSize}px / reflection ${stats.reflectionSize}px (${stats.quality})`;
  el.draws.title = "Enabled scene draws plus shadow and reflection passes";
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
  state.yaw = 0;
  state.pitch = 0.28;
  state.distance = 9.2;
  state.target = [0, 1.35, -0.85];
  state.lightX = 3.8;
  state.lightZ = 2.8;
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
    keys.add(key === "arrowup" ? "w" : key === "arrowdown" ? "s" : key === "arrowleft" ? "a" : key === "arrowright" ? "d" : key);
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
el.neon.addEventListener("change", () => { state.neon = el.neon.checked; });
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

// Expose a tiny integration surface for checks / company experiments.
window.IBRT = {
  version: "0.5.0",
  qualityPresets: QUALITY_PRESETS,
  renderer: ibrt,
  state,
};

function frame(now) {
  const deltaTime = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  fps = fps * 0.92 + (1 / Math.max(deltaTime, 0.001)) * 0.08;
  moveCamera(deltaTime);
  renderScene(now);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
