/**
 * Midnight Bar — SCENE / 002
 * ==========================
 *
 * Dense, game-style lounge used to stress-test Image Based RT with many
 * curved props (not cubes). Built entirely from procedural meshes:
 *   - Lathed bottles / glassware (solids of revolution)
 *   - Stadium (pill-shaped) bar counter and shelves
 *   - Capsule booths, torus stool rings, pendant spheres
 *   - BAR neon: cylinder stems + smooth elliptical tube bowls
 *   - Wet-floor puddle that mirrors the back-bar + BAR neon
 *
 * Same-material props batch via `mergeMeshInstances` (~42 opaque draws).
 * Consumed by `main.js` via `buildMidnightBar(ibrt, preset)`.
 * Returns a scene descriptor: objects, water, camera defaults, lights, bounds.
 */

// ---------------------------------------------------------------------------
// Quality → mesh density
// ---------------------------------------------------------------------------

/** Map GPU quality preset to segment counts for curved meshes. Low is the iGPU path. */
function detailLevel(preset) {
  const name = preset.neonDetail || "balanced";
  // neonRing = segments around each smooth elliptical neon lobe (B / R bowls).
  if (name === "low") return { segs: 12, lathe: 10, sphere: [8, 12], torus: [14, 8], neonRing: [16, 6] };
  if (name === "high") return { segs: 32, lathe: 28, sphere: [16, 24], torus: [32, 16], neonRing: [36, 10] };
  return { segs: 24, lathe: 20, sphere: [12, 18], torus: [24, 12], neonRing: [28, 8] };
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
// Neon BAR letter helpers
// Housing = cubes; straight strokes = cylinders; B/R bowls = smooth XY ellipse tubes.
// ---------------------------------------------------------------------------

function pushCube(list, position, scale, rotationZ = 0) {
  list.push({ position, scale, rotation: 0, rotationZ });
}

/** Unit cylinder is Y-aligned height 1; scaleY = full stroke length. */
function pushTube(list, position, length, radius, rotationZ = 0) {
  list.push({
    position,
    scale: [radius, length, radius],
    rotation: 0,
    rotationZ,
  });
}

function pushTubeVert(list, x, y, z, length, radius) {
  pushTube(list, [x, y, z], length, radius, 0);
}

function pushTubeHoriz(list, x, y, z, length, radius) {
  pushTube(list, [x, y, z], length, radius, Math.PI * 0.5);
}

/** Append a wall-facing elliptical neon tube (ring in the XY plane) into mesh buffers. */
function appendWallEllipseTube(vertices, indices, cx, cy, cz, radiusX, radiusY, tube, radialSegs, tubeSegs) {
  const base = vertices.length / 8;
  for (let i = 0; i <= radialSegs; i += 1) {
    const v = i / radialSegs;
    const phi = v * Math.PI * 2;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const centerX = cx + cosPhi * radiusX;
    const centerY = cy + sinPhi * radiusY;
    const tx = -sinPhi * radiusX;
    const ty = cosPhi * radiusY;
    const tLen = Math.hypot(tx, ty) || 1;
    const tangentX = tx / tLen;
    const tangentY = ty / tLen;
    // In-plane normal (rotate tangent 90°) so the tube stays round on the wall.
    const normalX = -tangentY;
    const normalY = tangentX;
    for (let j = 0; j <= tubeSegs; j += 1) {
      const u = j / tubeSegs;
      const theta = u * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const px = centerX + normalX * tube * cosTheta;
      const py = centerY + normalY * tube * cosTheta;
      const pz = cz + tube * sinTheta;
      const nx = normalX * cosTheta;
      const ny = normalY * cosTheta;
      const nz = sinTheta;
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      vertices.push(px, py, pz, nx * inv, ny * inv, nz * inv, u, v);
    }
  }
  for (let i = 0; i < radialSegs; i += 1) {
    for (let j = 0; j < tubeSegs; j += 1) {
      const a = base + i * (tubeSegs + 1) + j;
      const b = a + tubeSegs + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
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
  const pinkStems = [];
  const cyan = [];
  const housing = [];
  const [ringSegs, tubeSegs] = detail.neonRing;
  const tubeMesh = ibrt.buildCylinder(Math.max(8, (detail.segs / 2) | 0), 1, 1, 1, true);

  // Sign backplate + side posts.
  pushCube(housing, [0, y, z - 0.12], [2.4, 0.72, 0.05]);
  pushCube(housing, [-1.9, y - 0.95, z - 0.08], [0.06, 0.55, 0.06]);
  pushCube(housing, [1.9, y - 0.95, z - 0.08], [0.06, 0.55, 0.06]);

  // Letter B — stem + two smooth elliptical bowls.
  pushTubeVert(pinkStems, -1.55, y, z, 0.96, tube);
  const pinkRingVerts = [];
  const pinkRingIdx = [];
  appendWallEllipseTube(pinkRingVerts, pinkRingIdx, -1.2, y + 0.22, z, 0.3, 0.22, tube, ringSegs, tubeSegs);
  appendWallEllipseTube(pinkRingVerts, pinkRingIdx, -1.18, y - 0.22, z, 0.34, 0.24, tube, ringSegs, tubeSegs);

  // Letter A — two legs + crossbar (cyan for contrast in the puddle).
  pushTubeVert(cyan, -0.45, y, z, 0.96, tube);
  pushTubeVert(cyan, 0.15, y, z, 0.96, tube);
  pushTubeHoriz(cyan, -0.15, y - 0.05, z, 0.56, tube);
  pushTubeHoriz(cyan, -0.15, y + 0.42, z, 0.4, tube);

  // Letter R — stem + bowl + diagonal leg.
  pushTubeVert(pinkStems, 0.75, y, z, 0.96, tube);
  appendWallEllipseTube(pinkRingVerts, pinkRingIdx, 1.12, y + 0.18, z, 0.32, 0.26, tube, ringSegs, tubeSegs);
  pushTube(pinkStems, [1.24, y - 0.28, z], 0.68, tube, 0.55);

  const neonMat = (mesh, color, emissive) => ({
    mesh,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    color,
    texture: tex.neon,
    emissive,
    neon: true,
    cast: false,
    receive: false,
    gloss: 140,
    enabled: true,
  });

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
    neonMat(ibrt.mergeMeshInstances(tubeMesh, pinkStems), [1, 0.35, 0.65, 1], [1.8, 0.15, 0.55]),
    neonMat(ibrt.makeMesh(pinkRingVerts, pinkRingIdx), [1, 0.35, 0.65, 1], [1.8, 0.15, 0.55]),
    neonMat(ibrt.mergeMeshInstances(tubeMesh, cyan), [0.35, 0.95, 1, 1], [0.15, 1.4, 1.6]),
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

/**
 * Push one draw for many transforms of the same mesh + material.
 * Same-material bottle/stool/glassware groups collapse from N draws → 1.
 */
function pushMerged(ibrt, objects, sourceMesh, instances, color, texture, extras = {}) {
  if (!instances.length) return;
  if (instances.length === 1) {
    const one = instances[0];
    objects.push(obj(sourceMesh, one.position, one.scale, color, texture, {
      rotation: one.rotation || 0,
      rotationZ: one.rotationZ || 0,
      ...extras,
    }));
    return;
  }
  const mesh = ibrt.mergeMeshInstances(sourceMesh, instances);
  objects.push(obj(mesh, [0, 0, 0], [1, 1, 1], color, texture, extras));
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
  tryThis: "Orbit to the side, then lower the view — the wet floor is a mirrored image pass, not ray tracing. Toggle Bar neon, then try GPU quality → Low.",
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
  pushMerged(ibrt, objects, meshes.capsule, [
    { position: [-6.4, 2.4, -1.5], scale: [0.35, 1.55, 0.35] },
    { position: [6.4, 2.4, -1.5], scale: [0.35, 1.55, 0.35] },
  ], [0.55, 0.12, 0.22, 1], tex.velvet, { gloss: 25, cast: false });

  // --- Back-bar shelves (3 planks → 1 draw) --------------------------------
  pushMerged(ibrt, objects, meshes.stadium, [1.55, 2.25, 2.95].map((y) => ({
    position: [0, y, -4.85],
    scale: [2.6, 0.7, 0.55],
  })), [0.75, 0.72, 0.68, 1], tex.marble, { gloss: 95 });
  pushMerged(ibrt, objects, meshes.cylinder, [
    { position: [-5.2, 2.2, -4.85], scale: [0.08, 2.4, 0.08] },
    { position: [5.2, 2.2, -4.85], scale: [0.08, 2.4, 0.08] },
  ], [0.55, 0.42, 0.28, 1], tex.brass, { gloss: 110 });

  // --- Curved bar counter + brass foot rail (cylinder segments, one batch) -
  objects.push(obj(meshes.stadium, [0, 0.52, 0.35], [2.85, 1.55, 0.95], [0.42, 0.26, 0.16, 1], tex.wood, { gloss: 55 }));
  objects.push(obj(meshes.stadium, [0, 1.08, 0.35], [2.95, 0.55, 1.05], [0.82, 0.78, 0.74, 1], tex.marble, { gloss: 120 }));
  objects.push(obj(meshes.cylinder, [0, 0.28, 0.35], [2.55, 0.12, 0.72], [0.45, 0.32, 0.18, 1], tex.wood, { gloss: 40 }));
  // Foot-rail tubes + draft-tap columns share brass cylinder material.
  pushMerged(ibrt, objects, meshes.cylinder, [
    ...[-3.6, -1.8, 0, 1.8, 3.6].map((x) => ({
      position: [x, 0.22, 1.55],
      scale: [0.045, 0.85, 0.045],
      rotationZ: Math.PI * 0.5,
    })),
    ...[-2.6, -2.15, -1.7].map((x) => ({
      position: [x, 1.45, -0.15],
      scale: [0.04, 0.55, 0.04],
    })),
  ], [0.7, 0.55, 0.3, 1], tex.brass, { gloss: 135, cast: false });
  pushMerged(ibrt, objects, meshes.sphere, [-4.2, -2.4, -0.6, 1.2, 3.0, 4.2].map((x) => ({
    position: [x, 0.22, 1.75],
    scale: [0.06, 0.06, 0.06],
  })), [0.85, 0.65, 0.3, 1], tex.brass, { gloss: 140, cast: false });

  // --- Bar stools: 5 parts × 5 stools → 5 draws ---------------------------
  const stoolXs = [-3.2, -1.6, 0, 1.6, 3.2];
  const stoolZ = 2.15;
  pushMerged(ibrt, objects, meshes.seat, stoolXs.map((x) => ({
    position: [x, 0.72, stoolZ], scale: [0.38, 0.1, 0.38],
  })), [0.55, 0.12, 0.22, 1], tex.velvet, { gloss: 35 });
  pushMerged(ibrt, objects, meshes.torus, stoolXs.map((x) => ({
    position: [x, 0.68, stoolZ], scale: [0.34, 0.34, 0.34],
  })), [0.65, 0.48, 0.25, 1], tex.brass, { gloss: 120, cast: false });
  // Stool legs + cocktail-table stem share tapered brass.
  pushMerged(ibrt, objects, meshes.taper, [
    ...stoolXs.map((x) => ({ position: [x, 0.36, stoolZ], scale: [0.07, 0.62, 0.07] })),
    { position: [0, 0.28, 3.4], scale: [0.08, 0.5, 0.08] },
  ], [0.55, 0.42, 0.25, 1], tex.brass, { gloss: 100 });
  pushMerged(ibrt, objects, meshes.torus, stoolXs.map((x) => ({
    position: [x, 0.08, stoolZ], scale: [0.22, 0.22, 0.22],
  })), [0.55, 0.4, 0.22, 1], tex.brass, { gloss: 110, cast: false });
  pushMerged(ibrt, objects, meshes.sphere, stoolXs.map((x) => ({
    position: [x, 0.05, stoolZ], scale: [0.08, 0.04, 0.08],
  })), [0.35, 0.28, 0.18, 1], tex.dark, { cast: false, gloss: 40 });

  // --- Glassware / bottles: one bucket map so shelf + counter share draws ---
  // Tight palette → fewer unique material keys → fewer draws (target ~42 with neon).
  const C = {
    redWine: [0.32, 0.06, 0.12, 1],
    whiskey: [0.5, 0.22, 0.08, 1],
    clear: [0.78, 0.9, 0.95, 1],
    brass: [0.8, 0.72, 0.4, 1],
  };
  const meshName = (mesh) => (
    mesh === meshes.wine ? "wine"
      : mesh === meshes.slim ? "slim"
        : mesh === meshes.whiskey ? "whiskey"
          : mesh === meshes.decanter ? "decanter"
            : mesh === meshes.shaker ? "shaker"
              : mesh === meshes.tumbler ? "tumbler"
                : mesh === meshes.coupe ? "coupe"
                  : "other"
  );
  const texName = (t) => (
    t === tex.amber ? "amber" : t === tex.glass ? "glass" : t === tex.brass ? "brass" : "other"
  );
  const propBuckets = new Map();
  const addProp = (mesh, position, scale, color, texture, gloss, extras = {}) => {
    const key = `${meshName(mesh)}|${texName(texture)}|${color.join(",")}|${gloss}|${extras.cast === false ? 0 : 1}|${extras.rotationZ || 0}`;
    if (!propBuckets.has(key)) {
      propBuckets.set(key, { mesh, tex: texture, color, gloss, extras, instances: [] });
    }
    propBuckets.get(key).instances.push({
      position,
      scale,
      rotationZ: extras.rotationZ || 0,
    });
  };

  // Shelf stadium half-height ≈ 0.09 — bottle bases sit just above each plank.
  const shelfTop = { low: 1.66, mid: 2.36, high: 3.06 };
  const shelfBottles = [
    { mesh: meshes.wine, x: -4.2, y: shelfTop.low, s: 0.55, color: C.redWine, tex: tex.amber },
    { mesh: meshes.slim, x: -3.5, y: shelfTop.low, s: 0.5, color: C.clear, tex: tex.glass },
    { mesh: meshes.whiskey, x: -2.8, y: shelfTop.low, s: 0.52, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.decanter, x: -2.0, y: shelfTop.low, s: 0.5, color: C.clear, tex: tex.glass },
    { mesh: meshes.wine, x: -1.2, y: shelfTop.low, s: 0.58, color: C.redWine, tex: tex.amber },
    { mesh: meshes.slim, x: -0.4, y: shelfTop.low, s: 0.48, color: C.clear, tex: tex.glass },
    { mesh: meshes.whiskey, x: 0.4, y: shelfTop.low, s: 0.54, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.wine, x: 1.2, y: shelfTop.low, s: 0.56, color: C.redWine, tex: tex.amber },
    { mesh: meshes.decanter, x: 2.0, y: shelfTop.low, s: 0.5, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.slim, x: 2.8, y: shelfTop.low, s: 0.5, color: C.clear, tex: tex.glass },
    { mesh: meshes.whiskey, x: 3.5, y: shelfTop.low, s: 0.52, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.wine, x: 4.2, y: shelfTop.low, s: 0.55, color: C.redWine, tex: tex.amber },
    { mesh: meshes.slim, x: -3.8, y: shelfTop.mid, s: 0.46, color: C.clear, tex: tex.glass },
    { mesh: meshes.wine, x: -3.0, y: shelfTop.mid, s: 0.52, color: C.redWine, tex: tex.amber },
    { mesh: meshes.shaker, x: -2.15, y: shelfTop.mid, s: 0.48, color: C.brass, tex: tex.brass, gloss: 140 },
    { mesh: meshes.decanter, x: -1.3, y: shelfTop.mid, s: 0.48, color: C.clear, tex: tex.glass },
    { mesh: meshes.whiskey, x: -0.4, y: shelfTop.mid, s: 0.5, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.wine, x: 0.5, y: shelfTop.mid, s: 0.54, color: C.redWine, tex: tex.amber },
    { mesh: meshes.slim, x: 1.35, y: shelfTop.mid, s: 0.46, color: C.clear, tex: tex.glass },
    { mesh: meshes.shaker, x: 2.2, y: shelfTop.mid, s: 0.48, color: C.brass, tex: tex.brass, gloss: 140 },
    { mesh: meshes.wine, x: 3.05, y: shelfTop.mid, s: 0.52, color: C.redWine, tex: tex.amber },
    { mesh: meshes.decanter, x: 3.9, y: shelfTop.mid, s: 0.48, color: C.clear, tex: tex.glass },
    { mesh: meshes.wine, x: -3.4, y: shelfTop.high, s: 0.5, color: C.redWine, tex: tex.amber },
    { mesh: meshes.slim, x: -2.5, y: shelfTop.high, s: 0.45, color: C.clear, tex: tex.glass },
    { mesh: meshes.whiskey, x: -1.55, y: shelfTop.high, s: 0.48, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.wine, x: -0.55, y: shelfTop.high, s: 0.52, color: C.redWine, tex: tex.amber },
    { mesh: meshes.decanter, x: 0.45, y: shelfTop.high, s: 0.46, color: C.clear, tex: tex.glass },
    { mesh: meshes.slim, x: 1.4, y: shelfTop.high, s: 0.45, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.whiskey, x: 2.35, y: shelfTop.high, s: 0.48, color: C.whiskey, tex: tex.amber },
    { mesh: meshes.wine, x: 3.3, y: shelfTop.high, s: 0.5, color: C.redWine, tex: tex.amber },
  ];
  for (const item of shelfBottles) {
    addProp(item.mesh, [item.x, item.y, -4.68], [item.s, item.s, item.s], item.color, item.tex, item.gloss ?? 125);
  }

  // Counter service joins the same buckets where mesh/material match.
  addProp(meshes.tumbler, [-1.6, 1.18, 0.55], [0.42, 0.42, 0.42], C.clear, tex.glass, 125);
  addProp(meshes.tumbler, [-1.25, 1.18, 0.7], [0.4, 0.4, 0.4], C.clear, tex.glass, 125);
  addProp(meshes.coupe, [-0.55, 1.18, 0.45], [0.48, 0.48, 0.48], C.clear, tex.glass, 125);
  addProp(meshes.coupe, [1.15, 1.18, 0.65], [0.46, 0.46, 0.46], C.clear, tex.glass, 125);
  addProp(meshes.shaker, [0.35, 1.18, 0.5], [0.5, 0.5, 0.5], C.brass, tex.brass, 140);
  addProp(meshes.whiskey, [1.9, 1.18, 0.4], [0.42, 0.42, 0.42], C.whiskey, tex.amber, 125);
  addProp(meshes.coupe, [0.15, 0.6, 3.45], [0.4, 0.4, 0.4], C.clear, tex.glass, 125);
  for (const bucket of propBuckets.values()) {
    const { cast, receive, neon, emissive, rotationZ } = bucket.extras;
    pushMerged(ibrt, objects, bucket.mesh, bucket.instances, bucket.color, bucket.tex, {
      gloss: bucket.gloss,
      cast: cast === false ? false : true,
      receive: receive === false ? false : true,
      neon: !!neon,
      emissive: emissive || [0, 0, 0],
    });
  }

  pushMerged(ibrt, objects, meshes.sphere, [
    { position: [0.85, 1.28, 0.95], scale: [0.1, 0.1, 0.1] },
    { position: [1.05, 1.26, 1.05], scale: [0.08, 0.08, 0.08] },
  ], [1, 0.5, 0.14, 1], tex.amber, { gloss: 80, emissive: [0.12, 0.04, 0.01] });

  // Draft-tap spouts / handles (columns already batched with the foot rail).
  pushMerged(ibrt, objects, meshes.capsule, [-2.6, -2.15, -1.7].map((x) => ({
    position: [x, 1.78, 0.05], scale: [0.035, 0.12, 0.035], rotationZ: Math.PI * 0.5,
  })), [0.75, 0.6, 0.32, 1], tex.brass, { gloss: 140, cast: false });
  pushMerged(ibrt, objects, meshes.sphere, [-2.6, -2.15, -1.7].map((x) => ({
    position: [x, 1.72, -0.15], scale: [0.07, 0.07, 0.07],
  })), [0.85, 0.2, 0.25, 1], tex.velvet, { gloss: 90, cast: false });

  // Dark glossy back-bar panel (no emissive — a bright slab washed out the neon).
  objects.push(obj(meshes.cube, [0, 2.35, -5.15], [5.0, 1.55, 0.04], [0.22, 0.28, 0.32, 1], tex.glass, {
    gloss: 150,
    cast: false,
    receive: true,
    emissive: [0.01, 0.015, 0.02],
  }));

  // --- Booth seating + pendants + accents ----------------------------------
  const boothZ = -1.8;
  pushMerged(ibrt, objects, meshes.capsule, [
    { position: [-4.6, 0.85, boothZ], scale: [0.95, 0.55, 0.55] },
    { position: [4.6, 0.85, boothZ], scale: [0.95, 0.55, 0.55] },
  ], [0.5, 0.1, 0.2, 1], tex.velvet, { gloss: 30 });
  pushMerged(ibrt, objects, meshes.seat, [
    { position: [-4.6, 0.42, boothZ + 0.55], scale: [0.85, 0.14, 0.55] },
    { position: [4.6, 0.42, boothZ + 0.55], scale: [0.85, 0.14, 0.55] },
  ], [0.45, 0.1, 0.18, 1], tex.velvet, { gloss: 28 });
  // Thin brass trim under booth cushions (not a second cushion) + planter bases.
  pushMerged(ibrt, objects, meshes.cylinder, [
    { position: [-4.6, 0.3, boothZ + 0.55], scale: [0.82, 0.03, 0.52] },
    { position: [4.6, 0.3, boothZ + 0.55], scale: [0.82, 0.03, 0.52] },
    { position: [-5.2, 0.12, 2.8], scale: [0.35, 0.2, 0.35] },
    { position: [5.2, 0.12, 2.8], scale: [0.35, 0.2, 0.35] },
  ], [0.55, 0.42, 0.25, 1], tex.brass, { gloss: 100, cast: false });

  // Pendants tagged neon so the inspector toggle dims lounge glow.
  pushMerged(ibrt, objects, meshes.cylinder, [-2.4, 0, 2.4].map((x) => ({
    position: [x, 4.2, 0.2], scale: [0.02, 1.4, 0.02],
  })), [0.2, 0.2, 0.22, 1], tex.dark, { cast: false, gloss: 40 });
  pushMerged(ibrt, objects, meshes.sphere, [-2.4, 0, 2.4].map((x) => ({
    position: [x, 3.35, 0.2], scale: [0.22, 0.22, 0.22],
  })), [1, 0.85, 0.55, 1], tex.amber, {
    emissive: [0.55, 0.32, 0.08],
    cast: true,
    gloss: 100,
    neon: true,
  });
  pushMerged(ibrt, objects, meshes.taper, [-2.4, 0, 2.4].map((x) => ({
    position: [x, 3.55, 0.2], scale: [0.18, 0.16, 0.18],
  })), [0.55, 0.42, 0.22, 1], tex.brass, { gloss: 120, cast: false, neon: true });

  // Corner orbs — keep distinct tints (worth two draws for color pop).
  objects.push(obj(meshes.sphere, [-5.2, 0.55, 2.8], [0.45, 0.45, 0.45], [0.2, 0.55, 0.48, 1], tex.glass, {
    emissive: [0.03, 0.1, 0.08],
    gloss: 110,
  }));
  objects.push(obj(meshes.sphere, [5.2, 0.55, 2.8], [0.45, 0.45, 0.45], [0.55, 0.18, 0.4, 1], tex.velvet, {
    emissive: [0.1, 0.03, 0.07],
    gloss: 90,
  }));

  objects.push(obj(meshes.cylinder, [0, 0.55, 3.4], [0.55, 0.06, 0.55], [0.7, 0.55, 0.3, 1], tex.brass, { gloss: 130 }));

  objects.push(...buildBarNeon(ibrt, tex, detail));

  // Large wet patch in front of the stools — the reflection must read at first glance.
  const water = {
    mesh: meshes.puddle,
    position: [0, 0.02, 1.85],
    scale: [1.65, 1, 1.25],
    color: [0.015, 0.055, 0.08],
    opacity: 0.98,
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
      color: [1.0, 0.5, 0.75],
      intensity: 4.2,
    },
    // Default framing: puddle in the lower third, neon + shelves readable above.
    camera: {
      yaw: 0.18,
      pitch: 0.22,
      distance: 8.6,
      target: [0, 1.15, 0.85],
      lightX: 2.6,
      lightZ: 2.0,
    },
    bounds: { minX: -6.4, maxX: 6.4, minY: 0.3, maxY: 7.5, minZ: -5.0, maxZ: 5.5 },
    targetClamp: { minX: -4.2, maxX: 4.2, minZ: -3.5, maxZ: 2.8 },
    lightLookAt: [0, 1.4, -0.5],
    debugMesh: meshes.sphere,
    debugTexture: tex.amber,
  };
}
