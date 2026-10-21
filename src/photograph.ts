/**
 * The photograph as the scene's source picture. Each frame it is drawn into a
 * small sample canvas (SX × SY samples per text cell), cut into tiles that
 * follow the world's pendulum columns, so hanging racemes sway as a whole
 * while the canopy at the top barely moves. The renderer turns the result
 * into glyphs.
 *
 * Intro: the picture is revealed from the top down, each column at its own
 * pace, as if the racemes were growing, and brightens as it goes.
 */
import { clamp, noise1, smoothstep } from "./math";
import { SWAY_COLS, type World } from "./world";

export const PHOTO_SX = 5;
export const PHOTO_SY = 8;
const TILE_ROWS = 28;

export interface LoadedPhoto {
  image: HTMLImageElement;
  aspect: number;
  /** Bright flower pixels as (u, v, brightness) triples in [0, 1]. */
  flowers: Float32Array;
}

/** Load a photograph and find its bright flower pixels, where petals will fall from. */
export async function loadPhoto(url: string): Promise<LoadedPhoto> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const aspect = image.naturalWidth / image.naturalHeight;
  const w = 200;
  const h = Math.round(w / aspect);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  const pts: number[] = [];
  if (g) {
    g.drawImage(image, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        if (l > 0.38) pts.push((x + 0.5) / w, (y + 0.5) / h, clamp((l - 0.38) / 0.4, 0, 1));
      }
    }
  }
  return { image, aspect, flowers: new Float32Array(pts) };
}

export class PhotoSource {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly sx = PHOTO_SX;
  readonly sy = PHOTO_SY;
  private cw = 7;
  private ch = 10;

  constructor(private photo: LoadedPhoto) {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  resize(cols: number, rows: number, cw: number, ch: number) {
    this.cw = cw;
    this.ch = ch;
    this.canvas.width = cols * this.sx;
    this.canvas.height = rows * this.sy;
  }

  draw(world: World) {
    const g = this.ctx;
    const img = this.photo.image;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const rect = world.photoRect;
    if (rect.w === 0) return;
    const W = world.width;
    const H = world.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.sx / this.cw, 0, 0, this.sy / this.ch, 0, 0);
    g.imageSmoothingEnabled = true;

    const intro = !world.introDone;
    g.globalAlpha = intro ? 0.25 + 0.75 * smoothstep(3, 16, world.clock) : 1;

    // Tiles follow the pendulum columns; each row of a column shifts by the sway at its height.
    const tw = W / SWAY_COLS;
    const th = H / TILE_ROWS;
    const kx = iw / rect.w;
    const ky = ih / rect.h;
    for (let i = 0; i < SWAY_COLS; i++) {
      const x0 = i * tw;
      for (let j = 0; j < TILE_ROWS; j++) {
        const y0 = j * th;
        const dx = world.displaceX(x0 + tw / 2, y0 + th / 2);
        // Sample a little wider than the tile so neighbours overlap instead of leaving seams.
        const sx = (x0 - rect.x - 1) * kx;
        const sy = (y0 - rect.y) * ky;
        g.drawImage(img, sx, sy, (tw + 2) * kx, (th + 1) * ky, x0 - 1 + dx, y0, tw + 2, th + 1);
      }
    }
    g.globalAlpha = 1;

    if (intro) {
      // Reveal from the top down, column by column, with a soft growing edge.
      g.globalCompositeOperation = "destination-out";
      for (let i = 0; i < SWAY_COLS; i++) {
        const x0 = i * tw;
        const delay = 0.8 + 3.2 * noise1(i * 0.35, 4);
        const k = clamp((world.clock - delay) / 11, 0, 1);
        const front = -H * 0.1 + H * 1.3 * (1 - Math.pow(1 - k, 2.2));
        const band = H * 0.12;
        const grad = g.createLinearGradient(0, front - band, 0, front + band);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,1)");
        g.fillStyle = grad;
        g.fillRect(x0 - 1, front - band, tw + 2, H - front + band + 2);
      }
      g.globalCompositeOperation = "source-over";
    }
  }
}
