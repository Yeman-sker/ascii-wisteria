/**
 * Draws the World as a grid of ASCII cells, back to front through a z-buffer:
 *   1. a night sky: indigo gradient, a faint moon, slow-twinkling stars
 *   2. fragrance: a field that diffuses where the pointer passed and fades
 *      over several seconds, so the garden remembers you for a while
 *   3. fallen petals gathering along the ground, slowly fading
 *   4. trellis vines, leaf sprays, and racemes: each floret is a small blob
 *      shaded by the moonbeam, darkened at its rim so petals read as
 *      separate; far racemes are drawn soft and sparse like out-of-focus bokeh
 *   5. falling petals, tumbling through four glyphs
 */
import { clamp, hash3, mixRGB, ramp, smoothstep, TAU, type RGB } from "./math";
import { MOONLIGHT, type Palette } from "./palette";
import { PetalState, type Chain, type Raceme, type Vine, type World } from "./world";

const GROUND_ROWS = 3;
const SUB = [0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75];
const PETAL_GLYPHS = ["'", "`", ",", "."];
/** Florets, dim → bright. */
const FLORET_RAMP = " .:;=o*%8&@";
const LIGHT_DIR = { x: -0.42, y: -0.91 };

export class AsciiRenderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private dpr = 1;
  private width = 0;
  private height = 0;
  private cw = 10;
  private ch = 15;
  private cols = 0;
  private rows = 0;
  private fontFamily = "ui-monospace, Menlo, monospace";
  private palette: Palette;

  private glyph: string[] = [];
  private color = new Uint32Array(0);
  private zbuf = new Float32Array(0);
  private energy = new Float32Array(0);
  private energyTmp = new Float32Array(0);
  private ground = new Float32Array(0);
  private stars: { i: number; phase: number; freq: number; g: string }[] = [];
  private moonCells: { i: number; g: string; a: number }[] = [];

  private styleCache = new Map<number, string>();
  private buckets = new Map<number, number[]>();
  private lastPtr = { x: 0, y: 0, has: false };
  private q = { x: 0, y: 0, tx: 0, ty: 1 };
  private world: World | null = null;

  constructor(private canvas: HTMLCanvasElement, palette: Partial<Palette> = {}) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.palette = { ...MOONLIGHT, ...palette };
  }

  get cellWidth() {
    return this.cw;
  }

  get cellHeight() {
    return this.ch;
  }

  get font() {
    return this.fontFamily;
  }

  setFontFamily(family: string) {
    if (family) this.fontFamily = family;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124), 7, 13);
    this.ch = Math.round(this.cw * 1.5);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;

    const n = this.cols * this.rows;
    this.glyph = new Array(n).fill("");
    this.color = new Uint32Array(n);
    this.zbuf = new Float32Array(n);
    this.energy = new Float32Array(n);
    this.energyTmp = new Float32Array(n);
    this.ground = new Float32Array(this.cols * GROUND_ROWS);

    this.moonCells = [];
    this.stars = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const h = hash3(c, r, 11);
        // Fewer stars low down, where the petals fall.
        const p = r < this.rows * 0.6 ? 0.006 : 0.0025;
        if (h < p) {
          const g = hash3(c, r, 12) < 0.12 ? "+" : ".";
          this.stars.push({ i: r * this.cols + c, phase: hash3(c, r, 13) * TAU, freq: 0.15 + hash3(c, r, 14) * 0.5, g });
        }
      }
    }
    this.paintBackground();
  }

  private paintBackground() {
    const g = this.bg.getContext("2d");
    if (!g) return;
    const { width: W, height: H, dpr, palette: P } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, rgb(P.skyTop));
    sky.addColorStop(1, rgb(P.skyBottom));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // A faint pool of light where the moonbeam falls, and a vignette.
    const pool = g.createRadialGradient(W * 0.5, H * 0.32, 0, W * 0.5, H * 0.32, Math.max(W, H) * 0.6);
    pool.addColorStop(0, "rgba(70,56,150,0.16)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = pool;
    g.fillRect(0, 0, W, H);
    const vig = g.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.35, W * 0.5, H * 0.45, Math.max(W, H) * 0.8);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }

  private buildMoon(world: World) {
    this.moonCells = [];
    const { cw, ch, cols, rows } = this;
    const { x: mx, y: my, r: R } = world.moon;
    const c0 = Math.floor((mx - R * 2.2) / cw);
    const c1 = Math.ceil((mx + R * 2.2) / cw);
    const r0 = Math.floor((my - R * 2.2) / ch);
    const r1 = Math.ceil((my + R * 2.2) / ch);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const x = (c + 0.5) * cw - mx;
        const y = (r + 0.5) * ch - my;
        const d = Math.hypot(x, y) / R;
        const i = r * cols + c;
        if (d < 1) {
          // Lit from the lower left a touch, with soft maria.
          const maria = hash3((c / 2) | 0, (r / 2) | 0, 5) * 0.35;
          const lit = clamp(0.75 - 0.35 * d * d - maria + (-x / R) * 0.12, 0.15, 1);
          const g = d > 0.88 ? "." : maria > 0.24 ? ":" : lit > 0.62 ? "o" : ";";
          this.moonCells.push({ i, g, a: 0.22 + lit * 0.4 });
        } else if (d < 2.2 && hash3(c, r, 8) < 0.5 * (1 - (d - 1) / 1.2)) {
          this.moonCells.push({ i, g: ".", a: 0.06 * (1 - (d - 1) / 1.2) + 0.02 });
        }
      }
    }
  }

  render(world: World, dt: number) {
    const { ctx, dpr, cols } = this;
    if (cols === 0) return;
    if (this.world !== world || this.moonCells.length === 0) {
      this.world = world;
      this.buildMoon(world);
    }
    this.consumeEvents(world, dt);
    this.diffuse(dt);

    this.glyph.fill("");
    this.zbuf.fill(-1);

    const reveal = world.introDone ? 1 : smoothstep(0, 3, world.clock);
    this.drawSky(world, reveal);
    this.drawFragrance();
    this.drawGround(world);
    this.drawFore(world);
    for (const v of world.vines) this.drawVine(world, v);
    for (const l of world.leaves) this.drawLeaf(world, l);
    for (const r of world.racemes) this.drawRaceme(world, r);
    this.drawPetals(world);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.flush();
  }

  // ── buffer ──────────────────────────────────────────────────────────

  private put(c: number, r: number, g: string, col: RGB, a: number, z: number) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || a < 0.02) return;
    const i = r * this.cols + c;
    if (z < this.zbuf[i]) return;
    this.zbuf[i] = z;
    this.glyph[i] = g;
    this.color[i] =
      (clamp(col[0] | 0, 0, 255) >> 2) << 16 |
      (clamp(col[1] | 0, 0, 255) >> 2) << 10 |
      (clamp(col[2] | 0, 0, 255) >> 2) << 4 |
      Math.round(clamp(a, 0, 1) * 15);
  }

  private putPx(x: number, y: number, g: string, col: RGB, a: number, z: number) {
    this.put(Math.floor(x / this.cw), Math.floor(y / this.ch), g, col, a, z);
  }

  private flush() {
    const { ctx, cw, ch, cols, glyph, color, buckets, styleCache } = this;
    for (const list of buckets.values()) list.length = 0;
    for (let i = 0; i < glyph.length; i++) {
      if (!glyph[i]) continue;
      const k = color[i];
      let list = buckets.get(k);
      if (!list) buckets.set(k, (list = []));
      list.push(i);
    }
    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [k, list] of buckets) {
      if (list.length === 0) continue;
      let style = styleCache.get(k);
      if (!style) {
        const r = ((k >> 16) & 63) << 2;
        const g = ((k >> 10) & 63) << 2;
        const b = ((k >> 4) & 63) << 2;
        style = `rgba(${r},${g},${b},${((k & 15) / 15).toFixed(3)})`;
        styleCache.set(k, style);
      }
      ctx.fillStyle = style;
      for (const i of list) {
        const c = i % cols;
        const r = (i / cols) | 0;
        ctx.fillText(glyph[i], (c + 0.5) * cw, (r + 0.5) * ch);
      }
    }
  }

  // ── fields ──────────────────────────────────────────────────────────

  private stamp(field: Float32Array, x: number, y: number, radius: number, amount: number) {
    const c0 = Math.floor(x / this.cw);
    const r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius * 2; c <= c0 + radius * 2; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const d = Math.hypot((c - c0) * 0.5, r - r0);
        if (d > radius + 0.5) continue;
        const i = r * this.cols + c;
        field[i] = Math.min(1.2, field[i] + amount * (1 - d / (radius + 1)));
      }
    }
  }

  private consumeEvents(world: World, dt: number) {
    for (const e of world.events) {
      if (e.kind === "shake") {
        this.stamp(this.energy, e.x, e.y, 5, 0.7);
      } else {
        const c = Math.floor(e.x / this.cw);
        for (const [dc, amt] of [[0, 0.55], [-1, 0.18], [1, 0.18]]) {
          const cc = c + dc;
          if (cc < 0 || cc >= this.cols) continue;
          // Fill the lowest row first, then heap upward.
          let row = 0;
          while (row < GROUND_ROWS - 1 && this.ground[row * this.cols + cc] > 1.1 + row * 0.2) row++;
          const i = row * this.cols + cc;
          this.ground[i] = Math.min(1.6, this.ground[i] + amt);
        }
      }
    }
    world.events.length = 0;

    // The pointer leaves fragrance along its whole path, not just where it was sampled.
    const p = world.pointer;
    const speed = Math.hypot(p.vx, p.vy);
    if (p.active && speed > 12) {
      const amount = 0.2 * Math.min(1, speed / 400) * Math.min(1, dt * 60);
      if (this.lastPtr.has) {
        const dx = p.x - this.lastPtr.x;
        const dy = p.y - this.lastPtr.y;
        const steps = Math.min(30, Math.ceil(Math.hypot(dx, dy) / this.cw));
        for (let s = 1; s <= steps; s++) {
          this.stamp(this.energy, this.lastPtr.x + (dx * s) / steps, this.lastPtr.y + (dy * s) / steps, 1, amount);
        }
      } else {
        this.stamp(this.energy, p.x, p.y, 1, amount);
      }
    }
    this.lastPtr.x = p.x;
    this.lastPtr.y = p.y;
    this.lastPtr.has = p.active;

    // Lingering petals glow faintly around themselves.
    for (const pt of world.petals) {
      if (pt.alive && pt.state === PetalState.Linger) this.stamp(this.energy, pt.x, pt.y, 0, 0.004);
    }
  }

  /** Slow blur + slow decay: the trail spreads a little and lingers ~8 s. */
  private diffuse(dt: number) {
    const { cols, rows, energy, energyTmp: tmp, ground } = this;
    const decay = Math.exp(-dt * 0.3);
    // Spread per neighbour, scaled by time so the blur doesn't depend on frame rate.
    const k = Math.min(0.2, dt * 0.25);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const l = c > 0 ? energy[i - 1] : energy[i];
        const rt = c < cols - 1 ? energy[i + 1] : energy[i];
        const u = r > 0 ? energy[i - cols] : energy[i];
        const d = r < rows - 1 ? energy[i + cols] : energy[i];
        tmp[i] = (energy[i] * (1 - 4 * k) + (l + rt + u + d) * k) * decay;
      }
    }
    this.energy = tmp;
    this.energyTmp = energy;
    const fade = Math.exp(-dt / 55);
    for (let i = 0; i < ground.length; i++) ground[i] *= fade;
  }

  /** Scene light at (x, y): the moonbeam, plus the pointer as a small lantern. */
  private lightAt(world: World, x: number, y: number) {
    const { light, pointer } = world;
    const sigma = Math.max(this.width, this.height) * 0.3;
    const dx = x - light.x;
    const dy = (y - light.y) * 1.3;
    let l = 0.4 + 0.72 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    if (pointer.active) {
      const px = x - pointer.x;
      const py = y - pointer.y;
      l += 0.45 * Math.exp(-(px * px + py * py) / (2 * 95 * 95));
    }
    return l;
  }

  // ── sky, fragrance, ground ──────────────────────────────────────────

  private drawSky(world: World, reveal: number) {
    const { palette: P, cols } = this;
    const t = world.time;
    for (const s of this.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.freq + s.phase);
      this.put(s.i % cols, (s.i / cols) | 0, s.g, P.moon, (0.05 + 0.26 * tw * tw * tw) * reveal, 0);
    }
    for (const m of this.moonCells) {
      this.put(m.i % cols, (m.i / cols) | 0, m.g, P.moon, m.a * reveal, 0.01);
    }
  }

  private drawFragrance() {
    const { energy, cols, palette: P } = this;
    for (let i = 0; i < energy.length; i++) {
      const e = energy[i];
      if (e < 0.015) continue;
      const g = e < 0.1 ? "." : e < 0.28 ? ":" : ";";
      this.put(i % cols, (i / cols) | 0, g, P.fragrance, Math.min(0.6, 0.08 + e * 2.2), 0.05);
    }
  }

  private drawGround(world: World) {
    const { ground, cols, rows, palette: P, cw, ch } = this;
    for (let row = 0; row < GROUND_ROWS; row++) {
      for (let c = 0; c < cols; c++) {
        const v = ground[row * cols + c];
        if (v < 0.06) continue;
        const g = v < 0.3 ? "." : v < 0.65 ? "," : v < 1 ? ":" : ";";
        const lit = this.lightAt(world, (c + 0.5) * cw, (rows - 1 - row) * ch);
        const col = mixRGB(P.fallen, P.petal[3], clamp(v - 0.6, 0, 1) * 0.5);
        this.put(c, rows - 1 - row, g, col, clamp(0.12 + 0.5 * Math.min(v, 1), 0, 0.7) * Math.min(1, lit), 0.1);
      }
    }
  }

  // ── branches and leaves ─────────────────────────────────────────────

  /** A stroke glyph for a direction in pixels, accounting for the cell aspect. */
  private strokeGlyph(dx: number, dy: number) {
    const a = Math.atan2(dy / this.ch, dx / this.cw);
    const k = ((Math.round(a / (Math.PI / 4)) % 4) + 4) % 4;
    return "-\\|/"[k];
  }

  private drawVine(world: World, v: Vine) {
    const { palette: P } = this;
    const reveal = smoothstep(v.start, v.start + v.duration, world.clock);
    if (reveal <= 0) return;
    const pts = v.pts;
    const n = Math.floor((pts.length / 2) * reveal);
    for (let k = 1; k < n; k++) {
      const x = pts[k * 2];
      const y = pts[k * 2 + 1];
      const dx = x - pts[k * 2 - 2];
      const dy = y - pts[k * 2 - 1];
      const lit = Math.min(1.1, this.lightAt(world, x, y));
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      let g = this.strokeGlyph(dx, dy);
      if (g === "-" && v.thick > 1) g = hash3(c, r, 21) < 0.65 ? "=" : "~";
      const col = mixRGB(P.bark, P.leaf[2], 0.15 * lit);
      this.put(c, r, g, col, (0.45 + 0.45 * v.depth) * lit, v.depth - 0.05);
      if (v.thick > 1) this.put(c, r + 1, hash3(c, r, 22) < 0.5 ? "-" : "_", P.bark, 0.4 * lit, v.depth - 0.06);
    }
  }

  private drawLeaf(world: World, l: Chain & { leaflets: { s: number; side: 1 | -1; len: number; angle: number }[] }) {
    if (l.grow <= 0) return;
    const { palette: P, q } = this;
    const z = l.depth - 0.03;
    const haze = (1 - l.depth) * 0.5;
    for (const lf of l.leaflets) {
      if (lf.s > l.grow) continue;
      world.pointOn(l, lf.s / Math.max(l.grow, 1e-3), q);
      // Leaflet direction: the stem tangent rotated out to its side.
      const ang = Math.atan2(q.ty, q.tx) - lf.side * lf.angle;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const g = this.strokeGlyph(dx, dy);
      const len = lf.len * l.grow;
      for (let d = this.cw * 0.6; d < len; d += this.cw * 0.6) {
        const x = q.x + dx * d;
        const y = q.y + dy * d;
        const lit = this.lightAt(world, x, y);
        const tone = clamp(lit * (0.45 + 0.4 * l.depth) - (d / len) * 0.15, 0, 1);
        const col = mixRGB(ramp(P.leaf, tone), P.skyTop, haze);
        this.putPx(x, y, d + this.cw * 0.6 >= len ? "'" : g, col, 0.35 + 0.55 * l.depth, z);
      }
    }
    // The leaf's own stem.
    for (let s = 0; s < 1; s += 0.08) {
      world.pointOn(l, s, q);
      this.putPx(q.x, q.y, this.strokeGlyph(q.tx, q.ty), P.leaf[1], 0.3 + 0.4 * l.depth, z - 0.001);
    }
  }

  /** Lower-left framing, deliberately out of focus: soft, sparse and dim. */
  private drawFore(world: World) {
    const fore = world.fore;
    if (!fore) return;
    const { palette: P, cw, ch } = this;
    const reveal = smoothstep(fore.vine.start, fore.vine.start + fore.vine.duration, world.clock);
    if (reveal <= 0) return;
    const pts = fore.vine.pts;
    const n = Math.floor((pts.length / 2) * reveal);
    for (let k = 1; k < n; k++) {
      const x = pts[k * 2];
      const y = pts[k * 2 + 1];
      for (let o = -1; o <= 1; o++) {
        const g = o === 0 ? ":" : ".";
        this.putPx(x, y + o * ch * 0.6, g, P.leaf[1], o === 0 ? 0.32 : 0.14, 0.2);
      }
    }
    const t = world.time;
    for (const lf of fore.leaves) {
      const sway = Math.sin(t * 0.4 + lf.x * 0.01) * 0.06;
      const dx = Math.cos(lf.angle + sway);
      const dy = Math.sin(lf.angle + sway);
      for (let d = 0; d < lf.len * reveal; d += cw * 0.5) {
        const w = Math.sin((d / lf.len) * Math.PI) * lf.len * 0.2;
        for (let o = -w; o <= w; o += cw * 0.8) {
          const x = lf.x + dx * d - dy * o;
          const y = lf.y + dy * d + dx * o;
          const edge = Math.abs(o) / (w || 1);
          this.putPx(x, y, edge > 0.6 ? "." : ":", P.leaf[1], 0.24 - edge * 0.1, 0.22);
        }
      }
    }
    for (const b of fore.blooms) {
      const R = b.r * reveal;
      for (let y = -R; y <= R; y += ch * 0.5) {
        for (let x = -R * 1.3; x <= R * 1.3; x += cw * 0.5) {
          const d = Math.hypot(x / 1.3, y) / (R || 1);
          if (d > 1) continue;
          const lit = 0.5 + 0.5 * (-(x / R) * LIGHT_DIR.x - (y / R) * LIGHT_DIR.y) * 0.5;
          const col = ramp(P.petal, 0.35 + 0.45 * lit);
          this.putPx(b.x + x, b.y + y, d > 0.7 ? "." : d > 0.4 ? ":" : ";", col, (0.4 - d * 0.25) * reveal, 0.24);
        }
      }
    }
  }

  // ── racemes ─────────────────────────────────────────────────────────

  private drawRaceme(world: World, r: Raceme) {
    if (r.grow <= 0) return;
    const { palette: P, q, cw, ch } = this;
    const t = world.time;
    const blur = r.depth < 0.5;
    const haze = (1 - r.depth) * 0.6;

    // Stem first, so the florets cover it where they are dense.
    for (let s = 0; s < 1; s += 0.03) {
      world.pointOn(r, s, q);
      const lit = this.lightAt(world, q.x, q.y);
      const col = mixRGB(P.stem, P.skyTop, haze);
      this.putPx(q.x, q.y, blur ? ":" : this.strokeGlyph(q.tx, q.ty), col, (0.2 + 0.35 * r.depth) * Math.min(1, lit), r.depth - 0.02);
    }

    const tintShift: RGB = [r.tint * 10, r.tint * -2, r.tint * -12];
    for (let fi = 0; fi < r.florets.length; fi++) {
      const f = r.florets[fi];
      if (f.s > r.grow) continue;
      world.pointOn(r, f.s / r.grow, q);
      const open = f.s < r.bloom;
      // Buds are small; florets swell as they open.
      const openness = open ? smoothstep(0, 0.12, r.bloom - f.s) : 0;
      let rad = r.width * f.size * (0.45 + 0.55 * openness) * Math.min(1, r.grow * 1.5);
      if (blur) rad *= 1.3;
      if (rad < cw * 0.3) continue;

      // Each floret hangs out to its side on a short stalk and sways a little on its own.
      const sway = Math.sin(t * 1.6 + f.phase) * 0.18 * (0.4 + world.gust);
      const nx = -q.ty;
      const ny = q.tx;
      const off = rad * (0.62 + 0.25 * f.s);
      let ox = nx * f.side * off + q.tx * rad * 0.3;
      let oy = ny * f.side * off + q.ty * rad * 0.3;
      const cs = Math.cos(sway);
      const sn = Math.sin(sway);
      [ox, oy] = [ox * cs - oy * sn, ox * sn + oy * cs];
      const fx = q.x + ox;
      const fy = q.y + oy;
      const rx = rad * 1.1;
      const ry = rad * 0.85;
      const z = r.depth + f.z + (1 - f.s) * 0.004;
      const lit = this.lightAt(world, fx, fy);

      const c0 = Math.floor((fx - rx) / cw);
      const c1 = Math.floor((fx + rx) / cw);
      const r0 = Math.floor((fy - ry) / ch);
      const r1 = Math.floor((fy + ry) / ch);
      const fc = Math.floor(fx / cw);
      const fr = Math.floor(fy / ch);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          let cover = 0;
          let dsum = 0;
          for (let k = 0; k < 8; k += 2) {
            const x = ((col + SUB[k]) * cw - fx) / rx;
            // Slightly flattened top, like the banner petal flaring over the keel.
            const yy = ((row + SUB[k + 1]) * ch - fy) / ry;
            const d = x * x + yy * yy * (yy < 0 ? 1.15 : 0.95);
            if (d < 1) {
              cover++;
              dsum += d;
            }
          }
          // Single-sample hits are just noise at this resolution.
          if (cover < 2) continue;
          const d = dsum / cover;
          const cx = ((col + 0.5) * cw - fx) / rx;
          const cy = ((row + 0.5) * ch - fy) / ry;
          const facing = -(cx * LIGHT_DIR.x + cy * LIGHT_DIR.y);
          const e = this.energy[row * this.cols + col] || 0;
          let tone = (0.66 + 0.36 * facing - 0.2 * d) * lit * (0.6 + 0.55 * r.depth) + e * 0.6;
          // Darken the rim so neighbouring petals read as separate shapes.
          if (d > 0.6) tone *= 0.58;
          tone = clamp(tone, 0, 1);

          const h = hash3(col - fc, row - fr, r.seed + fi);
          let g: string;
          let color: RGB;
          if (!open) {
            color = mixRGB(P.bud, P.petal[2], tone * 0.5);
            g = blur ? "." : d < 0.45 ? "o" : ":";
          } else if (blur) {
            color = ramp(P.petal, tone * 0.85);
            g = cover < 3 ? "." : tone > 0.45 ? ";" : ":";
          } else {
            color = ramp(P.petal, tone);
            // One monotone ramp, nudged by a stable per-floret hash: each floret
            // reads as a single shaded shape, its rim a step darker.
            const k = clamp(Math.round(tone * (FLORET_RAMP.length - 1) + (h - 0.5) * 0.7), 1, FLORET_RAMP.length - 1);
            g = FLORET_RAMP[Math.max(2, k)];
          }
          color = mixRGB([color[0] + tintShift[0], color[1] + tintShift[1], color[2] + tintShift[2]], P.skyTop, haze);
          let a = blur ? 0.22 + 0.2 * (cover / 4) : 0.7 + 0.3 * r.depth;
          // A rare moonlight glint on the brightest petals.
          if (open && !blur && tone > 0.8 && hash3(col, row, Math.floor(t * 0.8)) > 0.994) {
            g = "+";
            color = P.moon;
            a = 1;
          }
          this.put(col, row, g, color, a, z);
        }
      }
    }
  }

  // ── petals ──────────────────────────────────────────────────────────

  private drawPetals(world: World) {
    const { palette: P, cw, ch } = this;
    const t = world.time;
    for (const p of world.petals) {
      if (!p.alive) continue;
      const lit = Math.min(1.15, this.lightAt(world, p.x, p.y));
      if (p.state === PetalState.Hold || (p.state === PetalState.Seek && Math.hypot(p.tx - p.x, p.ty - p.y) < ch * 0.8)) {
        const c = Math.floor(p.tx / cw);
        const r = Math.floor(p.ty / ch);
        const h = hash3(c, r, 31);
        const pulse = 0.62 + 0.16 * Math.sin(t * 1.4 + h * TAU);
        this.putPx(p.x, p.y, "%&o*"[(h * 4) | 0], mixRGB(P.poem, P.petal[2], 0.25 + h * 0.4), pulse, 1.2);
        continue;
      }
      if (p.state === PetalState.Linger) {
        this.putPx(p.x, p.y, "*", mixRGB(P.petal[4], P.moon, 0.5), 0.95, 1.2);
        continue;
      }
      const a = ((p.phase % TAU) + TAU) % TAU;
      const g = PETAL_GLYPHS[Math.floor((a / TAU) * 4) % 4];
      const col = ramp(P.petal, clamp((0.45 + 0.4 * p.depth) * lit, 0, 1));
      this.putPx(p.x, p.y, g, col, (0.45 + 0.55 * p.depth) * Math.min(1, lit + 0.2), 1 + p.depth * 0.1);
    }
  }
}

function rgb(c: RGB) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
