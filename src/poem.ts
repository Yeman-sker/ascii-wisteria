/**
 * Turns a line of verse into the grid cells it covers, so petals can gather
 * into it. The text is drawn 4× supersampled per cell on a scratch canvas,
 * then each cell's average coverage is thresholded.
 */
const SS = 4;
const SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", serif';
/** Below this many rows per character, strokes stop being legible. */
const MIN_ROWS = 8;

export function textMask(
  text: string,
  area: { x: number; y: number; w: number; h: number },
  cw: number,
  ch: number,
  vertical = false,
): { x: number; y: number }[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  // Vertical lines run top to bottom, the traditional way.
  const size = vertical
    ? Math.min(area.w * 0.9, area.h / (chars.length * 1.08))
    : Math.min(area.h * 0.9, area.w / (chars.length * 1.08));
  if (size < ch * MIN_ROWS) return [];

  const cols = Math.ceil(area.w / cw);
  const rows = Math.ceil(area.h / ch);
  const canvas = document.createElement("canvas");
  canvas.width = cols * SS;
  canvas.height = rows * SS;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return [];
  // Draw in pixel units; the scale squashes pixels into supersampled cells.
  g.setTransform(SS / cw, 0, 0, SS / ch, 0, 0);
  g.fillStyle = "#fff";
  g.font = `700 ${Math.round(size)}px ${SERIF}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const step = size * 1.08;
  if (vertical) {
    const y0 = area.h / 2 - (step * (chars.length - 1)) / 2;
    chars.forEach((c, i) => g.fillText(c, area.w / 2, y0 + i * step));
  } else {
    const x0 = area.w / 2 - (step * (chars.length - 1)) / 2;
    chars.forEach((c, i) => g.fillText(c, x0 + i * step, area.h / 2));
  }

  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const c0 = Math.floor(area.x / cw);
  const r0 = Math.floor(area.y / ch);
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let y = 0; y < SS; y++) {
        for (let x = 0; x < SS; x++) sum += data[((r * SS + y) * canvas.width + c * SS + x) * 4 + 3];
      }
      if (sum / (SS * SS * 255) > 0.3) out.push({ x: (c0 + c + 0.5) * cw, y: (r0 + r + 0.5) * ch });
    }
  }
  return out;
}
