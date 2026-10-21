# ascii wisteria

English · [简体中文](README.zh-CN.md)

```
==~====::::~=~-----=:===o:;~=~--------'/\:**%%%===;   /
   ::;:==ooo;~~=~=~:oo*%%:::::**:;   --''-=88&o*%8%= '/
:;:==o;**%%%=      ;*::=:o****==*:=    /\:=o**=888o---/
==;::::===o*;*%***; :o*%;%%88&o:oo*;   '\'*%8&&o*%%%;o/
o:;=oo;*%%%%=o*;%o   =%:&=o&oooo%88    '| :oo**;8&&o:8'
*:o***%:ooo:;%o*%%--:=o*o;8&&o8:o**;----'-;%888o==;;%*
= ;=%%:=*%**;%:==o  ;%88+=::::o**;o        o::**%88oo
*  :;==;%88=:=o%=o   =8&**%8%==8o%8       :=**%=&&o*%%
; :=**%*;    %8;=o  :o*%=8&'@oo***        ;%8&&o;=:o8
   ;=%=;o*o  ;=%8o  =8&&&:**  8&o**        o****%88=*;
    :'=:%88  %%;=;    * =*%%%=;=o&'        :o**;&@*'&.
   ;*%%%::    :=%8   ==o=8&@& %8o          ;8&&&  ;**=
    =8o;=oo; o%*:   ;%8&o***    :*=         *@%:=oo;
    ;::*%8%8  oo*%    **=o*;    :|             *8&&o
   :o*%=8&o    o        %&&o     |          =***@*@%o
    %8o:;=          :;=; *       o          88@&;==
      :o%%=     o   *888o        |           **;%8&o
    ;=o;oo           &@*;=                      o@*
    *%%=               =8&o                   =o|
       |:              |                       @|
       *%=          . o|                        :o
       |               |                        |
      o|               |                        |
```

A moonlit curtain of wisteria drawn as ASCII on a canvas. Racemes sway and
spring back. Petals drift down and gather on the ground. Your cursor leaves a
thread of fragrance that lingers for a few seconds. Zero dependencies.

![preview](docs/preview.png)

```sh
npm install && npm run dev
```

```ts
import { WisteriaEngine } from "./src";

new WisteriaEngine(canvas); // give the canvas a monospace font-family
```

## The idea

| | |
|---|---|
| **Romance** | Everything is slow: racemes swing on a 4–7 s rhythm and petals fall at walking pace. Two old vines twist around each other along the trellis. |
| **Longing** | Your cursor leaves a thread of fragrance that rises and curls like incense, cooling from `*` to `.` over a few seconds. Fallen petals pile up and fade over about a minute. Now and then a petal stops mid-air for a moment, as if looking back. A low moon sits in the empty lower right. |
| **Noble, calm** | One blue-violet ramp carries the scene. Leaves and bark are pushed to grey-lavender, so nothing competes with it. The only accent is moonlight. |

The composition follows a night photograph of wisteria: a few large, sharp
racemes caught in a moonbeam, the rest falling away into soft, sparse bokeh,
and a blurred vine framing the lower-left corner.

### What you'll see

- **Growth opening** (~18 s): the vine reaches across, racemes lengthen, buds open from the top down, then the first petals fall. Click to skip.

  ![blooming](docs/blooming.png)

- **Fragrance**: the cursor is a breeze that pushes racemes aside as it passes. It is also a small lantern that lights the florets near it. Behind it, evenly spaced motes take a little of its speed, then slow, rise and curl, with fainter wisps feathering off to the sides. Florets they drift past light up for a moment.
- **Ripple**: a click sends out an ASCII ring that eases outward over about 3 s, followed a beat later by a fainter dotted echo. Racemes swing and shed petals only when the ring reaches them, and fallen petals it passes over flutter back up, so the click spreads through the scene as one wave.
- **Poem**: once in a long while, falling petals gather into a line of Li Bai's *Wisteria* (紫藤树), hold it for a few breaths, and let it go.

  ![poem](docs/poem.png)

With `prefers-reduced-motion`, you get a single still frame in full bloom. Rendering pauses while the canvas is off-screen.

## Options

```ts
new WisteriaEngine(canvas, {
  intro: true,              // growth opening; false starts in full bloom
  poem: ["香风留美人"],      // your own lines, or false to turn the poem off
  poemDelay: 45,            // seconds after the intro before the first poem
  poemEvery: [150, 260],    // seconds between poems
  density: 1,               // racemes per width, relative
  wind: 1,                  // wind strength, relative
  palette: { skyTop: [12, 9, 30] }, // override any colour of the moonlight palette
});
```

Demo URL params: `?intro=0`, `?poem=0`, `?poem=line one|line two`, `?poemDelay=0`.

React:

```tsx
import { AsciiWisteria } from "./src/react";

<AsciiWisteria className="hero" options={{ intro: false }} />;
```

The poem needs room: each character must be at least 8 cell rows tall, so narrow phone screens skip it.

## How it works

Three layers, the same structure as [ascii-sharks](https://github.com/stackedlol/ascii-sharks), which inspired this project:

- **`world.ts`: physics in pixels.**
  - Each raceme is a 14-node verlet chain pinned to the trellis. A little bending stiffness makes it swing as a whole, and florets hang off it in alternating pairs: big and dense at the top, sparse toward the tip.
  - Wind is two slow swells plus gusts on a ~40 s rhythm. The pointer's velocity pushes nearby nodes.
  - Petals tumble (their spin drives a side-slip), drift on the wind, and land in a ground field.
  - Only a ripple's front pushes the chain nodes it crosses, so swings travel outward. The ripple also shakes petals from the racemes it reaches and lifts fallen ones off the ground.
- **`renderer.ts`: cells and fields.**
  - Drawing goes into a character grid where the nearest layer wins each cell.
  - Each floret is an ellipse sampled 4 times per cell. It is shaded by the moonbeam and a fixed light direction, and darkened at its rim so neighbouring petals read as separate shapes.
  - Glyphs come from one ramp, ` .:;=o*%8&@`, nudged by a per-floret hash so the texture stays put as florets move. Far racemes use only `.:;` at low alpha, like out-of-focus bokeh.
  - Fragrance motes pick a glyph from their "heat", which fades with age. They also feed a slow glow field that lights the florets they pass.
  - Ripple rings are drawn with strokes that follow the circle (`- \ | /`).
- **`poem.ts`: text to cells.** A line is drawn at 4× resolution per cell on a scratch canvas. Cells that are more than 30% covered become targets, and petals glide onto them, slowing so they settle without overshooting.

## Skill

[`skills/ascii-living-art`](skills/ascii-living-art/SKILL.md) is an agent skill for Claude Code and compatible agents. It teaches the method behind this project (feeling → simulation → fields → glyph ramps → palette), so you can grow other living ASCII pieces: cherry blossom, jellyfish, fireflies. It also covers embedding and tuning this wisteria. To install it, copy the folder into `~/.claude/skills/` (or your project's `.claude/skills/`).

## Credits

- Architecture inspired by [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks). No code was copied; everything here is written from scratch.
- Verse: Li Bai, *Wisteria* (李白《紫藤树》).

## License

MIT
