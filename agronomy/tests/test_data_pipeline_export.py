"""The original point pipeline must retain computed extreme-day counts in export."""
import unittest

import pandas as pd
from data_pipeline import aggregate_annual, POWER_PARAMETERS


class AnnualExportTests(unittest.TestCase):
    def test_extreme_days_survive_output_column_selection(self):
        days = pd.date_range('2024-01-01', '2024-12-31')
        frame = pd.DataFrame(1.0, index=days, columns=list(POWER_PARAMETERS))
        frame['T2M_MIN'] = 10.0
        frame['T2M_MAX'] = 20.0
        frame.loc[days[0], 'T2M_MIN'] = -1.0
        frame.loc[days[1], 'T2M_MAX'] = 36.0
        soil = {'soil_ph': 6.5, 'soil_type': 'loam', 'soil_organic_carbon_g_kg': 10.0}
        annual, _ = aggregate_annual(frame, [2024], soil)
        self.assertIn('extreme_temperature_days', annual.columns)
        self.assertEqual(annual.loc[2024, 'extreme_temperature_days'], 2)
        frame.loc[days[2], 'T2M_MIN'] = float('nan')
        annual, _ = aggregate_annual(frame, [2024], soil)
        self.assertTrue(pd.isna(annual.loc[2024, 'extreme_temperature_days']))
