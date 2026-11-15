import type { CropId } from '../domain/orbitFarm-types';
import type { GrowthStage } from '../domain/orbitFarm-model';
import { getCropSpriteUrl } from '../domain/orbitFarm-assets';
import { PlantFallback, SvgAssetImage } from './orbitFarm-image';

type PlantedStage = Exclude<GrowthStage, 'Planned'>;
const STAGE_ARTWORK: Record<PlantedStage, string> = {
  Seedling: 'seedling-v1',
  Growing: 'growing-v1',
  'Ready to harvest': 'field-v2',
};

interface CropSpriteProps {
  cropId: CropId;
  stage?: PlantedStage;
  size?: number;
  x?: number;
  y?: number;
}

export function CropSprite({ cropId, stage = 'Ready to harvest', size = 36, x, y }: CropSpriteProps) {
  return (
    <svg
      x={x}
      y={y}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="of-crop-sprite"
      data-crop-id={cropId}
      data-growth-stage={stage}
      data-crop-artwork={`crop/${cropId}/${STAGE_ARTWORK[stage]}`}
    >
      <SvgAssetImage
        className="of-crop-body of-scene-motion"
        src={getCropSpriteUrl(cropId, STAGE_ARTWORK[stage])}
        width={32}
        height={32}
        fallback={<PlantFallback />}
        fallbackViewBox="0 0 32 32"
      />
    </svg>
  );
}
