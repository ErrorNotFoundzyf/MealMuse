import type { Season } from '../types';

export function seasonForMonth(month: number): Exclude<Season, 'all_year'> {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError('月份应为 1 至 12');
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function seasonStatus(seasons: Season[], current: Exclude<Season, 'all_year'>): 'in_season' | 'out_of_season' | 'season_unknown' {
  if (!seasons.length) return 'season_unknown';
  return seasons.includes('all_year') || seasons.includes(current) ? 'in_season' : 'out_of_season';
}
