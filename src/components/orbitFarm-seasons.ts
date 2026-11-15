import { daysBetweenFarmDates } from '../domain/orbitFarm-model';

export const FARM_SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;

export type FarmSeason = typeof FARM_SEASONS[number];
export type SeasonBlend = Record<FarmSeason, number>;

const SEASON_ANCHORS: Record<FarmSeason, string> = {
  winter: '01-15',
  spring: '04-15',
  summer: '07-15',
  autumn: '10-15',
};
const SEASON_HOLD_DAYS = 16;

export function getFarmSeasonStops(start: string, end: string, today: string) {
  const currentYear = Number(today.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  const stops: Array<{ season: FarmSeason; date: string }> = [];
  for (const season of FARM_SEASONS) {
    const inYear = (year: number) => String(year).padStart(4, '0') + '-' + SEASON_ANCHORS[season];
    // Keep the shortcuts on one upcoming cycle even while the preview date moves.
    let year = currentYear + (inYear(currentYear) < today ? 1 : 0);
    if (year > lastYear || inYear(year) > end) year--;
    const date = inYear(year);
    if (year >= 0 && date >= start && date <= end) stops.push({ season, date });
  }
  return stops.sort((a, b) => a.date.localeCompare(b.date));
}

export function getFarmSeasonBlend(date: string): SeasonBlend {
  const year = date.slice(0, 4);
  const dates = FARM_SEASONS.map(season => year + '-' + SEASON_ANCHORS[season]);
  const winter: SeasonBlend = { winter: 1, spring: 0, summer: 0, autumn: 0 };
  if (date <= dates[0]) return winter;

  const next = dates.findIndex(anchor => anchor > date);
  const from = next === -1 ? FARM_SEASONS.length - 1 : next - 1;
  const start = dates[from];
  const span = next === -1
    ? daysBetweenFarmDates(start, `${year}-12-31`) + Number(SEASON_ANCHORS.winter.slice(3))
    : daysBetweenFarmDates(start, dates[next]);
  const elapsed = daysBetweenFarmDates(start, date);
  const progress = Math.max(0, Math.min(1, (elapsed - SEASON_HOLD_DAYS) / (span - 2 * SEASON_HOLD_DAYS)));
  const blend = progress * progress * (3 - 2 * progress);
  return {
    winter: 0,
    spring: 0,
    summer: 0,
    autumn: 0,
    [FARM_SEASONS[from]]: 1 - blend,
    [FARM_SEASONS[(from + 1) % FARM_SEASONS.length]]: blend,
  };
}
