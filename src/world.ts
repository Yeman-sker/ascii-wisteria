/**
 * The garden as physics, in CSS pixels. The renderer turns it into glyphs.
 *
 * Racemes: each hanging flower cluster is a verlet chain (its stem) pinned to
 * the trellis. Florets hang off the stem in alternating pairs, big and dense
 * at the top, sparse and small toward the tip, ending in closed buds. Wind
 * is a slow sum of sines with gusts; the pointer is a breeze that pushes the
 * chains aside, and they swing back.
 *
 * Petals: florets shed petals that tumble down, drift with the wind and
 * settle on the ground. Now and then one pauses mid-air for a moment, as if
 * looking back.
 *
 * Fragrance: the pointer leaves motes behind, evenly spaced along its path.
 * Each inherits a little of the pointer's speed, slows, rises and curls like
 * incense, and fades out over a few seconds.
 *
 * Ripple: a click sends a ring outward. Racemes swing and shed petals only
 * when the ring reaches them, and fallen petals it passes over are lifted
 * back into the air, so a click reads as one wave spreading through the scene.
 *
 * Poem: once in a long while, falling petals gather into a line of verse,
 * hold it for a few breaths, and let it go.
 *
 * Intro: the vine reaches across, racemes lengthen, buds open from the top
 * down, and then the first petals fall.
 */
import { clamp, hash3, noise1, rand, smoothstep, TAU } from "./math";

export const RACEME_NODES = 14;
const LEAF_NODES = 6;
const GRAVITY = 1400;
const DAMPING = 0.988;
const MAX_PETALS = 900;
const MAX_MOTES = 520;
export const GROUND_ROWS = 3;
/** Seconds a ripple takes to spread out and vanish. */
export const RIPPLE_LIFE = 3.2;

export interface Floret {
  /** Position along the stem, 0 top → 1 tip. */
  s: number;
  /** Which way it hangs: out to the left or right, or toward the viewer (0). */
  side: 1 | 0 | -1;
  /** Radius scale, 1 at the top of the raceme. */
  size: number;
  phase: number;
  /** Small depth jitter so overlapping florets keep a stable order. */
  z: number;
}

export interface Chain {
  ax: number;
  ay: number;
  nodes: Float32Array;
  prev: Float32Array;
  count: number;
  length: number;
  /** 0 → 1: how far it has grown in. */
  grow: number;
  /** Intro start time, seconds. */
  start: number;
  /** 0.35 far / blurred → 1 near / sharp. */
  depth: number;
  seed: number;
}

export interface Raceme extends Chain {
  /** Floret radius at the top, px. */
  width: number;
  /** Florets with s below this are open; the rest are buds. */
  bloom: number;
  florets: Floret[];
  /** −1 bluer … 1 redder. */
  tint: number;
}

export interface Leaflet {
  s: number;
  side: 1 | -1;
  len: number;
  angle: number;
}

export interface Leaf extends Chain {
  leaflets: Leaflet[];
}

/** A static branch: a polyline sampled every few pixels. */
export interface Vine {
  pts: Float32Array;
  thick: number;
  depth: number;
  /** Intro: the branch reveals itself from its first point onward. */
  start: number;
  duration: number;
}

export const enum PetalState {
  Fall,
  Linger,
  Seek,
  Hold,
}

export interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  spin: number;
  depth: number;
  state: PetalState;
  /** Seconds left in Linger, or delay before Seek starts steering. */
  timer: number;
  willLinger: boolean;
  tx: number;
  ty: number;
  alive: boolean;
}

/** A grain of fragrance left behind by the pointer. */
export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
  /** 1 for the core of the trail, less for the wisps around it. */
  bright: number;
  alive: boolean;
}

export interface Ripple {
  x: number;
  y: number;
  age: number;
  /** Final radius, px. */
  reach: number;
  /** Front radius on the previous step, to detect what the ring just crossed. */
  last: number;
  /** Racemes this ripple has already shaken petals from. */
  shed: Set<Raceme>;
}

/** The ring's front radius at a given age: fast at first, settling like water. */
export function rippleRadius(r: Ripple, age = r.age) {
  const t = Math.min(1, age / RIPPLE_LIFE);
  return r.reach * (1 - Math.pow(1 - t, 2.2));
}

export interface WorldOptions {
  /** Play the growth opening. Default true. */
  intro?: boolean;
  /** Lines of verse the petals gather into, or false for none. */
  poem?: string[] | false;
  /** Seconds after the intro before the first poem. */
  poemDelay?: number;
  /** Seconds between poems, [min, max]. */
  poemEvery?: [number, number];
  /** Racemes per unit width, relative. Default 1. */
  density?: number;
  /** Wind strength, relative. Default 1. */
  wind?: number;
}

/** Default verse: 李白《紫藤树》. */
export const LI_BAI = ["紫藤挂云木", "花蔓宜阳春", "密叶隐歌鸟", "香风留美人"];

/** Supplied by the engine: cell centres (px) that spell `text` inside an area. */
export type MaskProvider = (text: string, area: { x: number; y: number; w: number; h: number }) => { x: number; y: number }[];

const INTRO_LENGTH = 18;

export class World {
  width = 0;
  height = 0;
  time = 0;
  /** Seconds into the growth opening; jumps past the end when skipped. */
  clock = 0;
  racemes: Raceme[] = [];
  leaves: Leaf[] = [];
  vines: Vine[] = [];
  /** Out-of-focus framing in the lower-left corner. */
  fore: { vine: Vine; blooms: { x: number; y: number; r: number }[]; leaves: { x: number; y: number; len: number; angle: number }[] } | null = null;
  petals: Petal[] = [];
  motes: Mote[] = [];
  ripples: Ripple[] = [];
  /** Fallen petals per ground cell, bottom row first: GROUND_ROWS × groundCols. */
  ground = new Float32Array(0);
  groundCols = 0;
  cellW = 10;
  cellH = 15;
  pointer = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  /** Where the moonbeam falls; drifts slowly. */
  light = { x: 0, y: 0 };
  /** 0 → 1, current gust strength. */
  gust = 0;
  moon = { x: 0, y: 0, r: 0 };
  maskProvider: MaskProvider | null = null;

  poem = { phase: "idle" as "idle" | "gather" | "hold", next: 0, until: 0, index: 0 };

  private lastPointer = { x: 0, y: 0, has: false };
  /** Distance the pointer has travelled since it last left a mote. */
  private emitAcc = 0;
  private opts: Required<WorldOptions>;
  private groundY = 0;

  constructor(options: WorldOptions = {}) {
    this.opts = {
      intro: options.intro ?? true,
      poem: options.poem === undefined ? LI_BAI : options.poem,
      poemDelay: options.poemDelay ?? 45,
      poemEvery: options.poemEvery ?? [150, 260],
      density: options.density ?? 1,
      wind: options.wind ?? 1,
    };
    this.clock = this.opts.intro ? 0 : INTRO_LENGTH + 10;
  }

  get introDone() {
    return this.clock >= INTRO_LENGTH;
  }

  get introLength() {
    return INTRO_LENGTH;
  }

  /** Skip the growth opening and show the garden in full bloom. */
  skipIntro() {
    if (this.clock < INTRO_LENGTH + 2) {
      this.clock = INTRO_LENGTH + 2;
      this.poem.next = this.clock + this.opts.poemDelay;
    }
  }

  resize(width: number, height: number, cellW: number, cellH: number) {
    const first = this.width === 0;
    const sx = first ? 1 : width / this.width;
    this.width = width;
    this.height = height;
    this.groundY = height - cellH * 1.5;
    this.cellW = cellW;
    this.cellH = cellH;
    const cols = Math.ceil(width / cellW);
    if (cols !== this.groundCols) {
      this.groundCols = cols;
      this.ground = new Float32Array(cols * GROUND_ROWS);
    }
    if (first || Math.abs(sx - 1) > 0.15 || this.racemes.length === 0) {
      this.seed(cellW, cellH);
      return;
    }
    for (const p of this.petals) p.x = clamp(p.x * sx, 0, width);
  }

  // ── layout ──────────────────────────────────────────────────────────

  private seed(cw: number, ch: number) {
    const { width: W, height: H } = this;
    this.racemes = [];
    this.leaves = [];
    this.vines = [];
    this.petals = [];
    this.light.x = W * 0.5;
    this.light.y = H * 0.3;
    // A low moon in the open lower right: the oldest image of missing someone.
    this.moon = { x: W * (W > 700 ? 0.84 : 0.78), y: H * 0.7, r: Math.max(3 * ch, Math.min(W, H) * 0.07) };
    if (this.poem.next === 0) this.poem.next = INTRO_LENGTH + this.opts.poemDelay;

    // Trellis: two old vines twisting around each other across the top, and a
    // thinner third one sagging lower.
    const seedA = Math.random() * 1000;
    const trellisY = (x: number, k: number) =>
      H * (0.045 + 0.02 * k) +
      Math.sin(x * 0.006 + seedA + k * 2.1) * H * 0.018 +
      (noise1(x * 0.01, k + 3) - 0.5) * H * 0.02;
    for (let k = 0; k < 3; k++) {
      const pts: number[] = [];
      const sag = k === 2 ? H * 0.05 : 0;
      for (let x = -cw * 2; x <= W + cw * 2; x += cw * 0.4) {
        const u = x / W;
        pts.push(x, trellisY(x, k) + sag * Math.sin(u * Math.PI));
      }
      this.vines.push({ pts: new Float32Array(pts), thick: k === 0 ? 2 : 1, depth: k === 2 ? 0.6 : 0.85, start: 0.2 + k * 0.6, duration: 4.5 });
    }

    const vineYAt = (v: Vine, x: number) => {
      const p = v.pts;
      const step = p[2] - p[0];
      const i = clamp(Math.round((x - p[0]) / step), 0, p.length / 2 - 1);
      return p[i * 2 + 1];
    };

    // Composition after a night photograph: two or three large, sharp racemes
    // in the moonbeam with dark air between them, a few mid-distance ones, and
    // soft out-of-focus ones behind. Sizes are fractions of the height, so the
    // picture keeps its proportions at any resolution. Tips stop at ~68% of the
    // height; the open band below is for falling petals and the poem.
    const lenNoiseSeed = Math.floor(Math.random() * 1000);
    const unit = Math.min(H, W * 1.3);
    const tipLimit = H * 0.7;
    const taken: number[] = [];
    const addRaceme = (x: number, depth: number, len: [number, number], width: number) => {
      const vine = this.vines[depth < 0.5 ? 2 : Math.random() < 0.5 ? 0 : 1];
      const ay = vineYAt(vine, x) - rand(0, H * 0.02);
      const n = noise1((x / W) * 4.5, lenNoiseSeed);
      const length = Math.min(unit * (len[0] + (len[1] - len[0]) * n) * rand(0.92, 1.08), tipLimit - ay);
      this.racemes.push(this.makeRaceme(x, ay, length, unit * width * rand(0.92, 1.08), depth));
      taken.push(x);
    };
    const clear = (x: number, gap: number) => taken.every((t) => Math.abs(t - x) > gap);

    const heroes = W > 900 ? [0.4, 0.63] : W > 520 ? [0.36, 0.64] : [0.3, 0.7];
    for (const u of heroes) addRaceme(W * (u + rand(-0.02, 0.02)), rand(0.94, 1), [0.6, 0.68], 0.054);
    // Mid-distance: smaller, a little dimmer, kept off the heroes so the dark gaps stay open.
    const mids = Math.round((W / 360) * this.opts.density);
    for (let i = 0, tries = 0; i < mids && tries < 60; tries++) {
      const x = rand(0.03, 0.97) * W;
      if (!clear(x, W * 0.12)) continue;
      addRaceme(x, rand(0.66, 0.78), [0.3, 0.46], 0.032);
      i++;
    }
    // Far: soft and sparse, drawn as bokeh.
    const backs = Math.round((W / 300) * this.opts.density);
    for (let i = 0, tries = 0; i < backs && tries < 80; tries++) {
      const x = rand(0, 1) * W;
      if (!clear(x, W * 0.05)) continue;
      addRaceme(x, rand(0.36, 0.48), [0.18, 0.34], 0.02);
      i++;
    }
    // Back to front, so the renderer can rely on draw order as well as depth.
    this.racemes.sort((a, b) => a.depth - b.depth);

    // A canopy of pinnate leaves hanging in from the top, thicker toward the
    // corners, framing the racemes the way the photo's foliage does.
    const leafCount = Math.round(W / 150);
    for (let i = 0; i < leafCount; i++) {
      const u = (i + rand(0.1, 0.9)) / leafCount;
      const edge = Math.abs(u - 0.5) * 2;
      const depth = rand(0.5, 0.9);
      this.leaves.push(this.makeLeaf(u * W, -H * 0.03, unit * (0.12 + 0.16 * edge) * rand(0.8, 1.15), depth, unit));
    }

    // Lower-left framing: a blurred vine arcing out of the corner with a
    // couple of open flowers and leaves, like the edge of a lens.
    const pts: number[] = [];
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const x = -W * 0.04 + W * 0.34 * u;
      const y = H * (0.66 + 0.36 * u * u) - Math.sin(u * Math.PI) * H * 0.12;
      pts.push(x, y);
    }
    const pt = (u: number) => {
      const i = Math.round(u * 100) * 2;
      return { x: pts[i], y: pts[i + 1] };
    };
    this.fore = {
      vine: { pts: new Float32Array(pts), thick: 3, depth: 0.3, start: 6, duration: 5 },
      blooms: [0.42, 0.56].map((u, i) => ({ ...pt(u), r: unit * (0.04 - i * 0.008) })),
      leaves: [0.04, 0.14, 0.25, 0.66, 0.8].map((u, i) => ({ ...pt(u), len: unit * rand(0.09, 0.14), angle: (i % 2 ? 1 : -1) * rand(0.6, 1.2) - Math.PI / 2 })),
    };
  }

  private makeChain(ax: number, ay: number, length: number, depth: number, count: number): Chain {
    const nodes = new Float32Array(count * 2);
    for (let k = 0; k < count; k++) {
      nodes[k * 2] = ax;
      nodes[k * 2 + 1] = ay;
    }
    // Intro order: racemes appear as the vine reaches them, left to right.
    const start = 2.2 + (ax / this.width) * 4 + rand(0, 1.6) + (1 - depth) * 0.8;
    return { ax, ay, nodes, prev: nodes.slice(), count, length, grow: 0, start, depth, seed: Math.floor(Math.random() * 1e6) };
  }

  private makeRaceme(ax: number, ay: number, length: number, width: number, depth: number): Raceme {
    const chain = this.makeChain(ax, ay, length, depth, RACEME_NODES);
    const florets: Floret[] = [];
    let s = 0.02;
    const flip = Math.random() < 0.5 ? 1 : -1;
    for (let i = 0; s < 0.97; i++) {
      const size = 1 - 0.62 * Math.pow(s, 0.85);
      // Left, right, and on the dense upper part a third facing out, for volume.
      const front = s < 0.55 && i % 3 === 2;
      const side = front ? 0 : ((i % 2 ? 1 : -1) * flip) as 1 | -1;
      florets.push({ s, side, size: size * rand(0.88, 1.08) * (front ? 0.9 : 1), phase: rand(0, TAU), z: rand(0, 0.01) });
      // Spacing grows toward the tip: a dense, overlapping top, paired florets lower down.
      s += ((width * (0.2 + 0.75 * s)) / length) * rand(0.85, 1.15);
    }
    return { ...chain, width, bloom: 0, florets, tint: rand(-1, 1) };
  }

  private makeLeaf(ax: number, ay: number, length: number, depth: number, unit: number): Leaf {
    const chain = this.makeChain(ax, ay, length, depth, LEAF_NODES);
    const leaflets: Leaflet[] = [];
    // Pinnate: opposite pairs of lance-shaped leaflets and one at the tip.
    for (let s = 0.25; s < 0.95; s += rand(0.2, 0.26)) {
      for (const side of [-1, 1] as const) {
        leaflets.push({ s, side, len: unit * rand(0.06, 0.085) * (1 - s * 0.2), angle: rand(0.45, 0.8) });
      }
    }
    leaflets.push({ s: 1, side: 1, len: unit * 0.08, angle: 0 });
    return { ...chain, leaflets };
  }

  // ── simulation ──────────────────────────────────────────────────────

  /** Horizontal wind acceleration at (x, y): two slow swells plus gusts. */
  windAt(x: number, y: number, t: number) {
    const base = Math.sin(t * 0.31 + x * 0.0035) * 0.6 + Math.sin(t * 0.77 + x * 0.009 + 1.7) * 0.4;
    const flutter = Math.sin(t * 2.3 + x * 0.03 + y * 0.02) * 0.25;
    return (base * (55 + 160 * this.gust) + flutter * 40 * (0.3 + this.gust)) * this.opts.wind;
  }

  splash(x: number, y: number) {
    if (!this.introDone) this.skipIntro();
    const reach = Math.max(this.width, this.height) * 0.34;
    this.ripples.push({ x, y, age: 0, reach, last: 0, shed: new Set() });
    if (this.ripples.length > 4) this.ripples.shift();
    // A small burst of fragrance at the centre, thrown outward and left to drift.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rand(-0.2, 0.2);
      const v = rand(50, 120);
      this.emitMote(x, y, Math.cos(a) * v, Math.sin(a) * v * 0.7, rand(1.6, 3), 0.8);
    }
  }

  step(dt: number) {
    this.time += dt;
    this.clock += dt;
    const t = this.time;

    // Gusts come and go on a ~40 s rhythm.
    const g = Math.max(0, Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1.3));
    this.gust += (g - this.gust) * dt * 0.8;

    // Moonbeam drifts in a slow ellipse around the upper middle.
    this.light.x = this.width * (0.5 + 0.12 * Math.sin(t * 0.05));
    this.light.y = this.height * (0.3 + 0.06 * Math.sin(t * 0.037 + 2));

    this.updatePointer(dt);
    this.updateIntro();
    this.stepRipples(dt);

    for (const r of this.racemes) this.stepChain(r, dt, 1);
    for (const l of this.leaves) this.stepChain(l, dt, 0.7);

    this.spawnPetals(dt);
    this.stepPetals(dt);
    this.stepMotes(dt);
    this.stepPoem();

    const fade = Math.exp(-dt / 55);
    for (let i = 0; i < this.ground.length; i++) this.ground[i] *= fade;
  }

  private updatePointer(dt: number) {
    const p = this.pointer;
    if (!p.active) {
      this.lastPointer.has = false;
      p.vx *= 0.9;
      p.vy *= 0.9;
      return;
    }
    if (this.lastPointer.has) {
      const dx = p.x - this.lastPointer.x;
      const dy = p.y - this.lastPointer.y;
      p.vx += (dx / dt - p.vx) * 0.25;
      p.vy += (dy / dt - p.vy) * 0.25;
      this.emitAlong(this.lastPointer.x, this.lastPointer.y, dx, dy);
    }
    this.lastPointer.x = p.x;
    this.lastPointer.y = p.y;
    this.lastPointer.has = true;
  }

  private updateIntro() {
    const c = this.clock;
    for (const r of this.racemes) {
      r.grow = smoothstep(r.start, r.start + 5, c);
      // Buds open from the top down; the lowest quarter stays closed.
      r.bloom = 0.78 * smoothstep(r.start + 3, r.start + 11, c);
    }
    for (const l of this.leaves) l.grow = smoothstep(l.start - 1, l.start + 3, c);
  }

  private stepChain(c: Chain, dt: number, windScale: number) {
    const { nodes, prev, count } = c;
    const rest = (c.length * Math.max(0.02, c.grow)) / (count - 1);
    const dt2 = dt * dt;
    const p = this.pointer;
    const pSpeed = Math.hypot(p.vx, p.vy);
    // Far racemes move less: smaller on screen, and the eye reads them as further away.
    const parallax = 0.55 + 0.45 * c.depth;

    for (let k = 1; k < count; k++) {
      const i = k * 2;
      const x = nodes[i];
      const y = nodes[i + 1];
      let ax = this.windAt(x, y, this.time + c.seed * 0.001) * windScale * parallax;
      let ay = GRAVITY;
      if (pSpeed > 5) {
        const dx = x - p.x;
        const dy = y - p.y;
        const d2 = dx * dx + dy * dy;
        const R = 130;
        if (d2 < R * R) {
          const f = (1 - Math.sqrt(d2) / R) * parallax;
          ax += clamp(p.vx * 6, -4200, 4200) * f;
          ay += clamp(p.vy * 3, -2000, 2000) * f;
        }
      }
      for (const rp of this.ripples) {
        // Only the ring's front pushes, so the swing travels outward with it.
        const dx = x - rp.x;
        const dy = y - rp.y;
        const d = Math.hypot(dx, dy) || 1;
        const front = 1 - Math.abs(d - rippleRadius(rp)) / (this.cellW * 4);
        if (front <= 0) continue;
        const t = rp.age / RIPPLE_LIFE;
        const f = front * front * 3200 * (1 - t) * (1 - t) * parallax * (k / count);
        ax += (dx / d) * f;
        ay += (dy / d) * f * 0.35;
      }
      const vx = (x - prev[i]) * DAMPING;
      const vy = (y - prev[i + 1]) * DAMPING;
      prev[i] = x;
      prev[i + 1] = y;
      nodes[i] = x + vx + ax * dt2;
      nodes[i + 1] = y + vy + ay * dt2;
    }

    nodes[0] = c.ax;
    nodes[1] = c.ay;
    for (let iter = 0; iter < 4; iter++) {
      for (let k = 0; k < count - 1; k++) {
        const i = k * 2;
        const j = i + 2;
        const dx = nodes[j] - nodes[i];
        const dy = nodes[j + 1] - nodes[i + 1];
        const d = Math.hypot(dx, dy) || 1e-4;
        const diff = (d - rest) / d;
        if (k === 0) {
          nodes[j] -= dx * diff;
          nodes[j + 1] -= dy * diff;
        } else {
          nodes[i] += dx * diff * 0.5;
          nodes[i + 1] += dy * diff * 0.5;
          nodes[j] -= dx * diff * 0.5;
          nodes[j + 1] -= dy * diff * 0.5;
        }
      }
      // A little bending stiffness, so a raceme swings as a whole rather than like a rope.
      for (let k = 1; k < count - 1; k++) {
        const i = k * 2;
        nodes[i] += ((nodes[i - 2] + nodes[i + 2]) * 0.5 - nodes[i]) * 0.06;
        nodes[i + 1] += ((nodes[i - 1] + nodes[i + 3]) * 0.5 - nodes[i + 1]) * 0.06;
      }
    }
  }

  /** Point on a chain at s ∈ [0, 1]. */
  pointOn(c: Chain, s: number, out: { x: number; y: number; tx: number; ty: number }) {
    const f = clamp(s, 0, 1) * (c.count - 1);
    const k = Math.min(c.count - 2, Math.floor(f));
    const u = f - k;
    const n = c.nodes;
    const x0 = n[k * 2];
    const y0 = n[k * 2 + 1];
    const x1 = n[k * 2 + 2];
    const y1 = n[k * 2 + 3];
    out.x = x0 + (x1 - x0) * u;
    out.y = y0 + (y1 - y0) * u;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    out.tx = (x1 - x0) / len;
    out.ty = (y1 - y0) / len;
    return out;
  }

  // ── fragrance ───────────────────────────────────────────────────────

  private emitMote(x: number, y: number, vx: number, vy: number, life: number, bright = 1) {
    let m: Mote | undefined;
    for (const q of this.motes) {
      if (!q.alive) {
        m = q;
        break;
      }
    }
    if (!m) {
      if (this.motes.length >= MAX_MOTES) return;
      m = {} as Mote;
      this.motes.push(m);
    }
    m.x = x;
    m.y = y;
    m.vx = vx;
    m.vy = vy;
    m.age = 0;
    m.life = life;
    m.seed = Math.random() * 1000;
    m.bright = bright;
    m.alive = true;
  }

  /** Leave motes at even spacing along the pointer's path, however fast it moves. */
  private emitAlong(x0: number, y0: number, dx: number, dy: number) {
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5 || dist > 400) return;
    const spacing = this.cellW * 0.85;
    const ux = dx / dist;
    const uy = dy / dist;
    const speed = Math.hypot(this.pointer.vx, this.pointer.vy);
    let along = spacing - this.emitAcc;
    const push = 0.4 + Math.min(1, speed / 900);
    while (along <= dist) {
      const px = x0 + ux * along;
      const py = y0 + uy * along;
      // The core strand: on the path, carrying a little of the pointer's momentum.
      const side = rand(-1, 1) * this.cellH * 0.2;
      this.emitMote(px - uy * side, py + ux * side, ux * speed * 0.05, uy * speed * 0.05, rand(3.2, 4.8), 1);
      // Wisps that drift off to either side, so the trail feathers like smoke.
      if (Math.random() < 0.65) {
        const s = Math.random() < 0.5 ? -1 : 1;
        const off = rand(0.5, 1.3) * this.cellH * s;
        this.emitMote(px - uy * off, py + ux * off, -uy * s * 18 * push + ux * speed * 0.03, ux * s * 18 * push + uy * speed * 0.03, rand(1.8, 3.2), rand(0.4, 0.65));
      }
      along += spacing;
    }
    this.emitAcc = dist - (along - spacing);
  }

  private stepMotes(dt: number) {
    const t = this.time;
    const drag = Math.exp(-dt * 1.7);
    for (const m of this.motes) {
      if (!m.alive) continue;
      m.age += dt;
      if (m.age >= m.life) {
        m.alive = false;
        continue;
      }
      // Rise slowly and curl, the way scent hangs in still air.
      m.vx = m.vx * drag + Math.sin(m.y * 0.018 + t * 0.6 + m.seed) * 14 * dt + this.windAt(m.x, m.y, t) * 0.04 * dt;
      m.vy = m.vy * drag + (Math.cos(m.x * 0.014 + t * 0.5 + m.seed) * 9 - 9) * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
  }

  // ── ripples and the ground ──────────────────────────────────────────

  private stepRipples(dt: number) {
    for (const rp of this.ripples) {
      rp.last = rippleRadius(rp);
      rp.age += dt;
      const r = rippleRadius(rp);
      const strength = 1 - rp.age / RIPPLE_LIFE;
      if (strength <= 0) continue;

      // Shake petals loose from each raceme as the ring reaches its middle.
      for (const rc of this.racemes) {
        if (rp.shed.has(rc) || rc.bloom < 0.3) continue;
        const q = this.pointOn(rc, 0.35, this.tmp);
        const d = Math.hypot(q.x - rp.x, q.y - rp.y);
        if (d > r) continue;
        rp.shed.add(rc);
        const n = Math.round((1 + 4 * strength) * rc.depth);
        for (let i = 0; i < n; i++) this.spawnPetalFrom(rc);
      }

      // Lift fallen petals the ring sweeps over; they flutter up and settle again.
      const { cellW: cw, cellH: ch, groundCols: cols, ground } = this;
      for (let row = 0; row < GROUND_ROWS; row++) {
        const y = this.height - (row + 0.5) * ch;
        for (let c = 0; c < cols; c++) {
          const gi = row * cols + c;
          if (ground[gi] < 0.2) continue;
          const x = (c + 0.5) * cw;
          const d = Math.hypot(x - rp.x, y - rp.y);
          if (d <= rp.last || d > r) continue;
          const lift = Math.min(ground[gi], 0.4 + 0.6 * strength);
          ground[gi] -= lift;
          if (Math.random() < lift * 0.9) this.liftPetal(x, y, (x - rp.x) / (d || 1), strength);
        }
      }
    }
    this.ripples = this.ripples.filter((rp) => rp.age < RIPPLE_LIFE);
  }

  private landPetal(x: number) {
    const { groundCols: cols, ground } = this;
    const c = Math.floor(x / this.cellW);
    for (const [dc, amt] of [[0, 0.55], [-1, 0.18], [1, 0.18]]) {
      const cc = c + dc;
      if (cc < 0 || cc >= cols) continue;
      // Fill the lowest row first, then heap upward.
      let row = 0;
      while (row < GROUND_ROWS - 1 && ground[row * cols + cc] > 1.1 + row * 0.2) row++;
      const i = row * cols + cc;
      ground[i] = Math.min(1.6, ground[i] + amt);
    }
  }

  private liftPetal(x: number, y: number, dir: number, strength: number) {
    const p = this.newPetal();
    if (!p) return;
    p.x = x;
    p.y = Math.min(y, this.groundY) - this.cellH;
    p.vx = dir * rand(20, 60) * strength;
    p.vy = -rand(50, 110) * (0.5 + strength);
    p.phase = rand(0, TAU);
    p.spin = rand(3, 6) * (Math.random() < 0.5 ? -1 : 1);
    p.depth = rand(0.6, 1);
    p.state = PetalState.Fall;
    p.timer = 0;
    p.willLinger = false;
    p.tx = 0;
    p.ty = 0;
    p.alive = true;
  }

  // ── petals ──────────────────────────────────────────────────────────

  private tmp = { x: 0, y: 0, tx: 0, ty: 1 };

  private newPetal(): Petal | null {
    for (const p of this.petals) if (!p.alive) return p;
    if (this.petals.length >= MAX_PETALS) return null;
    const p = {} as Petal;
    this.petals.push(p);
    return p;
  }

  private spawnPetalFrom(r: Raceme, state = PetalState.Fall): Petal | null {
    if (r.bloom < 0.2) return null;
    const p = this.newPetal();
    if (!p) return null;
    const s = rand(0.04, r.bloom * 0.95);
    const q = this.pointOn(r, s, this.tmp);
    const spread = r.width * (1 - 0.6 * s) * rand(-1.2, 1.2);
    p.x = q.x - q.ty * spread;
    p.y = q.y + q.tx * spread;
    p.vx = rand(-8, 8);
    p.vy = rand(0, 10);
    p.phase = rand(0, TAU);
    p.spin = rand(1.6, 3.6) * (Math.random() < 0.5 ? -1 : 1);
    p.depth = clamp(r.depth + rand(-0.08, 0.08), 0.3, 1);
    p.state = state;
    p.timer = 0;
    p.willLinger = state === PetalState.Fall && Math.random() < 0.035;
    p.tx = 0;
    p.ty = 0;
    p.alive = true;
    return p;
  }

  private spawnPetals(dt: number) {
    const pSpeed = this.pointer.active ? Math.hypot(this.pointer.vx, this.pointer.vy) : 0;
    for (const r of this.racemes) {
      if (r.bloom < 0.45) continue;
      // Baseline: a slow, steady shedding; gusts and the pointer shake more loose.
      let rate = 0.065 * r.depth * (1 + this.gust * 3);
      if (pSpeed > 40) {
        const q = this.pointOn(r, 0.4, this.tmp);
        const d = Math.hypot(q.x - this.pointer.x, q.y - this.pointer.y);
        if (d < 160) rate += (1 - d / 160) * Math.min(1, pSpeed / 900) * 2.5;
      }
      if (Math.random() < rate * dt) this.spawnPetalFrom(r);
    }
  }

  private stepPetals(dt: number) {
    const H = this.height;
    const t = this.time;
    const p0 = this.pointer;
    for (const p of this.petals) {
      if (!p.alive) continue;
      p.phase += p.spin * dt;

      if (p.state === PetalState.Hold) {
        // Breathe in place.
        p.x += Math.sin(t * 1.3 + p.phase) * 0.04;
        p.y += Math.cos(t * 1.1 + p.phase) * 0.03;
        continue;
      }

      if (p.state === PetalState.Seek) {
        p.timer -= dt;
        if (p.timer <= 0) {
          // Critically damped spring onto the target cell.
          const k = 3.2;
          const c = 2 * Math.sqrt(k) * 1.05;
          p.vx += ((p.tx - p.x) * k - p.vx * c) * dt;
          p.vy += ((p.ty - p.y) * k - p.vy * c) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          continue;
        }
      }

      if (p.state === PetalState.Linger) {
        p.timer -= dt;
        p.vx *= 1 - dt * 2.5;
        p.vy *= 1 - dt * 2.5;
        p.x += p.vx * dt + Math.sin(t * 0.9 + p.phase) * 0.05;
        p.y += p.vy * dt;
        if (p.timer <= 0) p.state = PetalState.Fall;
        continue;
      }

      const terminal = 22 + 26 * p.depth;
      const wind = this.windAt(p.x, p.y, t) * 0.32;
      p.vy += (terminal - p.vy) * dt * 1.4;
      p.vx += (wind - p.vx) * dt * 0.9;
      if (p0.active) {
        const dx = p.x - p0.x;
        const dy = p.y - p0.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 100 * 100) {
          const f = 1 - Math.sqrt(d2) / 100;
          p.vx += p0.vx * f * dt * 3;
          p.vy += p0.vy * f * dt * 2;
        }
      }
      // Tumbling petals side-slip with their spin.
      p.x += (p.vx + Math.cos(p.phase) * 16) * dt;
      p.y += (p.vy + Math.sin(p.phase * 2) * 5) * dt;

      if (p.willLinger && p.y > H * 0.58 && p.y < H * 0.75) {
        p.willLinger = false;
        p.state = PetalState.Linger;
        p.timer = rand(2.4, 4);
      }

      if (p.vy > 0 && p.y >= this.groundY + rand(-4, 6)) {
        p.alive = false;
        if (p.state === PetalState.Fall) this.landPetal(p.x);
      } else if (p.x < -40 || p.x > this.width + 40) {
        p.alive = false;
      }
    }
  }

  // ── poem ────────────────────────────────────────────────────────────

  private stepPoem() {
    const lines = this.opts.poem;
    const poem = this.poem;
    if (!lines || lines.length === 0 || !this.maskProvider || !this.introDone) return;
    const t = this.time;

    if (poem.phase === "idle") {
      if (this.clock < poem.next) return;
      const text = lines[poem.index % lines.length];
      poem.index++;
      const W = this.width;
      const H = this.height;
      const cells = this.maskProvider(text, { x: W * 0.06, y: H * 0.7, w: W * 0.66, h: H * 0.2 });
      if (cells.length < 12) {
        // Too small to read at this size; try again later.
        poem.next = this.clock + 60;
        return;
      }
      const fronts = this.racemes.filter((r) => r.bloom > 0.4);
      for (const cell of cells) {
        const r = fronts[(Math.random() * fronts.length) | 0];
        const p = r && this.spawnPetalFrom(r, PetalState.Seek);
        if (!p) break;
        p.tx = cell.x;
        p.ty = cell.y;
        // Fall freely for a moment, then drift into place, staggered.
        p.timer = rand(0.6, 3.2);
      }
      poem.phase = "gather";
      poem.until = t + 9;
      return;
    }

    if (poem.phase === "gather") {
      let settled = true;
      for (const p of this.petals) {
        if (!p.alive || p.state !== PetalState.Seek) continue;
        if (Math.hypot(p.tx - p.x, p.ty - p.y) < 1.5 && Math.hypot(p.vx, p.vy) < 6) {
          p.state = PetalState.Hold;
          p.x = p.tx;
          p.y = p.ty;
        } else {
          settled = false;
        }
      }
      if (settled || t > poem.until) {
        for (const p of this.petals) if (p.alive && p.state === PetalState.Seek) p.state = PetalState.Hold;
        poem.phase = "hold";
        poem.until = t + 4.5;
      }
      return;
    }

    if (t > poem.until) {
      // Let go: each petal gets its own little push, and they fall away.
      for (const p of this.petals) {
        if (!p.alive || p.state !== PetalState.Hold) continue;
        p.state = PetalState.Fall;
        p.vx = rand(-6, 6) + this.windAt(p.x, p.y, t) * 0.2;
        p.vy = rand(-4, 2) - hash3(p.x | 0, p.y | 0, 3) * 6;
      }
      poem.phase = "idle";
      const [a, b] = this.opts.poemEvery;
      poem.next = this.clock + rand(a, b);
    }
  }
}
