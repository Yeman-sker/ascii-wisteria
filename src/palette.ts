import type { RGB } from "./math";

/**
 * Moonlit blue-violet. Purple carries the scene; leaves and bark are pushed
 * toward grey-lavender so nothing competes with it. One cool accent: moonlight.
 */
export interface Palette {
  /** Sky gradient, top → bottom. */
  skyTop: RGB;
  skyBottom: RGB;
  /** Open florets, shadow → highlight. */
  petal: RGB[];
  /** Closed buds near the tip. */
  bud: RGB;
  /** The raceme's stem (rachis). */
  stem: RGB;
  leaf: RGB[];
  bark: RGB;
  /** Moon, stars and rare glints. */
  moon: RGB;
  /** The lingering trail where the pointer passed. */
  fragrance: RGB;
  /** Petals settled on the ground. */
  fallen: RGB;
  /** Petals gathered into the poem. */
  poem: RGB;
}

export const MOONLIGHT: Palette = {
  skyTop: [12, 9, 30],
  skyBottom: [4, 3, 11],
  petal: [
    [38, 26, 92],
    [78, 58, 168],
    [132, 112, 232],
    [184, 170, 255],
    [232, 226, 255],
  ],
  bud: [58, 40, 128],
  stem: [112, 98, 168],
  leaf: [
    [34, 30, 58],
    [72, 66, 108],
    [128, 120, 168],
  ],
  bark: [66, 56, 86],
  moon: [214, 220, 246],
  fragrance: [146, 122, 240],
  fallen: [120, 100, 200],
  poem: [226, 218, 255],
};
