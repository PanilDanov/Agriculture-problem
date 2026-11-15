import type { FarmSeason } from './orbitFarm-seasons';
import { findShrub, ORCHARD, orchardGrassSample } from './orbitFarm-vegetation';

type Tint = readonly [number, number, number];

interface Palette {
  grass: Tint;
  leaves: Tint;
  shrubs: Tint;
  reeds: Tint;
  water: Tint;
  path: Tint;
  light: Tint;
}

const PALETTES: Record<FarmSeason, Palette> = {
  spring: {
    grass: [-19, 4, 7], leaves: [4, 13, 5], shrubs: [11, 23, 7], reeds: [-4, 13, 3],
    water: [-6, 10, 12], path: [-7, 0, 6], light: [2, 3, 5],
  },
  summer: {
    grass: [1, 1, -7], leaves: [-2, 3, -2], shrubs: [-6, 4, 7], reeds: [3, 2, -3],
    water: [-4, 3, 5], path: [0, 2, -4], light: [10, 5, -5],
  },
  autumn: {
    grass: [26, -17, -25], leaves: [36, -15, -13], shrubs: [45, -17, -9], reeds: [43, -14, -4],
    water: [-6, -4, 4], path: [-9, -11, -12], light: [10, -2, -8],
  },
  winter: {
    grass: [-39, -33, -1], leaves: [-12, -17, 0], shrubs: [-22, -16, 8], reeds: [24, -17, 1],
    water: [-6, -13, 6], path: [-23, -20, -1], light: [-8, -5, 9],
  },
};

function roofAt(x: number, y: number) {
  return (x >= 40 && x <= 111 && y < 37)
    || (x >= 126 && x <= 161 && y < 32)
    || (x >= 320 && x <= 377 && y < 39);
}

function windowAt(x: number, y: number, r: number, g: number, b: number) {
  if (g <= r + 5 || b < r - 18) return false;
  const cottage = ((x >= 53 && x <= 62) || (x >= 90 && x <= 99)) && y >= 38 && y <= 47;
  const shed = x >= 353 && x <= 366 && y >= 45 && y <= 54;
  return cottage || shed;
}

export function paintTerrain(context: CanvasRenderingContext2D, source: ImageData, season: FarmSeason, orchardMask: Uint8Array) {
  const { width, height, data } = source;
  const result = context.createImageData(width, height);
  const pixels = result.data;
  const palette = PALETTES[season];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] === 0) continue;

      let sample = offset;
      let r = data[sample], g = data[sample + 1], b = data[sample + 2];
      const inOrchard = x >= ORCHARD.x && x < ORCHARD.x + ORCHARD.width && y >= ORCHARD.y && y < ORCHARD.y + ORCHARD.height;
      if (inOrchard && orchardMask[(y - ORCHARD.y) * ORCHARD.width + x - ORCHARD.x]) {
        sample = orchardGrassSample(x, y, source);
        if (sample < 0) continue;
        r = data[sample];
        g = data[sample + 1];
        b = data[sample + 2];
      }

      const shrub = findShrub(x, y);
      const fruit = r > 139 && r > g * 1.27 && r > b * 1.35;
      const petals = r > 210 && g > 198 && b > 140;
      if (shrub && (fruit || (!shrub.berries && petals))) {
        const light = Math.max(r, g) / 255;
        r = 51 + light * 44;
        g = 89 + light * 48;
        b = 28 + light * 19;
      }
      const pond = x >= 6 && x <= 66 && y >= 118 && y <= 180 && b > r + 10 && g > r + 24;
      const path = y >= 229 && y <= 260 && r > 219 && g > 155 && g < 228;
      const plant = g > r + 7 && g > b + 11 && !roofAt(x, y);
      const reeds = x >= 37 && x <= 62 && y >= 87 && y <= 126 && g < 160;
      let tint: Tint | undefined;
      if (pond) tint = palette.water;
      else if (path) tint = palette.path;
      else if (plant && reeds) tint = palette.reeds;
      else if (plant && shrub && g < 177) tint = palette.shrubs;
      else if (plant) tint = r >= 128 && g >= 153 ? palette.grass : palette.leaves;

      const shade = Math.min(1, .28 + Math.max(r, g, b) / 229);
      const sunlight = 1 - .38 * x / width - .35 * y / height;
      if (season === 'winter' && windowAt(x, y, r, g, b)) {
        const glow = g / 255;
        r = 175 + 78 * glow;
        g = 92 + 115 * glow;
        b = 45 + 88 * glow;
      }

      pixels[offset] = r + (tint?.[0] ?? 0) * shade + palette.light[0] * sunlight;
      pixels[offset + 1] = g + (tint?.[1] ?? 0) * shade + palette.light[1] * sunlight;
      pixels[offset + 2] = b + (tint?.[2] ?? 0) * shade + palette.light[2] * sunlight;
      pixels[offset + 3] = data[sample + 3];
    }
  }

  context.putImageData(result, 0, 0);
}
