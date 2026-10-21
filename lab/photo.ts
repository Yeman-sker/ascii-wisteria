/**
 * Lab: turn a reference photo into ASCII, to find out what a subject needs in
 * order to stay recognisable at a given cell size. Run `npm run dev` and open
 * /lab/photo.html (it uses public/wisteria.jpg; ?src=/other.jpg for another photo).
 *   ?mode=ramp   brightness only: one glyph per cell from a density ramp (what the engine does now)
 *   ?mode=shape  shape matching: the glyph whose bitmap best fits the cell's sub-pixel pattern
 *   ?mode=hybrid flat cells from a ramp, edge cells matched by shape against stroke-like glyphs
 * ?cw= sets the cell width in px (height is 1.5×).
 */
const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "shape";
const W = 1440;
const cw = Number(params.get("cw") ?? 12);
const ch = Math.round(cw * 1.5);
const SX = 5;
const SY = 8;
const RAMP = " .:;=o*%8&@";
const FILL = " .:;+=*o%&";
const EDGE_GLYPHS = " .,:;'`\"-_~^|/\\()<>[]{}ivxolcsuJL7rtfjz";
const GLYPHS = params.get("glyphs") ?? " .,:;'`\"-_~=+*^!|/\\()<>[]{}ivxolcsu%#&@8OVY";

const canvas = document.querySelector("canvas")!;
const font = getComputedStyle(canvas).fontFamily;

const img = new Image();
img.src = params.get("src") ?? "/wisteria.jpg";
await img.decode();
await document.fonts.load(`600 16px ${font}`);

const H = Math.round((W * img.height) / img.width);
const cols = Math.floor(W / cw);
const rows = Math.floor(H / ch);
const dpr = 2;
canvas.width = W * dpr;
canvas.height = H * dpr;
canvas.style.width = W + "px";
canvas.style.height = H + "px";

// Sample the photo at SX×SY points per cell.
const sw = cols * SX;
const sh = rows * SY;
const sc = document.createElement("canvas");
sc.width = sw;
sc.height = sh;
const sg = sc.getContext("2d", { willReadFrequently: true })!;
sg.drawImage(img, 0, 0, sw, sh);
const px = sg.getImageData(0, 0, sw, sh).data;
const lum = new Float32Array(sw * sh);
for (let i = 0; i < sw * sh; i++) {
  const l = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  // The photo is dark; lift it so petals use the whole range.
  lum[i] = Math.pow(Math.min(1, Math.max(0, (l - 0.04) / 0.55)), 0.85);
}

// Glyph bitmaps at the same sub-cell resolution, rendered in the page's font.
const templates: { g: string; t: Float32Array; tt: number }[] = [];
{
  const S = 4;
  const gc = document.createElement("canvas");
  gc.width = cw * S;
  gc.height = ch * S;
  const g = gc.getContext("2d", { willReadFrequently: true })!;
  for (const c of GLYPHS) {
    g.clearRect(0, 0, gc.width, gc.height);
    g.fillStyle = "#fff";
    g.font = `600 ${Math.round(ch * 0.74 * S)}px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(c, (cw * S) / 2, (ch * S) / 2);
    const d = g.getImageData(0, 0, gc.width, gc.height).data;
    const t = new Float32Array(SX * SY);
    const bw = gc.width / SX;
    const bh = gc.height / SY;
    for (let y = 0; y < SY; y++) {
      for (let x = 0; x < SX; x++) {
        let sum = 0;
        let n = 0;
        for (let yy = Math.floor(y * bh); yy < Math.floor((y + 1) * bh); yy++) {
          for (let xx = Math.floor(x * bw); xx < Math.floor((x + 1) * bw); xx++) {
            sum += d[(yy * gc.width + xx) * 4 + 3];
            n++;
          }
        }
        t[y * SX + x] = sum / n / 255;
      }
    }
    let tt = 0;
    for (const v of t) tt += v * v;
    templates.push({ g: c, t, tt });
  }
}

const edgeTemplates = templates.filter((t) => EDGE_GLYPHS.includes(t.g));

const ctx = canvas.getContext("2d")!;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.fillStyle = "#07060f";
ctx.fillRect(0, 0, W, H);
ctx.font = `600 ${Math.round(ch * 0.74)}px ${font}`;
ctx.textAlign = "center";
ctx.textBaseline = "middle";

const v = new Float32Array(SX * SY);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    let mean = 0;
    let R = 0, G = 0, B = 0;
    for (let y = 0; y < SY; y++) {
      for (let x = 0; x < SX; x++) {
        const i = (r * SY + y) * sw + c * SX + x;
        v[y * SX + x] = lum[i];
        mean += lum[i];
        R += px[i * 4];
        G += px[i * 4 + 1];
        B += px[i * 4 + 2];
      }
    }
    const n = SX * SY;
    mean /= n;
    if (mean < 0.035) continue;

    let glyph = " ";
    let bright = mean;
    if (mode === "ramp") {
      glyph = RAMP[Math.min(RAMP.length - 1, Math.round(mean * (RAMP.length - 1) * 1.3))];
      bright = 0.35 + 0.65 * mean;
    } else {
      // Ink brightness = the cell's bright end; the glyph only has to match the
      // pattern of light within the cell, as coverage in [0, 1].
      let peak = 0;
      let low = 1;
      for (const x of v) {
        peak = Math.max(peak, x);
        low = Math.min(low, x);
      }
      bright = peak;
      // Flat cells (inside a petal) take a density ramp; only cells that hold an
      // edge are matched by shape, and never against the solid glyphs.
      const edge = mode === "shape" ? true : peak - low > 0.3 * peak + 0.06;
      if (!edge) {
        glyph = FILL[Math.min(FILL.length - 1, Math.round(mean * (FILL.length - 1) * 1.25))];
        bright = 0.3 + 0.7 * mean;
      } else {
        let best = Infinity;
        for (const tp of mode === "shape" ? templates : edgeTemplates) {
          let err = 0;
          for (let k = 0; k < n; k++) {
            const d = v[k] / peak - tp.t[k];
            err += d * d;
          }
          if (err < best) {
            best = err;
            glyph = tp.g;
          }
        }
      }
    }
    if (glyph === " ") continue;
    // Keep the photo's hue; let the glyph carry the brightness.
    const m = Math.max(R, G, B) / n || 1;
    const k = (255 * Math.min(1, bright * 1.15)) / m;
    ctx.fillStyle = `rgb(${(R / n) * k},${(G / n) * k},${(B / n) * k})`;
    ctx.fillText(glyph, (c + 0.5) * cw, (r + 0.5) * ch);
  }
}
document.title = `lab · ${mode} · ${cols}×${rows}`;
