/**
 * Neon Atrium — SCENE / 001
 * =========================
 *
 * Original Cursor Buildathon demo: low-poly atrium with a letterform NEON sign
 * and a feathered puddle. Kept as a lighter comparison scene next to Midnight Bar.
 *
 * Consumed by `main.js` via `buildNeonAtrium(ibrt, preset)`.
 */

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

let cachedAtriumTextures = null;

function createAtriumTextures(ibrt) {
  if (cachedAtriumTextures) return cachedAtriumTextures;

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

  cachedAtriumTextures = { floorTexture, accentTexture, neonTexture, orbTexture, darkTexture };
  return cachedAtriumTextures;
}

function buildNeonSign(ibrt, tex, detail = "balanced") {
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

export const neonAtriumMeta = {
  id: "atrium",
  code: "SCENE / 001",
  title: "Neon Atrium",
  blurb: "A low-cost 3D atrium with image-assisted surfaces, orbit controls, and a dynamic shadow-casting light.",
  neonLabel: "Neon sign",
  neonHint: "Letterform NEON tubes and colored local light",
  legendNote: "The round puddle reflects a mirrored scene image of the NEON letter sign, then gently warps it with soft undulation and thin feathered edges.",
  tryThis: "Cheap baseline: orbit around the NEON sign and watch the puddle. Compare draw count to Midnight Bar, then switch GPU quality → Low.",
};

export function buildNeonAtrium(ibrt, preset) {
  const tex = createAtriumTextures(ibrt);
  const cube = ibrt.buildCube();
  const plane = ibrt.buildPlane();
  const sphere = ibrt.buildSphere(preset.neonDetail === "low" ? 9 : 11, preset.neonDetail === "low" ? 12 : 16);
  const puddle = ibrt.buildPuddle(preset.puddleSegments, preset.puddleRings);
  const neonBatches = buildNeonSign(ibrt, tex, preset.neonDetail);

  const objects = [
    { mesh: plane, position: [0, 0, 0], scale: [8, 1, 6], color: [0.92, 0.97, 1, 1], texture: tex.floorTexture, cast: false, receive: true, gloss: 55, enabled: true },
    { mesh: cube, position: [0, 3.9, -5.5], scale: [7.2, 3.9, 0.15], color: [0.58, 0.78, 0.86, 1], texture: tex.darkTexture, cast: true, receive: true, gloss: 60, enabled: true },
    { mesh: cube, position: [0, 0.45, -1.15], scale: [1.8, 0.45, 1.55], color: [0.28, 0.55, 0.62, 1], texture: tex.darkTexture, rotation: 0.18, cast: true, receive: true, gloss: 58, enabled: true },
    { mesh: cube, position: [-3.2, 1.7, -0.6], scale: [0.55, 1.7, 0.55], color: [0.66, 0.42, 1, 1], texture: tex.accentTexture, cast: true, receive: true, gloss: 75, enabled: true },
    { mesh: cube, position: [0, 2.2, -1.1], scale: [0.75, 2.2, 0.75], color: [0.34, 0.94, 0.88, 1], texture: tex.accentTexture, cast: true, receive: true, gloss: 82, enabled: true },
    { mesh: cube, position: [2.8, 0.9, -0.35], scale: [1.0, 0.9, 1.0], color: [1, 0.52, 0.3, 1], texture: tex.accentTexture, rotation: -0.2, cast: true, receive: true, gloss: 40, enabled: true },
    { mesh: cube, position: [3.8, 0.65, -2.6], scale: [0.8, 0.65, 0.8], color: [0.7, 0.48, 1, 1], texture: tex.accentTexture, rotation: 0.32, cast: true, receive: true, gloss: 50, enabled: true },
    { mesh: sphere, position: [1.9, 2.45, 1.2], scale: [0.48, 0.48, 0.48], color: [1, 0.2, 0.08, 1], texture: tex.orbTexture, emissive: [0.28, 0.04, 0.01], cast: true, receive: true, gloss: 130, enabled: true },
    { mesh: cube, position: [-4.7, 0.75, -2.5], scale: [0.75, 0.75, 0.75], color: [0.35, 0.82, 0.96, 1], texture: tex.accentTexture, rotation: 0.45, cast: true, receive: true, gloss: 65, enabled: true },
    ...neonBatches,
  ];

  return {
    objects,
    floorObject: objects[0],
    water: {
      mesh: puddle,
      position: [-0.05, 0.016, 1.2],
      scale: [1.12, 1, 1.1],
      color: [0.012, 0.08, 0.105],
      opacity: 0.96,
      planeY: 0,
    },
    clearColor: [0.016, 0.038, 0.055, 1],
    localLight: {
      position: [0, 3.95, 0.5],
      color: [0.45, 0.88, 1.0],
      intensity: 3.4,
    },
    camera: {
      yaw: 0.12,
      pitch: 0.34,
      distance: 8.8,
      target: [0, 1.45, -0.55],
      lightX: 3.4,
      lightZ: 2.4,
    },
    bounds: { minX: -6.1, maxX: 6.1, minY: 0.35, maxY: 8.2, minZ: -4.8, maxZ: 5.8 },
    targetClamp: { minX: -3.8, maxX: 3.8, minZ: -3.8, maxZ: 1.8 },
    lightLookAt: [0, 1.2, -1],
    debugTexture: tex.accentTexture,
    debugMesh: sphere,
  };
}
