"""Bounded seeded Optuna search on chronological validation folds."""

import optuna


def parameters(trial, family):
    if family == "ridge":
        return {"alpha": trial.suggest_float("alpha", 0.3, 250, log=True)}
    common = {"learning_rate": trial.suggest_float("learning_rate", 0.025, 0.12, log=True)}
    if family == "hist":
        return {**common, "max_iter": trial.suggest_int("max_iter", 100, 280, step=60),
                "max_leaf_nodes": trial.suggest_int("max_leaf_nodes", 7, 31, step=8),
                "l2_regularization": trial.suggest_float("l2_regularization", 0.5, 25, log=True)}
    if family == "cat":
        return {**common, "iterations": trial.suggest_int("iterations", 180, 420, step=80),
                "depth": trial.suggest_int("depth", 4, 8), "l2_leaf_reg": trial.suggest_float(
                    "l2_leaf_reg", 2, 30, log=True)}
    subsample = trial.suggest_float("subsample", 0.7, 1.0)
    return {**common, "subsample": subsample,
            "n_estimators": trial.suggest_int("n_estimators", 150, 390, step=80),
            "max_depth": trial.suggest_int("max_depth", 3, 8),
            "reg_lambda": trial.suggest_float("reg_lambda", 0.5, 25, log=True)}


def tune(spec, seed, count, evaluate):
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(sampler=optuna.samplers.TPESampler(seed=seed, n_startup_trials=2))

    def objective(trial):
        candidate = {**spec, "name": f"{spec['name']}_trial_{trial.number}",
                     "params": parameters(trial, spec["family"])}
        return evaluate(candidate)["validation_mae_t_ha"]

    study.optimize(objective, n_trials=count, n_jobs=1)
