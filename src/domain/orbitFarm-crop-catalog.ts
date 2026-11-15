import type { Crop, CropId } from './orbitFarm-types';

export const CROP_IDS = [
  'wheat', 'barley', 'maize', 'sorghum', 'chickpea',
  'lentil', 'faba-bean', 'sunflower', 'potato', 'tomato',
] as const;

// Reference schedules and planting methods are documented in docs/orbitFarm-crop-catalog.md.
export const CROP_PROFILES: Record<CropId, Omit<Crop, 'id'>> = {
  wheat: {
    name: 'Wheat', daysToGrowing: 20, daysToHarvest: 135, color: '#e9bb51',
    description: 'Golden grain for your next season. Illustrative demo crop profile.',
  },
  barley: {
    name: 'Barley', daysToGrowing: 21, daysToHarvest: 115, color: '#d6b45c',
    description: 'A grain for your planting layout. Illustrative demo growth duration.',
  },
  maize: {
    name: 'Maize', daysToGrowing: 30, daysToHarvest: 150, color: '#e7bc43',
    description: 'A tall grain for your planting layout. Illustrative demo growth duration.',
  },
  sorghum: {
    name: 'Sorghum', daysToGrowing: 20, daysToHarvest: 125, color: '#c78054',
    description: 'A grain option in the water-saving demo. Illustrative demo crop profile.',
  },
  chickpea: {
    name: 'Chickpea', daysToGrowing: 20, daysToHarvest: 100, color: '#79a861',
    description: 'A legume to explore in a diverse rotation. Illustrative demo crop profile.',
  },
  lentil: {
    name: 'Lentil', daysToGrowing: 25, daysToHarvest: 160, color: '#8aab67',
    description: 'A legume for your planting layout. Illustrative demo growth duration.',
  },
  'faba-bean': {
    name: 'Faba bean', daysToGrowing: 20, daysToHarvest: 105, color: '#71975a',
    description: 'A legume for your planting layout. Illustrative demo growth duration.',
  },
  sunflower: {
    name: 'Sunflower', daysToGrowing: 25, daysToHarvest: 130, color: '#edbb42',
    description: 'A bright flower for your planting layout. Illustrative demo growth duration.',
  },
  potato: {
    name: 'Potato', daysToGrowing: 30, daysToHarvest: 130, color: '#ac8a63',
    description: 'A tuber crop for your planting layout. Illustrative demo growth duration.',
  },
  tomato: {
    name: 'Open-field tomato', daysToGrowing: 15, daysToHarvest: 75, color: '#d36f4e',
    description: 'An open-field crop for your planting layout. Illustrative demo growth duration.',
  },
};

export const CROP_CATALOG: Crop[] = CROP_IDS.map(id => ({ id, ...CROP_PROFILES[id] }));
