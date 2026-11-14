import { useId, useMemo, type ComponentType, type ReactNode } from 'react';
import type { CropId, LayoutPoint } from '../domain/orbitFarm-types';
import { planBedAnnotations } from './orbitFarm-bed-annotations';
import './orbitFarm-bed-layer.css';

export interface FarmBedVisual {
  slotId: number;
  name: string;
  points: LayoutPoint[];
  label: string;
  cropId: CropId | null;
  taskTitle: string | null;
}

export interface FarmBedLayerProps {
  beds: FarmBedVisual[];
  pixelsPerUnit: number;
  selectedSlotId: number | null;
  onSelectSlot: (slotId: number) => void;
  CropSpriteComponent: ComponentType<{ cropId: CropId; size?: number }>;
  background?: ReactNode;
}

const CROP_NAMES: Record<CropId, string> = {
  wheat: 'Wheat',
  chickpea: 'Chickpea',
  sorghum: 'Sorghum',
};

function description(bed: FarmBedVisual): string {
  return `${bed.name} · ${bed.cropId ? CROP_NAMES[bed.cropId] : 'Empty'}${bed.taskTitle ? ` · ${bed.taskTitle}` : ''}`;
}

function Drop({ x = 0, y = 0, size = 14 }: { x?: number; y?: number; size?: number }) {
  return <svg x={x} y={y} width={size} height={size} viewBox="0 0 16 20" aria-hidden="true">
    <path d="M6 0H10V4H12V7H14V11H16V16H13V19H3V16H0V11H2V7H4V4H6Z" fill="#203D32" />
    <path d="M6 5H10V9H12V12H13V15H10V17H5V15H3V12H5V9H6Z" fill="#BDE4F0" />
  </svg>;
}

/** Farm geometry stays fixed while small-bed labels can use clear surrounding ground. */
export function FarmBedLayer({ beds, pixelsPerUnit, selectedSlotId, onSelectSlot, CropSpriteComponent, background }: FarmBedLayerProps) {
  const id = useId().replaceAll(':', '');
  const scale = Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? pixelsPerUnit : 1;
  const plan = useMemo(() => planBedAnnotations(beds.map(bed => ({
    slotId: bed.slotId,
    points: bed.points,
    label: bed.label,
    hasTask: Boolean(bed.taskTitle),
    empty: bed.cropId === null,
  })), pixelsPerUnit), [beds, pixelsPerUnit]);
  const plannedBeds = new Map(plan.beds.map(bed => [bed.slotId, bed]));
  // Keep an identifier available even if a future planner cannot place a callout.
  const legend = beds.filter(bed => !plannedBeds.get(bed.slotId)?.annotation);

  return <>
    <div className="of-farm-canvas">
      {background}
      <svg className="of-bed-layer" viewBox="0 0 800 520" aria-label="Your planting beds">
        <defs>
          <pattern id={`${id}-soil`} width="18" height="28" patternUnits="userSpaceOnUse">
            <rect width="18" height="28" fill="#A96545" />
            <path d="M0 3H18V9H0Z" fill="#CB8A5E" />
            <path d="M0 22H18V27H0Z" fill="#8E553E" />
          </pattern>
          {beds.map(bed => <clipPath key={bed.slotId} id={`${id}-clip-${bed.slotId}`}>
            <polygon points={bed.points.map(point => `${point.x},${point.y}`).join(' ')} />
          </clipPath>)}
        </defs>
        {beds.map(bed => {
          const content = plannedBeds.get(bed.slotId);
          const annotation = content?.annotation;
          const selected = bed.slotId === selectedSlotId;
          const cropId = bed.cropId;
          const points = bed.points.map(point => `${point.x},${point.y}`).join(' ');
          const mode = annotation ? content?.external ? 'callout' : annotation.mode === 'compact' ? 'compact' : 'id' : 'legend';
          return <g
            key={bed.slotId}
            className={`of-bed-shape${bed.taskTitle ? ' of-bed-needs-care' : ''}${selected ? ' of-bed-shape-selected' : ''}`}
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
            <polygon className="of-bed-ground" points={points} fill={`url(#${id}-soil)`} stroke="#203D32" strokeWidth="5" strokeLinejoin="round" />
            <g clipPath={`url(#${id}-clip-${bed.slotId})`} pointerEvents="none" aria-hidden="true">
              {cropId && content?.crops.map((crop, index) => <g key={index} data-testid={`bed-crop-${bed.slotId}-${index}`} data-bed-id={bed.slotId} transform={`translate(${crop.x} ${crop.y})`}>
                <CropSpriteComponent cropId={cropId} size={crop.width} />
              </g>)}
            </g>
            <polygon className="of-bed-selection" points={points} fill="none" stroke="#FFF8E8" strokeWidth="3" strokeLinejoin="round" pointerEvents="none" />
          </g>;
        })}
        {beds.map(bed => {
          const content = plannedBeds.get(bed.slotId);
          if (!content?.annotation) return null;
          const badge = content.annotation;
          const external = content.external;
          const selected = bed.slotId === selectedSlotId;
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
              <rect
                data-testid={`bed-annotation-box-${bed.slotId}`}
                x={badge.x} y={badge.y} width={badge.width} height={badge.height}
                rx={2 / scale}
                fill={bed.taskTitle ? '#F4C95D' : '#FFF8E8'}
                stroke={selected && external ? '#286B45' : '#203D32'}
                strokeWidth={selected && external ? 2 : 1.2}
                vectorEffect="non-scaling-stroke"
              />
              <text
                className="of-bed-badge-text"
                x={badge.showTask ? badge.x + badge.fontSize * .55 : badge.x + badge.width / 2}
                y={badge.y + badge.height / 2}
                textAnchor={badge.showTask ? 'start' : 'middle'}
                dominantBaseline="central"
                style={{ fontSize: badge.fontSize }}
              >{bed.label}</text>
              {badge.showTask && <Drop x={badge.x + badge.width - badge.fontSize * 1.7} y={badge.y + (badge.height - badge.fontSize * 1.15) / 2} size={badge.fontSize * 1.15} />}
            </g>
          </g>;
        })}
      </svg>
    </div>
    {legend.length > 0 && <div className="of-bed-legend" aria-label="Small bed identifiers">
      <div className="of-bed-legend-heading"><strong>Small beds</strong><span>Select a letter to highlight its bed.</span></div>
      <div className="of-bed-legend-items">
        {legend.map(bed => <button
          key={bed.slotId}
          type="button"
          className={bed.taskTitle ? 'of-bed-legend-needs-care' : undefined}
          data-testid={`bed-legend-${bed.slotId}`}
          aria-label={`Select ${description(bed)}`}
          aria-pressed={bed.slotId === selectedSlotId}
          title={description(bed)}
          onClick={() => onSelectSlot(bed.slotId)}
        ><span>{bed.label}</span>{bed.taskTitle && <Drop size={14} />}</button>)}
      </div>
    </div>}
  </>;
}
