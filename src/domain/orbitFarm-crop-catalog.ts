import type { Crop } from './orbitFarm-types';

export const CROP_IDS = [
  'wheat', 'barley', 'maize', 'sorghum', 'chickpea',
  'lentil', 'faba-bean', 'sunflower', 'potato', 'tomato',
] as const;

// Growth durations are illustrative UI fixtures, not validated crop predictions.
// The seven newly plantable crops use the existing 120-day demo fallback.
export const CROP_CATALOG: Crop[] = [
  { id: 'wheat', name: 'Wheat', daysToHarvest: 130, color: '#e9bb51', description: 'Golden grain for your next season. Illustrative demo crop profile.' },
  { id: 'barley', name: 'Barley', daysToHarvest: 120, color: '#d6b45c', description: 'A grain for your planting layout. Illustrative demo growth duration.' },
  { id: 'maize', name: 'Maize', daysToHarvest: 120, color: '#e7bc43', description: 'A tall grain for your planting layout. Illustrative demo growth duration.' },
  { id: 'sorghum', name: 'Sorghum', daysToHarvest: 105, color: '#c78054', description: 'A grain option in the water-saving demo. Illustrative demo crop profile.' },
  { id: 'chickpea', name: 'Chickpea', daysToHarvest: 110, color: '#79a861', description: 'A legume to explore in a diverse rotation. Illustrative demo crop profile.' },
  { id: 'lentil', name: 'Lentil', daysToHarvest: 120, color: '#8aab67', description: 'A legume for your planting layout. Illustrative demo growth duration.' },
  { id: 'faba-bean', name: 'Faba bean', daysToHarvest: 120, color: '#71975a', description: 'A legume for your planting layout. Illustrative demo growth duration.' },
  { id: 'sunflower', name: 'Sunflower', daysToHarvest: 120, color: '#edbb42', description: 'A bright flower for your planting layout. Illustrative demo growth duration.' },
  { id: 'potato', name: 'Potato', daysToHarvest: 120, color: '#ac8a63', description: 'A tuber crop for your planting layout. Illustrative demo growth duration.' },
  { id: 'tomato', name: 'Open-field tomato', daysToHarvest: 120, color: '#d36f4e', description: 'An open-field crop for your planting layout. Illustrative demo growth duration.' },
];
