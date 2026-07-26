# Image Based RT

Image Based RT is an open-source rendering experiment: use connected imagery and inexpensive raster passes to create effects that feel similar to ray tracing on lower-end graphics hardware.

The current prototype is a self-contained browser scene called **Neon Atrium**. It is intentionally written without a framework, package manager, external assets, or build step.

## Current status

The prototype has moved from an initial 2D view-cell experiment to a stable WebGL2 3D baseline. It currently includes:

- A portable method module (`src/implementation.js`) that companies can drop into their own WebGL2 apps.
- A Neon Atrium demo scene (`src/main.js`) that authors content and UI on top of that module.
- Low-poly 3D geometry: floor, back wall, plinth, colored pillars, boxes, and a red/orange sphere.
- Interactive orbit camera, zoom, WASD/arrow movement, and camera bounds.
- A dynamic light that can be moved with `Q` / `E`.
- Quality-scaled soft shadows (1-tap, 4-tap diagonal, or 3x3 PCF) from a depth map.
- Small procedural image textures for floor, architecture, props, and the orb (cached across quality switches).
- A round, multi-ring elliptical puddle with soft organic rim variation.
- A mirrored-scene color pass rendered into an image texture for the puddle, with temporal reuse when the view is stable.
- Non-flat water: shallow center dome, soft undulation, deep-center tint, and feathered thin edges.
- A letterform **NEON** sign baked into a few merged meshes (cyan / magenta / housing) plus a local colored light.
- Atmosphere helpers in the lit pass: wrap lighting, fresnel rim, cheap height fog.
- Adjustable GPU quality presets for lower-end / integrated GPUs.
- A debug light marker and runtime telemetry panel.

This is not literal ray tracing. It is rasterized WebGL2 with image-assisted materials and an image-based reflection pass. The reflected scene is reused as a texture instead of being reached by tracing secondary rays.

## Run locally

No installation is required. Start a static server from the project root:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a WebGL2-capable browser.

Opening `index.html` directly may work in some browsers, but a static server is recommended because module loading and browser security behavior are more predictable over HTTP.

## Controls

- Drag inside the viewport to orbit the camera.
- `WASD` or the arrow keys move the camera target through the atrium.
- Hold `Shift` while moving for faster traversal.
- Use the mouse wheel to zoom.
- `Q` / `E` move the light horizontally so the shadow response can be inspected.
- `R` or **Reset view** restores the authored camera and light pose.
- **Image accents** enables or disables the procedural material textures.
- **Neon sign** toggles the letterform tubes, colored local light, and their reflection contribution.
- **Shadow debug** displays the light as a small orange marker.
- **GPU quality** selects low, balanced, or high presets (map size, PCF, water blur, DPR cap, neon/puddle detail).

## Split architecture: method + demo

```text
index.html
    │
    └── src/main.js          Neon Atrium scene, UI, input, neon letters
            │
            └── src/implementation.js
                    portable Image Based RT method
                    (shadow + mirrored reflection image + water composite)
```

### `src/implementation.js` (portable method)

This is the file companies should copy first. It replaces classic secondary-ray reflection with:

1. A depth shadow pass + optional PCF.
2. A mirrored-camera color pass into a reflection image.
3. A water/mirror composite that samples that image with Fresnel and soft undulation.

Public entry points:

- `QUALITY_PRESETS` — low / balanced / high budgets for iGPUs.
- `recommendContextOptions(quality)` — low-power WebGL2 context hints.
- `createImageBasedRT(gl, { quality })` — factory returning the renderer API:
  - `setQuality(name)`, `allocateTargets()`
  - `buildOrbitCamera(...)`, `buildMirroredCamera(...)`, `buildOrthoLight(...)`
  - `renderFrame({ canvas, camera, light, localLight, objects, water, ... })`
  - mesh/texture helpers: `buildCube`, `buildPlane`, `buildSphere`, `buildPuddle`, `mergeCubeInstances`, `createTexture`

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

### `src/main.js` (demo scene)

Owns the Neon Atrium content only:

- DOM/UI wiring and orbit controls.
- Procedural demo textures.
- Letterform **NEON** sign construction (detail scales with quality).
- Scene object list and animation loop.
- Calls into `implementation.js` for all GPU passes.

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
| Low | 256px | 640px · 2× MSAA | 1-tap | soft + mips | 1.0 | Shadow every 2 frames when still |
| Balanced | 512px | 1024px · 4× MSAA | 4-tap diagonal | soft + mips | 1.0 | Every frame |
| High | 1024px | 1536px · 4× MSAA | 3x3 | soft + mips | 1.5 | Every frame |

Reflection images are rendered with MSAA, resolved into a mipmapped texture, then sampled with a multi-tap LOD-biased kernel so neon edges stay smooth in the puddle instead of stair-stepping.

Additional lower-end choices in the implementation:

- `powerPreference: "low-power"` and antialias off except on high.
- `mediump` shader precision, cheap height fog, wrap lighting.
- Neon letter strokes baked into 2–3 merged meshes (far fewer draw calls).
- Temporal reuse of shadow/reflection targets when the view is stable.
- Quality-scaled puddle segment/ring counts.
- Smaller procedural textures (64–128px), cached across quality switches.
- Pixel ratio capped per preset so retina displays do not 2–3× fill-rate cost.

### Water composite

The puddle is a multi-ring elliptical disc. Vertex UV.x stores radial distance. The shaders lift a shallow center dome, sample the mirrored scene image (with quality-scaled blur), tint deeper water in the center, and feather alpha into a thin meniscus at the rim.

### Neon letter sign

Demo-only geometry in `main.js`: readable **NEON** tube strokes mounted on a dark housing. Stroke/endcap/oval density follows the active quality preset. A local colored light contributes to lit surfaces and the water glint; the letters themselves appear in the mirrored reflection image.

## Source map

### `index.html`

The application shell, canvas, renderer telemetry, control inputs, legend, and link to this document.

### `styles.css`

The dark lab interface, responsive two-column layout, viewport overlays, inspector controls, telemetry grid, toggles, and mobile breakpoints.

### `src/implementation.js`

Portable Image Based RT method module intended for reuse outside this demo.

### `src/main.js`

Neon Atrium demo entrypoint that imports and drives `implementation.js`.

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
10. Neon strokes were merged into batched meshes and shadow/reflection passes gained temporal refresh intervals, cutting draw calls (~12 + 2) while holding interactive frame rates.
11. Lit/water shading gained wrap lighting, fresnel rim, height fog, and clearer puddle reflections for a denser look without post-process bloom.
12. Multi-angle puddle fix: mirrored projection uses square aspect (matching the RT) with height-based FOV; reflection UVs project from the flat mirror plane (not the dome); soft UV edge fade + stronger grazing fresnel keep side views clean.

## Verification

```bash
node --check src/implementation.js
node --check src/main.js
```

Serve locally and open in Playwright. Checks should include:

- No page/console errors; WebGL `getError() === 0`.
- `window.IBRT.renderer` exists and exposes `renderFrame` / `setQuality`.
- Quality switch rebuilds targets (low → 256px shadow).
- Neon sign readable; puddle still composites after module split.
- Module import of `implementation.js` from `main.js` succeeds over HTTP.

## Lower-end GPU considerations

- Native low-power WebGL2 context; antialias only on the high preset.
- One depth shadow texture and one smaller reflection texture.
- Sample counts (PCF / water blur) and DPR are quality-gated.
- One additional local light instead of bloom/post chains.
- Small 128px procedural textures created at startup.
- No per-pixel ray traversal.
- Neon letter strokes merged into 2–3 draw calls instead of dozens of tube instances.
- Temporal reuse of shadow/reflection targets on low/balanced when the camera/light are stable.
- Water mesh stays a single inexpensive disc; motion is shader math.

## Known limitations

- There is no physically correct ray tracing, refraction, global illumination, or multi-bounce reflection.
- The reflection is a single mirrored color image. Objects outside the mirrored camera's capture can disappear from the puddle; soft edge fade blends those regions into water tint.
- The water surface is a procedural dome plus soft undulation; it is not a fluid simulation.
- Neon letters are assembled from box strokes rather than true bent glass tubes.
- `implementation.js` expects the host app to supply meshes, materials, and a planar water object; it does not import glTF or manage assets.
- The procedural textures in the demo are placeholders for future captured imagery.

## Roadmap

1. Publish a minimal third-party example that imports only `implementation.js`.
2. Define an external capture manifest with color image, depth image, camera pose, bounds, and cell neighbors.
3. Replace selected proxy objects with view-dependent image/depth impostors.
4. Add depth-assisted reprojection to reduce disocclusion and edge ghosting.
5. Add streamed nearby view cells with an LRU texture cache.
6. Add captured normal/roughness imagery for the water and materials.
7. Benchmark memory, frame time, and visual error on integrated GPUs.
8. Publish an open capture format and permissively licensed sample scenes.

## Design principle

Use more reusable imagery and fewer expensive runtime calculations. The project is not trying to reproduce a full path tracer; it is exploring the practical boundary where connected images, depth, reprojection, raster shadows, and lightweight shaders can create a convincing interactive scene on modest hardware.
