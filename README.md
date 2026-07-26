# Image Based RT

**Ray-tracing–like reflections on lower-end GPUs — without tracing rays.**

Image Based RT is an open-source WebGL2 experiment that approximates reflective, “ray-traced” surfaces using connected imagery and a few cheap raster passes. Instead of firing secondary rays, the scene is mirrored into a color image and sampled by a water material — so puddles and neon reflections stay interactive on integrated graphics.

Made during **Cursor Buildathon Delhi**.

---

## Why this exists

Full path tracing is beautiful and expensive. Many products need the *look* of reflections and soft shadows on laptops and mid-range devices where a real-time ray tracer is not practical.

This project explores that middle ground:

| Classic ray tracing | Image Based RT |
| --- | --- |
| Trace reflection rays per pixel | Rasterize a mirrored camera into a texture |
| Cost scales with rays × bounces | Cost is one extra color pass + a water composite |
| Hard on integrated GPUs | Tuned with low / balanced / high presets |

It is **not** physically correct ray tracing. It is a deliberate trade: reusable images + lightweight shaders for a convincing interactive scene.

---

## Live demo scenes

Switch scenes in the inspector (**Active scene**):

### Midnight Bar (default) — SCENE / 002

A denser game-style lounge for stressing the reflection path:

- Lathed bottles, tumblers, coupes, and shakers (solids of revolution — not cubes)
- Curved stadium bar counter, brass foot rail, velvet stools with torus rings
- Pendant globes, draft taps, hanging stemware, back-bar mirror
- Pink/cyan **BAR** neon + wet-floor puddle that mirrors shelves and signage
- Same-material props batched with `mergeMeshInstances` (~40 draws vs ~130 unbatched)

### Neon Atrium — SCENE / 001

The original lighter Buildathon demo:

- Soft quality-scaled PCF shadows from a depth map
- Letterform **NEON** sign (batched emissive tubes + local colored light)
- Round feathered puddle reflecting the atrium
- Low draw-call proxy geometry for a cheap baseline

```text
scene
  ├── shadow depth pass      → shadow map
  ├── mirrored camera pass   → reflection image
  ├── main camera pass       → canvas color
  └── water composite        → puddle over the floor
```

---

## Quick start

No install. From the project root:

```bash
python3 -m http.server 8080
```

Open [http://localhost:8080](http://localhost:8080) in a WebGL2-capable browser.

---

## What to look for

Judges / first-time viewers — about 30 seconds:

1. **Default scene is Midnight Bar.** Orbit to the side, then lower the camera (grazing). The wet floor should still show the BAR neon and bottle shelves.
2. **That puddle is not ray tracing.** It is one mirrored color pass sampled by the water material (MSAA + mips). The inspector pitch line states this up front.
3. **Toggle Bar neon** — tubes, pendants, and the local pink light drop out of the reflection with them.
4. **Switch GPU quality → Low** — the iGPU path (smaller maps, fewer mesh segments). The scene should stay interactive.
5. **Optional:** switch Active scene → Neon Atrium for the cheap baseline (~dozen draws).

The portable method lives in one file: [`src/implementation.js`](./src/implementation.js).

---

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit |
| `WASD` / arrows | Move |
| `Shift` | Faster move |
| Wheel | Zoom |
| `Q` / `E` | Move key light |
| `R` | Reset view |
| Active scene | Midnight Bar / Neon Atrium |
| GPU quality | Low / balanced / high budgets |

---

## For companies — drop-in method

The portable implementation lives in [`src/implementation.js`](./src/implementation.js). Demo scenes and UI live in [`src/main.js`](./src/main.js) + [`src/scenes/`](./src/scenes/).

```js
import { createImageBasedRT, recommendContextOptions } from "./implementation.js";

const gl = canvas.getContext("webgl2", recommendContextOptions("low"));
const ibrt = createImageBasedRT(gl, { quality: "low" });

ibrt.renderFrame({
  canvas,
  camera,
  light,
  localLight,
  objects,
  floorObject,
  water,
  time: performance.now() / 1000,
  aspect: width / height,
});
```

Mesh helpers available on the factory (and as named exports): `buildCube`, `buildPlane`, `buildSphere`, `buildCylinder`, `buildLathe`, `buildTorus`, `buildCapsule`, `buildStadium`, `buildPuddle`, `mergeCubeInstances`, `mergeMeshInstances`, `createTexture`.

### Quality presets (lower-end first)

| Preset | Shadow | Reflection | PCF | Water blur | Max DPR |
| --- | ---: | ---: | --- | --- | ---: |
| Low | 256px | 640px · 2× MSAA | 1-tap | soft + mips | 1.0 |
| Balanced | 512px | 1024px · 4× MSAA | 4-tap | soft + mips | 1.0 |
| High | 1024px | 1536px · 4× MSAA | 3×3 | soft + mips | 1.5 |

Neon strokes are merged into a few batched meshes. The mirror pass uses MSAA + mipmaps and a multi-tap sample so puddle neon stays smooth instead of pixelated.

---

## Project layout

```text
imagebasedrt/
├── index.html                 Demo shell + controls
├── styles.css                 Lab UI
├── PROJECT.md                 Architecture & iteration notes
├── README.md                  You are here
└── src/
    ├── implementation.js      Portable Image Based RT method + mesh helpers
    ├── main.js                UI, input, scene switcher, render loop
    └── scenes/
        ├── midnightBar.js     Dense game-style bar (default)
        └── neonAtrium.js      Original atrium demo
```

More detail: [`PROJECT.md`](./PROJECT.md).

---

## Built with

- Vanilla **WebGL2** (ES modules, no build step)
- Image-based planar reflections that hold up from orbit / side / grazing views
- Depth shadows with quality-scaled PCF
- Curved procedural props (lathe / cylinder / torus / capsule / stadium)
- Batched neon meshes + temporal pass refresh for better frames
- Procedural textures generated at runtime

---

## Origin

Created during **Cursor Buildathon Delhi** as an exploration of practical, image-assisted rendering for real products — not a path-tracer clone, but a method teams can try when classic ray tracing is too heavy.

---

## License

Open source — use it, fork it, adapt the method into your stack. If you ship something cool with it, star the repo or open an issue with what you learned.
