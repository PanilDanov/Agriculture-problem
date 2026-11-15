# Mapping field and regional predictors

The original data-engineering CSV contains annual aggregates for a point at 42.0, -93.5. `data_pipeline.py` retrieves NASA POWER AG/LST daily values and exports annual data, coverage and provenance. The earlier export omitted `extreme_temperature_days`; the integrated pipeline retains that computed column. The `agronomy` collector separately provides daily weather including pressure, wind and dew point. Regional models were trained on 0.1° AgERA5 aggregated over administrative regions and crop masks. NASA POWER point requests represent a grid cell; spatial and temporal support depend on its product. [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [Copernicus AgERA5](https://cds.climate.copernicus.eu/datasets/sis-agrometeorological-indicators?tab=overview) · [CY-Bench 1.10](https://zenodo.org/records/17279151).

## Calendar, spatial identifiers and soil

| ML field | Type and units | Annual CSV | Available information and required preparation |
| --- | --- | --- | --- |
| `harvest_year` | int, harvest year | `year` is a calendar year | Use the season-end year and reconcile it with the yield label. |
| `season_start`, `season_end` | ISO dates | Absent | Field calendars provide FAO, Sacks and GGCMI candidates. Supply selected dates and `available_on` for current and historical regional seasons. |
| `season_days` | int, days | Absent | `end - start + 1`, inclusive. |
| `country_code` | string, CY-Bench code | Absent | Map the region to a supported code; Natural Earth Admin 0 provides a country candidate. |
| `adm_id` | string, regional ID | Absent | Match CY-Bench boundary version and the yield-statistics level. |
| `latitude`, `longitude` | float, WGS84 degrees | Point coordinates occur in the filename | Supply the region centroid and retain field coordinates separately. |
| `climate_seasons`, `climate_through` | int and ISO date | Absent | Count covered historical seasons and the last accepted observation. Supply daily history and calendars for the preceding seven years. |
| `mid_weather_through`, `mid_weather_coverage` | ISO date and fraction 0-1 | Absent | Latest complete day and complete-day count divided by the eligible current-season window. |
| `awc` | float, CY-Bench WISE scale | Absent | Use the WISE regional aggregate. SoilGrids retention at different pressures/depths can describe layer water capacity, but requires explicit depth, pressure and cross-product calibration. |
| `bulk_density` | float, kg/dm³ | Absent | Use WISE regional support. SoilGrids `bdod` converts cg/cm³ to kg/dm³ by dividing by 100; align depth and validate products. |
| `regional_median_t_ha`, `regional_recent_t_ha`, `regional_history_count` | float t/ha, float t/ha, int | Absent | Updating history requires regional labels, harvest years and publication dates. The package derives these from frozen history; cold-start omits them. |

pH, SOC, texture, RH2M, SFMC and RZMC are not predictors in the current regional models. SOC in g/kg converts to mass percent by dividing by 10; this does not create AWC. [SoilGrids units](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html).

## Weather predictors

Each suffix below corresponds to numeric `climate_<suffix>` and `mid_<suffix>` predictors. Their spatial support is the administrative crop-mask aggregate, with daily input resolution. For `climate_`, calculate each completed historical season first, then average across seasons. For `mid_`, calculate from current season start through midpoint minus 14 days.

| Suffix | Formula and units | Relationship to annual CSV and NASA POWER | Required ML input |
| --- | --- | --- | --- |
| `temperature_c` | Mean daily Tavg, °C | `average_air_temperature_c`, `T2M` | Daily AgERA5 Tavg; Kelvin input is converted by subtracting 273.15. |
| `min_temperature_c` | Minimum daily Tmin, °C | `min_air_temperature_c`, `T2M_MIN` | Daily AgERA5 Tmin. |
| `max_temperature_c` | Maximum daily Tmax, °C | `max_air_temperature_c`, `T2M_MAX` | Daily AgERA5 Tmax. |
| `temperature_sd_c` | Population SD of daily Tavg, °C | Not recoverable from an annual mean; dated `T2M` can support calculation | Daily AgERA5 Tavg. |
| `precipitation_mm` | Sum daily precipitation, mm | `precipitation_mm`; daily `PRECTOTCORR` | AgERA5 precipitation flux, mm/day. |
| `precipitation_mm_day` | Sum / complete days, mm/day | Dividing the annual total produces a different window | The same daily precipitation. |
| `radiation_mj_m2_day` | Mean daily radiation, MJ/m²/day | `solar_radiation_mj_m2_day`, `ALLSKY_SFC_SW_DWN` | AgERA5 J/m²/day divided by 10⁶, or explicitly supplied MJ units. |
| `et0_mm` | Sum daily grass-reference ET₀, mm | Absent from CSV; field API derives FAO-56 from several POWER parameters | AgERA5 reference ET₀, independently compared with the field calculation. |
| `vpd_kpa` | Mean daily VPD at Tmax, kPa | Absent from CSV; mean RH and mean T are insufficient | AgERA5 VPD at Tmax, hPa divided by 10. |
| `water_balance_mm` | Sum daily precipitation minus ET₀, mm | Annual ET₀ is absent; `waterScreenMm` is a different calculation | Daily CWB from compatible precipitation and ET₀. |
| `hot_days` | Count Tmax >=35°C | Earlier combined annual counter; daily Tmax supports reconstruction | AgERA5 Tmax. |
| `frost_days` | Count Tmin <0°C | Earlier combined annual counter; daily Tmin supports reconstruction | AgERA5 Tmin. |
| `dry_days` | Count precipitation <1 mm | Absent; derivable from daily rain | AgERA5 precipitation flux. |
| `climate_precipitation_sd_mm` | Sample SD of seasonal rain totals, mm | Annual totals use different intervals | Daily rain covering at least two completed seasons. |
| `climate_temperature_interannual_sd_c` | Sample SD of seasonal Tavg means, °C | Annual means use different intervals | Daily Tavg covering at least two completed seasons. |

The original annual table directly supports unit and quality checks. Regional inference additionally needs verified geometry/IDs, yearly calendars and publication dates, crop-mask AgERA5, complete ET₀/VPD/CWB inputs and compatible optional WISE predictors. [Data contract and integration sequence](data_engineer_contract.md).
