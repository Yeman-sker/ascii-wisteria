# ascii wisteria · 紫藤

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
spring back, shed petals that drift down and gather on the ground, and the air
remembers where your cursor passed for a few seconds. Zero dependencies.

一帘月夜紫藤，用 ASCII 字符画在 canvas 上。花串随风轻摆，落花飘下、在地面慢慢积起又淡去；
鼠标划过的地方会留下一缕"余香"，好几秒才散。零依赖。

![preview](docs/preview.png)

```sh
npm install && npm run dev
```

```ts
import { WisteriaEngine } from "./src";

new WisteriaEngine(canvas); // give the canvas a monospace font-family
```

## The idea · 设计

| | |
|---|---|
| **浪漫 Romance** | Everything is slow: racemes swing on a 4–7 s rhythm, petals fall at walking pace. Two old vines twist around each other along the trellis. 一切都慢；两根老藤沿着花架彼此缠绕。 |
| **思念 Longing** | Your cursor leaves a thread of fragrance that rises and curls like incense, cooling from `*` to `.` over a few seconds. Fallen petals pile up and fade over a minute. Now and then a petal stops mid-air for a moment, as if looking back. A low moon sits in the empty lower right — 望月怀人. 鼠标留下一缕暗香，像焚香的烟一样上浮、打旋，由 `*` 渐渐冷却成 `.`；落花慢慢堆积，偶有一片停在半空回望；右下留白处一轮低月。 |
| **高贵 · 冷静 Noble, calm** | One blue-violet ramp carries the scene; leaves and bark are pushed to grey-lavender so nothing competes with it. The only accent is moonlight. 一条蓝紫色阶撑起全局，叶与枝都压成灰紫，唯一的点缀是月光。 |

Composition follows a night photograph of wisteria: a few large, sharp racemes
caught in a moonbeam, the rest falling away into soft, sparse bokeh, and a
blurred vine framing the lower-left corner. 构图取自一张夜间紫藤照片：几串清晰的主角花串浸在月光里，
其余渐次虚化成稀疏的散景，左下角一道虚焦的藤蔓做前景框。

### What you'll see · 会发生什么

- **Growth opening 生长开场** (~18 s): the vine reaches across, racemes lengthen, buds open from the top down, then the first petals fall. Click to skip. 藤蔓伸展 → 花串垂下 → 花苞自上而下开放 → 第一片花瓣落下。点击可跳过。

  ![blooming](docs/blooming.png)

- **Fragrance 暗香**: the cursor is a breeze, pushing racemes aside as it passes, and a small lantern that lights the florets near it. Behind it, evenly spaced motes inherit a little of its speed, then slow, rise and curl, with fainter wisps feathering off to the sides. Florets they drift past warm up for a moment. 鼠标是一阵风，也是一盏小灯；身后留下均匀的香气微粒，继承一点鼠标的速度后慢下来、上浮、打旋，两侧还散出更淡的烟丝；经过的花会被短暂映亮。
- **Ripple 涟漪**: a click sends out a drawn ASCII ring that eases outward over ~3 s, with a dotted echo a beat behind. Racemes swing and shed petals only when the ring reaches them, and fallen petals it passes over flutter back up — one wave spreading through the scene. 点击发出一圈用笔画字符画成的涟漪，约 3 秒缓缓扩散，后面跟着一圈虚线回声；涟漪扫到哪串花，哪串才摆动、落瓣，扫过地面会惊起积花。
- **Poem 诗**: once in a long while, falling petals gather into a line of Li Bai's *紫藤树*, hold it for a few breaths, and let it go. 很久才有一次，落花聚成李白《紫藤树》中的一句，停留几息，又散去。

  ![poem](docs/poem.png)

`prefers-reduced-motion` gets a single still frame in full bloom. Rendering pauses when the canvas is off-screen.

## Options · 参数

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

Demo URL params: `?intro=0`, `?poem=0`, `?poem=第一句|第二句`, `?poemDelay=0`.

React:

```tsx
import { AsciiWisteria } from "./src/react";

<AsciiWisteria className="hero" options={{ intro: false }} />;
```

The poem needs room: each character must be at least 8 cell rows tall, so on narrow phones it is skipped. 诗句需要足够空间（每个字至少 8 行字符高），窄屏手机上会自动跳过。

## How it works · 实现

Three layers, same shape as [ascii-sharks](https://github.com/stackedlol/ascii-sharks), which inspired this:

- **`world.ts` — physics in pixels.** Each raceme is a 14-node verlet chain pinned to the trellis, with a little bending stiffness so it swings as a whole. Florets hang off it in alternating pairs, big and dense at the top, sparse toward the tip. Wind is two slow swells plus gusts on a ~40 s rhythm; the pointer's velocity pushes nearby nodes. Petals tumble (spin drives a side-slip), drift on the wind, and land in a ground field. A ripple's front pushes the chain nodes it crosses, so swings propagate outward; it also sheds petals from the racemes it reaches and lifts fallen ones from the ground.
- **`renderer.ts` — cells and fields.** A z-buffered character grid. Each floret is an ellipse rasterised with 4 sub-samples per cell, shaded by the moonbeam and a fixed light direction, and darkened at its rim so neighbouring petals read as separate shapes. Glyphs come from one monotone ramp ` .:;=o*%8&@`, nudged by a per-floret hash so the texture stays stable as florets move. Far racemes use only `.:;` at low alpha — ASCII bokeh. Fragrance motes pick a glyph from their "heat", which decays with age. They also warm a slow, frame-rate-independent glow field, which brightens the florets they pass. Ripple rings are sampled by angle and drawn with tangent strokes (`- \ | /`).
- **`poem.ts` — text to cells.** A line is drawn 4× supersampled per cell on a scratch canvas; cells above 30% coverage become targets, and petals steer onto them with a critically damped spring.

## Skill

[`skills/ascii-living-art`](skills/ascii-living-art/SKILL.md) is an agent skill (Claude Code and compatible agents) that teaches the method behind this project — simulation → fields → glyph ramps → palette → emotion — so you can grow other living ASCII pieces (cherry blossom, jellyfish, fireflies…). It also covers embedding and tuning this wisteria. Install it by copying the folder into `~/.claude/skills/` (or your project's `.claude/skills/`).

这个仓库附带一个 agent skill，提炼了"ASCII 生命艺术"的做法（模拟 → 场 → 字符色阶 → 配色 → 情绪），可以迁移到樱花、水母、萤火虫等题材，也包含本项目的嵌入与调参说明。把文件夹复制到 `~/.claude/skills/` 即可使用。

## Credits

- Architecture inspired by [stackedlol/ascii-sharks](https://github.com/stackedlol/ascii-sharks). No code was copied; everything here is written from scratch.
- Verse: 李白《紫藤树》— 紫藤挂云木，花蔓宜阳春。密叶隐歌鸟，香风留美人。

MIT
