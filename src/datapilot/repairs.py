from __future__ import annotations

import math
from typing import Any

import pandas as pd

from datapilot.profiler import iqr_bounds

MISSING_METHODS_NUMERIC = {
    "fill_median": "Fill with the median",
    "fill_mean": "Fill with the mean",
    "drop_rows": "Remove rows where this value is missing",
}
MISSING_METHODS_CATEGORICAL = {
    "fill_mode": "Fill with the most frequent value",
    "fill_unknown": "Fill with 'Unknown'",
    "drop_rows": "Remove rows where this value is missing",
}
OUTLIER_METHODS = {
    "cap_iqr": "Cap values at the 1.5 × IQR bounds",
    "drop_rows": "Remove rows with outlying values",
}

# Repairs run in this order regardless of the order they were selected, so the
# same selection always produces the same result.
ACTION_ORDER = (
    "trim_whitespace",
    "drop_duplicate_rows",
    "drop_constant_column",
    "handle_missing_values",
    "handle_outliers",
)

ML_LEAKAGE_NOTE = (
    "If you will train a model on the repaired copy, filling or capping uses "
    "statistics from all rows, including future test rows. The ML readiness "
    "pipeline already imputes using training data only."
)


def _is_numeric(series: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(
        series
    )


def build_repair_plan(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Create reviewable repair suggestions without changing the dataset."""
    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be a pandas DataFrame.")

    plan: list[dict[str, Any]] = []

    duplicate_count = int(df.duplicated().sum())
    if duplicate_count:
        plan.append(
            {
                "id": "drop_duplicate_rows",
                "action": "drop_duplicate_rows",
                "column": None,
                "title": "Remove exact duplicate rows",
                "evidence": f"{duplicate_count} duplicate rows detected.",
                "recommendation": (
                    "Review repeated records before removing them. "
                    "Duplicates may be legitimate in some datasets."
                ),
                "risk": "medium",
            }
        )

    for column in df.columns:
        series = df[column]
        name = str(column)

        missing_count = int(series.isna().sum())
        if missing_count:
            missing_percentage = (
                missing_count / len(df) * 100 if len(df) else 0.0
            )

            if _is_numeric(series):
                methods = MISSING_METHODS_NUMERIC
                suggestion = (
                    "The median is robust to skew and outliers; the mean "
                    "suits roughly symmetric values."
                )
            else:
                methods = MISSING_METHODS_CATEGORICAL
                suggestion = (
                    "An explicit 'Unknown' keeps the fact that the value was "
                    "missing; the most frequent value hides it."
                )

            plan.append(
                {
                    "id": f"missing::{name}",
                    "action": "handle_missing_values",
                    "column": name,
                    "title": f"Handle missing values in {name}",
                    "evidence": (
                        f"{missing_count} of {len(df)} rows are missing "
                        f"({missing_percentage:.2f}%)."
                    ),
                    "recommendation": (
                        "Investigate why values are missing first. "
                        f"{suggestion}"
                    ),
                    "note": ML_LEAKAGE_NOTE,
                    "methods": methods,
                    "default_method": next(iter(methods)),
                    "risk": "medium",
                }
            )

        non_missing = series.dropna()
        if len(non_missing) and non_missing.nunique() == 1:
            plan.append(
                {
                    "id": f"drop_constant::{name}",
                    "action": "drop_constant_column",
                    "column": name,
                    "title": f"Remove constant column: {name}",
                    "evidence": (
                        "The column has only one distinct non-missing value."
                    ),
                    "recommendation": (
                        "Remove only if the column is not required for "
                        "business rules, auditing, or downstream reporting."
                    ),
                    "risk": "medium",
                }
            )

        if _is_numeric(series):
            bounds = iqr_bounds(series)
            if bounds is not None:
                values = pd.to_numeric(series, errors="coerce")
                outliers = int(
                    ((values < bounds[0]) | (values > bounds[1])).sum()
                )
                if outliers:
                    plan.append(
                        {
                            "id": f"outliers::{name}",
                            "action": "handle_outliers",
                            "column": name,
                            "title": f"Handle outliers in {name}",
                            "evidence": (
                                f"{outliers} values fall outside "
                                f"{bounds[0]:.4g} to {bounds[1]:.4g} "
                                "(1.5 × IQR)."
                            ),
                            "recommendation": (
                                "Outliers are often real observations. Change "
                                "them only if they are errors or would distort "
                                "your analysis. Capping keeps every row; "
                                "removing rows loses their other values too."
                            ),
                            "note": ML_LEAKAGE_NOTE,
                            "methods": OUTLIER_METHODS,
                            "default_method": "cap_iqr",
                            "risk": "high",
                        }
                    )

        if (
            pd.api.types.is_object_dtype(series)
            or pd.api.types.is_string_dtype(series)
        ):
            text_values = series.dropna()
            whitespace_count = int(
                text_values.map(
                    lambda value: isinstance(value, str)
                    and value != value.strip()
                ).sum()
            )
            if whitespace_count:
                plan.append(
                    {
                        "id": f"trim_whitespace::{name}",
                        "action": "trim_whitespace",
                        "column": name,
                        "title": f"Trim text whitespace in {name}",
                        "evidence": (
                            f"{whitespace_count} text values contain "
                            "leading or trailing whitespace."
                        ),
                        "recommendation": (
                            "Review the preview, then trim surrounding "
                            "whitespace to improve consistency."
                        ),
                        "risk": "low",
                    }
                )

    return plan


def _fit_to_dtype(series: pd.Series, value: float) -> float | int:
    """Round a fill value for integer columns so the dtype is preserved."""
    if pd.api.types.is_integer_dtype(series):
        return round(value)
    return value


def _handle_missing(
    result: pd.DataFrame,
    column: str,
    method: str,
) -> tuple[pd.DataFrame, int, str]:
    series = result[column]
    missing = series.isna()
    count = int(missing.sum())
    if not count:
        return result, 0, "no missing values remained"

    if method == "drop_rows":
        return (
            result.loc[~missing].reset_index(drop=True),
            count,
            f"removed {count} rows",
        )

    if method in ("fill_median", "fill_mean"):
        values = pd.to_numeric(series, errors="coerce")
        statistic = values.median() if method == "fill_median" else values.mean()
        if pd.isna(statistic):
            raise ValueError(f"'{column}' has no values to compute a fill from.")
        fill = _fit_to_dtype(series, float(statistic))
        label = "median" if method == "fill_median" else "mean"
        detail = f"filled {count} values with the {label} ({fill:.4g})"
    elif method == "fill_mode":
        modes = series.mode(dropna=True)
        if modes.empty:
            raise ValueError(f"'{column}' has no values to compute a fill from.")
        fill = modes.iloc[0]
        detail = f"filled {count} values with the most frequent value ({fill!r})"
    elif method == "fill_unknown":
        fill = "Unknown"
        detail = f"filled {count} values with 'Unknown'"
    else:
        raise ValueError(f"Unsupported missing-value method: {method}")

    result[column] = series.fillna(fill)
    return result, count, detail


def _handle_outliers(
    result: pd.DataFrame,
    column: str,
    method: str,
) -> tuple[pd.DataFrame, int, str]:
    series = result[column]
    bounds = iqr_bounds(series)
    if bounds is None:
        return result, 0, "no outlier bounds could be computed"

    lower, upper = bounds
    if pd.api.types.is_integer_dtype(series):
        # Integer bounds that still contain every non-outlying value.
        lower, upper = math.ceil(lower), math.floor(upper)

    values = pd.to_numeric(series, errors="coerce")
    outside = ((values < lower) | (values > upper)).fillna(False).astype(bool)
    count = int(outside.sum())
    if not count:
        return result, 0, "no outliers remained"

    if method == "cap_iqr":
        result[column] = series.clip(lower=lower, upper=upper)
        return result, count, f"capped {count} values to {lower:.4g}–{upper:.4g}"
    if method == "drop_rows":
        return (
            result.loc[~outside].reset_index(drop=True),
            count,
            f"removed {count} rows",
        )
    raise ValueError(f"Unsupported outlier method: {method}")


def apply_repairs(
    df: pd.DataFrame,
    selected_action_ids: list[str],
    methods: dict[str, str] | None = None,
) -> tuple[pd.DataFrame, list[dict[str, Any]]]:
    """
    Apply explicitly selected, supported repairs to a copy of the data.

    ``methods`` chooses how to handle missing values or outliers, keyed by
    repair id; items without a choice use their default method. Repairs run in
    ``ACTION_ORDER`` whatever the selection order. The original DataFrame is
    never modified.
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be a pandas DataFrame.")

    methods = methods or {}
    plan = build_repair_plan(df)
    available = {item["id"]: item for item in plan}

    unknown = set(selected_action_ids) - set(available)
    if unknown:
        raise ValueError(
            f"Unknown or unavailable repair action(s): {sorted(unknown)}"
        )

    selected = [available[action_id] for action_id in dict.fromkeys(selected_action_ids)]
    for item in selected:
        method = methods.get(item["id"])
        if method is not None and method not in item.get("methods", {}):
            raise ValueError(
                f"Method '{method}' is not available for {item['title']}."
            )
    selected.sort(key=lambda item: ACTION_ORDER.index(item["action"]))

    result = df.copy(deep=True)
    applied: list[dict[str, Any]] = []

    for item in selected:
        action = item["action"]
        column = item["column"]
        method = methods.get(item["id"], item.get("default_method"))
        detail = ""

        if column is not None and column not in result.columns:
            continue

        if action == "drop_duplicate_rows":
            before = len(result)
            result = result.drop_duplicates().reset_index(drop=True)
            changed = before - len(result)
            detail = f"removed {changed} rows"

        elif action == "drop_constant_column":
            result = result.drop(columns=[column])
            changed = 1
            detail = "removed the column"

        elif action == "trim_whitespace":
            before_values = result[column]
            changed = int(
                before_values.dropna().map(
                    lambda value: isinstance(value, str)
                    and value != value.strip()
                ).sum()
            )
            result[column] = before_values.map(
                lambda value: value.strip()
                if isinstance(value, str)
                else value
            )
            detail = f"trimmed {changed} values"

        elif action == "handle_missing_values":
            result, changed, detail = _handle_missing(result, column, method)

        elif action == "handle_outliers":
            result, changed, detail = _handle_outliers(result, column, method)

        else:
            raise ValueError(f"Unsupported repair action: {action}")

        record: dict[str, Any] = {
            "id": item["id"],
            "title": item["title"],
            "changed_count": int(changed),
            "detail": detail,
        }
        if "methods" in item:
            record["method"] = item["methods"][method]
        applied.append(record)

    return result, applied
