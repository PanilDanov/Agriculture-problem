import { ArrowRight, Check, Leaf } from 'lucide-react';
import { CROP_CATALOG, getBedPlanProgress, getGrowthStage } from '../domain/orbitFarm-domain';
import type { CropId, FarmState } from '../domain/orbitFarm-types';
import { CropSprite } from './orbitFarm-crop-sprite';
import './orbitFarm-rotation-guide.css';

const cropName = (id: CropId) => CROP_CATALOG.find(crop => crop.id === id)?.name ?? id;

export function RotationGuide({ state, slotId, viewDate = state.demoToday, onCompare }: {
  state: FarmState;
  slotId: number;
  viewDate?: string;
  onCompare?: () => void;
}) {
  const progress = getBedPlanProgress(state, slotId, viewDate);
  if (!progress) return null;
  const { plan, completedSeasons, seasonIndex, status, currentPlot } = progress;
  return <section className={`rotation-guide rotation-guide--${status}`} aria-label="Active rotation plan" data-testid="rotation-guide">
    <div className="rotation-guide-heading"><span><Leaf size={14} />Active plan</span><span>{completedSeasons}/2 harvested</span></div>
    <h4>{plan.name}</h4>
    <ol className="rotation-guide-steps">
      {plan.sequence.map((cropId, index) => {
        const done = index < completedSeasons;
        const active = index === seasonIndex;
        return <li key={index} className={done ? 'is-complete' : active ? 'is-current' : ''} aria-current={active ? 'step' : undefined}>
          <span className="rotation-step-icon">{done ? <Check size={18} /> : <CropSprite cropId={cropId} size={30} />}</span>
          <span><small>Season {index + 1}</small><strong>{cropName(cropId)}</strong><small>{done ? 'Harvested' : active ? status === 'growing' && currentPlot ? getGrowthStage(currentPlot, viewDate) === 'Planned' ? 'Planned' : 'Planted' : 'Plant next' : 'After harvest'}</small></span>
          {index === 0 && <ArrowRight className="rotation-step-arrow" size={14} aria-hidden="true" />}
        </li>;
      })}
    </ol>
    <p>{status === 'complete' ? 'Both seasons are complete. Analyze your field for a new plan.'
      : status === 'off-plan' && currentPlot ? `${cropName(currentPlot.cropId)} is outside this plan. Harvesting it will keep your next planned season unchanged.`
      : status === 'growing' ? 'Record the harvest here when the crop is ready to move to the next season.'
      : completedSeasons > 0 ? 'Harvest saved. Your next crop is ready to plan.'
      : 'Your planting choices follow this sequence, one harvest at a time.'}</p>
    {plan.planStatus === 'provisional' && <span className="rotation-guide-provisional">Provisional · check the plan details before planting</span>}
    {onCompare && <button type="button" className="text-button" onClick={onCompare}>Change plan <ArrowRight size={13} /></button>}
  </section>;
}
