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
import { PhotoSource, type LoadedPhoto } from "./photograph";
import { GROUND_ROWS, PetalState, RIPPLE_LIFE, rippleRadius, type World } from "./world";

const PETAL_GLYPHS = ["'", "`", ",", "."];
/** Luminance (0–255) → lifted brightness: the photo is dark, so stretch it to use the whole range. */
const PHOTO_LIFT = Float32Array.from({ length: 256 }, (_, l) => Math.pow(clamp((l / 255 - 0.04) / 0.55, 0, 1), 0.85));
/** Flat cells inside a shape, dim → bright. Few levels, so a petal reads as one surface. */
const FILL = ".:;o%@@";
/** Glyphs an edge cell may be matched against. */
const STROKES = " .,'`-_|/\\()^v<>";
/**
 * Glyphs a photograph's cells are matched against by shape, most used first:
 * `@` fills the petals and wins ~90% of cells, so trying it first lets the
 * rest stop early.
 */
const PHOTO_GLYPHS = "@%#_\"[]-`^*()|/\\{}:;.,'~=OV<> ";

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
  private photo: PhotoSource | null = null;
  /** Stroke glyph bitmaps at SX × SY, in the current font and cell size. */
  private strokes: { g: string; t: Float32Array }[] = [];
  /** Glyph bitmaps for photo cells, at the photo source's sample size. */
  private photoGlyphs: { g: string; t: Float32Array }[] = [];
  /**
   * The photograph's glyphs live on their own layer, refreshed every other
   * frame (convert on one, paint on the next) so the cost is spread out;
   * overlays still redraw every frame. photoMask marks the cells it covers,
   * so anything meant to sit behind the plant stays hidden there.
   */
  private photoLayer: HTMLCanvasElement = document.createElement("canvas");
  private photoGlyph: string[] = [];
  private photoColor = new Uint32Array(0);
  private photoMask = new Uint8Array(0);
  private photoTick = 0;
  private photoFresh = false;
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
    const ctx = canvas.getContext("2d");
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
    this.photoGlyphs = [];
  }

  /** Draw a photograph instead of the illustration. Call resize() afterwards: cells get finer. */
  usePhoto(photo: LoadedPhoto) {
    this.photo = new PhotoSource(photo);
    this.photoGlyphs = [];
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    // Fine cells: a petal needs several of them to keep its shape. A photograph
    // carries more detail, so it gets finer ones still.
    this.cw = this.photo ? clamp(Math.round(width / 205), 6, 9) : clamp(Math.round(width / 175), 6, 10);
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
    this.photo?.resize(this.cols, this.rows, this.cw, this.ch);
    this.photoLayer.width = this.canvas.width;
    this.photoLayer.height = this.canvas.height;
    this.photoGlyph = new Array(n).fill("");
    this.photoColor = new Uint32Array(n);
    this.photoMask = new Uint8Array(n);
    this.photoFresh = false;
    this.strokes = [];
    this.photoGlyphs = [];

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
    // The sky never changes, so it sits behind the canvas as CSS instead of being redrawn every frame.
    this.canvas.style.backgroundImage = `url(${this.bg.toDataURL()})`;
    this.canvas.style.backgroundSize = "100% 100%";
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
    if (this.photo) {
      // A three-frame cycle: convert the top half, then the bottom half, then
      // repaint the layer. The photo layer updates at 20 fps (the sway is slow)
      // and no frame carries the whole cost.
      const half = Math.ceil(this.rows / 2);
      if (!this.photoFresh) {
        this.photo.draw(world);
        this.convertPhoto(world, 0, this.rows);
        this.paintPhotoLayer();
        this.photoFresh = true;
        this.photoTick = 0;
      } else {
        this.photoTick = (this.photoTick + 1) % 3;
        if (this.photoTick === 0) {
          this.photo.draw(world);
          this.convertPhoto(world, 0, half);
        } else if (this.photoTick === 1) {
          this.convertPhoto(world, half, this.rows);
        } else {
          this.paintPhotoLayer();
        }
      }
    } else {
      this.illustrator.draw(world, this.shading);
      this.convert();
    }
    this.drawPetals(world);
    this.drawMotes(world);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.photo) {
      this.drawCells(ctx, this.glyph, this.color, (i) => this.zbuf[i] < 0.5);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.photoLayer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawCells(ctx, this.glyph, this.color, (i) => this.zbuf[i] >= 0.5);
    } else {
      this.drawCells(ctx, this.glyph, this.color);
    }
  }

  private paintPhotoLayer() {
    const g = this.photoLayer.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.photoLayer.width, this.photoLayer.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawCells(g, this.photoGlyph, this.photoColor);
  }

  // ── buffer ──────────────────────────────────────────────────────────

  private put(c: number, r: number, g: string, col: RGB, a: number, z: number) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || a < 0.02) return;
    const i = r * this.cols + c;
    if (z < this.zbuf[i]) return;
    if (z < 0.5 && this.photo && this.photoMask[i]) return;
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

  /** Draw cells grouped by colour, so each colour sets fillStyle once. */
  private drawCells(ctx: CanvasRenderingContext2D, glyph: string[], color: Uint32Array, include?: (i: number) => boolean) {
    const { cw, ch, cols, buckets, styleCache } = this;
    for (const list of buckets.values()) list.length = 0;
    for (let i = 0; i < glyph.length; i++) {
      if (!glyph[i] || (include && !include(i))) continue;
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
    // A photograph brings its own light and sky.
    if (this.photo) return;
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
    this.strokes = this.buildGlyphs(STROKES, SX, SY, true);
  }

  /** Rasterise glyphs from the real font into sx × sy coverage bitmaps. */
  private buildGlyphs(glyphs: string, sx: number, sy: number, normalise: boolean) {
    const S = 4;
    const out: { g: string; t: Float32Array }[] = [];
    const c = document.createElement("canvas");
    c.width = this.cw * S;
    c.height = this.ch * S;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return out;
    g.font = `600 ${Math.round(this.ch * 0.8 * S)}px ${this.fontFamily}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    for (const ch of glyphs) {
      g.clearRect(0, 0, c.width, c.height);
      g.fillText(ch, c.width / 2, c.height / 2);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const t = new Float32Array(sx * sy);
      const bw = c.width / sx;
      const bh = c.height / sy;
      for (let y = 0; y < sy; y++) {
        for (let x = 0; x < sx; x++) {
          let sum = 0;
          let n = 0;
          for (let yy = Math.floor(y * bh); yy < Math.floor((y + 1) * bh); yy++) {
            for (let xx = Math.floor(x * bw); xx < Math.floor((x + 1) * bw); xx++) {
              sum += d[(yy * c.width + xx) * 4 + 3];
              n++;
            }
          }
          t[y * sx + x] = sum / (n * 255);
        }
      }
      if (normalise) {
        // So thin and bold strokes compete on shape, not on ink.
        let peak = 0;
        for (const v of t) peak = Math.max(peak, v);
        if (peak > 0) for (let k = 0; k < t.length; k++) t[k] /= peak;
      }
      out.push({ g: ch, t });
    }
    return out;
  }

  /**
   * A photograph converts by shape alone: for each cell, the glyph whose
   * bitmap best fits the cell's pattern of light (relative to its brightest
   * sample), inked in the cell's own colour at that brightness. The pointer's
   * lantern and passing fragrance brighten the ink.
   */
  private convertPhoto(world: World, rowFrom: number, rowTo: number) {
    const photo = this.photo!;
    const { sx: SXp, sy: SYp } = photo;
    if (this.photoGlyphs.length === 0) this.photoGlyphs = this.buildGlyphs(PHOTO_GLYPHS, SXp, SYp, false);
    const { cols, rows, cw, ch, photoGlyphs: glyphs, energy, photoGlyph, photoColor, photoMask } = this;
    photoGlyph.fill("", rowFrom * cols, rowTo * cols);
    photoMask.fill(0, rowFrom * cols, rowTo * cols);
    const W = photo.canvas.width;
    // Read only this band of rows; `data` row 0 is sample row rowFrom * SYp.
    const data = photo.ctx.getImageData(0, rowFrom * SYp, W, (rowTo - rowFrom) * SYp).data;
    const n = SXp * SYp;
    const v = new Float32Array(n);
    const col: RGB = [0, 0, 0];
    const p = world.pointer;
    for (let r = rowFrom; r < rowTo; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let peak = 0;
        let low = 1;
        let R = 0;
        let G = 0;
        let B = 0;
        for (let y = 0; y < SYp; y++) {
          let i = (((r - rowFrom) * SYp + y) * W + c * SXp) * 4;
          for (let x = 0; x < SXp; x++, i += 4) {
            const a = data[i + 3] / 255;
            const lv = PHOTO_LIFT[(((54 * data[i] + 183 * data[i + 1] + 19 * data[i + 2]) >> 8) * a) | 0];
            v[y * SXp + x] = lv;
            sum += lv;
            if (lv > peak) peak = lv;
            if (lv < low) low = lv;
            R += data[i] * a;
            G += data[i + 1] * a;
            B += data[i + 2] * a;
          }
        }
        if (sum / n < 0.035) continue;
        let best = Infinity;
        let g = " ";
        // Flat cells (inside a petal, or even background) are always the solid glyph.
        if (low > peak * 0.8) g = glyphs[0].g;
        else for (const tp of glyphs) {
          let err = 0;
          const t = tp.t;
          for (let k = 0; k < n && err < best; k++) {
            const d = v[k] / peak - t[k];
            err += d * d;
          }
          if (err < best) {
            best = err;
            g = tp.g;
          }
        }
        if (g === " ") continue;
        let bright = peak;
        const x = (c + 0.5) * cw;
        const y = (r + 0.5) * ch;
        if (p.active) {
          const dx = x - p.x;
          const dy = y - p.y;
          bright *= 1 + 0.45 * Math.exp(-(dx * dx + dy * dy) / (2 * 95 * 95));
        }
        bright *= 1 + Math.min(1, energy[r * cols + c] * 2) * 0.6;
        // Keep the photo's hue; let the glyph carry the brightness.
        const m = Math.max(R, G, B) / n || 1;
        const k = (255 * Math.min(1, bright * 1.15)) / m;
        const i = r * cols + c;
        photoGlyph[i] = g;
        photoMask[i] = 1;
        photoColor[i] =
          (clamp(((R / n) * k) | 0, 0, 255) >> 2) << 16 |
          (clamp(((G / n) * k) | 0, 0, 255) >> 2) << 10 |
          (clamp(((B / n) * k) | 0, 0, 255) >> 2) << 4 |
          15;
      }
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
