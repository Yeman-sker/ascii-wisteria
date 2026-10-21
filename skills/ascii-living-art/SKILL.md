---
name: ascii-living-art
description: Design and build living ASCII art on an HTML canvas — a subject (flowers, creatures, weather) simulated in pixels and drawn as a grid of glyphs that moves, reacts to the pointer and carries a mood. Use when the user wants an animated ASCII hero, background or art piece ("ASCII 樱花", "ASCII jellyfish hero", "make it feel romantic"), wants to adapt or tune ascii-wisteria, or asks how projects like ascii-sharks / ascii-wisteria work.
---

# ASCII living art

A living ASCII piece is three layers. Keep them separate; most quality problems come from mixing them.

1. **World** (`world.ts`) — the subject as physics, in CSS pixels. No DOM, no glyphs.
2. **Renderer** (`renderer.ts`) — rasterises the world into a cell grid: one glyph + one colour + one depth per cell.
3. **Engine** (`engine.ts`) — canvas plumbing: fixed 60 Hz timestep, resize, pointer, pause off-screen, `prefers-reduced-motion`.

The reference implementation is this repository (ascii-wisteria). For embedding or tuning the wisteria itself, read `references/wisteria.md`.

## Workflow

### 1. Start from the feeling, then pick mechanisms

Ask the user (or decide) what the piece should *feel* like, then map each feeling to something the simulation actually does. A mood that has no mechanism will not show up.

| Feeling | Mechanisms that carry it |
|---|---|
| Romance, tenderness | Slow periods (4–7 s sway); things that entwine; soft light pooling on the subject |
| Longing, memory (思念) | Traces that outlive their cause: a trail that fades over ~8 s, petals that pile up then fade over a minute; an element that pauses and "looks back"; empty space left on purpose; a low moon |
| Calm, nobility | One dominant hue ramp; every other element desaturated toward it; a single cool accent; nothing fast or flickering |
| Joy, play | Bursts on click, springy overshoot, warmer accents, higher spawn rates |
| Unease | Irregular rhythm, cells that flicker, hard contrast |

Write the mapping down before coding. It is the brief every later choice is checked against.

### 2. Get a reference image if you can

A photo of the real subject settles structure, light and colour faster than any description. Look for:
- **Structure**: what are the repeated units and how do they attach? (Wisteria: florets in alternating pairs on a thin stem, dense at the top, sparse with bare stem and buds toward the tip — *not* a solid cone.)
- **Depth of field**: what's sharp versus blurred? Use this for depth layers.
- **Light**: where does it come from, and where does it pool? Use this for a light field plus a vignette.
- **Palette**: sample 4–6 stops from shadow to highlight on the subject, plus the background.

### 3. World: simulate the subject in pixels

- Hanging or swaying things (racemes, tentacles, hair, vines): **verlet chains**, the first node pinned, 3–4 distance-constraint passes, plus a small pull toward each node's neighbours' midpoint for bending stiffness. Wind is a horizontal acceleration: a sum of two slow sines over x and t, scaled by a gust envelope that rises and falls over about 40 s.
- Things that swim or flock: boids (separation, alignment, cohesion) plus steering.
- Falling or drifting things (petals, snow, embers): particles with a terminal velocity, wind drift and a spin that drives a side-slip, so they tumble instead of dropping straight.
- The pointer: track its smoothed velocity. Use the velocity, not the position, to push nearby nodes or particles, so it acts as a breeze rather than a magnet.
- Emit **events** (`land`, `splash`) for the renderer, rather than having the world touch the cell fields.
- Give the piece a **story arc** if it suits: an intro (grow → open → first fall) with a skip on click, and rare events (a poem, a migration) on long random timers.
- Make layout depend on the viewport (`resize` reseeds on big changes) and leave intentional empty areas.

### 4. Renderer: from geometry to glyphs

- **Cell size** scales with width (`cw ≈ width / 124`, clamped to 7–13 px; `ch ≈ 1.5 × cw`). Draw text at about `0.74 × ch` in a bold monospace font.
- **z-buffer per cell**: everything calls `put(col, row, glyph, rgb, alpha, z)`, and the nearest write wins. Draw order then stops mattering.
- **Rasterise shapes by sampling.** For each cell in a shape's bounding box, take 4 sub-samples. Skip cells with fewer than 2 hits: single-sample hits read as noise.
- **Shade, then pick a glyph from one monotone ramp** (dim → bright, e.g. ` .:;=o*%8&@`), plus a small stable jitter from `hash(col − shapeCol, row − shapeRow, shapeId)`. Hash relative to the shape, so the texture moves with it instead of crawling.
- **Darken rims** (normalised distance > 0.6, tone × 0.6) so neighbouring units read as separate shapes.
- **Depth layers**: far layers are larger, dimmer, hazed toward the sky colour, and use only `.:;` — that is ASCII bokeh. Near layers are sharp and bright. Put the heroes in the light.
- **Fields** (`Float32Array` per cell) carry anything diffuse: a trail, heat, accumulated ground. Make blur and decay time-scaled: `k = min(0.2, dt × 0.25)` per neighbour and `decay = exp(−dt × rate)`. A per-frame blur kernel flattens a trail in about 2 s, no matter what decay you set.
- **Batch by colour**: quantise RGBA into a key, bucket the cells by key, and set `fillStyle` once per bucket.
- Paint the sky gradient, light pool and vignette once into an offscreen background canvas.

### 5. Palette

Define all colours in a single `palette.ts` as RGB stops, and expose overrides. One hue family should do the work. Push secondary elements (leaves, bark, ground) toward that family in grey, and keep one accent for rare glints. Avoid letter glyphs (`c e a`) in organic textures: they read as text.

### 6. Verify visually — every iteration

Animation tuning cannot be done by reading code.
- Expose the engine on `window` in the demo. That lets you step the world (`world.step(1/60)` in a loop) and dump the glyph grid as text when the preview can't run `requestAnimationFrame` (hidden panes).
- Take full-resolution screenshots (for example with Playwright at `scale: "css"` and a 1440×900 viewport). Downscaled screenshots hide whether cells read as shapes.
- Check the states one by one: steady state, mid-intro, pointer sweep (trail visible right after?), rare event (force it with a URL param like `?poemDelay=0`), and reduced motion.
- Common fixes:
  - Noisy carpet → fewer instances, bigger heroes, skip 1-hit cells.
  - Everything too dim → raise the tone gain before touching alpha.
  - Trail invisible → the blur is too strong, not the deposit too weak.
  - An odd rectangle of glyphs → a field accumulating at one point; lower the deposit.

### 7. Ship it

- Zero runtime dependencies: TypeScript + Vite, `src/index.ts` exports the engine, plus an optional React wrapper.
- Respect `prefers-reduced-motion` with one settled still frame.
- Pause when off-screen (`IntersectionObserver`).
- In the README, open with a real glyph dump from the running piece as the hero image, then a screenshot, the design rationale (feeling → mechanism), the options and credits.
- When inspired by someone else's repository, check its license. If it has none, re-implement from scratch and credit the idea.
