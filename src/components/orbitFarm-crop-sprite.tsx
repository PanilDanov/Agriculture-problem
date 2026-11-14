import type { CropId } from '../domain/orbitFarm-types';
import wheatReady from '../../brand/sprites/crops-v1/png/wheat-ready.png';
import barleyReady from '../../brand/sprites/crops-v1/png/barley-ready.png';
import maizeReady from '../../brand/sprites/crops-v1/png/maize-ready.png';
import sorghumReady from '../../brand/sprites/crops-v1/png/sorghum-ready.png';
import chickpeaReady from '../../brand/sprites/crops-v1/png/chickpea-ready.png';
import lentilReady from '../../brand/sprites/crops-v1/png/lentil-ready.png';
import fabaBeanReady from '../../brand/sprites/crops-v1/png/faba-bean-ready.png';
import sunflowerReady from '../../brand/sprites/crops-v1/png/sunflower-ready.png';
import potatoReady from '../../brand/sprites/crops-v1/png/potato-ready.png';
import tomatoReady from '../../brand/sprites/crops-v1/png/tomato-ready.png';

interface CropArtwork {
  href: string;
  bounds: { x: number; y: number; width: number; height: number };
}

// Visible alpha bounds from the sprite-pack manifest, excluding transparent padding.
const CROP_ARTWORK = {
  wheat: { href: wheatReady, bounds: { x: 164, y: 66, width: 345, height: 450 } },
  barley: { href: barleyReady, bounds: { x: 84, y: 62, width: 470, height: 450 } },
  maize: { href: maizeReady, bounds: { x: 129, y: 35, width: 381, height: 519 } },
  sorghum: { href: sorghumReady, bounds: { x: 158, y: 40, width: 352, height: 510 } },
  chickpea: { href: chickpeaReady, bounds: { x: 81, y: 137, width: 490, height: 392 } },
  lentil: { href: lentilReady, bounds: { x: 165, y: 74, width: 320, height: 451 } },
  'faba-bean': { href: fabaBeanReady, bounds: { x: 109, y: 25, width: 447, height: 541 } },
  sunflower: { href: sunflowerReady, bounds: { x: 150, y: 46, width: 370, height: 487 } },
  potato: { href: potatoReady, bounds: { x: 106, y: 163, width: 443, height: 371 } },
  tomato: { href: tomatoReady, bounds: { x: 104, y: 69, width: 453, height: 461 } },
} satisfies Record<CropId, CropArtwork>;

export function CropSprite({ cropId, size = 36 }: { cropId: CropId; size?: number }) {
  const artwork = CROP_ARTWORK[cropId];
  const { bounds } = artwork;
  const scale = 28 / Math.max(bounds.width, bounds.height);
  const x = 16 - (bounds.x + bounds.width / 2) * scale;
  const y = 30 - (bounds.y + bounds.height) * scale;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="of-crop-sprite"
      data-crop-id={cropId}
      data-crop-artwork={`crop/${cropId}/ready`}
    >
      <image
        href={artwork.href}
        x={x}
        y={y}
        width={627 * scale}
        height={627 * scale}
        preserveAspectRatio="xMidYMid meet"
        style={{ imageRendering: 'pixelated' }}
      />
    </svg>
  );
}
