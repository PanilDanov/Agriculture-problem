# Model limitations

- The target is average yield in an administrative region. Field-level and farm-level errors are unknown. Applications should use boundaries and IDs at the corresponding administrative level.
- CY-Bench crop calendars and crop masks are static and retrospective. The information available at each historical forecast date is uncertain. Actual annual sowing dates for individual regions are unavailable to the model.
- National yield publication dates use a July 1 proxy in the year after harvest. The earliest forecast date in each split limits its entire training set. Archived publication dates would be needed to confirm when each historical label was available.
- The recent holdout covers three countries per crop. Forecasts for new countries include a warning. Leave-one-country-out evaluation trains separate models using climate and soil without yield labels from the excluded country. That test measures transfer to a new country. The temporal holdout measures later seasons in familiar regions.
- Inference uses the yield history frozen at the test origin. Updating that history for recent seasons requires retraining on published yield observations. The input contract checks dates, scales, and broad physical bounds. The integrator verifies the underlying observations.
- Prediction intervals were estimated from absolute errors in year blocks and checked on later observations. The small number of seasons and spatial dependence limit calibration. The API returns a point estimate.
- The next evaluation would benefit from recent seasons in more countries, actual publication dates, consistent annual crop calendars, and measured irrigation information. Comparable satellite time series with known publication delays may help the mid-season forecast.
