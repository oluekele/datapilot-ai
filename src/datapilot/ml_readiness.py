from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from pandas.api.types import is_numeric_dtype
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

SUSPICIOUS_FEATURE_TERMS = (
    "future",
    "next_day",
    "next_week",
    "post_outcome",
    "final_result",
    "after_event",
    "outcome_after",
)

ID_NAME_TERMS = ("id", "uuid", "identifier", "reference_number")


def inspect_target(
    df: pd.DataFrame,
    target: str,
    task: str,
) -> list[dict[str, Any]]:
    """Check target suitability and flag possible leakage risks."""
    if target not in df.columns:
        raise ValueError(f"Target column {target!r} does not exist.")

    if task not in {"classification", "regression"}:
        raise ValueError(
            "task must be 'classification' or 'regression'."
        )

    findings: list[dict[str, Any]] = []
    y = df[target]
    observed = y.dropna()

    if y.isna().any():
        findings.append(
            {
                "type": "missing_target",
                "severity": "warning",
                "column": target,
                "evidence": (
                    f"{int(y.isna().sum())} rows have a missing target "
                    "and will be excluded from baseline evaluation."
                ),
                "recommendation": (
                    "Investigate why the target is missing. Missing target "
                    "rows cannot be used as labelled examples in this run."
                ),
            }
        )

    if observed.nunique() < 2:
        raise ValueError(
            "The target needs at least two distinct non-missing values."
        )

    if task == "classification":
        if is_numeric_dtype(y) and observed.nunique() > 20:
            findings.append(
                {
                    "type": "target_task_review",
                    "severity": "warning",
                    "column": target,
                    "evidence": (
                        f"The numeric target has {observed.nunique()} "
                        "distinct values."
                    ),
                    "recommendation": (
                        "Confirm that classification is intended. If the "
                        "target represents a measured quantity, regression "
                        "may be more appropriate."
                    ),
                }
            )

        class_counts = observed.value_counts()
        if class_counts.min() < 2:
            findings.append(
                {
                    "type": "rare_target_class",
                    "severity": "warning",
                    "column": target,
                    "evidence": (
                        "At least one target class has fewer than "
                        "two examples."
                    ),
                    "recommendation": (
                        "Collect more examples or reconsider the evaluation "
                        "design. A reliable stratified split may not be possible."
                    ),
                }
            )

    if task == "regression" and not is_numeric_dtype(y):
        raise ValueError(
            "Regression requires a numeric target. "
            "Choose classification for categorical outcomes."
        )

    target_name = str(target).lower().replace("-", "_").replace(" ", "_")

    for feature in df.columns:
        if feature == target:
            continue

        normalized = (
            str(feature).lower().replace("-", "_").replace(" ", "_")
        )
        if any(term in normalized for term in SUSPICIOUS_FEATURE_TERMS):
            findings.append(
                {
                    "type": "possible_temporal_leakage",
                    "severity": "warning",
                    "column": str(feature),
                    "evidence": (
                        f"The feature name {feature!r} contains a term "
                        "associated with future or post-outcome information."
                    ),
                    "recommendation": (
                        "Verify that this feature would be available at the "
                        "exact time the model makes its prediction."
                    ),
                }
            )

        if target_name in normalized and len(target_name) >= 3:
            findings.append(
                {
                    "type": "target_related_feature",
                    "severity": "warning",
                    "column": str(feature),
                    "evidence": (
                        f"The feature name resembles the target name "
                        f"{target!r}."
                    ),
                    "recommendation": (
                        "Check whether the feature directly encodes the target "
                        "or was created after the target became known."
                    ),
                }
            )

        series = df[feature].dropna()
        unique_count = int(series.nunique())

        if (
            any(term in normalized for term in ID_NAME_TERMS)
            or (
                len(series) >= 20
                and unique_count / len(series) >= 0.98
            )
        ):
            findings.append(
                {
                    "type": "identifier_like_feature",
                    "severity": "info",
                    "column": str(feature),
                    "evidence": (
                        f"The feature has {unique_count} distinct values "
                        f"among {len(series)} non-missing entries, or its "
                        "name suggests an identifier."
                    ),
                    "recommendation": (
                        "Determine whether this is a genuine predictor or "
                        "merely a record identifier. Unique values alone "
                        "do not prove leakage."
                    ),
                }
            )

    return findings


def _to_numpy_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy using NumPy dtypes and NaN instead of pandas' pd.NA.

    The loader produces nullable extension dtypes (Int64, Float64, string).
    scikit-learn's imputers cannot evaluate pd.NA, so convert before fitting.
    """
    result = df.copy()
    for column in result.columns:
        series = result[column]
        if not isinstance(series.dtype, pd.api.extensions.ExtensionDtype):
            continue
        if pd.api.types.is_bool_dtype(series) or not is_numeric_dtype(series):
            result[column] = series.astype(object).where(series.notna(), np.nan)
        else:
            result[column] = series.astype("float64")
    return result


def _build_preprocessor(
    numeric_columns: list[str],
    categorical_columns: list[str],
) -> ColumnTransformer:
    transformers = []

    if numeric_columns:
        numeric_pipeline = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
            ]
        )
        transformers.append(
            ("numeric", numeric_pipeline, numeric_columns)
        )

    if categorical_columns:
        categorical_pipeline = Pipeline(
            steps=[
                (
                    "imputer",
                    SimpleImputer(strategy="most_frequent"),
                ),
                (
                    "encoder",
                    OneHotEncoder(handle_unknown="ignore"),
                ),
            ]
        )
        transformers.append(
            ("categorical", categorical_pipeline, categorical_columns)
        )

    return ColumnTransformer(
        transformers=transformers,
        remainder="drop",
    )


def run_baseline(
    df: pd.DataFrame,
    target: str,
    task: str,
    test_size: float = 0.2,
    random_state: int = 42,
) -> dict[str, Any]:
    """
    Evaluate baseline models with a held-out test set.

    Preprocessing is fitted inside a Pipeline on training data only.
    The function does not modify the input DataFrame.
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be a pandas DataFrame.")

    if not 0.1 <= test_size <= 0.5:
        raise ValueError("test_size must be between 0.1 and 0.5.")

    findings = inspect_target(df, target, task)

    # Exclude rows without known labels.
    labelled = _to_numpy_dtypes(df.loc[df[target].notna()])
    y = labelled[target]
    X = labelled.drop(columns=[target])

    # Exclude columns with no usable values.
    all_missing = [
        column for column in X.columns if X[column].isna().all()
    ]
    if all_missing:
        X = X.drop(columns=all_missing)
        findings.append(
            {
                "type": "all_missing_feature",
                "severity": "warning",
                "column": None,
                "evidence": (
                    f"Excluded {len(all_missing)} feature column(s) "
                    "that contain no non-missing values."
                ),
                "recommendation": (
                    "Investigate whether these columns are intentionally "
                    "empty or indicate an upstream data issue."
                ),
            }
        )

    # Remove very high-cardinality non-numeric features from this basic
    # baseline to avoid an uncontrolled number of one-hot encoded columns.
    high_cardinality = []
    for column in X.columns:
        if not is_numeric_dtype(X[column]):
            observed = X[column].dropna()
            if (
                len(observed) >= 20
                and observed.nunique() / len(observed) >= 0.95
            ):
                high_cardinality.append(column)

    if high_cardinality:
        X = X.drop(columns=high_cardinality)
        findings.append(
            {
                "type": "high_cardinality_features_excluded",
                "severity": "warning",
                "column": None,
                "evidence": (
                    f"Excluded {len(high_cardinality)} non-numeric feature "
                    "column(s) with very high cardinality from the baseline."
                ),
                "recommendation": (
                    "Review these features separately. They may be identifiers, "
                    "free text, or useful predictors requiring specialised "
                    "feature engineering."
                ),
            }
        )

    if X.shape[1] == 0:
        raise ValueError(
            "No usable feature columns remain after basic exclusions."
        )

    if len(X) < 10:
        raise ValueError(
            "At least 10 labelled rows are required for this basic "
            "train/test evaluation. More data is usually preferable."
        )

    if task == "classification":
        class_counts = y.value_counts()
        if class_counts.min() < 2:
            raise ValueError(
                "At least two examples per target class are needed for "
                "this baseline split."
            )

        if y.nunique() > min(50, max(10, len(y) // 2)):
            findings.append(
                {
                    "type": "many_target_classes",
                    "severity": "warning",
                    "column": target,
                    "evidence": (
                        f"The target has {y.nunique()} distinct classes."
                    ),
                    "recommendation": (
                        "Confirm that this is a classification problem. "
                        "A numeric target with many values may be better "
                        "treated as regression."
                    ),
                }
            )

    numeric_columns = [
        column for column in X.columns if is_numeric_dtype(X[column])
    ]
    categorical_columns = [
        column for column in X.columns if column not in numeric_columns
    ]

    stratify = None
    if task == "classification":
        n_classes = y.nunique()
        test_count = int(np.ceil(len(y) * test_size))
        train_count = len(y) - test_count

        if (
            y.value_counts().min() >= 2
            and test_count >= n_classes
            and train_count >= n_classes
        ):
            stratify = y

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=stratify,
    )

    preprocessor = _build_preprocessor(
        numeric_columns,
        categorical_columns,
    )

    if task == "classification":
        models = {
            "dummy_baseline": DummyClassifier(strategy="most_frequent"),
            "logistic_regression": LogisticRegression(
                max_iter=1000,
                random_state=random_state,
            ),
        }
    else:
        models = {
            "dummy_baseline": DummyRegressor(strategy="median"),
            "random_forest": RandomForestRegressor(
                n_estimators=100,
                random_state=random_state,
                n_jobs=-1,
            ),
        }

    model_results: dict[str, Any] = {}

    for model_name, estimator in models.items():
        pipeline = Pipeline(
            steps=[
                ("preprocessor", preprocessor),
                ("model", estimator),
            ]
        )

        try:
            pipeline.fit(X_train, y_train)
            predictions = pipeline.predict(X_test)

            if task == "classification":
                metrics: dict[str, Any] = {
                    "accuracy": round(
                        float(accuracy_score(y_test, predictions)), 4
                    ),
                    "f1_weighted": round(
                        float(
                            f1_score(
                                y_test,
                                predictions,
                                average="weighted",
                                zero_division=0,
                            )
                        ),
                        4,
                    ),
                }

                # ROC AUC is not defined for every classifier or test split.
                try:
                    probabilities = pipeline.predict_proba(X_test)
                    model_classes = pipeline.named_steps["model"].classes_

                    if len(model_classes) == 2:
                        positive_label = model_classes[1]
                        binary_truth = (y_test == positive_label).astype(int)
                        metrics["roc_auc"] = round(
                            float(
                                roc_auc_score(
                                    binary_truth,
                                    probabilities[:, 1],
                                )
                            ),
                            4,
                        )
                    elif len(model_classes) > 2:
                        metrics["roc_auc_ovr_weighted"] = round(
                            float(
                                roc_auc_score(
                                    y_test,
                                    probabilities,
                                    labels=model_classes,
                                    multi_class="ovr",
                                    average="weighted",
                                )
                            ),
                            4,
                        )
                except (ValueError, AttributeError):
                    metrics["roc_auc_note"] = (
                        "ROC AUC could not be calculated for this split."
                    )

            else:
                mse = float(mean_squared_error(y_test, predictions))
                metrics = {
                    "mae": round(
                        float(mean_absolute_error(y_test, predictions)), 4
                    ),
                    "rmse": round(float(np.sqrt(mse)), 4),
                    "r2": round(float(r2_score(y_test, predictions)), 4),
                }

            model_results[model_name] = {
                "status": "success",
                "metrics": metrics,
            }

        except (ValueError, TypeError, FloatingPointError) as exc:
            model_results[model_name] = {
                "status": "failed",
                "reason": str(exc),
            }

    if not any(
        result["status"] == "success"
        for result in model_results.values()
    ):
        raise ValueError(
            "All baseline models failed. Check the feature types, target "
            "values, and missing data, then try again."
        )

    return {
        "task": task,
        "target": target,
        "labelled_rows": len(labelled),
        "training_rows": len(X_train),
        "test_rows": len(X_test),
        "features_used": [str(column) for column in X.columns],
        "excluded_all_missing_features": [str(c) for c in all_missing],
        "excluded_high_cardinality_features": [
            str(c) for c in high_cardinality
        ],
        "models": model_results,
        "findings": findings,
        "limitations": [
            "Feature-name checks are heuristics, not proof of leakage.",
            "A random split may be inappropriate for time series or grouped data.",
            "A single holdout score is not a guarantee of real-world performance.",
            "Domain knowledge is required to validate target and feature timing.",
        ],
    }
