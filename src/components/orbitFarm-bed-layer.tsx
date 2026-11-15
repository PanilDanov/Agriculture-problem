import { useId, useMemo, type ReactNode } from 'react';
import type { CropId, LayoutPoint } from '../domain/orbitFarm-types';
import { CROP_CATALOG } from '../domain/orbitFarm-crop-catalog';
import type { GrowthStage } from '../domain/orbitFarm-model';
import { planBedAnnotations } from './orbitFarm-bed-annotations';
import { CropSprite } from './orbitFarm-crop-sprite';
import { ArtworkMark } from './orbitFarm-artwork-mark';
import { FARM_WORLD_VIEW_BOX } from './orbitFarm-world';
import './orbitFarm-bed-layer.css';

export interface FarmBedVisual {
  slotId: number;
  name: string;
  points: LayoutPoint[];
  label: string;
  crop: { id: CropId; stage: GrowthStage } | null;
}

export interface FarmBedLayerProps {
  beds: FarmBedVisual[];
  pixelsPerUnit: number;
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
  background?: ReactNode;
}

function description(bed: FarmBedVisual): string {
  if (!bed.crop) return `${bed.name} · Empty`;
  const crop = CROP_CATALOG.find(item => item.id === bed.crop?.id)?.name ?? bed.crop.id;
  return `${bed.name} · ${crop} · ${bed.crop.stage}`;
}

/** Farm geometry stays fixed while small-bed labels can use clear surrounding ground. */
export function FarmBedLayer({ beds, pixelsPerUnit, selectedSlotId, onSelectSlot, background }: FarmBedLayerProps) {
  const id = useId().replaceAll(':', '');
  const scale = Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? pixelsPerUnit : 1;
  const plan = useMemo(() => planBedAnnotations(beds.map(bed => ({
    slotId: bed.slotId,
    points: bed.points,
    label: bed.label,
    empty: !bed.crop || bed.crop.stage === 'Planned',
  })), pixelsPerUnit), [beds, pixelsPerUnit]);
  const plannedBeds = new Map(plan.beds.map(bed => [bed.slotId, bed]));
  // Keep an identifier available even if a future planner cannot place a callout.
  const legend = beds.filter(bed => !plannedBeds.get(bed.slotId)?.annotation);

  return <>
    <div className="of-farm-canvas">
      {background}
      <svg className="of-bed-layer" viewBox={FARM_WORLD_VIEW_BOX} aria-label="Your planting beds">
        <defs>
          <pattern id={`${id}-soil`} width="91" height="30" patternUnits="userSpaceOnUse" shapeRendering="crispEdges">
            <rect width="91" height="30" fill="#AA704D" />
            <path d="M0 3h22v2h17v2h38V5h14v10H64v-2H37v1H12v-2H0Z" fill="#B98057" />
            <path d="M0 22h21v-2h22v2h24v-2h15v2h9v4H0Z" fill="#8E583C" />
            <path d="M6 7h4v2H6zm23-2h5v2h-5zm25 7h3v2h-3zm29-3h4v2h-4zM17 17h3v2h-3zm54-1h4v2h-4zm-26 12h4v2h-4z" fill="#D8A06A" />
            <path d="M8 15h5v2H8zm28 4h4v2h-4zm28-11h5v2h-5zm13 18h5v2h-5z" fill="#9A6243" />
          </pattern>
          {beds.map(bed => <clipPath key={bed.slotId} id={`${id}-clip-${bed.slotId}`}>
            <polygon points={bed.points.map(point => `${point.x},${point.y}`).join(' ')} />
          </clipPath>)}
        </defs>
        <g aria-hidden="true" pointerEvents="none" fill="#526448" opacity=".3" transform="translate(2 5)">
          {beds.map(bed => <polygon key={bed.slotId} points={bed.points.map(point => `${point.x},${point.y}`).join(' ')} />)}
        </g>
        {beds.map(bed => {
          const content = plannedBeds.get(bed.slotId);
          const annotation = content?.annotation;
          const selected = bed.slotId === selectedSlotId;
          const cropId = bed.crop?.id;
          const stage = bed.crop?.stage;
          const points = bed.points.map(point => `${point.x},${point.y}`).join(' ');
          const mode = annotation ? (content?.external ? 'callout' : 'id') : 'legend';
          return <g
            key={bed.slotId}
            className={`of-bed-shape${selected ? ' of-bed-shape-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={description(bed)}
            aria-pressed={selected}
            data-testid={`plot-slot-${bed.slotId}`}
            data-annotation-mode={mode}
            onClick={() => onSelectSlot(bed.slotId)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectSlot(bed.slotId); } }}
          >
            <title>{description(bed)}</title>
            <polygon className="of-bed-ground" points={points} fill={`url(#${id}-soil)`} stroke="#70472F" strokeWidth="4" strokeLinejoin="round" />
            <g clipPath={`url(#${id}-clip-${bed.slotId})`} pointerEvents="none" aria-hidden="true">
              <polygon points={points} fill="none" stroke="#C2915C" strokeWidth="4" strokeLinejoin="round" opacity=".65" />
              {cropId && stage && stage !== 'Planned' && content?.crops.map((crop, index) => <g className="of-bed-crop" key={index} data-testid={`bed-crop-${bed.slotId}-${index}`} data-bed-id={bed.slotId} transform={`translate(${crop.x} ${crop.y})`}>
                <CropSprite cropId={cropId} stage={stage} size={crop.width} />
              </g>)}
            </g>
            <polygon className="of-bed-selection" points={points} fill="none" stroke="#FFF4CE" strokeWidth="2.5" strokeLinejoin="round" pointerEvents="none" />
          </g>;
        })}
        {beds.map(bed => {
          const content = plannedBeds.get(bed.slotId);
          if (!content?.annotation) return null;
          const badge = content.annotation;
          const external = content.external;
          const selected = bed.slotId === selectedSlotId;
          const crop = badge.showCrop ? bed.crop : null;
          const textInset = 26 / scale + badge.fontSize * .55;
          return <g key={bed.slotId} className="of-bed-annotation-layer">
            {content.leader && <line
              className="of-bed-callout-leader"
              data-testid={`bed-leader-${bed.slotId}`}
              x1={content.leader.from.x} y1={content.leader.from.y}
              x2={content.leader.to.x} y2={content.leader.to.y}
              vectorEffect="non-scaling-stroke" pointerEvents="none" aria-hidden="true"
            />}
            <g
              className={`of-bed-badge${external ? ' of-bed-callout' : ''}${selected ? ' of-bed-badge-selected' : ''}`}
              data-testid={`bed-annotation-${bed.slotId}`}
              data-annotation-external={external ? 'true' : 'false'}
              pointerEvents={external ? 'auto' : 'none'}
              aria-hidden={external ? undefined : true}
              role={external ? 'button' : undefined}
              tabIndex={external ? 0 : undefined}
              aria-label={external ? `Select ${description(bed)}` : undefined}
              aria-pressed={external ? selected : undefined}
              onClick={external ? () => onSelectSlot(bed.slotId) : undefined}
              onKeyDown={external ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectSlot(bed.slotId); } } : undefined}
            >
              <rect className="of-bed-stake" x={badge.x + (badge.width - 5 / scale) / 2}
                y={badge.y + badge.height - 1 / scale} width={5 / scale} height={3 / scale} />
              <rect
                className="of-bed-badge-face"
                data-testid={`bed-annotation-box-${bed.slotId}`}
                x={badge.x} y={badge.y} width={badge.width} height={badge.height}
                rx={2 / scale}
                stroke={selected && external ? '#286B45' : '#6A502F'}
                strokeWidth={selected && external ? 2 : 1.2}
                vectorEffect="non-scaling-stroke"
              />
              {crop && crop.stage !== 'Planned' && <CropSprite cropId={crop.id} stage={crop.stage} x={badge.x + 3 / scale} y={badge.y + 3 / scale} size={22 / scale} />}
              <text
                className="of-bed-badge-text"
                x={crop ? badge.x + textInset : badge.x + badge.width / 2}
                y={badge.y + badge.height / 2}
                textAnchor={crop ? 'start' : 'middle'}
                dominantBaseline="central"
                style={{ fontSize: badge.fontSize }}
              >{bed.label}</text>
            </g>
          </g>;
        })}
      </svg>
      <ArtworkMark className="of-artwork-mark--overlay" />
    </div>
    {legend.length > 0 && <div className="of-bed-legend" aria-label="Small bed identifiers">
      <div className="of-bed-legend-heading"><strong>Beds</strong></div>
      <div className="of-bed-legend-items">
        {legend.map(bed => <button
          key={bed.slotId}
          type="button"
          data-testid={`bed-legend-${bed.slotId}`}
          aria-label={`Select ${description(bed)}`}
          aria-pressed={bed.slotId === selectedSlotId}
          title={description(bed)}
          onClick={() => onSelectSlot(bed.slotId)}
        >
          {bed.crop && bed.crop.stage !== 'Planned' && <CropSprite cropId={bed.crop.id} stage={bed.crop.stage} size={24} />}
          <span>{bed.label}</span>
        </button>)}
      </div>
    </div>}
  </>;
}
