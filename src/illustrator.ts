/**
 * Paints the World as a small vector illustration on an offscreen canvas, at
 * SX × SY samples per text cell. The renderer then turns that picture into
 * glyphs, so whatever reads as wisteria here reads as wisteria in ASCII.
 *
 * A floret is drawn the way it looks from the side: a broad banner petal
 * flaring up and back, and a cupped keel hanging out and down on a short
 * stalk. Each is lit from the upper left and outlined a shade darker, so
 * neighbouring petals stay separate shapes. Florets hang more steeply toward
 * the tip, and closed buds finish the raceme.
 */
import { clamp, lerp, mixRGB, ramp, smoothstep, type RGB } from "./math";
import type { Palette } from "./palette";
import type { Leaf, Raceme, Vine, World } from "./world";

/** Samples per cell, horizontally and vertically. */
export const SX = 4;
export const SY = 6;

/** Toward the light: the moon is up and to the left. */
const LIGHT = { x: -0.42, y: -0.91 };

export interface Shading {
  /** Scene light at a point: the moonbeam and the pointer's lantern. */
  lightAt(x: number, y: number): number;
  /** Extra warmth from fragrance and ripples passing by. */
  glowAt(x: number, y: number): number;
}

export class Illustrator {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private cw = 8;
  private ch = 12;
  private q = { x: 0, y: 0, tx: 0, ty: 1 };

  constructor(private palette: Palette) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  resize(cols: number, rows: number, cw: number, ch: number) {
    this.cw = cw;
    this.ch = ch;
    this.canvas.width = cols * SX;
    this.canvas.height = rows * SY;
  }

  draw(world: World, shade: Shading) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Draw in CSS pixels; the transform squeezes them into sample space.
    g.setTransform(SX / this.cw, 0, 0, SY / this.ch, 0, 0);
    g.lineCap = "round";
    g.lineJoin = "round";

    for (const v of world.vines) this.drawVine(world, v);
    // Racemes and leaves interleaved by depth, far to near.
    const items: (Raceme | Leaf)[] = [...world.racemes, ...world.leaves].sort((a, b) => a.depth - b.depth);
    for (const it of items) {
      if ("florets" in it) {
        if (it.depth < 0.5) this.drawBokeh(world, it, shade);
        else this.drawRaceme(world, it, shade);
      } else {
        this.drawLeaf(world, it, shade);
      }
    }
    this.drawFore(world, shade);
  }

  // ── racemes ─────────────────────────────────────────────────────────

  private drawRaceme(world: World, r: Raceme, shade: Shading) {
    if (r.grow <= 0) return;
    const g = this.ctx;
    const P = this.palette;
    const q = this.q;
    const t = world.time;
    const haze = (1 - r.depth) * 0.55;
    const unitW = r.width;

    // The stem, as far as it has grown.
    g.beginPath();
    for (let s = 0; s <= 1.0001; s += 0.05) {
      world.pointOn(r, s, q);
      if (s === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    }
    world.pointOn(r, 0.5, q);
    g.strokeStyle = css(mixRGB(P.stem, P.skyTop, haze), clamp(shade.lightAt(q.x, q.y), 0.3, 1));
    g.lineWidth = Math.max(1, unitW * 0.07);
    g.stroke();

    // Tip first, so the big florets at the top overlap the ones below like
    // scales; side florets before the ones facing out, which sit in front.
    for (let pass = 0; pass < 2; pass++)
    for (let i = r.florets.length - 1; i >= 0; i--) {
      const f = r.florets[i];
      if (f.s > r.grow || (f.side === 0) !== (pass === 1)) continue;
      world.pointOn(r, f.s / r.grow, q);
      const openness = f.s < r.bloom ? smoothstep(0, 0.1, r.bloom - f.s) : 0;
      const rad = unitW * f.size * (0.38 + 0.62 * openness) * Math.min(1, r.grow * 1.4);
      if (rad < 1) continue;

      // Hang out to the side, more steeply toward the tip, swaying a little on its own.
      const down = Math.atan2(q.ty, q.tx);
      const sway = Math.sin(t * 1.5 + f.phase) * 0.12 * (0.5 + world.gust);
      // Facing-out florets hang almost straight down, with a slight lean.
      const spread = f.side === 0 ? (hashSide(f.phase) * 0.25) : f.side * lerp(1.15, 0.45, f.s) * (0.5 + 0.5 * openness);
      const ang = down - spread + sway;
      const side = f.side === 0 ? (hashSide(f.phase) > 0 ? 1 : -1) : f.side;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const reach = f.side === 0 ? 0.1 : 0.35;
      const bx = q.x + dx * rad * reach;
      const by = q.y + dy * rad * reach;

      const lit = shade.lightAt(bx, by);
      const glow = shade.glowAt(bx, by);
      // Florets turned toward the moon catch more of it.
      const facing = 0.5 + 0.5 * (dx * LIGHT.x + dy * LIGHT.y);
      const tone = clamp((0.46 + 0.26 * facing) * lit * (0.55 + 0.5 * r.depth) + glow * 0.5, 0, 1);
      const tint = (c: RGB): RGB => mixRGB([c[0] + r.tint * 10, c[1] - r.tint * 2, c[2] - r.tint * 10], P.skyTop, haze);

      // Stalk.
      g.beginPath();
      g.moveTo(q.x, q.y);
      g.lineTo(bx, by);
      g.strokeStyle = css(tint(P.stem), 0.8);
      g.lineWidth = Math.max(0.8, unitW * 0.04);
      g.stroke();

      if (openness <= 0) {
        // A closed bud: a small dark drop.
        ellipse(g, bx + dx * rad * 0.4, by + dy * rad * 0.4, rad * 0.55, rad * 0.4, ang);
        g.fillStyle = css(tint(mixRGB(P.bud, P.petal[2], tone * 0.6)));
        g.fill();
        continue;
      }

      const rim = css(tint(ramp(P.petal, tone * 0.15)), 0.95);
      g.lineWidth = Math.max(1, rad * 0.15);

      // Banner: broad, flaring up and back.
      const nx = -dy * side;
      const ny = dx * side;
      ellipse(g, bx + dx * rad * 0.2 - nx * rad * 0.28, by + dy * rad * 0.2 - ny * rad * 0.28, rad * 0.66, rad * 0.54, ang - side * 0.7);
      g.fillStyle = css(tint(ramp(P.petal, tone + 0.1)));
      g.fill();
      g.strokeStyle = rim;
      g.stroke();

      // Keel: the cupped lower petal, hanging out along the stalk.
      const kx = bx + dx * rad * 0.72;
      const ky = by + dy * rad * 0.72;
      ellipse(g, kx, ky, rad * 0.74, rad * 0.46 * (0.7 + 0.3 * openness), ang + side * 0.15);
      g.fillStyle = css(tint(ramp(P.petal, tone)));
      g.fill();
      g.strokeStyle = rim;
      g.stroke();

      // Moonlight on the upper edge.
      ellipse(g, kx + LIGHT.x * rad * 0.18, ky + LIGHT.y * rad * 0.18, rad * 0.42, rad * 0.2, ang);
      g.fillStyle = css(tint(ramp(P.petal, tone + 0.32)), 0.75);
      g.fill();
    }
  }

  /** Far racemes as soft, overlapping discs: the photo's out-of-focus background. */
  private drawBokeh(world: World, r: Raceme, shade: Shading) {
    if (r.grow <= 0) return;
    const g = this.ctx;
    const P = this.palette;
    const q = this.q;
    for (const f of r.florets) {
      if (f.s > r.grow || f.s > r.bloom + 0.15) continue;
      world.pointOn(r, f.s / r.grow, q);
      const rad = r.width * f.size * 1.1;
      const x = q.x - q.ty * f.side * rad * 0.5;
      const y = q.y + q.tx * f.side * rad * 0.5;
      const tone = clamp(0.28 * shade.lightAt(x, y) + shade.glowAt(x, y) * 0.3, 0, 1);
      const col = mixRGB(ramp(P.petal, tone + 0.15), P.skyTop, 0.35);
      ellipse(g, x, y, rad * 1.25, rad * 1.05, 0);
      g.fillStyle = css(col, 0.22);
      g.fill();
      ellipse(g, x, y, rad * 0.7, rad * 0.6, 0);
      g.fillStyle = css(col, 0.28);
      g.fill();
    }
  }

  // ── leaves and branches ─────────────────────────────────────────────

  private drawLeaf(world: World, l: Leaf, shade: Shading) {
    if (l.grow <= 0) return;
    const g = this.ctx;
    const P = this.palette;
    const q = this.q;
    const haze = (1 - l.depth) * 0.5;

    g.beginPath();
    for (let s = 0; s <= 1.0001; s += 0.1) {
      world.pointOn(l, s, q);
      if (s === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    }
    g.strokeStyle = css(mixRGB(P.leaf[1], P.skyTop, haze), 0.8);
    g.lineWidth = Math.max(1, l.length * 0.012);
    g.stroke();

    for (const lf of l.leaflets) {
      if (lf.s > l.grow) continue;
      world.pointOn(l, lf.s / Math.max(l.grow, 1e-3), q);
      const ang = Math.atan2(q.ty, q.tx) - lf.side * lf.angle;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const len = lf.len * l.grow;
      const w = len * 0.26;
      const tipX = q.x + dx * len;
      const tipY = q.y + dy * len;
      const mx = q.x + dx * len * 0.45;
      const my = q.y + dy * len * 0.45;
      const lit = shade.lightAt(mx, my);
      const tone = clamp(lit * (0.26 + 0.3 * l.depth) + shade.glowAt(mx, my) * 0.3, 0, 1);

      // A lance: two curves meeting at a point.
      g.beginPath();
      g.moveTo(q.x, q.y);
      g.quadraticCurveTo(mx - dy * w, my + dx * w, tipX, tipY);
      g.quadraticCurveTo(mx + dy * w, my - dx * w, q.x, q.y);
      g.fillStyle = css(mixRGB(ramp(P.leaf, tone), P.skyTop, haze));
      g.fill();
      // Midrib, a shade darker.
      g.beginPath();
      g.moveTo(q.x, q.y);
      g.lineTo(q.x + dx * len * 0.85, q.y + dy * len * 0.85);
      g.strokeStyle = css(mixRGB(ramp(P.leaf, tone * 0.5), P.skyTop, haze), 0.9);
      g.lineWidth = Math.max(0.7, len * 0.03);
      g.stroke();
    }
  }

  private drawVine(world: World, v: Vine) {
    const reveal = smoothstep(v.start, v.start + v.duration, world.clock);
    if (reveal <= 0) return;
    const g = this.ctx;
    const pts = v.pts;
    const n = Math.floor((pts.length / 2) * reveal);
    if (n < 2) return;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let k = 1; k < n; k++) g.lineTo(pts[k * 2], pts[k * 2 + 1]);
    g.strokeStyle = css(this.palette.bark, 0.55 * v.depth);
    g.lineWidth = v.thick * 2.2;
    g.stroke();
  }

  /** Lower-left framing: near the lens, so large, soft and dim, with two lit flowers. */
  private drawFore(world: World, shade: Shading) {
    const fore = world.fore;
    if (!fore) return;
    const reveal = smoothstep(fore.vine.start, fore.vine.start + fore.vine.duration, world.clock);
    if (reveal <= 0) return;
    const g = this.ctx;
    const P = this.palette;
    const t = world.time;

    const pts = fore.vine.pts;
    const n = Math.floor((pts.length / 2) * reveal);
    if (n > 1) {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let k = 1; k < n; k++) g.lineTo(pts[k * 2], pts[k * 2 + 1]);
      g.strokeStyle = css(P.leaf[1], 0.5);
      g.lineWidth = 5;
      g.stroke();
    }

    for (const lf of fore.leaves) {
      const sway = Math.sin(t * 0.4 + lf.x * 0.01) * 0.05;
      const a = lf.angle + sway;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const len = lf.len * reveal;
      const w = len * 0.32;
      const mx = lf.x + dx * len * 0.45;
      const my = lf.y + dy * len * 0.45;
      g.beginPath();
      g.moveTo(lf.x, lf.y);
      g.quadraticCurveTo(mx - dy * w, my + dx * w, lf.x + dx * len, lf.y + dy * len);
      g.quadraticCurveTo(mx + dy * w, my - dx * w, lf.x, lf.y);
      g.fillStyle = css(ramp(P.leaf, 0.35 * shade.lightAt(mx, my)), 0.55);
      g.fill();
    }

    for (const b of fore.blooms) {
      const R = b.r * reveal;
      if (R < 1) continue;
      const tone = clamp(0.55 * shade.lightAt(b.x, b.y) + shade.glowAt(b.x, b.y) * 0.4, 0, 1);
      // An open flower seen face-on: three rounded petals around a darker heart.
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k - 1) * 0.9 + Math.sin(t * 0.5 + b.x) * 0.05;
        ellipse(g, b.x + Math.cos(a) * R * 0.45, b.y + Math.sin(a) * R * 0.45, R * 0.62, R * 0.44, a);
        g.fillStyle = css(ramp(P.petal, tone + (k === 1 ? 0.15 : 0)), 0.85);
        g.fill();
      }
      ellipse(g, b.x, b.y + R * 0.1, R * 0.3, R * 0.24, 0);
      g.fillStyle = css(ramp(P.petal, tone * 0.4), 0.9);
      g.fill();
    }
  }
}

/** A stable ±1 lean for florets that face out, taken from their phase. */
function hashSide(phase: number) {
  return Math.sin(phase * 7.3) > 0 ? 1 : -1;
}

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number) {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

function css(c: RGB, a = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

