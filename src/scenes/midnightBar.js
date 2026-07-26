/**
 * Midnight Bar — SCENE / 002
 * ==========================
 *
 * Dense, game-style lounge used to stress-test Image Based RT with many
 * curved props (not cubes). Built entirely from procedural meshes:
 *   - Lathed bottles / glassware (solids of revolution)
 *   - Stadium (pill-shaped) bar counter and shelves
 *   - Capsule booths, torus stool rings, pendant spheres
 *   - Wet-floor puddle that mirrors the back-bar + BAR neon
 *
 * Consumed by `main.js` via `buildMidnightBar(ibrt, preset)`.
 * Returns a scene descriptor: objects, water, camera defaults, lights, bounds.
 */

// ---------------------------------------------------------------------------
// Quality → mesh density
// ---------------------------------------------------------------------------

/** Map GPU quality preset to segment counts for curved meshes. */
function detailLevel(preset) {
  const name = preset.neonDetail || "balanced";
  if (name === "low") return { segs: 16, lathe: 14, sphere: [10, 14], torus: [18, 10], neonOval: 12 };
  if (name === "high") return { segs: 32, lathe: 28, sphere: [16, 24], torus: [32, 16], neonOval: 22 };
  return { segs: 24, lathe: 20, sphere: [12, 18], torus: [24, 12], neonOval: 16 };
}

// ---------------------------------------------------------------------------
// Procedural textures (Canvas2D → WebGL, cached across quality rebuilds)
// ---------------------------------------------------------------------------

let cachedBarTextures = null;

function createBarTextures(ibrt) {
  if (cachedBarTextures) return cachedBarTextures;

  // Warm wood grain for the bar body.
  const wood = ibrt.createTexture((ctx, w, h) => {
    const base = ctx.createLinearGradient(0, 0, w, 0);
    base.addColorStop(0, "#2a1810");
    base.addColorStop(0.5, "#3d2418");
    base.addColorStop(1, "#24140e");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i += 1) {
      const x = (i * 37) % w;
      ctx.strokeStyle = `rgba(90, 50, 28, ${0.12 + (i % 5) * 0.04})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 8, h * 0.35, x - 6, h * 0.65, x + 4, h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 180, 100, 0.05)";
    ctx.fillRect(0, 0, w, h);
  }, 256);

  // Dark tiled floor with a cool wash so the puddle reads as wet.
  const floor = ibrt.createTexture((ctx, w, h) => {
    ctx.fillStyle = "#12161c";
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 18) {
      for (let x = 0; x < w; x += 48) {
        const odd = ((x / 48) + (y / 18)) % 2;
        ctx.fillStyle = odd ? "rgba(40, 48, 58, 0.55)" : "rgba(28, 34, 42, 0.55)";
        ctx.fillRect(x, y, 46, 16);
        ctx.strokeStyle = "rgba(90, 110, 130, 0.12)";
        ctx.strokeRect(x + 0.5, y + 0.5, 45, 15);
      }
    }
    ctx.fillStyle = "rgba(120, 200, 220, 0.04)";
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
  }, 256);

  // Metallic brass with a specular highlight stripe.
  const brass = ibrt.createTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#5a3a18");
    g.addColorStop(0.35, "#d4a45a");
    g.addColorStop(0.55, "#fff0c8");
    g.addColorStop(0.75, "#b8843a");
    g.addColorStop(1, "#4a2e12");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(w * 0.2, 0, w * 0.08, h);
  }, 128);

  // Deep red velvet for seats / curtains.
  const velvet = ibrt.createTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.4, h * 0.35, 8, w * 0.5, h * 0.5, w * 0.7);
    g.addColorStop(0, "#6a1a32");
    g.addColorStop(0.55, "#3a0e1c");
    g.addColorStop(1, "#1a0810");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 80; i += 1) {
      ctx.fillStyle = `rgba(180, 60, 90, ${0.03 + (i % 4) * 0.02})`;
      ctx.fillRect((i * 17) % w, (i * 29) % h, 2, 6);
    }
  }, 128);

  // Clear glass — bright center band reads as refraction highlight.
  const glass = ibrt.createTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "#0a1820");
    g.addColorStop(0.35, "#6ec8d8");
    g.addColorStop(0.5, "#e8ffff");
    g.addColorStop(0.65, "#6ec8d8");
    g.addColorStop(1, "#0a1820");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(w * 0.42, 0, w * 0.06, h);
  }, 64);

  // Amber liquor / warm pendant glow.
  const amber = ibrt.createTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#3a1808");
    g.addColorStop(0.4, "#c46820");
    g.addColorStop(0.7, "#ffb040");
    g.addColorStop(1, "#5a2010");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 64);

  // Hot neon tube cross-section for the BAR letters.
  const neon = ibrt.createTexture((ctx, w, h) => {
    ctx.fillStyle = "#081018";
    ctx.fillRect(0, 0, w, h);
    const tube = ctx.createLinearGradient(0, 0, 0, h);
    tube.addColorStop(0, "rgba(8, 20, 40, 1)");
    tube.addColorStop(0.4, "rgba(255, 90, 160, 0.95)");
    tube.addColorStop(0.5, "rgba(255, 255, 255, 1)");
    tube.addColorStop(0.6, "rgba(255, 120, 180, 0.95)");
    tube.addColorStop(1, "rgba(8, 20, 40, 1)");
    ctx.fillStyle = tube;
    ctx.fillRect(16, 0, w - 32, h);
  }, 64);

  // Cool marble / stone for counter top and shelves.
  const marble = ibrt.createTexture((ctx, w, h) => {
    ctx.fillStyle = "#1c2228";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(180, 200, 210, 0.22)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 12; i += 1) {
      ctx.beginPath();
      ctx.moveTo((i * 41) % w, 0);
      ctx.bezierCurveTo(w * 0.3, h * 0.4, w * 0.7, h * 0.2, (i * 53) % w, h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255, 220, 180, 0.06)";
    ctx.fillRect(0, 0, w, h);
  }, 128);

  // Neutral dark fill for housing / cables.
  const dark = ibrt.createTexture((ctx, w, h) => {
    ctx.fillStyle = "#141820";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(100, 140, 160, 0.08)";
    ctx.fillRect(0, h * 0.48, w, 2);
  }, 64);

  cachedBarTextures = { wood, floor, brass, velvet, glass, amber, neon, marble, dark };
  return cachedBarTextures;
}

// ---------------------------------------------------------------------------
// Neon BAR letter helpers (cube strokes merged into few draw calls)
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

/** Approximate a curved neon tube as a ring of short box strokes. */
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

/**
 * Build the wall-mounted BAR neon: dark housing + pink/cyan emissive tubes.
 * Objects marked `neon: true` are toggled by the inspector "Bar neon" switch.
 */
function buildBarNeon(ibrt, tex, detail) {
  const y = 3.55;
  const z = -4.55;
  const tube = 0.05;
  const pink = [];
  const cyan = [];
  const housing = [];

  // Sign backplate + side posts.
  pushStroke(housing, [0, y, z - 0.12], [2.4, 0.72, 0.05]);
  pushStroke(housing, [-1.9, y - 0.95, z - 0.08], [0.06, 0.55, 0.06]);
  pushStroke(housing, [1.9, y - 0.95, z - 0.08], [0.06, 0.55, 0.06]);

  // Letter B — vertical stem + two lobes.
  pushVert(pink, -1.55, y, z, 0.48, tube);
  pushOval(pink, -1.22, y + 0.22, z, 0.28, 0.22, tube * 0.9, Math.floor(detail.neonOval * 0.55));
  pushOval(pink, -1.2, y - 0.22, z, 0.32, 0.24, tube * 0.9, Math.floor(detail.neonOval * 0.55));

  // Letter A — two legs + crossbar (cyan for contrast in the puddle).
  pushVert(cyan, -0.45, y, z, 0.48, tube);
  pushVert(cyan, 0.15, y, z, 0.48, tube);
  pushHoriz(cyan, -0.15, y - 0.05, z, 0.28, tube);
  pushHoriz(cyan, -0.15, y + 0.42, z, 0.18, tube);

  // Letter R — stem + bowl + diagonal leg.
  pushVert(pink, 0.75, y, z, 0.48, tube);
  pushOval(pink, 1.1, y + 0.18, z, 0.3, 0.26, tube * 0.9, Math.floor(detail.neonOval * 0.5));
  pushStroke(pink, [1.22, y - 0.28, z], [tube, 0.32, tube], 0.55);

  return [
    {
      mesh: ibrt.mergeCubeInstances(housing),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: [0.08, 0.09, 0.11, 1],
      texture: tex.dark,
      emissive: [0.02, 0.02, 0.03],
      neon: true,
      cast: false,
      receive: true,
      gloss: 40,
      enabled: true,
    },
    {
      mesh: ibrt.mergeCubeInstances(pink),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: [1, 0.35, 0.65, 1],
      texture: tex.neon,
      emissive: [1.8, 0.15, 0.55],
      neon: true,
      cast: false,
      receive: false,
      gloss: 140,
      enabled: true,
    },
    {
      mesh: ibrt.mergeCubeInstances(cyan),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: [0.35, 0.95, 1, 1],
      texture: tex.neon,
      emissive: [0.15, 1.4, 1.6],
      neon: true,
      cast: false,
      receive: false,
      gloss: 140,
      enabled: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Lathe profiles — [radius, y] pairs revolved around Y into bottle / glass meshes
// ---------------------------------------------------------------------------

const PROFILES = {
  wine: [
    [0.0, 0.0], [0.07, 0.0], [0.11, 0.04], [0.125, 0.22], [0.13, 0.45],
    [0.12, 0.62], [0.06, 0.78], [0.045, 0.95], [0.048, 1.08], [0.055, 1.12], [0.0, 1.12],
  ],
  whiskey: [
    [0.0, 0.0], [0.09, 0.0], [0.13, 0.05], [0.14, 0.35], [0.135, 0.55],
    [0.1, 0.68], [0.07, 0.78], [0.06, 0.88], [0.07, 0.92], [0.0, 0.92],
  ],
  decanter: [
    [0.0, 0.0], [0.1, 0.0], [0.16, 0.08], [0.18, 0.28], [0.16, 0.48],
    [0.1, 0.62], [0.07, 0.75], [0.08, 0.82], [0.0, 0.82],
  ],
  tumbler: [
    [0.0, 0.0], [0.09, 0.0], [0.095, 0.05], [0.1, 0.28], [0.098, 0.38], [0.0, 0.38],
  ],
  coupe: [
    [0.0, 0.0], [0.04, 0.0], [0.04, 0.02], [0.035, 0.18], [0.03, 0.32],
    [0.04, 0.34], [0.14, 0.42], [0.16, 0.52], [0.14, 0.58], [0.0, 0.58],
  ],
  shaker: [
    [0.0, 0.0], [0.08, 0.0], [0.11, 0.06], [0.12, 0.35], [0.1, 0.55],
    [0.07, 0.7], [0.05, 0.78], [0.06, 0.82], [0.0, 0.82],
  ],
  bottleSlim: [
    [0.0, 0.0], [0.055, 0.0], [0.08, 0.04], [0.085, 0.4], [0.07, 0.65],
    [0.04, 0.85], [0.035, 1.05], [0.04, 1.1], [0.0, 1.1],
  ],
};

/** Shorthand for an opaque scene object (every surface needs a texture bind). */
function obj(mesh, position, scale, color, texture, extras = {}) {
  return {
    mesh,
    position,
    scale,
    color,
    texture,
    cast: true,
    receive: true,
    gloss: 70,
    enabled: true,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Public scene API
// ---------------------------------------------------------------------------

/** Inspector copy + neon toggle labels for this scene. */
export const midnightBarMeta = {
  id: "bar",
  code: "SCENE / 002",
  title: "Midnight Bar",
  blurb: "A denser game-style lounge: lathed bottles, curved counter, stools, pendants, and a wet floor that stresses the reflection path.",
  neonLabel: "Bar neon",
  neonHint: "BAR letter tubes and warm local glow",
  legendNote: "The wet floor puddle mirrors shelves, bottles, and the BAR neon — a denser reflection stress test than the atrium.",
};

/**
 * Assemble the full Midnight Bar scene for the current quality preset.
 * @param {object} ibrt   createImageBasedRT() instance (mesh / texture helpers)
 * @param {object} preset active QUALITY_PRESETS entry
 */
export function buildMidnightBar(ibrt, preset) {
  const detail = detailLevel(preset);
  const tex = createBarTextures(ibrt);

  // Shared mesh library — instanced many times via position/scale (not re-uploaded).
  const meshes = {
    plane: ibrt.buildPlane(),
    cube: ibrt.buildCube(),
    sphere: ibrt.buildSphere(detail.sphere[0], detail.sphere[1]),
    cylinder: ibrt.buildCylinder(detail.segs, 2, 1, 1, true),
    taper: ibrt.buildCylinder(detail.segs, 3, 0.55, 1, true), // stool / table legs
    capsule: ibrt.buildCapsule(Math.max(6, Math.floor(detail.segs / 3)), detail.segs),
    torus: ibrt.buildTorus(detail.torus[0], detail.torus[1], 1, 0.22),
    seat: ibrt.buildCylinder(detail.segs, 1, 1, 1, true),
    stadium: ibrt.buildStadium(detail.segs, 2.2, 1, 0.18), // pill-shaped counter / shelves
    footRail: ibrt.buildTorus(detail.torus[0], detail.torus[1], 1, 0.08),
    wine: ibrt.buildLathe(PROFILES.wine, detail.lathe),
    whiskey: ibrt.buildLathe(PROFILES.whiskey, detail.lathe),
    decanter: ibrt.buildLathe(PROFILES.decanter, detail.lathe),
    tumbler: ibrt.buildLathe(PROFILES.tumbler, detail.lathe),
    coupe: ibrt.buildLathe(PROFILES.coupe, detail.lathe),
    shaker: ibrt.buildLathe(PROFILES.shaker, detail.lathe),
    slim: ibrt.buildLathe(PROFILES.bottleSlim, detail.lathe),
    puddle: ibrt.buildPuddle(preset.puddleSegments, preset.puddleRings),
  };

  const objects = [];

  // --- Room shell ----------------------------------------------------------
  // floorObject must be the same reference passed to renderFrame so the mirror
  // pass can skip the floor (avoids reflecting the puddle into itself).
  const floor = obj(meshes.plane, [0, 0, 0], [7.5, 1, 5.5], [0.85, 0.9, 0.95, 1], tex.floor, { cast: false, gloss: 90 });
  objects.push(floor);

  objects.push(obj(meshes.cube, [0, 2.6, -5.35], [7.2, 2.6, 0.12], [0.22, 0.2, 0.24, 1], tex.velvet, { gloss: 35 }));
  objects.push(obj(meshes.cube, [0, 5.05, -1.2], [7.4, 0.12, 4.8], [0.12, 0.12, 0.14, 1], tex.dark, { cast: false, gloss: 20 }));
  // Soft side curtains (capsules read as fabric, not boxes).
  objects.push(obj(meshes.capsule, [-6.4, 2.4, -1.5], [0.35, 1.55, 0.35], [0.55, 0.12, 0.22, 1], tex.velvet, { gloss: 25, cast: false }));
  objects.push(obj(meshes.capsule, [6.4, 2.4, -1.5], [0.35, 1.55, 0.35], [0.55, 0.12, 0.22, 1], tex.velvet, { gloss: 25, cast: false }));

  // --- Back-bar shelves ----------------------------------------------------
  for (const y of [1.55, 2.25, 2.95]) {
    objects.push(obj(meshes.stadium, [0, y, -4.85], [2.6, 0.7, 0.55], [0.75, 0.72, 0.68, 1], tex.marble, { gloss: 95, cast: true }));
  }
  objects.push(obj(meshes.cylinder, [-5.2, 2.2, -4.85], [0.08, 2.4, 0.08], [0.55, 0.42, 0.28, 1], tex.brass, { gloss: 110 }));
  objects.push(obj(meshes.cylinder, [5.2, 2.2, -4.85], [0.08, 2.4, 0.08], [0.55, 0.42, 0.28, 1], tex.brass, { gloss: 110 }));

  // --- Curved bar counter + brass foot rail --------------------------------
  objects.push(obj(meshes.stadium, [0, 0.52, 0.35], [2.85, 1.55, 0.95], [0.42, 0.26, 0.16, 1], tex.wood, { gloss: 55 }));
  objects.push(obj(meshes.stadium, [0, 1.08, 0.35], [2.95, 0.55, 1.05], [0.82, 0.78, 0.74, 1], tex.marble, { gloss: 120 }));
  objects.push(obj(meshes.cylinder, [0, 0.28, 0.35], [2.55, 0.12, 0.72], [0.45, 0.32, 0.18, 1], tex.wood, { gloss: 40 }));
  // Cylinders tip onto X via rotationZ so rails run along the bar face.
  for (const x of [-3.6, -1.8, 0, 1.8, 3.6]) {
    objects.push(obj(meshes.cylinder, [x, 0.22, 1.55], [0.045, 0.85, 0.045], [0.7, 0.55, 0.28, 1], tex.brass, {
      rotationZ: Math.PI * 0.5,
      gloss: 130,
      cast: false,
    }));
  }
  for (const x of [-4.2, -2.4, -0.6, 1.2, 3.0, 4.2]) {
    objects.push(obj(meshes.sphere, [x, 0.22, 1.75], [0.06, 0.06, 0.06], [0.85, 0.65, 0.3, 1], tex.brass, {
      gloss: 140,
      cast: false,
    }));
  }

  // --- Bar stools (velvet pad + brass rings + tapered leg) -----------------
  for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) {
    const z = 2.15;
    objects.push(obj(meshes.seat, [x, 0.72, z], [0.38, 0.1, 0.38], [0.55, 0.12, 0.22, 1], tex.velvet, { gloss: 35 }));
    objects.push(obj(meshes.torus, [x, 0.68, z], [0.34, 0.34, 0.34], [0.65, 0.48, 0.25, 1], tex.brass, { gloss: 120, cast: false }));
    objects.push(obj(meshes.taper, [x, 0.36, z], [0.07, 0.62, 0.07], [0.55, 0.42, 0.25, 1], tex.brass, { gloss: 100 }));
    objects.push(obj(meshes.torus, [x, 0.08, z], [0.22, 0.22, 0.22], [0.55, 0.4, 0.22, 1], tex.brass, { gloss: 110, cast: false }));
    objects.push(obj(meshes.sphere, [x, 0.05, z], [0.08, 0.04, 0.08], [0.35, 0.28, 0.18, 1], tex.dark, { cast: false, gloss: 40 }));
  }

  // --- Bottle back-bar (hero curved props for the reflection pass) ---------
  const bottleRows = [
    { y: 1.62, items: [
      { mesh: meshes.wine, x: -4.2, s: 0.55, color: [0.35, 0.05, 0.12, 1], tex: tex.amber },
      { mesh: meshes.slim, x: -3.5, s: 0.5, color: [0.1, 0.25, 0.2, 1], tex: tex.glass },
      { mesh: meshes.whiskey, x: -2.8, s: 0.52, color: [0.55, 0.28, 0.08, 1], tex: tex.amber },
      { mesh: meshes.decanter, x: -2.0, s: 0.5, color: [0.7, 0.85, 0.9, 1], tex: tex.glass },
      { mesh: meshes.wine, x: -1.2, s: 0.58, color: [0.2, 0.04, 0.1, 1], tex: tex.amber },
      { mesh: meshes.slim, x: -0.4, s: 0.48, color: [0.9, 0.9, 0.85, 1], tex: tex.glass },
      { mesh: meshes.whiskey, x: 0.4, s: 0.54, color: [0.45, 0.2, 0.05, 1], tex: tex.amber },
      { mesh: meshes.wine, x: 1.2, s: 0.56, color: [0.15, 0.08, 0.22, 1], tex: tex.velvet },
      { mesh: meshes.decanter, x: 2.0, s: 0.5, color: [0.85, 0.75, 0.45, 1], tex: tex.amber },
      { mesh: meshes.slim, x: 2.8, s: 0.5, color: [0.08, 0.2, 0.28, 1], tex: tex.glass },
      { mesh: meshes.whiskey, x: 3.5, s: 0.52, color: [0.5, 0.15, 0.08, 1], tex: tex.amber },
      { mesh: meshes.wine, x: 4.2, s: 0.55, color: [0.3, 0.05, 0.1, 1], tex: tex.amber },
    ]},
    { y: 2.32, items: [
      { mesh: meshes.slim, x: -3.8, s: 0.46, color: [0.95, 0.9, 0.7, 1], tex: tex.glass },
      { mesh: meshes.wine, x: -3.0, s: 0.52, color: [0.4, 0.08, 0.14, 1], tex: tex.amber },
      { mesh: meshes.shaker, x: -2.15, s: 0.48, color: [0.75, 0.78, 0.82, 1], tex: tex.brass, gloss: 140 },
      { mesh: meshes.decanter, x: -1.3, s: 0.48, color: [0.6, 0.85, 0.8, 1], tex: tex.glass },
      { mesh: meshes.whiskey, x: -0.4, s: 0.5, color: [0.55, 0.3, 0.1, 1], tex: tex.amber },
      { mesh: meshes.wine, x: 0.5, s: 0.54, color: [0.18, 0.05, 0.12, 1], tex: tex.amber },
      { mesh: meshes.slim, x: 1.35, s: 0.46, color: [0.15, 0.35, 0.25, 1], tex: tex.glass },
      { mesh: meshes.shaker, x: 2.2, s: 0.48, color: [0.85, 0.7, 0.35, 1], tex: tex.brass, gloss: 140 },
      { mesh: meshes.wine, x: 3.05, s: 0.52, color: [0.25, 0.06, 0.1, 1], tex: tex.amber },
      { mesh: meshes.decanter, x: 3.9, s: 0.48, color: [0.9, 0.88, 0.8, 1], tex: tex.glass },
    ]},
    { y: 3.02, items: [
      { mesh: meshes.wine, x: -3.4, s: 0.5, color: [0.35, 0.06, 0.12, 1], tex: tex.amber },
      { mesh: meshes.slim, x: -2.5, s: 0.45, color: [0.1, 0.22, 0.3, 1], tex: tex.glass },
      { mesh: meshes.whiskey, x: -1.55, s: 0.48, color: [0.48, 0.22, 0.08, 1], tex: tex.amber },
      { mesh: meshes.wine, x: -0.55, s: 0.52, color: [0.22, 0.05, 0.14, 1], tex: tex.amber },
      { mesh: meshes.decanter, x: 0.45, s: 0.46, color: [0.7, 0.9, 0.95, 1], tex: tex.glass },
      { mesh: meshes.slim, x: 1.4, s: 0.45, color: [0.9, 0.85, 0.55, 1], tex: tex.amber },
      { mesh: meshes.whiskey, x: 2.35, s: 0.48, color: [0.4, 0.12, 0.06, 1], tex: tex.amber },
      { mesh: meshes.wine, x: 3.3, s: 0.5, color: [0.28, 0.05, 0.1, 1], tex: tex.amber },
    ]},
  ];

  for (const row of bottleRows) {
    for (const item of row.items) {
      const h = item.s;
      objects.push(obj(
        item.mesh,
        [item.x, row.y, -4.7],
        [h, h, h],
        item.color,
        item.tex,
        { gloss: item.gloss ?? 125, cast: true, receive: true },
      ));
    }
  }

  // --- Counter service set -------------------------------------------------
  const service = [
    { mesh: meshes.tumbler, p: [-1.6, 1.18, 0.55], s: 0.42, c: [0.75, 0.9, 0.95, 1], t: tex.glass, g: 140 },
    { mesh: meshes.tumbler, p: [-1.25, 1.18, 0.7], s: 0.4, c: [0.7, 0.88, 0.92, 1], t: tex.glass, g: 140 },
    { mesh: meshes.coupe, p: [-0.55, 1.18, 0.45], s: 0.48, c: [0.85, 0.95, 1, 1], t: tex.glass, g: 150 },
    { mesh: meshes.shaker, p: [0.35, 1.18, 0.5], s: 0.5, c: [0.82, 0.84, 0.88, 1], t: tex.brass, g: 150 },
    { mesh: meshes.coupe, p: [1.15, 1.18, 0.65], s: 0.46, c: [0.9, 0.95, 1, 1], t: tex.glass, g: 150 },
    { mesh: meshes.whiskey, p: [1.9, 1.18, 0.4], s: 0.42, c: [0.55, 0.28, 0.1, 1], t: tex.amber, g: 120 },
    { mesh: meshes.sphere, p: [0.85, 1.28, 0.95], s: 0.1, c: [1, 0.45, 0.12, 1], t: tex.amber, g: 80, e: [0.15, 0.04, 0.01] },
    { mesh: meshes.sphere, p: [1.05, 1.26, 1.05], s: 0.08, c: [1, 0.55, 0.15, 1], t: tex.amber, g: 80 },
  ];
  for (const item of service) {
    objects.push(obj(item.mesh, item.p, [item.s, item.s, item.s], item.c, item.t, {
      gloss: item.g,
      emissive: item.e || [0, 0, 0],
    }));
  }

  // Draft taps — column + spout + colored handle.
  for (const x of [-2.6, -2.15, -1.7]) {
    objects.push(obj(meshes.cylinder, [x, 1.45, -0.15], [0.04, 0.55, 0.04], [0.7, 0.55, 0.3, 1], tex.brass, { gloss: 140 }));
    objects.push(obj(meshes.capsule, [x, 1.78, 0.05], [0.035, 0.12, 0.035], [0.75, 0.6, 0.32, 1], tex.brass, {
      rotationZ: Math.PI * 0.5,
      gloss: 140,
      cast: false,
    }));
    objects.push(obj(meshes.sphere, [x, 1.72, -0.15], [0.07, 0.07, 0.07], [0.85, 0.2, 0.25, 1], tex.velvet, {
      gloss: 90,
      cast: false,
    }));
  }

  // Stemware hanging under the top shelf (rotationZ flips coupe stem-up).
  for (const x of [-3.6, -2.9, -2.2, -1.5, 1.5, 2.2, 2.9, 3.6]) {
    objects.push(obj(meshes.coupe, [x, 2.78, -4.55], [0.32, 0.32, 0.32], [0.8, 0.92, 0.98, 1], tex.glass, {
      rotationZ: Math.PI,
      gloss: 150,
      cast: false,
    }));
  }

  // Glossy back-bar "mirror" slab — adds bright highlights into the puddle.
  objects.push(obj(meshes.cube, [0, 2.35, -5.15], [5.0, 1.55, 0.04], [0.55, 0.7, 0.78, 1], tex.glass, {
    gloss: 160,
    cast: false,
    receive: true,
    emissive: [0.03, 0.04, 0.05],
  }));

  // --- Booth seating + pendants + accents ----------------------------------
  const boothZ = -1.8;
  for (const x of [-4.6, 4.6]) {
    objects.push(obj(meshes.capsule, [x, 0.85, boothZ], [0.95, 0.55, 0.55], [0.5, 0.1, 0.2, 1], tex.velvet, { gloss: 30 }));
    objects.push(obj(meshes.seat, [x, 0.42, boothZ + 0.55], [0.85, 0.14, 0.55], [0.45, 0.1, 0.18, 1], tex.velvet, { gloss: 28 }));
    objects.push(obj(meshes.cylinder, [x, 0.7, boothZ + 0.55], [0.45, 0.05, 0.45], [0.55, 0.42, 0.25, 1], tex.brass, { gloss: 100, cast: false }));
  }

  // Pendant lights also tagged neon so the inspector toggle dims the lounge glow.
  for (const x of [-2.4, 0, 2.4]) {
    objects.push(obj(meshes.cylinder, [x, 4.2, 0.2], [0.02, 1.4, 0.02], [0.2, 0.2, 0.22, 1], tex.dark, { cast: false, gloss: 40 }));
    objects.push(obj(meshes.sphere, [x, 3.35, 0.2], [0.22, 0.22, 0.22], [1, 0.85, 0.55, 1], tex.amber, {
      emissive: [0.55, 0.32, 0.08],
      cast: true,
      gloss: 100,
      neon: true,
    }));
    objects.push(obj(meshes.taper, [x, 3.55, 0.2], [0.18, 0.16, 0.18], [0.55, 0.42, 0.22, 1], tex.brass, {
      gloss: 120,
      cast: false,
      neon: true,
    }));
  }

  objects.push(obj(meshes.sphere, [-5.2, 0.55, 2.8], [0.45, 0.45, 0.45], [0.2, 0.55, 0.45, 1], tex.glass, {
    emissive: [0.02, 0.08, 0.06],
    gloss: 110,
  }));
  objects.push(obj(meshes.sphere, [5.2, 0.55, 2.8], [0.45, 0.45, 0.45], [0.55, 0.2, 0.45, 1], tex.velvet, {
    emissive: [0.08, 0.02, 0.06],
    gloss: 90,
  }));
  objects.push(obj(meshes.cylinder, [-5.2, 0.12, 2.8], [0.35, 0.2, 0.35], [0.4, 0.3, 0.18, 1], tex.brass, { gloss: 100 }));
  objects.push(obj(meshes.cylinder, [5.2, 0.12, 2.8], [0.35, 0.2, 0.35], [0.4, 0.3, 0.18, 1], tex.brass, { gloss: 100 }));

  objects.push(obj(meshes.cylinder, [0, 0.55, 3.4], [0.55, 0.06, 0.55], [0.7, 0.55, 0.3, 1], tex.brass, { gloss: 130 }));
  objects.push(obj(meshes.taper, [0, 0.28, 3.4], [0.08, 0.5, 0.08], [0.55, 0.42, 0.25, 1], tex.brass, { gloss: 110 }));
  objects.push(obj(meshes.coupe, [0.15, 0.6, 3.45], [0.4, 0.4, 0.4], [0.85, 0.95, 1, 1], tex.glass, { gloss: 150 }));

  objects.push(...buildBarNeon(ibrt, tex, detail));

  // Wet floor patch in front of the bar — primary reflection stress surface.
  const water = {
    mesh: meshes.puddle,
    position: [0.1, 0.018, 1.55],
    scale: [1.35, 1, 0.95],
    color: [0.02, 0.06, 0.09],
    opacity: 0.97,
    planeY: 0, // mirror plane Y used by the mirrored camera + clip
  };

  return {
    objects,
    floorObject: floor,
    water,
    clearColor: [0.02, 0.025, 0.04, 1],
    // Pink neon local light near the BAR sign (intensity zeroed when neon off).
    localLight: {
      position: [0, 3.55, -4.2],
      color: [1.0, 0.45, 0.7],
      intensity: 3.8,
    },
    camera: {
      yaw: 0.08,
      pitch: 0.28,
      distance: 9.2,
      target: [0, 1.35, 0.2],
      lightX: 2.8,
      lightZ: 1.6,
    },
    bounds: { minX: -6.4, maxX: 6.4, minY: 0.3, maxY: 7.5, minZ: -5.0, maxZ: 5.5 },
    targetClamp: { minX: -4.2, maxX: 4.2, minZ: -3.5, maxZ: 2.8 },
    lightLookAt: [0, 1.4, -0.5],
    debugMesh: meshes.sphere,
    debugTexture: tex.amber,
  };
}
