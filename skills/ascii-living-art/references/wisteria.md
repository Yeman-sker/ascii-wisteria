# Embedding and tuning ascii-wisteria

## Embed

Copy `src/` into the project (or install from GitHub), then:

```ts
import { WisteriaEngine } from "./wisteria"; // path to src/index.ts

const engine = new WisteriaEngine(canvas, { intro: true });
// later: engine.destroy();
```

- The canvas needs a CSS size (e.g. `width: 100vw; height: 100vh`) and a **monospace `font-family`**; glyphs are drawn in that font at weight 600. Geist Mono, JetBrains Mono and Menlo all work.
- React: `import { AsciiWisteria } from "./wisteria/react"` → `<AsciiWisteria className="hero" options={{ intro: false }} />`. Options are read once at mount.
- Background colour behind the canvas: `#07060f`.

## Options

| Option | Default | Effect |
|---|---|---|
| `image` | none | A wisteria photograph to bring to life (cover-fitted, swayed, converted every frame). Without it, the built-in illustration is drawn. |
| `intro` | `true` | Opening: the photo is revealed top-down, or the illustration grows (~18 s); click skips. Forced off under reduced motion. |
| `density` | `1` | Background and mid-layer racemes per width. The two hero racemes are always placed. |
| `wind` | `1` | Scales all wind forces. |
| `palette` | `MOONLIGHT` | Partial override; see `src/palette.ts`. |

## Where to tune

| Want | Change |
|---|---|
| Brighter or darker flowers | the `tone` line in `Illustrator.drawRaceme`, or the `petal` stops in the palette |
| Bigger or longer hero racemes | `heroes` and the hero `addRaceme(..., [0.6, 0.68], 0.054)` call in `World.seed` (length and width are fractions of `unit`) |
| More or fewer florets | the spacing formula in `makeRaceme`: `width * (0.2 + 0.75 * s)` |
| Petal shape | the banner and keel ellipses in `Illustrator.drawRaceme` |
| Glyph choice | `FILL` and `STROKES` in `renderer.ts`, and the edge test in `convert()` |
| Finer or coarser ASCII | `cw` in `AsciiRenderer.resize` (`width / 175`, clamped 6–10) |
| A trail that lingers longer | `decay` and `k` in `AsciiRenderer.diffuse` |
| More or fewer falling petals | `rate` in `World.spawnPetals` |
| Moon position | `this.moon` in `World.seedCommon` (illustration only) |
| A different mood, e.g. dusk | a new palette: warmer `skyTop`, pinker `petal` highlights, a gold `moon` |

To see the illustration without the glyph conversion, run this in the console:
`const i = wisteria.renderer.illustrator.canvas, c = document.querySelector("canvas"); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height)`

## Verifying changes

Run `npm run dev`. The demo exposes `window.wisteria`: call `wisteria.skipIntro()` to jump to full bloom, or load with `?intro=0`. Hidden preview panes may not run `requestAnimationFrame`. In that case, step it by hand with `wisteria.world.step(1/60)` in a loop, then `wisteria.renderer.render(wisteria.world, 1/60)`.
