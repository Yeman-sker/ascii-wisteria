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
| `intro` | `true` | ~18 s growth opening; click skips. Forced off under reduced motion. |
| `poem` | Li Bai's 紫藤树, 4 lines | Lines that petals gather into, shown in order. `false` disables. Custom lines: keep them to ≤7 CJK characters, or short Latin words. |
| `poemDelay` | `45` | Seconds after the intro before the first poem. |
| `poemEvery` | `[150, 260]` | Random gap between poems, in seconds. |
| `density` | `1` | Background and mid-layer racemes per width. The hero racemes are fixed (3 on wide screens, 2 on medium, 1 on narrow). |
| `wind` | `1` | Scales all wind forces. |
| `palette` | `MOONLIGHT` | Partial override; see `src/palette.ts`. |

## Where to tune

| Want | Change |
|---|---|
| Brighter or darker flowers | the `tone` gain in `drawRaceme` (renderer), or the `petal` stops in the palette |
| Bigger or longer hero racemes | `heroes` and the hero `addRaceme(..., [0.42, 0.52], 3.3, ...)` call in `World.seed` |
| Denser florets low on the raceme | the spacing formula in `makeRaceme`: `width * (0.4 + 0.75 * s)` |
| A trail that lingers longer | `decay` and `k` in `AsciiRenderer.diffuse` |
| More or fewer falling petals | `rate` in `World.spawnPetals` |
| Moon position | `this.moon` in `World.seed`; keep it clear of the poem area (`stepPoem`'s mask area) |
| A different mood, e.g. dusk | a new palette: warmer `skyTop`, pinker `petal` highlights, a gold `moon` |

## Verifying changes

Run `npm run dev`. The demo exposes `window.wisteria`: call `wisteria.skipIntro()` to jump to full bloom, and use `?poemDelay=0&intro=0` to see the poem at once. Hidden preview panes may not run `requestAnimationFrame`. In that case, step it by hand with `wisteria.world.step(1/60)` in a loop, then `wisteria.renderer.render(wisteria.world, 1/60)`.
