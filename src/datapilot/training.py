"""Leakage-safe model training for the TRAIN operation.

Design:

* Supervised tasks hold out a test set first (stratified when possible).
  Imputation, scaling and one-hot encoding live inside a scikit-learn
  ``Pipeline`` so they are fitted on training rows only — during the final
  fit and inside every cross-validation fold.
* Optional k-fold cross-validation runs on (a bounded sample of) the training
  set only. The best model is the one with the highest held-out test score
  for the primary metric (``f1_weighted`` / ``r2``); the model card notes that
  selecting on the test set makes that score slightly optimistic.
* Cost is bounded for datasets of ~100k rows × 200 columns: slow algorithms
  are skipped above a row limit, CV and permutation importance use samples,
  one-hot encoding is capped per column, plots use samples.
"""

from __future__ import annotations

import importlib
import platform
import time
import warnings
from dataclasses import dataclass, field
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from matplotlib.figure import Figure
from pandas.api.types import is_bool_dtype, is_numeric_dtype
from sklearn.base import clone
from sklearn.decomposition import PCA
from sklearn.exceptions import ConvergenceWarning
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    calinski_harabasz_score,
    confusion_matrix,
    davies_bouldin_score,
    f1_score,
    mean_absolute_error,
    mean_absolute_percentage_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    silhouette_score,
)
from sklearn.model_selection import (
    KFold,
    StratifiedKFold,
    cross_val_score,
    train_test_split,
)
from sklearn.pipeline import Pipeline

from datapilot.artifacts import ArtifactWriter
from datapilot.charts import (
    finish,
    horizontal_bars,
    matrix_heatmap,
    new_figure,
    style_axes,
)
from datapilot.ml_readiness import (
    _build_preprocessor,
    _to_numpy_dtypes,
    inspect_target,
)
from datapilot.operations import column_kinds
from datapilot.params import Params
from datapilot.pipeline_generator import generate_training_script
from datapilot.reports import _json_safe, _markdown_table, _timestamp
from datapilot.visualization import (
    CATEGORICAL,
    OTHER_COLOR,
    SURFACE,
    TEXT_SECONDARY,
)

RANDOM_STATE = 42
TASKS = ("classification", "regression", "clustering")
MIN_ROWS = 30
MAX_FEATURES = 200
MAX_CLASSES = 50
MAX_CATEGORIES = 30  # one-hot columns per categorical feature (rest → "infrequent")
SLOW_ALGORITHM_MAX_ROWS = 20_000
AGGLOMERATIVE_MAX_ROWS = 10_000
CV_MAX_ROWS = 10_000
DEFAULT_CV_FOLDS = 5
DENSE_MAX_CELLS = 30_000_000  # ~240 MB of float64
PLOT_SAMPLE = 5_000
SILHOUETTE_SAMPLE = 5_000
ELBOW_SAMPLE = 10_000
ELBOW_K = range(2, 9)
TOP_IMPORTANCE = 20
MAX_FINDINGS = 40


# ---------------------------------------------------------------- registry


@dataclass(frozen=True)
class Algorithm:
    key: str
    label: str
    module: str
    cls: str
    kwargs: dict[str, Any] = field(default_factory=dict)
    dense: bool = False
    max_rows: int | None = None

    def build(self, **overrides: Any) -> Any:
        estimator = getattr(importlib.import_module(self.module), self.cls)
        return estimator(**{**self.kwargs, **overrides})

    def code(self, **overrides: Any) -> tuple[str, str]:
        """The import line and constructor call for the generated script."""
        args = ", ".join(f"{k}={v!r}" for k, v in {**self.kwargs, **overrides}.items())
        return f"from {self.module} import {self.cls}", f"{self.cls}({args})"


def _algo(key, label, module, cls, dense=False, max_rows=None, **kwargs):
    return Algorithm(key, label, module, cls, kwargs, dense, max_rows)


ALGORITHMS: dict[str, dict[str, Algorithm]] = {
    "classification": {
        a.key: a
        for a in (
            _algo("logistic_regression", "Logistic regression",
                  "sklearn.linear_model", "LogisticRegression",
                  max_iter=1000, random_state=RANDOM_STATE),
            _algo("decision_tree", "Decision tree", "sklearn.tree",
                  "DecisionTreeClassifier", min_samples_leaf=5,
                  random_state=RANDOM_STATE),
            _algo("random_forest", "Random forest", "sklearn.ensemble",
                  "RandomForestClassifier", n_estimators=100, min_samples_leaf=3,
                  n_jobs=-1, random_state=RANDOM_STATE),
            _algo("gradient_boosting", "Gradient boosting (histogram)",
                  "sklearn.ensemble", "HistGradientBoostingClassifier",
                  dense=True, random_state=RANDOM_STATE),
            _algo("knn", "k-nearest neighbours", "sklearn.neighbors",
                  "KNeighborsClassifier", max_rows=SLOW_ALGORITHM_MAX_ROWS,
                  n_neighbors=5),
            _algo("svm", "Support vector machine (RBF)", "sklearn.svm", "SVC",
                  max_rows=SLOW_ALGORITHM_MAX_ROWS, kernel="rbf", C=1.0,
                  random_state=RANDOM_STATE),
            _algo("naive_bayes", "Gaussian naive Bayes", "sklearn.naive_bayes",
                  "GaussianNB", dense=True),
        )
    },
    "regression": {
        a.key: a
        for a in (
            _algo("linear_regression", "Linear regression",
                  "sklearn.linear_model", "LinearRegression"),
            _algo("ridge", "Ridge (alpha chosen by CV)", "sklearn.linear_model",
                  "RidgeCV", alphas=[0.01, 0.1, 1.0, 10.0, 100.0]),
            _algo("lasso", "Lasso (alpha chosen by CV)", "sklearn.linear_model",
                  "LassoCV", cv=5, max_iter=5000, random_state=RANDOM_STATE),
            _algo("decision_tree", "Decision tree", "sklearn.tree",
                  "DecisionTreeRegressor", min_samples_leaf=5,
                  random_state=RANDOM_STATE),
            _algo("random_forest", "Random forest", "sklearn.ensemble",
                  "RandomForestRegressor", n_estimators=100, min_samples_leaf=3,
                  max_features="sqrt", n_jobs=-1, random_state=RANDOM_STATE),
            _algo("gradient_boosting", "Gradient boosting (histogram)",
                  "sklearn.ensemble", "HistGradientBoostingRegressor",
                  dense=True, random_state=RANDOM_STATE),
            _algo("knn", "k-nearest neighbours", "sklearn.neighbors",
                  "KNeighborsRegressor", max_rows=SLOW_ALGORITHM_MAX_ROWS,
                  n_neighbors=5),
            _algo("svr", "Support vector regression (RBF)", "sklearn.svm", "SVR",
                  max_rows=SLOW_ALGORITHM_MAX_ROWS, kernel="rbf", C=1.0),
        )
    },
    "clustering": {
        a.key: a
        for a in (
            _algo("kmeans", "k-means", "sklearn.cluster", "KMeans", dense=True,
                  n_init=10, random_state=RANDOM_STATE),
            _algo("agglomerative", "Agglomerative (Ward)", "sklearn.cluster",
                  "AgglomerativeClustering", dense=True,
                  max_rows=AGGLOMERATIVE_MAX_ROWS, linkage="ward"),
            _algo("gaussian_mixture", "Gaussian mixture", "sklearn.mixture",
                  "GaussianMixture", dense=True, random_state=RANDOM_STATE),
        )
    },
}

PRIMARY_METRIC = {
    "classification": "f1_weighted",
    "regression": "r2",
    "clustering": "silhouette",
}


def _finding(kind: str, severity: str, evidence: str, column: str | None = None,
             recommendation: str | None = None) -> dict[str, Any]:
    item = {"type": kind, "severity": severity, "column": column,
            "evidence": evidence}
    if recommendation:
        item["recommendation"] = recommendation
    return item


def _names(columns: list[str], limit: int = 8) -> str:
    shown = ", ".join(columns[:limit])
    return shown + (f" and {len(columns) - limit} more" if len(columns) > limit else "")


# ---------------------------------------------------------------- setup


@dataclass
class TrainConfig:
    task: str
    target: str | None
    algorithms: list[str]
    features: list[str]
    numeric: list[str]
    categorical: list[str]
    test_size: float
    cv_folds: int
    n_clusters: int
    findings: list[dict[str, Any]]
    stratified: bool = False


def _parse(df: pd.DataFrame, raw_params: Any) -> TrainConfig:
    params = Params(raw_params, df)
    task = params.choice("task", TASKS, required=True)
    registry = ALGORITHMS[task]
    target = params.column("target")
    if task == "clustering":
        if target is not None:
            raise ValueError(
                "Clustering does not use a target column; remove 'target' or "
                "choose classification or regression."
            )
    elif target is None:
        raise ValueError(f"'target' is required for {task}: choose the column to predict.")

    algorithms = params.strings("algorithms", registry, max_items=len(registry))
    algorithms = algorithms or list(registry)
    requested = params.columns("features", max_items=MAX_FEATURES)
    test_size = params.number("testSize", 0.2, 0.1, 0.5)
    cv_folds = params.integer("cvFolds", DEFAULT_CV_FOLDS, 0, 10)
    if cv_folds in (1, 2):
        raise ValueError("'cvFolds' must be 0 (no cross-validation) or 3–10.")
    n_clusters = params.integer("nClusters", 3, 2, 20)

    findings: list[dict[str, Any]] = []
    kinds = column_kinds(df)
    if requested is None:
        usable = ("numeric", "categorical", "boolean")
        features = [c for c in df.columns if c != target and kinds[c] in usable]
        excluded = [c for c in df.columns if c != target and kinds[c] not in usable]
        if excluded:
            findings.append(_finding(
                "features_excluded", "info",
                f"Not used as features (identifier, free text, date or empty "
                f"columns): {_names(excluded)}.",
                recommendation="Pass 'features' explicitly to include a column, "
                "or derive numeric features (e.g. month from a date) first.",
            ))
    else:
        features = requested
        if target in features:
            raise ValueError(f"The target '{target}' cannot also be a feature.")
        for column in features:
            kind = kinds[column]
            if kind == "empty":
                raise ValueError(f"Feature '{column}' has no values.")
            if kind == "datetime":
                raise ValueError(
                    f"Feature '{column}' is a date/time column; derive numeric "
                    "features from it (e.g. year, month) before training."
                )
            if kind in ("identifier", "text"):
                findings.append(_finding(
                    "identifier_or_text_feature", "warning",
                    f"'{column}' looks like an identifier or free text; it is "
                    f"one-hot encoded with at most {MAX_CATEGORIES} categories.",
                    column, "Identifiers rarely generalise; consider removing it.",
                ))
    if not features:
        raise ValueError("No usable feature columns: choose 'features' explicitly.")

    sample = _to_numpy_dtypes(df[features].head(1))
    numeric = [c for c in features
               if is_numeric_dtype(sample[c]) and not is_bool_dtype(sample[c])]
    numeric += [c for c in features if is_bool_dtype(sample[c])]
    categorical = [c for c in features if c not in numeric]
    return TrainConfig(task, target, algorithms, features, numeric, categorical,
                       test_size, cv_folds, n_clusters, findings)


def _feature_frame(df: pd.DataFrame, config: TrainConfig) -> pd.DataFrame:
    X = _to_numpy_dtypes(df[config.features])
    for column in config.numeric:
        X[column] = pd.to_numeric(X[column], errors="coerce").astype("float64")
    for column in config.categorical:
        X[column] = X[column].map(lambda v: v if pd.isna(v) else str(v))
    return X


def make_preprocessor(numeric: list[str], categorical: list[str], dense: bool):
    preprocessor = _build_preprocessor(numeric, categorical)
    if categorical:
        preprocessor.set_params(categorical__encoder__max_categories=MAX_CATEGORIES)
    if dense:
        preprocessor.set_params(sparse_threshold=0)
    return preprocessor


def _encoded_width(X: pd.DataFrame, config: TrainConfig) -> int:
    width = len(config.numeric)
    for column in config.categorical:
        width += min(int(X[column].nunique()), MAX_CATEGORIES)
    return width


# ---------------------------------------------------------------- metrics


def _scores(pipeline: Pipeline, X: pd.DataFrame) -> np.ndarray | None:
    """Probabilities (or decision scores) for ranking metrics."""
    if hasattr(pipeline, "predict_proba"):
        return pipeline.predict_proba(X)
    if hasattr(pipeline, "decision_function"):
        return pipeline.decision_function(X)
    return None


def _classification_metrics(y_true, predictions, scores, classes) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "accuracy": accuracy_score(y_true, predictions),
        "balanced_accuracy": balanced_accuracy_score(y_true, predictions),
        "precision_weighted": precision_score(
            y_true, predictions, average="weighted", zero_division=0),
        "recall_weighted": recall_score(
            y_true, predictions, average="weighted", zero_division=0),
        "f1_weighted": f1_score(
            y_true, predictions, average="weighted", zero_division=0),
        "roc_auc": None,
    }
    try:
        if scores is not None and len(classes) == 2:
            positive = scores[:, 1] if scores.ndim == 2 else scores
            metrics["roc_auc"] = roc_auc_score(y_true == classes[1], positive)
        elif scores is not None and scores.ndim == 2 and len(np.unique(y_true)) > 2:
            metrics["roc_auc"] = roc_auc_score(
                y_true, scores, labels=classes, multi_class="ovr", average="weighted")
    except ValueError:
        metrics["roc_auc"] = None
    return {k: (None if v is None else round(float(v), 4)) for k, v in metrics.items()}


def _regression_metrics(y_true, predictions) -> dict[str, Any]:
    y_true = np.asarray(y_true, dtype=float)
    metrics = {
        "r2": r2_score(y_true, predictions),
        "mae": mean_absolute_error(y_true, predictions),
        "rmse": float(np.sqrt(mean_squared_error(y_true, predictions))),
        "mape": None,
    }
    # MAPE explodes near zero: only report it when every actual is clearly non-zero.
    if np.all(np.abs(y_true) > 1e-6 * max(1.0, float(np.abs(y_true).max()))):
        metrics["mape"] = mean_absolute_percentage_error(y_true, predictions)
    return {k: (None if v is None else round(float(v), 4)) for k, v in metrics.items()}


# ---------------------------------------------------------------- supervised


def _labels(y: pd.Series, task: str) -> pd.Series:
    if task == "regression":
        return pd.to_numeric(y, errors="coerce").astype("float64")
    if is_numeric_dtype(y) and not is_bool_dtype(y):
        values = pd.to_numeric(y, errors="coerce").astype("float64")
        if np.all(np.mod(values, 1) == 0):
            return values.astype("int64")
        return values
    return y.astype(str)


def _leakage_checks(X: pd.DataFrame, y: pd.Series, config: TrainConfig) -> None:
    if config.task == "classification" and y.nunique() != 2:
        return
    target = pd.Series(pd.factorize(y)[0], index=y.index) if (
        config.task == "classification") else y
    for column in config.numeric:
        values = X[column]
        if values.nunique() < 2:
            continue
        correlation = values.corr(target)
        if pd.notna(correlation) and abs(correlation) >= 0.98:
            config.findings.append(_finding(
                "possible_target_leakage", "high",
                f"'{column}' is almost perfectly correlated with the target "
                f"(r = {correlation:.3f}).", column,
                "Check that this value is known before the outcome; if it is "
                "derived from the target, remove it.",
            ))


def _split(X, y, config: TrainConfig):
    stratify = None
    if config.task == "classification":
        counts = y.value_counts()
        test_count = int(np.ceil(len(y) * config.test_size))
        if counts.min() >= 2 and min(test_count, len(y) - test_count) >= len(counts):
            stratify = y
            config.stratified = True
        else:
            config.findings.append(_finding(
                "unstratified_split", "warning",
                "The test split could not be stratified by class (some classes "
                "are too small).", config.target,
            ))
    return train_test_split(X, y, test_size=config.test_size,
                            random_state=RANDOM_STATE, stratify=stratify)


def _cross_validate(pipeline, X_train, y_train, config: TrainConfig) -> tuple:
    folds = config.cv_folds
    if not folds:
        return None, None
    X_cv, y_cv = X_train, y_train
    if len(X_train) > CV_MAX_ROWS:
        stratify = y_train if config.task == "classification" else None
        try:
            X_cv, _, y_cv, _ = train_test_split(
                X_train, y_train, train_size=CV_MAX_ROWS,
                random_state=RANDOM_STATE, stratify=stratify)
        except ValueError:
            X_cv, _, y_cv, _ = train_test_split(
                X_train, y_train, train_size=CV_MAX_ROWS, random_state=RANDOM_STATE)
    if config.task == "classification":
        folds = min(folds, int(y_cv.value_counts().min()))
        if folds < 2:
            return None, None
        splitter = StratifiedKFold(folds, shuffle=True, random_state=RANDOM_STATE)
    else:
        splitter = KFold(folds, shuffle=True, random_state=RANDOM_STATE)
    scores = cross_val_score(clone(pipeline), X_cv, y_cv, cv=splitter,
                             scoring=PRIMARY_METRIC[config.task], error_score=np.nan)
    if np.isnan(scores).all():
        return None, None
    return round(float(np.nanmean(scores)), 4), round(float(np.nanstd(scores)), 4)


def _train_supervised(df: pd.DataFrame, config: TrainConfig) -> dict[str, Any]:
    target = config.target
    findings = config.findings
    findings.extend(inspect_target(df[config.features + [target]], target, config.task))

    labelled = df.loc[df[target].notna()]
    y = _labels(labelled[target], config.task)
    keep = y.notna()
    labelled, y = labelled.loc[keep], y.loc[keep]
    if len(labelled) < MIN_ROWS:
        raise ValueError(
            f"Training needs at least {MIN_ROWS} rows with a known target; "
            f"found {len(labelled)}."
        )
    if config.task == "classification":
        counts = y.value_counts()
        if len(counts) > MAX_CLASSES:
            raise ValueError(
                f"The target '{target}' has {len(counts)} classes; classification "
                f"supports at most {MAX_CLASSES}. For a measured quantity choose "
                "regression."
            )
        minority = counts.min() / counts.sum()
        if minority < 0.2:
            findings.append(_finding(
                "class_imbalance", "warning",
                f"The smallest class holds {minority:.0%} of labelled rows; "
                "accuracy can look good while that class is mostly missed.",
                target,
                "Compare balanced_accuracy and the confusion matrix, not just "
                "accuracy.",
            ))
        if counts.min() < 2:
            rare = ", ".join(map(str, counts[counts < 2].index[:5]))
            raise ValueError(
                f"Each target class needs at least 2 rows; too few rows for: {rare}. "
                "Merge or remove rare classes first."
            )

    X = _feature_frame(labelled, config)
    _leakage_checks(X, y, config)
    X_train, X_test, y_train, y_test = _split(X, y, config)
    if config.cv_folds and len(X_train) > CV_MAX_ROWS:
        findings.append(_finding(
            "cv_sampled", "info",
            f"Cross-validation used a random sample of {CV_MAX_ROWS:,} training "
            "rows to bound run time.",
        ))

    dense_ok = len(X_train) * _encoded_width(X_train, config) <= DENSE_MAX_CELLS
    registry = ALGORITHMS[config.task]
    leaderboard: list[dict[str, Any]] = []
    fitted: dict[str, Pipeline] = {}
    for key in config.algorithms:
        algorithm = registry[key]
        if algorithm.max_rows and len(X_train) > algorithm.max_rows:
            findings.append(_finding(
                "algorithm_skipped", "info",
                f"{algorithm.label} was skipped: {len(X_train):,} training rows "
                f"exceed its {algorithm.max_rows:,}-row limit (it would be too slow).",
            ))
            continue
        if algorithm.dense and not dense_ok:
            findings.append(_finding(
                "algorithm_skipped", "info",
                f"{algorithm.label} was skipped: the encoded feature matrix is too "
                "large to hold in memory. Choose fewer categorical features.",
            ))
            continue
        pipeline = Pipeline([
            ("preprocessor", make_preprocessor(config.numeric, config.categorical,
                                               algorithm.dense)),
            ("model", algorithm.build()),
        ])
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", ConvergenceWarning)
                started = time.perf_counter()
                pipeline.fit(X_train, y_train)
                fit_seconds = time.perf_counter() - started
                cv_score, cv_std = _cross_validate(pipeline, X_train, y_train, config)
            predictions = pipeline.predict(X_test)
            if config.task == "classification":
                metrics = _classification_metrics(
                    y_test.to_numpy(), predictions, _scores(pipeline, X_test),
                    pipeline.classes_)
            else:
                metrics = _regression_metrics(y_test, predictions)
        except (ValueError, TypeError, FloatingPointError, MemoryError) as exc:
            findings.append(_finding(
                "algorithm_failed", "warning",
                f"{algorithm.label} could not be trained: {str(exc)[:200]}",
            ))
            continue
        if any(issubclass(w.category, ConvergenceWarning) for w in caught):
            findings.append(_finding(
                "not_converged", "info",
                f"{algorithm.label} did not fully converge; its scores may improve "
                "with more iterations or stronger regularisation.",
            ))
        fitted[key] = pipeline
        leaderboard.append({
            "algorithm": key, "label": algorithm.label, "metrics": metrics,
            "cvScore": cv_score, "cvStd": cv_std,
            "fitSeconds": round(fit_seconds, 3),
        })

    if not leaderboard:
        raise ValueError(
            "None of the selected algorithms could be trained on this data. "
            "Check the findings, choose other algorithms or fewer rows/features."
        )
    primary = PRIMARY_METRIC[config.task]
    leaderboard.sort(key=lambda r: -np.inf if r["metrics"][primary] is None
                     else r["metrics"][primary], reverse=True)
    best = leaderboard[0]
    if (best["metrics"][primary] or 0) >= 0.999:
        findings.append(_finding(
            "suspiciously_perfect", "high",
            f"The best model scores {primary} = {best['metrics'][primary]} on the "
            "test set. Near-perfect scores usually mean a feature leaks the target.",
            recommendation="Review the most important features for leakage.",
        ))
    return {
        "X_train": X_train, "X_test": X_test, "y_train": y_train, "y_test": y_test,
        "leaderboard": leaderboard, "best": best, "pipeline": fitted[best["algorithm"]],
    }


def _importance(pipeline, X_test, y_test, task: str) -> list[dict[str, Any]] | None:
    n_features = X_test.shape[1]
    repeats = 5 if n_features <= 30 else 3 if n_features <= 100 else 2
    limit = 5_000 if n_features <= 30 else 2_000
    if len(X_test) > limit:
        X_test = X_test.sample(limit, random_state=RANDOM_STATE)
        y_test = y_test.loc[X_test.index]
    try:
        result = permutation_importance(
            pipeline, X_test, y_test, scoring=PRIMARY_METRIC[task],
            n_repeats=repeats, random_state=RANDOM_STATE)
    except (ValueError, MemoryError):
        return None
    frame = pd.DataFrame({
        "feature": list(X_test.columns),
        "importance": result.importances_mean,
        "std": result.importances_std,
    }).sort_values("importance", ascending=False).head(TOP_IMPORTANCE)
    return [
        {"feature": str(r.feature), "importance": round(float(r.importance), 5),
         "std": round(float(r.std), 5)}
        for r in frame.itertuples()
    ]


# ---------------------------------------------------------------- clustering


def _cluster_metrics(Xt: np.ndarray, labels: np.ndarray) -> dict[str, Any]:
    n_labels = len(np.unique(labels))
    if not 2 <= n_labels < len(labels):
        return {"silhouette": None, "calinski_harabasz": None, "davies_bouldin": None}
    return {
        "silhouette": round(float(silhouette_score(
            Xt, labels, sample_size=min(SILHOUETTE_SAMPLE, len(labels)),
            random_state=RANDOM_STATE)), 4),
        "calinski_harabasz": round(float(calinski_harabasz_score(Xt, labels)), 4),
        "davies_bouldin": round(float(davies_bouldin_score(Xt, labels)), 4),
    }


def _cluster_overrides(key: str, k: int, width: int) -> dict[str, Any]:
    if key == "gaussian_mixture":
        return {"n_components": k, "covariance_type": "full" if width <= 50 else "diag"}
    return {"n_clusters": k}


def _train_clustering(df: pd.DataFrame, config: TrainConfig) -> dict[str, Any]:
    k = config.n_clusters
    if len(df) < max(MIN_ROWS, 2 * k):
        raise ValueError(
            f"Clustering into {k} groups needs at least {max(MIN_ROWS, 2 * k)} rows."
        )
    X = _feature_frame(df, config)
    if len(X) * _encoded_width(X, config) > DENSE_MAX_CELLS:
        raise ValueError(
            "The encoded feature matrix is too large for clustering. Choose fewer "
            "features (especially categorical ones)."
        )
    preprocessor = make_preprocessor(config.numeric, config.categorical, dense=True)
    Xt = np.asarray(preprocessor.fit_transform(X), dtype=float)

    registry = ALGORITHMS["clustering"]
    leaderboard: list[dict[str, Any]] = []
    fitted: dict[str, tuple[Any, np.ndarray]] = {}
    for key in config.algorithms:
        algorithm = registry[key]
        if algorithm.max_rows and len(X) > algorithm.max_rows:
            config.findings.append(_finding(
                "algorithm_skipped", "info",
                f"{algorithm.label} was skipped: {len(X):,} rows exceed its "
                f"{algorithm.max_rows:,}-row limit (memory grows with rows²).",
            ))
            continue
        model = algorithm.build(**_cluster_overrides(key, k, Xt.shape[1]))
        try:
            started = time.perf_counter()
            labels = model.fit_predict(Xt)
            fit_seconds = time.perf_counter() - started
        except (ValueError, MemoryError) as exc:
            config.findings.append(_finding(
                "algorithm_failed", "warning",
                f"{algorithm.label} could not be fitted: {str(exc)[:200]}"))
            continue
        fitted[key] = (model, labels)
        leaderboard.append({
            "algorithm": key, "label": algorithm.label,
            "metrics": _cluster_metrics(Xt, labels), "cvScore": None,
            "fitSeconds": round(fit_seconds, 3),
        })
    if not leaderboard:
        raise ValueError("None of the selected clustering algorithms could be run.")
    leaderboard.sort(key=lambda r: -np.inf if r["metrics"]["silhouette"] is None
                     else r["metrics"]["silhouette"], reverse=True)
    best = leaderboard[0]
    model, labels = fitted[best["algorithm"]]
    pipeline = Pipeline([("preprocessor", preprocessor), ("model", model)])
    sizes = pd.Series(labels).value_counts().sort_index()
    if sizes.min() < max(2, 0.01 * len(labels)):
        config.findings.append(_finding(
            "tiny_cluster", "info",
            "At least one cluster holds under 1% of rows; it may capture outliers "
            "rather than a meaningful segment."))
    elbow = _elbow(Xt) if "kmeans" in config.algorithms else None
    return {
        "X": X, "Xt": Xt, "labels": labels, "pipeline": pipeline,
        "leaderboard": leaderboard, "best": best, "elbow": elbow,
        "clusters": [{"cluster": int(c), "size": int(n)} for c, n in sizes.items()],
    }


def _elbow(Xt: np.ndarray) -> list[dict[str, Any]]:
    rng = np.random.default_rng(RANDOM_STATE)
    sample = Xt if len(Xt) <= ELBOW_SAMPLE else Xt[
        rng.choice(len(Xt), ELBOW_SAMPLE, replace=False)]
    rows = []
    for k in ELBOW_K:
        if k >= len(sample):
            break
        model = ALGORITHMS["clustering"]["kmeans"].build(n_clusters=k, n_init=4)
        labels = model.fit_predict(sample)
        rows.append({"k": k, "inertia": float(model.inertia_),
                     "silhouette": _cluster_metrics(sample, labels)["silhouette"]})
    return rows


# ---------------------------------------------------------------- charts


def _sample_idx(n: int, limit: int = PLOT_SAMPLE) -> np.ndarray:
    if n <= limit:
        return np.arange(n)
    return np.sort(np.random.default_rng(RANDOM_STATE).choice(n, limit, replace=False))


def _comparison_chart(leaderboard, metric: str, writer: ArtifactWriter) -> None:
    rows = [r for r in leaderboard if r["metrics"].get(metric) is not None]
    if not rows:
        return
    figure = horizontal_bars(
        [r["label"] for r in rows], [r["metrics"][metric] for r in rows],
        f"Model comparison (test {metric})", metric, highlight=0)
    writer.add_figure(figure, "model-comparison", "Model comparison",
                      metadata={"metric": metric})


def _confusion_chart(y_test, predictions, classes, writer) -> None:
    if len(classes) > 20:
        return
    matrix = pd.DataFrame(
        confusion_matrix(y_test, predictions, labels=classes),
        index=[str(c) for c in classes], columns=[str(c) for c in classes])
    figure = matrix_heatmap(matrix, "Confusion matrix (test set)", diverging=False,
                            value_format="{:.0f}", x_label="Predicted",
                            y_label="Actual")
    writer.add_figure(figure, "confusion-matrix", "Confusion matrix",
                      metadata={"labels": [str(c) for c in classes]})


def _roc_chart(y_test, scores, classes, auc, writer) -> None:
    positive = scores[:, 1] if scores.ndim == 2 else scores
    fpr, tpr, _ = roc_curve(y_test == classes[1], positive)
    figure, axes = new_figure(6.4, 5.2)
    axes.plot([0, 1], [0, 1], color=OTHER_COLOR, linestyle="--", linewidth=1,
              label="Chance")
    axes.plot(fpr, tpr, color=CATEGORICAL[0], linewidth=2,
              label=f"Model (AUC = {auc:.3f})" if auc is not None else "Model")
    axes.legend(frameon=False, fontsize=9, loc="lower right")
    finish(axes, f"ROC curve (positive class: {classes[1]})",
           "False positive rate", "True positive rate")
    figure.tight_layout()
    writer.add_figure(figure, "roc-curve", "ROC curve",
                      metadata={"positive_class": str(classes[1]), "auc": auc})


def _regression_charts(y_test, predictions, writer) -> None:
    actual = np.asarray(y_test, dtype=float)
    idx = _sample_idx(len(actual))
    actual, predicted = actual[idx], np.asarray(predictions, dtype=float)[idx]
    style = {"s": 18, "alpha": 0.6 if len(idx) <= 2000 else 0.3,
             "edgecolors": SURFACE, "linewidths": 0.6, "color": CATEGORICAL[0]}

    figure, axes = new_figure(6.4, 5.6)
    axes.scatter(actual, predicted, **style)
    low = float(min(actual.min(), predicted.min()))
    high = float(max(actual.max(), predicted.max()))
    axes.plot([low, high], [low, high], color=CATEGORICAL[1], linewidth=1.5,
              label="Perfect prediction")
    axes.legend(frameon=False, fontsize=9)
    finish(axes, "Predicted vs actual (test set)", "Actual", "Predicted")
    figure.tight_layout()
    writer.add_figure(figure, "predicted-vs-actual", "Predicted vs actual",
                      metadata={"points": len(idx)})

    figure, axes = new_figure()
    axes.scatter(predicted, actual - predicted, **style)
    axes.axhline(0, color=CATEGORICAL[1], linewidth=1.5)
    finish(axes, "Residuals (test set)", "Predicted", "Actual − predicted")
    figure.tight_layout()
    writer.add_figure(figure, "residuals", "Residuals",
                      metadata={"points": len(idx)})


def _importance_chart(importance, writer) -> None:
    if not importance:
        return
    figure = horizontal_bars(
        [r["feature"] for r in importance], [r["importance"] for r in importance],
        "Permutation feature importance (test set)", "Drop in score when shuffled",
        errors=[r["std"] for r in importance])
    writer.add_figure(figure, "feature-importance", "Feature importance")


def _cluster_chart(Xt, labels, writer) -> None:
    idx = _sample_idx(len(Xt))
    if Xt.shape[1] < 2:
        return
    pca = PCA(n_components=2, random_state=RANDOM_STATE).fit(Xt[idx])
    points = pca.transform(Xt[idx])
    sample_labels = labels[idx]
    figure, axes = new_figure(7.2, 5.6)
    # Colours follow the cluster id (stable across charts); ids beyond the
    # palette share the neutral "other" colour instead of cycling.
    for cluster in sorted(np.unique(labels)):
        mask = sample_labels == cluster
        named = cluster < len(CATEGORICAL)
        axes.scatter(points[mask, 0], points[mask, 1], s=16, alpha=0.6,
                     color=CATEGORICAL[cluster] if named else OTHER_COLOR,
                     edgecolors=SURFACE, linewidths=0.5,
                     label=f"Cluster {cluster}" if named else None)
    legend = axes.legend(frameon=False, fontsize=9, title="Cluster")
    legend.get_title().set_color(TEXT_SECONDARY)
    explained = pca.explained_variance_ratio_ * 100
    finish(axes, "Clusters on the first two principal components",
           f"PC1 ({explained[0]:.0f}% of variance)",
           f"PC2 ({explained[1]:.0f}% of variance)")
    figure.tight_layout()
    writer.add_figure(figure, "cluster-scatter-pca", "Cluster scatter (PCA)",
                      metadata={"points": len(idx),
                                "explained_variance": explained.round(2).tolist()})


def _elbow_chart(elbow, writer) -> None:
    if not elbow or len(elbow) < 2:
        return
    figure = Figure(figsize=(10, 4.2), dpi=110, facecolor=SURFACE)
    left, right = figure.subplots(1, 2)
    ks = [r["k"] for r in elbow]
    for axes, key, label in ((left, "inertia", "Inertia (within-cluster SS)"),
                             (right, "silhouette", "Silhouette score")):
        style_axes(axes)
        values = [np.nan if r[key] is None else r[key] for r in elbow]
        axes.plot(ks, values, color=CATEGORICAL[0], marker="o", linewidth=2)
        axes.set_xticks(ks)
        finish(axes, f"k-means: {label.split(' (')[0].lower()} by k",
               "Number of clusters (k)", label)
    figure.tight_layout()
    writer.add_figure(figure, "kmeans-elbow-silhouette",
                      "k-means elbow and silhouette by k", metadata={"k": ks})


# ---------------------------------------------------------------- reports


def _model_card(result, config: TrainConfig, dataset_name: str, model_file: str,
                metadata: dict[str, Any]) -> str:
    best = result["best"]
    lines = [
        f"# Model card: {best['label']}",
        "",
        f"- Dataset: {dataset_name}",
        f"- Generated: {_timestamp()} UTC",
        f"- Task: {config.task}",
        f"- Target: {config.target or '(none: unsupervised clustering)'}",
        f"- Algorithm: {best['label']} (`{metadata['estimator']}`)",
        f"- scikit-learn {sklearn.__version__}, Python {platform.python_version()}",
        "",
        "## Data used",
        "",
        f"- Features ({len(config.features)}): {', '.join(config.features)}",
        (
            "- Numeric features are median-imputed and standardised; categorical "
            "features are mode-imputed and one-hot encoded (at most "
            f"{MAX_CATEGORIES} categories each; rarer values share an "
            "'infrequent' column)."
        ),
    ]
    train_rows, test_rows = result["rows"]["train"], result["rows"]["test"]
    stratified = ", stratified by class" if config.stratified else ""
    if config.task == "clustering":
        lines += [
            f"- Rows clustered: {result['rows']['train']}",
            f"- Clusters requested: {config.n_clusters}",
        ]
    else:
        lines += [
            f"- Rows with a known target: {train_rows + test_rows}",
            (
                f"- Split: {train_rows} training / {test_rows} test rows (test "
                f"size {config.test_size:g}, random_state={RANDOM_STATE}{stratified})."
            ),
            (
                "- Preprocessing is fitted on the training rows only (inside the "
                "pipeline), so no test-set information leaks into training."
            ),
            f"- Cross-validation: {config.cv_folds}-fold on the training set"
            if config.cv_folds else "- Cross-validation: not run.",
        ]
    lines += ["", "## Results", "",
              f"Primary metric: **{result['primaryMetric']}**. "
              + ("Scores are measured on the held-out test set." if
                 config.task != "clustering" else
                 "Silhouette ranges from −1 to 1; higher means better-separated clusters."),
              ""]
    lines += _markdown_table([
        {"algorithm": r["label"], **r["metrics"], "cv_score": r.get("cvScore"),
         "fit_seconds": r["fitSeconds"]}
        for r in result["leaderboard"]
    ])
    if result.get("featureImportance"):
        lines += ["", "## Most important features", "",
                  ("Permutation importance on the test set: the drop in "
                   f"{result['primaryMetric']} when a feature's values are shuffled."),
                  "", *_markdown_table(result["featureImportance"][:10])]
    if result.get("clusters"):
        lines += ["", "## Cluster sizes", "", *_markdown_table(result["clusters"])]
    lines += ["", "## Findings and limitations", ""]
    lines += [f"- **{f['severity']}** – {f['evidence']}" for f in result["findings"]]
    lines += [
        "- The best model was chosen by its test-set score, which makes that score "
        "slightly optimistic; confirm on fresh data before relying on it."
        if config.task != "clustering" else
        "- Clusters describe structure in these features; they are not ground truth.",
        "- A random split may be inappropriate for time-ordered or grouped data.",
        "- Performance can degrade when future data differs from this dataset.",
        "- Associations learned by the model do not imply causation.",
        "",
        "## How to use the model",
        "",
        "```python",
        "import joblib",
        "import pandas as pd",
        "",
        f'model = joblib.load("{model_file}")',
        'new_rows = pd.read_csv("new_data.csv")  # same column names as training',
        f"features = {config.features!r}",
        "predictions = model.predict(new_rows[features])",
        "```",
        "",
        (
            "The file is the complete scikit-learn pipeline (preprocessing + "
            f"model). Load it with scikit-learn {sklearn.__version__} for "
            "compatibility."
        ),
        "",
        (
            "> **Security warning:** joblib/pickle files can execute arbitrary "
            "code when loaded. Only load model files from sources you trust, "
            "such as your own DataPilot workspace."
        ),
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- entry point


def run_train(
    df: pd.DataFrame, raw_params: Any, writer: ArtifactWriter, dataset_name: str
) -> dict[str, Any]:
    if df.empty:
        raise ValueError("The dataset has no rows to train on.")
    config = _parse(df, raw_params)
    primary = PRIMARY_METRIC[config.task]

    if config.task == "clustering":
        trained = _train_clustering(df, config)
        rows = {"train": len(trained["X"]), "test": 0}
        importance = None
    else:
        trained = _train_supervised(df, config)
        rows = {"train": len(trained["X_train"]), "test": len(trained["X_test"])}
        importance = _importance(trained["pipeline"], trained["X_test"],
                                 trained["y_test"], config.task)

    best = trained["best"]
    pipeline: Pipeline = trained["pipeline"]
    algorithm = ALGORITHMS[config.task][best["algorithm"]]
    overrides = {}
    if config.task == "clustering":
        overrides = _cluster_overrides(best["algorithm"], config.n_clusters,
                                       trained["Xt"].shape[1])
    import_line, estimator_code = algorithm.code(**overrides)

    result: dict[str, Any] = {
        "task": config.task,
        "target": config.target,
        "features": config.features,
        "rows": rows,
        "findings": config.findings[:MAX_FINDINGS],
        "leaderboard": trained["leaderboard"],
        "primaryMetric": primary,
        "best": {k: best[k] for k in ("algorithm", "label", "metrics")},
        "featureImportance": importance,
    }
    if config.task == "clustering":
        result["clusters"] = trained["clusters"]
        result["elbow"] = trained["elbow"]

    # ---- model
    metadata = {
        "algorithm": best["algorithm"], "label": best["label"],
        "estimator": estimator_code, "task": config.task, "target": config.target,
        "features": config.features, "numeric_features": config.numeric,
        "categorical_features": config.categorical,
        "primary_metric": primary, "metrics": best["metrics"],
        "sklearn_version": sklearn.__version__,
        "python_version": platform.python_version(),
    }
    if config.task == "classification":
        metadata["classes"] = [str(c) for c in pipeline.classes_]
    model_entry = writer.add_file(
        lambda path: joblib.dump(pipeline, path, compress=3),
        f"model-{best['algorithm']}", "joblib", "MODEL",
        f"Trained model: {best['label']}", metadata)

    # ---- data, charts
    _comparison_chart(trained["leaderboard"], primary, writer)
    if config.task == "clustering":
        labelled = df.loc[trained["X"].index].copy()
        labelled["cluster"] = trained["labels"]
        writer.add_csv(labelled, "dataset-with-clusters", "Dataset with cluster labels",
                       kind="DATA", metadata={"algorithm": best["algorithm"]})
        _cluster_chart(trained["Xt"], trained["labels"], writer)
        _elbow_chart(trained["elbow"], writer)
    else:
        X_test, y_test = trained["X_test"], trained["y_test"]
        predictions = pipeline.predict(X_test)
        frame = pd.DataFrame({"row": X_test.index + 1, "actual": y_test.to_numpy(),
                              "predicted": predictions})
        if config.task == "classification":
            classes = pipeline.classes_
            scores = _scores(pipeline, X_test)
            if len(classes) == 2 and scores is not None:
                if scores.ndim == 2:
                    frame[f"probability_{classes[1]}"] = scores[:, 1].round(5)
                else:  # e.g. SVM without probabilities: signed decision score
                    frame[f"score_{classes[1]}"] = scores.round(5)
            _confusion_chart(y_test, predictions, classes, writer)
            if len(classes) == 2 and scores is not None:
                _roc_chart(y_test.to_numpy(), scores, classes,
                           best["metrics"].get("roc_auc"), writer)
        else:
            frame["residual"] = frame["actual"] - frame["predicted"]
            _regression_charts(y_test, predictions, writer)
        writer.add_csv(frame, "predictions-test-set",
                       f"Test-set predictions ({best['label']})", kind="DATA",
                       metadata={"algorithm": best["algorithm"]})
        _importance_chart(importance, writer)

    writer.add_csv(
        pd.DataFrame([{"algorithm": r["algorithm"], "label": r["label"],
                       **r["metrics"], "cv_score": r.get("cvScore"),
                       "cv_std": r.get("cvStd"), "fit_seconds": r["fitSeconds"]}
                      for r in trained["leaderboard"]]),
        "leaderboard", "Model leaderboard")

    # ---- code and model card
    script = generate_training_script(
        task=config.task, target=config.target, features=config.features,
        numeric_features=config.numeric, categorical_features=config.categorical,
        estimator_import=import_line, estimator_code=estimator_code,
        dense=algorithm.dense, max_categories=MAX_CATEGORIES,
        test_size=config.test_size, random_state=RANDOM_STATE,
        model_filename=model_entry["file"],
    )
    writer.add_text(script, f"train-{best['algorithm']}", "py", "CODE",
                    f"Reproducible training script ({best['label']})",
                    {"algorithm": best["algorithm"]})
    writer.add_text(_model_card(result, config, dataset_name, model_entry["file"],
                                metadata),
                    "model-card", "md", "REPORT", f"Model card: {best['label']}")
    return _json_safe(result)
