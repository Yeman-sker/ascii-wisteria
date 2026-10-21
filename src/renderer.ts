/**
 * Draws the World as a grid of ASCII cells, back to front through a z-buffer:
 *   1. a night sky: indigo gradient, a faint moon, slow-twinkling stars
 *   2. click ripples: an ASCII ring drawn with tangent strokes, eased outward,
 *      followed by a fainter echo
 *   3. fallen petals gathering along the ground, slowly fading
 *   4. the plant itself, painted as a vector illustration (illustrator.ts) and
 *      converted cell by cell: flat cells take a glyph from a short density
 *      ramp and let colour carry the shading; cells that hold an edge are
 *      matched by shape against stroke glyphs (`/ \ | ( ) _ ' ,`), so outlines
 *      follow the petals instead of dissolving into texture
 *   5. falling petals, tumbling through four glyphs
 *   6. fragrance motes behind the pointer, cooling from a bright `*` to a
 *      faint `.` as they drift; they also warm the florets they pass
 */
import { clamp, hash3, mixRGB, ramp, smoothstep, TAU, type RGB } from "./math";
import { MOONLIGHT, type Palette } from "./palette";
import { Illustrator, SX, SY } from "./illustrator";
import { GROUND_ROWS, PetalState, RIPPLE_LIFE, rippleRadius, type World } from "./world";

const PETAL_GLYPHS = ["'", "`", ",", "."];
/** Flat cells inside a shape, dim → bright. Few levels, so a petal reads as one surface. */
const FILL = ".:;o%@@";
/** Glyphs an edge cell may be matched against. */
const STROKES = " .,'`-_|/\\()^v<>";

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
  private stars: { i: number; phase: number; freq: number; g: string }[] = [];
  private moonCells: { i: number; g: string; a: number }[] = [];

  private styleCache = new Map<number, string>();
  private buckets = new Map<number, number[]>();
  private world: World | null = null;
  private illustrator: Illustrator;
  /** Stroke glyph bitmaps at SX × SY, in the current font and cell size. */
  private strokes: { g: string; t: Float32Array }[] = [];
  private shading = {
    lightAt: (x: number, y: number) => (this.world ? this.lightAt(this.world, x, y) : 1),
    glowAt: (x: number, y: number) => {
      const c = Math.floor(x / this.cw);
      const r = Math.floor(y / this.ch);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 0;
      return Math.min(1, this.energy[r * this.cols + c] * 2);
    },
  };

  constructor(private canvas: HTMLCanvasElement, palette: Partial<Palette> = {}) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.palette = { ...MOONLIGHT, ...palette };
    this.illustrator = new Illustrator(this.palette);
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
    this.strokes = [];
  }

  /** Call once the webfont has loaded, so edge matching uses the real glyph shapes. */
  fontsReady() {
    this.strokes = [];
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    // Fine cells: a petal needs several of them to keep its shape.
    this.cw = clamp(Math.round(width / 175), 6, 10);
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
    this.illustrator.resize(this.cols, this.rows, this.cw, this.ch);
    this.strokes = [];

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
    this.warm(world, dt);
    this.diffuse(dt);

    this.glyph.fill("");
    this.zbuf.fill(-1);

    const reveal = world.introDone ? 1 : smoothstep(0, 3, world.clock);
    this.drawSky(world, reveal);
    this.drawRipples(world);
    this.drawGround(world);
    this.illustrator.draw(world, this.shading);
    this.convert();
    this.drawPetals(world);
    this.drawMotes(world);

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
    ctx.font = `600 ${Math.round(ch * 0.8)}px ${this.fontFamily}`;
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

  /** Fragrance and ripples warm the florets they pass; the glow lingers in a field. */
  private warm(world: World, dt: number) {
    const k = Math.min(1, dt * 60);
    for (const m of world.motes) {
      if (m.alive) this.stamp(this.energy, m.x, m.y, 0, 0.012 * (1 - m.age / m.life) * k);
    }
    for (const rp of world.ripples) {
      const r = rippleRadius(rp);
      const strength = 1 - rp.age / RIPPLE_LIFE;
      const step = (this.cw * 2) / Math.max(r, this.cw);
      for (let a = 0; a < TAU; a += step) {
        this.stamp(this.energy, rp.x + Math.cos(a) * r, rp.y + Math.sin(a) * r, 0, 0.05 * strength * k);
      }
    }
    // Lingering petals glow faintly around themselves.
    for (const pt of world.petals) {
      if (pt.alive && pt.state === PetalState.Linger) this.stamp(this.energy, pt.x, pt.y, 0, 0.004);
    }
  }

  /** Slow blur + slow decay: the trail spreads a little and lingers ~8 s. */
  private diffuse(dt: number) {
    const { cols, rows, energy, energyTmp: tmp } = this;
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

  /**
   * Each click ring is drawn with strokes that follow its tangent, so it reads
   * as a drawn circle rather than a cloud. It starts silver and cools to
   * violet, shimmers a little along its length, and leaves a fainter echo.
   */
  private drawRipples(world: World) {
    const { palette: P, cw, ch } = this;
    for (const rp of world.ripples) {
      const t = rp.age / RIPPLE_LIFE;
      const r = rippleRadius(rp);
      const color = mixRGB(P.moon, P.fragrance, smoothstep(0, 0.7, t));
      const alpha = Math.pow(1 - t, 1.6) * 0.6;
      if (r > cw) {
        const step = (cw * 0.55) / r;
        for (let a = 0; a < TAU; a += step) {
          const cs = Math.cos(a);
          const sn = Math.sin(a);
          // Brush-like breaks and a slow shimmer along the ring.
          if (hash3((a * 40) | 0, 0, 77) < 0.12) continue;
          const shimmer = 0.75 + 0.25 * Math.sin(a * 5 + rp.age * 3);
          const x = rp.x + cs * r;
          const y = rp.y + sn * r;
          this.putPx(x, y, this.strokeGlyph(-sn, cs), color, alpha * shimmer, 0.3);
          // A soft wake just inside the front.
          this.putPx(rp.x + cs * (r - ch * 0.7), rp.y + sn * (r - ch * 0.7), ".", color, alpha * 0.35 * shimmer, 0.29);
        }
      }
      // The echo: a second, dotted ring a beat behind.
      const echoAge = rp.age - 0.4;
      if (echoAge > 0) {
        const re = rippleRadius(rp, echoAge) * 0.8;
        const te = echoAge / RIPPLE_LIFE;
        if (re > cw) {
          const step = (cw * 0.9) / re;
          for (let a = 0; a < TAU; a += step) {
            this.putPx(rp.x + Math.cos(a) * re, rp.y + Math.sin(a) * re, ":", P.fragrance, Math.pow(1 - te, 1.8) * 0.4, 0.28);
          }
        }
      }
      // A brief spark where the click landed.
      if (rp.age < 0.5) {
        const k = 1 - rp.age / 0.5;
        this.putPx(rp.x, rp.y, rp.age < 0.18 ? "*" : "+", P.moon, k * k, 1.3);
      }
    }
  }

  private drawMotes(world: World) {
    const { palette: P } = this;
    const pale = mixRGB(P.petal[4], P.moon, 0.4);
    const t = world.time;
    for (const m of world.motes) {
      if (!m.alive) continue;
      const life = m.age / m.life;
      // Heat cools with age, so the trail runs * → + → : → . from head to tail.
      const heat = m.bright * Math.exp(-m.age * 0.95);
      const a = smoothstep(0, 0.05, life) * Math.pow(1 - life, 1.2) * (0.55 + 0.45 * Math.min(1, heat * 1.6));
      // Now and then a grain catches the moonlight.
      const glint = hash3(m.seed | 0, Math.floor(t * 4), 9) > 0.985;
      let g = heat > 0.78 ? "*" : heat > 0.5 ? "+" : heat > 0.26 ? ":" : ".";
      let col = heat > 0.5 ? mixRGB(pale, P.fragrance, (1 - heat) * 1.6) : mixRGB(P.fragrance, P.petal[1], 1 - heat * 2);
      if (glint) {
        g = "*";
        col = P.moon;
      }
      this.putPx(m.x, m.y, g, col, glint ? Math.max(a, 0.7) : a * 0.95, 1.05);
    }
  }

  private drawGround(world: World) {
    const { rows, palette: P, cw, ch } = this;
    const { ground, groundCols: cols } = world;
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

  // ── illustration → glyphs ───────────────────────────────────────────

  private buildStrokes() {
    const S = 4;
    const c = document.createElement("canvas");
    c.width = this.cw * S;
    c.height = this.ch * S;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return;
    g.font = `600 ${Math.round(this.ch * 0.8 * S)}px ${this.fontFamily}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    this.strokes = [];
    for (const ch of STROKES) {
      g.clearRect(0, 0, c.width, c.height);
      g.fillText(ch, c.width / 2, c.height / 2);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const t = new Float32Array(SX * SY);
      const bw = c.width / SX;
      const bh = c.height / SY;
      for (let y = 0; y < SY; y++) {
        for (let x = 0; x < SX; x++) {
          let sum = 0;
          let n = 0;
          for (let yy = Math.floor(y * bh); yy < Math.floor((y + 1) * bh); yy++) {
            for (let xx = Math.floor(x * bw); xx < Math.floor((x + 1) * bw); xx++) {
              sum += d[(yy * c.width + xx) * 4 + 3];
              n++;
            }
          }
          t[y * SX + x] = sum / (n * 255);
        }
      }
      // Normalise so thin and bold strokes compete on shape, not on ink.
      let peak = 0;
      for (const v of t) peak = Math.max(peak, v);
      if (peak > 0) for (let k = 0; k < t.length; k++) t[k] /= peak;
      this.strokes.push({ g: ch, t });
    }
  }

  /** Read the illustration back and choose a glyph and colour for every cell it covers. */
  private convert() {
    if (this.strokes.length === 0) this.buildStrokes();
    const { cols, rows, strokes } = this;
    const ill = this.illustrator;
    const W = ill.canvas.width;
    const data = ill.ctx.getImageData(0, 0, W, ill.canvas.height).data;
    const n = SX * SY;
    const v = new Float32Array(n);
    const col: RGB = [0, 0, 0];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let peak = 0;
        let low = 1;
        let R = 0;
        let G = 0;
        let B = 0;
        let A = 0;
        for (let y = 0; y < SY; y++) {
          let i = ((r * SY + y) * W + c * SX) * 4;
          for (let x = 0; x < SX; x++, i += 4) {
            const a = data[i + 3] / 255;
            const l = ((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255) * a;
            v[y * SX + x] = l;
            sum += l;
            if (l > peak) peak = l;
            if (l < low) low = l;
            R += data[i] * a;
            G += data[i + 1] * a;
            B += data[i + 2] * a;
            A += a;
          }
        }
        const mean = sum / n;
        if (mean < 0.03 || A === 0) continue;

        let g: string;
        let alpha = 1;
        const cover = A / n;
        if (peak < 0.13) {
          // Too dim to hold a shape (bokeh, deep shadow): a single soft dot.
          g = ".";
          alpha = 0.5 + peak * 3;
        } else if (cover < 0.6 && peak - low > peak * 0.45 + 0.04) {
          // An edge: the stroke glyph whose shape best fits the light in this cell.
          let best = Infinity;
          g = " ";
          for (const s of strokes) {
            let err = 0;
            for (let k = 0; k < n; k++) {
              const d = v[k] / peak - s.t[k];
              err += d * d;
            }
            if (err < best) {
              best = err;
              g = s.g;
            }
          }
          if (g === " ") continue;
          alpha = 0.6 + 0.4 * cover;
        } else {
          // The surface's own brightness, on a curve so dim leaves and bokeh stay sparse.
          const surface = mean / Math.max(cover, 0.3);
          g = FILL[Math.min(FILL.length - 1, Math.floor(Math.pow(surface, 1.5) * 2.1 * FILL.length))];
        }
        // The covered pixels' own colour, lifted so the glyph's ink is as bright as the petal.
        const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / (A * 255) || 1;
        const k = Math.min(2.8, (0.12 + peak * 1.3) / lum);
        // Scale as a whole rather than clipping per channel, so highlights stay violet.
        const top = (Math.max(R, G, B) / A) * k;
        const fit = top > 240 ? 240 / top : 1;
        col[0] = (R / A) * k * fit;
        col[1] = (G / A) * k * fit;
        col[2] = (B / A) * k * fit;
        this.put(c, r, g, col, alpha, 0.5);
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
