# Image Based RT

Image Based RT is an open-source rendering experiment: use connected imagery and inexpensive raster passes to create effects that feel similar to ray tracing on lower-end graphics hardware.

The browser demo ships two scenes — **Midnight Bar** (default) and **Neon Atrium** — with no framework, package manager, external assets, or build step.

## Current status

The prototype has moved from an initial 2D view-cell experiment to a stable WebGL2 3D baseline. It currently includes:

- A portable method module (`src/implementation.js`) that companies can drop into their own WebGL2 apps.
- A **minimal host example** at `examples/minimal/` that imports only `implementation.js`.
- A demo shell (`src/main.js`) with scene switching, orbit/WASD controls, and inspector UI.
- **Midnight Bar** (`src/scenes/midnightBar.js`, IBRT **0.7.0**): lathed bottles with liquid cores, stadium bar, stools, pendants, draft taps, booths, BAR neon, wet-floor puddle; batches via `mergeMeshInstances` (~45 draws).
- **Neon Atrium** (`src/scenes/neonAtrium.js`): lighter Buildathon atrium with letterform NEON and a feathered puddle.
- Curved mesh helpers: cylinder, lathe, torus, capsule, stadium (plus cube / plane / sphere / puddle) and `mergeMeshInstances` for batched props.
- BAR neon: angled cyan **A**, pink B/R stems, wall-facing elliptical tube bowls (`makeMesh`).
- Inspector pitch + “Try this” tips so judges understand the method without reading the README.
- Interactive orbit camera, zoom, WASD/arrow movement, and camera bounds per scene.
- A dynamic key light that can be moved with `Q` / `E`.
- Quality-scaled soft shadows (1-tap, 4-tap diagonal, or 3x3 PCF) from a depth map.
- MSAA + mipmapped reflection images with multi-tap LOD-biased water sampling.
- Small procedural image textures (cached across quality switches).
- Atmosphere helpers in the lit pass: wrap lighting, fresnel rim, cheap height fog, floor-contact AO.
- Adjustable GPU quality presets for lower-end / integrated GPUs.
- A debug light marker and runtime telemetry panel.
- Persistent reflection bake (`scripts/bake-images.mjs` → `assets/baked/`) so the water combine image can be generated once and reused forever.

This is not literal ray tracing. It is rasterized WebGL2 with image-assisted materials and an image-based reflection pass. The reflected scene is reused as a texture instead of being reached by tracing secondary rays.

## Run locally

No installation is required. Start a static server from the project root:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a WebGL2-capable browser.

Opening `index.html` directly may work in some browsers, but a static server is recommended because module loading and browser security behavior are more predictable over HTTP.

### Reflection image storage (live vs baked)

The water composite **combines** the main color buffer with a mirrored **reflection image** (and lit surfaces sample a shadow depth map).

| Target | Live storage | Regenerated? |
| --- | --- | --- |
| Shadow map | WebGL depth texture / FBO in GPU VRAM | Yes (interval / dirty key) |
| Reflection image | WebGL RGBA texture (+ MSAA resolve) in GPU VRAM | Yes (every frame on balanced/high) |
| Final frame | Default framebuffer (`#viewport` canvas) | Every frame |
| Baked reflection | `assets/baked/<scene>/reflection-<quality>.png` | **No** — generated once, uploaded once |

Live mode never writes combine inputs to disk or `/tmp`. Temporal reuse only keeps the previous GPU texture in the same page session.

**Generate once, reuse forever:**

```bash
node scripts/bake-images.mjs
```

This launches headless Chrome, captures each scene × quality at the authored camera, and writes PNGs + `assets/baked/manifest.json`. The demo enables **Use baked images** when a matching entry exists; `renderFrame` then skips the mirror pass and the water material keeps sampling the uploaded bake. Inspector: **Bake images** button or keyboard **B** (downloads captures). API: `ibrt.bakeReflectionCapture`, `ibrt.setBakedReflection`, `window.IBRT.bakeImages()`.

## Controls

- Drag inside the viewport to orbit the camera.
- `WASD` or the arrow keys move the camera target.
- Hold `Shift` while moving for faster traversal.
- Use the mouse wheel to zoom.
- `Q` / `E` move the light horizontally so the shadow response can be inspected.
- `R` or **Reset view** restores the authored camera and light pose for the active scene.
- **Active scene** switches Midnight Bar ↔ Neon Atrium.
- **Image accents** enables or disables the procedural material textures.
- **Bar neon / Neon sign** toggles neon-tagged objects, colored local light, and their reflection contribution.
- **Shadow debug** displays the light as a small orange marker.
- **GPU quality** selects low, balanced, or high presets (map size, PCF, water blur, DPR cap, mesh detail).

## Split architecture: method + demo + scenes

```text
index.html
    │
    └── src/main.js                 UI, input, scene switcher, render loop
            │
            ├── src/scenes/midnightBar.js   dense game-style bar (default)
            ├── src/scenes/neonAtrium.js    original atrium demo
            │
            └── src/implementation.js
                    portable Image Based RT method
                    (shadow + mirrored reflection image + water composite)
                    + curved mesh helpers
```

### `src/implementation.js` (portable method)

This is the file companies should copy first. It replaces classic secondary-ray reflection with:

1. A depth shadow pass + optional PCF.
2. A mirrored-camera color pass into a reflection image (MSAA resolve + mipmaps).
3. A water/mirror composite that samples that image with Fresnel and soft undulation.

Public entry points:

- `QUALITY_PRESETS` — low / balanced / high budgets for iGPUs.
- `recommendContextOptions(quality)` — low-power WebGL2 context hints.
- `createImageBasedRT(gl, { quality })` — factory returning the renderer API:
  - `setQuality(name)`, `allocateTargets()`
  - `buildOrbitCamera(...)`, `buildMirroredCamera(...)`, `buildOrthoLight(...)`
  - `renderFrame({ canvas, camera, light, localLight, objects, water, ... })`
  - bake helpers: `bakeReflectionCapture(frame)`, `setBakedReflection({ image, camera, planeY })`, `clearBakedReflection()`, `captureReflectionPngDataUrl()`
  - mesh/texture helpers: `buildCube`, `buildPlane`, `buildSphere`, `buildCylinder`, `buildLathe`, `buildTorus`, `buildCapsule`, `buildStadium`, `buildPuddle`, `mergeCubeInstances`, `mergeMeshInstances`, `createTexture`

Company sketch:

```js
import { createImageBasedRT, recommendContextOptions } from "./implementation.js";

const gl = canvas.getContext("webgl2", recommendContextOptions("low"));
const ibrt = createImageBasedRT(gl, { quality: "low" });

// each frame:
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

### `src/main.js` (demo shell)

Owns wiring only:

- DOM/UI and orbit controls.
- Scene registry + rebuild on quality / scene change.
- Animation loop calling `renderFrame`.

### `src/scenes/*` (content)

Each scene exports:

- `*Meta` — inspector title, blurb, neon toggle labels.
- `build*(ibrt, preset)` — returns `{ objects, floorObject, water, camera, localLight, bounds, ... }`.

`floorObject` must be the same reference as the floor entry in `objects` so the mirror pass can skip it.

## Rendering architecture

The renderer is organized as four frame stages:

```text
scene meshes
    │
    ├── depth pass from light ───────► shadow texture
    │                                      │
    ├── mirrored camera pass ───────► reflection texture
    │                                      │
    └── main camera pass ───────────► canvas color
                                           │
                                      water composite
```

### Quality presets (lower-end first)

| Quality | Shadow | Reflection | PCF | Water blur | Max DPR | Refresh |
| --- | ---: | ---: | --- | --- | ---: | --- |
| Low · iGPU | 256px | 640px · 2× MSAA | 1-tap | 5-tap + mips | 1.0 | Shadow every 2 frames when still |
| Balanced · showcase | 512px | 1024px · 4× MSAA | 4-tap diagonal | 9-tap + mips | 1.0 | Every frame |
| High | 1024px | 1536px · 4× MSAA | 3x3 | 13-tap + mips | 1.5 | Every frame |

Reflection images are rendered with MSAA, resolved into a mipmapped texture, then sampled with a quality-gated multi-tap LOD-biased kernel (`waterBlur` 0 / 1 / 2). When a reflection frame is skipped, water UV warp is frozen so the puddle does not swim against a stale map. Dirty keys include full light pose, neon intensity, and a host `contentVersion` (bumped on neon / accent toggles).

Additional lower-end choices in the implementation:

- `powerPreference: "low-power"`; canvas antialias on balanced/high.
- `mediump` lit shaders, cheap height fog, wrap lighting.
- Neon letter strokes baked into a few merged meshes (far fewer draw calls).
- Temporal reuse of shadow/reflection targets when the view is stable.
- Quality-scaled puddle segment/ring counts and curved-mesh segment counts.
- Smaller procedural textures (64–256px), cached across quality switches.
- Pixel ratio capped per preset so retina displays do not 2–3× fill-rate cost.

### Water composite

The puddle is a multi-ring elliptical disc. Vertex UV.x stores radial distance. The shaders lift a shallow center dome, sample the mirrored scene image (with quality-scaled blur), tint deeper water in the center, and feather alpha into a thin meniscus at the rim.

### Neon signs

Demo-only geometry in the scene modules, mounted on a dark housing:

- **Neon Atrium** — letterform **NEON** from merged cube strokes (quality-scaled oval density).
- **Midnight Bar** — **BAR** from angled cyan A legs, pink B/R stems, and smooth wall-facing elliptical tube bowls (`appendWallEllipseTube` → `makeMesh`). Ring segment counts follow the quality preset (`neonRing`).

A local colored light contributes to lit surfaces and the water glint; the letters themselves appear in the mirrored reflection image.

### Midnight Bar props

Non-blocky assets are authored as:

| Helper | Used for |
| --- | --- |
| `buildLathe` | Wine / whiskey / decanter / tumbler / coupe / shaker bottles |
| `buildStadium` | Curved bar counter and shelf planks |
| `buildCylinder` / taper | Legs, uprights, foot-rail segments, pendant cables, neon stems |
| `buildTorus` | Stool seat rings and foot rings |
| `buildCapsule` | Booth backs, curtains, tap spouts |
| `buildSphere` | Pendant globes, citrus, rail connectors, corner orbs |
| `buildLathe` (`liquid`) | Inner wine / whiskey fills for clear glass bottles |
| `makeMesh` (ellipse tubes) | Smooth B / R neon bowls + A apex ring on the back wall |

## Source map

### `index.html`

The application shell, canvas, renderer telemetry, scene/quality controls, legend, and link to this document.

### `styles.css`

The dark lab interface, responsive two-column layout, viewport overlays, inspector controls, telemetry grid, toggles, and mobile breakpoints.

### `src/implementation.js`

Portable Image Based RT method module intended for reuse outside this demo, plus shared mesh/texture helpers.

### `src/main.js`

Demo entrypoint: boots WebGL2, switches scenes, handles input, drives `renderFrame`.

### `src/scenes/midnightBar.js` / `neonAtrium.js`

Authored scene content (textures, meshes, object lists, camera/light defaults).

### `PROJECT.md`

Architecture and development record, including the company integration path, quality tradeoffs, known limitations, and roadmap.

## Important fixes made during iteration

1. The original strip-warp renderer could collapse most of the canvas to black. It was replaced with a real WebGL2 3D baseline.
2. The floor triangles had the wrong winding. Their indices were reversed so the floor normal and depth behavior are correct.
3. Camera movement could expose clipped side-wall geometry as a large black wedge. Side walls were removed from the playable path, interior culling was disabled for the main pass, and camera coordinates were clamped.
4. The red sphere was embedded in the teal column. It was moved aside and given a dedicated orb texture.
5. Water now samples the mirrored camera projection so reflected imagery follows the surface correctly.
6. Concentric ripple bands and high-frequency UV shearing were removed; soft undulation + quality-scaled blur remain.
7. The puddle was rebuilt as a round multi-ring disc with dome height and feathered edges.
8. The neon rig became a letterform **NEON** sign with quality-scaled detail.
9. The method was extracted into `implementation.js` so the demo and the reusable RT-replacement API are separate, and quality presets were retuned for lower-end GPUs.
10. Neon strokes were merged into batched meshes and shadow/reflection passes gained temporal refresh intervals, cutting draw calls while holding interactive frame rates.
11. Lit/water shading gained wrap lighting, fresnel rim, height fog, and clearer puddle reflections for a denser look without post-process bloom.
12. Multi-angle puddle fix: mirrored projection uses square aspect (matching the RT) with height-based FOV; reflection UVs project from the flat mirror plane (not the dome); soft UV edge fade + stronger grazing fresnel keep side views clean.
13. Midnight Bar scene added with lathe/cylinder/torus/capsule/stadium helpers for a denser game-style reflection stress test; scenes split into `src/scenes/` with an inspector switcher.
14. Buildathon polish: `mergeMeshInstances` batches same-material bar props; Low preset uses cheaper mesh density; inspector pitch / Try this copy; README “What to look for”.
15. Visual QA (0.6.4): stronger puddle `reflectAmount` + milder balanced water blur/LOD; BAR neon rebuilt as cylinder stems + elliptical tube bowls; default camera reframed so the wet floor reads at a glance; bottles seated on shelf tops; booth brass trim corrected.
16. Reliability polish (0.6.5): Low water path is true 5-tap; shadow/reflection dirty keys include neon + `contentVersion`; freeze UV warp when reusing reflection RT; shell title/comments drop “View Cell Lab”; remove unused footRail torus mesh.
17. Portable showcase (0.7.0): `examples/minimal/` drop-in host; lit-pass floor-contact AO; BAR letter A angled tubes + apex ring; clear-glass liquid cores; docs sync.
18. Persistent bake (0.8.0): reflection combine images can be generated once via `node scripts/bake-images.mjs` into `assets/baked/`; live mode still uses GPU-only RTs that regenerate each frame.

## Verification

```bash
node --check src/implementation.js
node --check src/main.js
node --check src/scenes/midnightBar.js
node --check src/scenes/neonAtrium.js
node --check examples/minimal/main.js
node --check scripts/bake-images.mjs
node scripts/bake-images.mjs
```

Serve locally and open in a WebGL2 browser. Checks should include:

- No page/console errors; WebGL `getError() === 0`.
- `window.IBRT.renderer` exists and exposes `renderFrame` / `setQuality` / `setBakedReflection`.
- Default scene is Midnight Bar (~45 + 2 draws); switching to Neon Atrium updates inspector copy (~12 + 2).
- Quality switch rebuilds targets (high → 1536px reflection); Low keeps interactive FPS on iGPU.
- Side / grazing orbits still show puddle neon / stools without severe shear.
- Neon toggle drops BAR tubes + local pink light (and their reflection contribution).
- Module imports succeed over HTTP; `window.IBRT.version` reports `0.8.0`.
- Neon toggle immediately refreshes shadow/reflection (no stale BAR in the puddle on Low).
- `/examples/minimal/` renders floor, cube, sphere, and puddle with orbit drag (no console errors).
- After bake, **Use baked images** loads `assets/baked/**`, telemetry shows `BAKED`, and `skippedReflection` stays true (no per-frame mirror regen).

## Lower-end GPU considerations

- Native low-power WebGL2 context; canvas antialias on balanced/high.
- One depth shadow texture and one reflection texture (MSAA resolve when available).
- Sample counts (PCF / water blur) and DPR are quality-gated.
- One additional local light instead of bloom/post chains.
- Small procedural textures created at startup and cached.
- No per-pixel ray traversal.
- Neon letter strokes merged into a few draw calls instead of dozens of tube instances.
- Temporal reuse of shadow/reflection targets on low when the camera/light are stable.
- Optional baked reflection PNGs under `assets/baked/` so the mirror pass can be skipped entirely after one generate.
- Water mesh stays a single inexpensive disc; motion is shader math.
- Bar mesh segment counts scale down on the low preset.

## Known limitations

- There is no physically correct ray tracing, refraction, global illumination, or multi-bounce reflection.
- The reflection is a single mirrored color image. Objects outside the mirrored camera's capture can disappear from the puddle; soft edge fade blends those regions into water tint.
- The water surface is a procedural dome plus soft undulation; it is not a fluid simulation.
- Neon letters are procedural tubes (cylinders + elliptical rings / cube strokes), not true bent glass tubes or emissive textures.
- Bar props are procedural lathes/cylinders, not authored glTF assets.
- `implementation.js` expects the host app to supply meshes, materials, and a planar water object; it does not import glTF or manage assets.
- The procedural textures in the demo are placeholders for future captured imagery.
- Batched bar still uses one draw per unique material group; further GPU instancing would reduce CPU submit cost more.

## Roadmap

1. ~~Publish a minimal third-party example that imports only `implementation.js`.~~ **Done in 0.7.0** (`examples/minimal/`).
2. ~~Bake reflection combine images to disk for permanent reuse.~~ **Done in 0.8.0** (`scripts/bake-images.mjs` → `assets/baked/`).
3. Define an external capture manifest with color image, depth image, camera pose, bounds, and cell neighbors (extends the 0.8.0 reflection bake).
4. Replace selected proxy objects with view-dependent image/depth impostors.
5. Add depth-assisted reprojection to reduce disocclusion and edge ghosting.
6. Add streamed nearby view cells with an LRU texture cache.
7. Add captured normal/roughness imagery for the water and materials.
8. Benchmark memory, frame time, and visual error on integrated GPUs.
9. Publish an open capture format and permissively licensed sample scenes.
10. Optional glTF import path for authored game props while keeping the RT method portable.

## Design principle

Use more reusable imagery and fewer expensive runtime calculations. The project is not trying to reproduce a full path tracer; it is exploring the practical boundary where connected images, depth, reprojection, raster shadows, and lightweight shaders can create a convincing interactive scene on modest hardware.
