---
name: ascii-living-art
description: Design and build living ASCII art on an HTML canvas — a subject (flowers, creatures, weather) simulated in pixels and drawn as a grid of glyphs that moves, reacts to the pointer and carries a mood. Use when the user wants an animated ASCII hero, background or art piece ("ASCII 樱花", "ASCII jellyfish hero", "make it feel romantic"), wants to adapt or tune ascii-wisteria, or asks how projects like ascii-sharks / ascii-wisteria work.
---

# ASCII living art

A living ASCII piece is four layers. Keep them separate; most quality problems come from mixing them.

1. **World** (`world.ts`) — the subject as physics, in CSS pixels. No DOM, no glyphs.
2. **Illustrator** (`illustrator.ts`) — paints the world as a real vector illustration on an offscreen canvas, at a few samples per text cell.
3. **Renderer** (`renderer.ts`) — reads that picture back and chooses one glyph + one colour per cell, then draws overlays (particles, trails, text) directly as glyphs.
4. **Engine** (`engine.ts`) — canvas plumbing: fixed 60 Hz timestep, resize, pointer, pause off-screen, `prefers-reduced-motion`.

**The rule that decides whether the subject is recognisable: illustrate first, convert second.** If the offscreen picture reads as the subject, the ASCII will too. Choosing a glyph per cell from brightness alone (a density ramp over procedural blobs) produces coloured noise, however you tune it. People recognise the subject from:
- a few large silhouettes with dark air between them;
- flat surfaces inside each part (one glyph family per petal, with shading carried by colour);
- outlines drawn with stroke glyphs that follow the shape;
- enough resolution that each part spans several cells.

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

### 2. Get a reference image, and test the ceiling first

Before writing the illustrator, convert the reference photo itself to ASCII at your target cell size (see the converter in step 4). If even the photo is unrecognisable at that size, no simulation will be: enlarge the subject, shrink the cells, or simplify the composition. In this project the photo stopped reading at 12 px cells and started reading at 7–8 px.

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

### 4. Illustrator and renderer: from shapes to glyphs

**Illustrator.** Give it a canvas sized `cols × SX` by `rows × SY` (4 × 6 samples per cell works), opened with `willReadFrequently: true`. Draw in CSS pixels under `setTransform(SX / cw, 0, 0, SY / ch, 0, 0)`.
- Draw each part as it really looks from the viewer's side, from simple primitives: ellipses, quadratic-curve lances, stroked polylines. (Wisteria floret: a broad banner petal flaring up and back, plus a cupped keel hanging out on a short stalk.)
- Light every part from one direction, add a small highlight on the lit edge, and stroke a darker rim: rims are what keep neighbouring parts separate after conversion.
- Draw back to front. Within a cluster, draw the tip first so the upper parts overlap like scales.
- Far layers: soft, overlapping, low-alpha discs. They convert into bokeh for free. Skip canvas `filter: blur` (slow on a CPU-backed canvas).
- Keep a debug path that paints the illustration canvas onto the screen, and tune the *picture* until it reads well before touching glyph choice.

**Renderer, per cell** (one `getImageData` per frame):
- Compute the sample luminances (premultiplied by alpha), mean, peak, low and coverage, plus the alpha-weighted mean colour.
- **Dim cells** (peak < ~0.13): a single `.` at low alpha.
- **Edge cells** (coverage < 0.6 and `peak − low > 0.45·peak + 0.04`): least-squares match of `samples / peak` against glyph bitmaps from a *restricted stroke set*, `" .,'\`-_|/\\()^v<>"`. Rasterise the bitmaps from the real font at the same SX × SY, normalised to their own peak. Never offer every glyph: brackets and letters win often and read as code.
- **Flat cells**: a short ramp (`.:;o%@`) indexed by the surface brightness (`mean / coverage`) on a gamma curve (`^1.5`), so dark leaves stay sparse and a lit petal stays one surface.
- **Colour**: the covered pixels' own mean colour, brightened as a whole so the glyph's ink matches the petal. Scale uniformly when a channel would exceed ~240, rather than clipping each channel, or highlights wash out to white.
- Use a z-buffer per cell. Draw the illustration at a fixed z; draw overlays (falling particles, motes, ripples, poem) above or below it.
- **Cell size**: `cw ≈ width / 175`, clamped to 6–10 px; `ch = 1.5 × cw`; font size ≈ `0.8 × ch`.
- **Fields** (`Float32Array` per cell) carry anything diffuse: a trail, heat, accumulated ground. Make blur and decay time-scaled: `k = min(0.2, dt × 0.25)` per neighbour and `decay = exp(−dt × rate)`. Feed the field back into the illustrator as extra light, so trails warm the parts they pass.
- **Batching**: quantise RGBA into a key, bucket the cells by key, and set `fillStyle` once per bucket.
- **Budget**: in this project the illustration plus conversion costs about 7 ms per frame at 1440 × 900.

### 4b. When the illustration can't match the subject, animate a photograph

Some subjects defeat simple primitives: hand-drawn wisteria florets read as grapes, however you tune them. If a photo-to-ASCII test of a good reference beats your illustration, use the photograph as the source picture, and keep the simulation for motion and overlays.

- **Motion without segmentation**: give the scene a row of damped pendulum columns (about 40 across, with a period of ~5 s). Draw the photo into the sample canvas in tiles, each shifted by its column's angle × its distance below the top. Anything hanging swings as a whole; the top barely moves. Wind, pointer speed and ripple fronts drive the pendulums. Overlap tiles by a pixel so no seams show.
- **Emitters from the image**: threshold its luminance (e.g. > 0.38) on a ~200 px thumbnail. Those pixels, displaced by the sway, are where particles spawn.
- **Conversion**: at 5 × 8 samples per cell, use the brightest sample as the ink and pick the glyph whose raw coverage bitmap best fits `samples / peak`. Order the candidates by frequency (`@` first), stop each comparison once it exceeds the best so far, and send flat cells (`low > 0.8·peak`) straight to `@`. Look the brightness curve up in a table, not with `Math.pow` per sample.
- **Budget**: give the photo its own layer, refreshed over a three-frame cycle (convert the top half, convert the bottom half, repaint). Redraw overlays every frame. Keep a `photoMask`, so overlays meant to sit behind the plant stay hidden behind it.
- **Opening**: reveal the photo from the top down, column by column, with a soft gradient edge.
- **Rights**: ask before publishing someone's photograph (or screenshots derived from it) in a public repository.

### 5. Palette

Define all colours in a single `palette.ts` as RGB stops, and expose overrides. One hue family should do the work. Push secondary elements (leaves, bark, ground) toward that family in grey, and keep one accent for rare glints. Avoid letter glyphs (`c e a`) in organic textures: they read as text.

### 6. Verify visually — every iteration

Animation tuning cannot be done by reading code.
- Expose the engine on `window` in the demo. That lets you step the world (`world.step(1/60)` in a loop) and dump the glyph grid as text when the preview can't run `requestAnimationFrame` (hidden panes).
- Take full-resolution screenshots (for example with Playwright at `scale: "css"` and a 1440×900 viewport). Downscaled screenshots hide whether cells read as shapes.
- Check the states one by one: steady state, mid-intro, pointer sweep (trail visible right after?), rare event (force it with a URL param like `?poemDelay=0`), and reduced motion.
- Common fixes:
  - "Doesn't look like the subject" → check the illustration on its own first; then the silhouette size, the dark gaps and the cell size.
  - Noisy carpet → fewer instances, bigger heroes, a flat ramp inside shapes.
  - Everything too dim → raise the tone gain before touching alpha.
  - Trail invisible → the blur is too strong, not the deposit too weak.
  - An odd rectangle of glyphs → a field accumulating at one point; lower the deposit.

### 7. Ship it

- Zero runtime dependencies: TypeScript + Vite, `src/index.ts` exports the engine, plus an optional React wrapper.
- Respect `prefers-reduced-motion` with one settled still frame.
- Pause when off-screen (`IntersectionObserver`).
- In the README, open with a real glyph dump from the running piece as the hero image, then a screenshot, the design rationale (feeling → mechanism), the options and credits.
- When inspired by someone else's repository, check its license. If it has none, re-implement from scratch and credit the idea.
