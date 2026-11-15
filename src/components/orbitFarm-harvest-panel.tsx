import { useEffect, useState } from 'react';
import { CalendarDays, CheckCheck, Wheat } from 'lucide-react';
import { dateSchema, getEstimatedHarvestDate, getGrowthStage } from '../domain/orbitFarm-domain';
import type { Plot } from '../domain/orbitFarm-types';

export function HarvestPanel({ plot, viewDate, today, nextCropName, onHarvest }: {
  plot: Plot;
  viewDate: string;
  today: string;
  nextCropName?: string;
  onHarvest: (harvestedOn: string) => void;
}) {
  const [harvestedOn, setHarvestedOn] = useState(viewDate);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setHarvestedOn(viewDate); setError(null); }, [viewDate, plot.id]);
  const planned = harvestedOn > today;
  return <form className="harvest-panel" data-testid="harvest-panel" onSubmit={event => {
    event.preventDefault();
    if (!dateSchema.safeParse(harvestedOn).success) { setError('Choose a valid harvest date.'); return; }
    if (getGrowthStage(plot, harvestedOn) !== 'Ready to harvest') { setError('Choose a date on or after the estimated harvest.'); return; }
    setError(null);
    onHarvest(harvestedOn);
  }}>
    <strong><Wheat size={18} />Ready for harvest</strong>
    <p>Save this harvest and free the bed{nextCropName ? ` for ${nextCropName}` : ' for its next crop'}.</p>
    <label>Harvest date<input type="date" min={getEstimatedHarvestDate(plot)} value={harvestedOn} onChange={event => { setHarvestedOn(event.target.value); setError(null); }} /></label>
    <p className="harvest-date-note"><CalendarDays size={14} /><span>{planned ? 'A future date saves a planned harvest. You can plant the next crop on your timeline.' : 'Record this date after checking that your crop is ready in the field.'}</span></p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button type="submit" className="button primary full-width"><CheckCheck size={17} />Harvest crop</button>
  </form>;
}
