"""Render EDA, held-out residual plots and diagnostic summaries from saved runs."""

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from yield_prediction.features import KEY, MODE_FEATURES, TARGET
from yield_prediction.validation import eligible, read_prepared, score

ROOT = Path(__file__).resolve().parent
MODES = list(MODE_FEATURES)
CROPS = ["maize", "wheat"]
COLORS = {"maize": "#246e55", "wheat": "#a75b18"}


def save(fig, directory, name):
    fig.savefig(directory / f"{name}.png", dpi=150, bbox_inches="tight")
    plt.close(fig)


def plot_eda(data, directory):
    fig, axes = plt.subplots(1, 2, figsize=(11, 3.6), constrained_layout=True)
    for crop, subset in data.groupby("crop"):
        axes[0].hist(subset[TARGET], bins=np.linspace(0, 35, 48), alpha=0.65, color=COLORS[crop], label=crop)
        trend = subset.groupby("harvest_year")[TARGET].median()
        axes[1].plot(trend, label=crop, color=COLORS[crop])
    axes[0].set(xlabel="Observed yield (t/ha)", ylabel="Regional seasons", title="Yield distribution")
    axes[1].set(xlabel="Harvest year", ylabel="Median observed yield (t/ha)", title="Changing coverage by year")
    for ax in axes:
        ax.legend()
    save(fig, directory, "yield_eda")
    fig, ax = plt.subplots(figsize=(10, 6.8), constrained_layout=True)
    features = list(dict.fromkeys(MODE_FEATURES["mid_season"]))
    missing = data.groupby("crop")[features].agg(lambda x: x.isna().mean() * 100).T
    missing.loc[missing.max(axis=1).gt(0)].sort_values("maize").plot.barh(ax=ax, color=list(COLORS.values()))
    ax.set(xlabel="Missing observations (%)", title="Missingness before mode eligibility filtering")
    save(fig, directory, "missingness")


def plot_diagnostics(runs, output, directory):
    fig, axes = plt.subplots(4, 2, figsize=(10, 13), constrained_layout=True)
    for axes_row, ((crop, mode), run) in zip(axes, runs.items()):
        table = pd.read_csv(output / "predictions" / f"{crop}_{mode}.csv")
        x, y = table[TARGET], table.predicted_yield_t_ha
        left, right = axes_row
        lim = [min(x.min(), y.min()), max(x.max(), y.max())]
        left.scatter(x, y, s=12, alpha=0.5, color=COLORS[crop])
        left.plot(lim, lim, color="#575757", lw=1)
        left.set(xlabel="Observed (t/ha)", ylabel="Predicted (t/ha)", title=f"{crop} · {mode}")
        right.hist(y - x, bins=24, color=COLORS[crop], alpha=0.8)
        right.axvline(0, color="#333333", linewidth=1)
        right.set(xlabel="Predicted − observed (t/ha)", ylabel="Regional seasons", title="Residuals")
    save(fig, directory, "heldout_predictions")

    fig, axes = plt.subplots(1, 2, figsize=(11, 3.7), constrained_layout=True)
    for ax, mode in zip(axes, MODES):
        for crop in CROPS:
            points = pd.DataFrame(runs[(crop, mode)]["learning_curve"])
            if len(points):
                ax.plot(points.training_size, points.mae_t_ha, "o-", color=COLORS[crop], label=crop)
        ax.set(xlabel="Training rows", ylabel="Test MAE (t/ha)", title=mode)
        ax.legend()
    save(fig, directory, "learning_curves")

    fig, axes = plt.subplots(2, 2, figsize=(11, 9), constrained_layout=True)
    for ax, ((crop, mode), run) in zip(axes.flat, runs.items()):
        values = pd.DataFrame(run["permutation_importance"][:8])
        if len(values):
            values.sort_values("mae_increase_t_ha").plot.barh(
                x="feature", y="mae_increase_t_ha", ax=ax, color=COLORS[crop], legend=False)
        ax.set(xlabel="MAE increase (t/ha)", ylabel="", title=f"{crop} · {mode}")
    save(fig, directory, "permutation_importance")

    fig, axes = plt.subplots(2, 2, figsize=(11, 9), constrained_layout=True)
    for ax, ((crop, mode), run) in zip(axes.flat, runs.items()):
        values = pd.DataFrame(run["loco"])
        if len(values):
            matrix = values.pivot(index="country_code", columns="model", values="mae_t_ha")
            matrix.plot.bar(ax=ax, rot=0, width=0.8, fontsize=7)
        ax.set(xlabel="", ylabel="MAE (t/ha)", title=f"{crop} · {mode}")
    save(fig, directory, "leave_one_country_out")

    groups = []
    for (crop, mode), run in runs.items():
        for group in ("country_code", "harvest_year"):
            groups += [{"crop": crop, "mode": mode, "group": group, "value": row[group], **row}
                       for row in run["groups"][group]]
        groups.append({"crop": crop, "mode": mode, "group": "crop", "value": crop, **run["metadata"]["test"]})
    frame = pd.DataFrame(groups)
    frame[["crop", "mode", "group", "value", "n", "mae_t_ha", "rmse_t_ha", "r2", "bias_t_ha"]].to_csv(
        output / "metrics" / "heldout_groups.csv", index=False)
    fig, axes = plt.subplots(1, 3, figsize=(14, 4), constrained_layout=True)
    for ax, group in zip(axes, ("country_code", "harvest_year", "crop")):
        matrix = frame.loc[frame.group.eq(group)].assign(series=lambda f: f.crop + " " + f["mode"]).pivot(
            index="value", columns="series", values="mae_t_ha")
        matrix.plot.bar(ax=ax, rot=0, title=f"MAE by {group}", legend=group == "crop")
        ax.set(xlabel="", ylabel="MAE (t/ha)")
    save(fig, directory, "heldout_mae")


def summarize_data(data, directory, manifest):
    rows = []
    for crop, subset in data.groupby("crop"):
        for country, group in subset.groupby("country_code"):
            rows.append({"crop": crop, "country_code": country, "n": len(group),
                         "regions": group.adm_id.nunique(), "first": group.harvest_year.min(),
                         "last": group.harvest_year.max(), "median_yield": group[TARGET].median(),
                         "median_climate_precip_mm": group.climate_precipitation_mm.median(),
                         "median_climate_temp_c": group.climate_temperature_c.median(),
                         **{f"{mode}_rows": len(eligible(group, mode)) for mode in MODES}})
    pd.DataFrame(rows).to_csv(directory / "data_by_country.csv", index=False)
    data.groupby("crop")[MODE_FEATURES["mid_season"]].agg(lambda x: int(x.isna().sum())).T.to_csv(
        directory / "data_missingness.csv")
    (directory / "data_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def summarize_experiments(runs, directory):
    test_rows, val_rows = [], []
    for (crop, mode), report in runs.items():
        selected = report["metadata"]["selected_model"]
        for row in report["test"]:
            test_rows.append({"crop": crop, "mode": mode, "selected": row["name"] == selected, **row})
        for row in report["validation"]:
            spec = row["spec"]
            val_rows.append({"crop": crop, "mode": mode, "name": spec["name"], "selected": spec["name"] == selected,
                             **{key: value for key, value in row.items() if key.startswith("validation_")},
                             "mean_fit_seconds": np.mean([f["fit_seconds"] for f in row["folds"]]),
                             "last_fit_rows": row["folds"][-1]["n_fit"],
                             "features": row["folds"][-1]["feature_count"],
                             "parameters": json.dumps(spec, ensure_ascii=False)})
    pd.DataFrame(test_rows).to_csv(directory / "test_comparison.csv", index=False)
    pd.DataFrame(val_rows).to_csv(directory / "validation_comparison.csv", index=False)


def compare_common_rows(output):
    """Compare the two forecast dates on the intersection of evaluation rows."""
    results = []
    for crop in CROPS:
        pre, mid = [
            pd.read_csv(output / "predictions" / f"{crop}_{mode}.csv", dtype={"adm_id": str})
            for mode in MODES
        ]
        shared = pre.merge(mid[KEY + ["predicted_yield_t_ha"]], on=KEY, validate="one_to_one",
                           suffixes=("_pre", "_mid"))
        for mode, suffix in zip(MODES, ["pre", "mid"]):
            results.append({"crop": crop, "mode": mode,
                            **score(shared[TARGET], shared[f"predicted_yield_t_ha_{suffix}"])})
    pd.DataFrame(results).to_csv(output / "metrics" / "paired_modes.csv", index=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "data/processed/zenodo.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--eda-only", action="store_true")
    args = parser.parse_args()
    data = read_prepared(args.dataset)
    figures = args.output / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    metrics = args.output / "metrics"
    metrics.mkdir(parents=True, exist_ok=True)
    summarize_data(data, metrics, json.loads(args.dataset.with_suffix(".json").read_text(encoding="utf-8")))
    plot_eda(data, figures)
    if not args.eda_only:
        runs = {(crop, mode): json.loads((metrics / f"{crop}_{mode}.json").read_text(encoding="utf-8"))
                for mode in MODES for crop in CROPS}
        summarize_experiments(runs, metrics)
        plot_diagnostics(runs, args.output, figures)
        compare_common_rows(args.output)


if __name__ == "__main__":
    main()
