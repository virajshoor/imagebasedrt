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

## Live demo scene — Neon Atrium

A self-contained atrium with:

- Soft quality-scaled PCF shadows from a depth map  
- A round, feathered puddle that reflects the scene  
- A letterform **NEON** sign (batched emissive tubes + local colored light)  
- Atmosphere via wrap lighting, fresnel rim, and cheap height fog  
- Orbit camera, WASD move, movable key light  
- No framework, no bundler, no external assets  

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

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit |
| `WASD` / arrows | Move |
| `Shift` | Faster move |
| Wheel | Zoom |
| `Q` / `E` | Move key light |
| `R` | Reset view |
| GPU quality | Low / balanced / high budgets |

---

## For companies — drop-in method

The portable implementation lives in [`src/implementation.js`](./src/implementation.js). The Neon Atrium demo in [`src/main.js`](./src/main.js) only authors the scene and UI on top of it.

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

### Quality presets (lower-end first)

| Preset | Shadow | Reflection | PCF | Water blur | Max DPR |
| --- | ---: | ---: | --- | --- | ---: |
| Low | 256px | 256px | 1-tap | 1-tap | 1.0 |
| Balanced | 512px | 384px | 4-tap | 5-tap | 1.0 |
| High | 1024px | 768px | 3×3 | 9-tap | 1.5 |

Neon strokes are merged into a few batched meshes, and shadow/reflection passes can refresh on an interval when the view is stable — better frames on integrated GPUs without dropping the look.

---

## Project layout

```text
imagebasedrt/
├── index.html                 Demo shell + controls
├── styles.css                 Lab UI
├── PROJECT.md                 Architecture & iteration notes
├── README.md                  You are here
└── src/
    ├── implementation.js      Portable Image Based RT method
    └── main.js                Neon Atrium scene + UI
```

More detail: [`PROJECT.md`](./PROJECT.md).

---

## Built with

- Vanilla **WebGL2** (ES modules, no build step)  
- Image-based planar reflections  
- Depth shadows with quality-scaled PCF  
- Batched neon meshes + temporal pass refresh for better frames  
- Procedural textures generated at runtime  

---

## Origin

Created during **Cursor Buildathon Delhi** as an exploration of practical, image-assisted rendering for real products — not a path-tracer clone, but a method teams can try when classic ray tracing is too heavy.

---

## License

Open source — use it, fork it, adapt the method into your stack. If you ship something cool with it, star the repo or open an issue with what you learned.
