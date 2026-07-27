# AGENTS.md

## Cursor Cloud specific instructions

This repo is **Image Based RT**, a single, dependency-free vanilla WebGL2 browser demo.
There is **no package manager, no lockfile, no build step, and no backend/database**. Do
not look for `package.json`, `npm install`, bundlers, or a dev server framework — none exist.

### Running the app (development)
- Serve the repo root over HTTP, then open in a WebGL2-capable browser:
  - `python3 -m http.server 8080`
  - Main demo: `http://localhost:8080/`
  - Minimal library example: `http://localhost:8080/examples/minimal/`
- You **must** serve over HTTP. Opening `index.html` via `file://` breaks ES module
  loading. Any static server works; the README standardizes on `python3 -m http.server`.
- There is nothing to install/refresh on startup; the update script is intentionally a no-op.

### Lint / test / build
- There is no lint step, no automated test suite, and no build.
- The only "verification" is JS syntax checking with the already-installed Node:
  `node --check src/implementation.js src/main.js src/scenes/midnightBar.js src/scenes/neonAtrium.js examples/minimal/main.js`
  (see `PROJECT.md` → Verification for the runtime checks, e.g. `window.IBRT.version`).

### Non-obvious gotchas
- The **"Active scene" control is a native `<select>`**. Its option popup renders as an OS
  overlay outside the page, so automated GUI tools (computer-use) often can't pick options
  from it — this is a tooling limitation, not an app bug. Scene switching still works for a
  real user. Camera orbit (drag), the "Bar neon" toggle, and "GPU quality" are all reliably
  automatable in-page controls.
- Rendering runs headless in this environment's Chrome via software WebGL2 (~20 FPS is
  expected here, not a performance regression).
