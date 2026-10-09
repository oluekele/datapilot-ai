from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def iqr_bounds(series: pd.Series) -> tuple[float, float] | None:
    """Return the 1.5 × IQR outlier bounds, or None when they are undefined."""
    values = pd.to_numeric(series, errors="coerce")
    values = values.replace([np.inf, -np.inf], np.nan).dropna()

    if len(values) < 4:
        return None

    q1 = values.quantile(0.25)
    q3 = values.quantile(0.75)
    iqr = q3 - q1

    if pd.isna(iqr) or iqr == 0:
        return None

    return float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)


def _count_iqr_outliers(series: pd.Series) -> int:
    """Count potential outliers using the 1.5 × IQR rule."""
    bounds = iqr_bounds(series)
    if bounds is None:
        return 0

    values = pd.to_numeric(series, errors="coerce")
    values = values.replace([np.inf, -np.inf], np.nan).dropna()
    lower_bound, upper_bound = bounds

    return int(((values < lower_bound) | (values > upper_bound)).sum())


def profile_dataset(df: object) -> dict[str, Any]:
    """
    Summarize dataset quality without modifying the original DataFrame.

    Findings describe observed conditions or potential issues.
    They are not proof that the data is incorrect.
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be a pandas DataFrame.")

    row_count, column_count = df.shape
    missing_by_column = df.isna().sum()
    total_missing = int(missing_by_column.sum())
    duplicate_rows = int(df.duplicated().sum())

    overview = {
        "rows": int(row_count),
        "columns": int(column_count),
        "missing_cells": total_missing,
        "missing_percentage": (
            round(total_missing / (row_count * column_count) * 100, 2)
            if row_count and column_count
            else 0.0
        ),
        "duplicate_rows": duplicate_rows,
        "memory_usage_bytes": int(
            df.memory_usage(index=True, deep=True).sum()
        ),
    }

    column_profiles: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []

    for column in df.columns:
        series = df[column]
        missing_count = int(series.isna().sum())
        non_missing = series.dropna()
        unique_count = int(series.nunique(dropna=True))
        missing_percentage = (
            round(missing_count / row_count * 100, 2)
            if row_count
            else 0.0
        )

        profile: dict[str, Any] = {
            "column": str(column),
            "data_type": str(series.dtype),
            "rows": int(row_count),
            "non_missing": int(series.notna().sum()),
            "missing": missing_count,
            "missing_percentage": missing_percentage,
            "unique_values": unique_count,
            "unique_percentage": (
                round(unique_count / len(non_missing) * 100, 2)
                if len(non_missing)
                else 0.0
            ),
            "is_constant": len(non_missing) > 0 and unique_count == 1,
        }

        if pd.api.types.is_numeric_dtype(series):
            numeric = pd.to_numeric(series, errors="coerce")
            finite = numeric.replace(
                [np.inf, -np.inf], np.nan
            ).dropna()

            profile.update(
                {
                    "mean": (
                        round(float(finite.mean()), 4)
                        if len(finite)
                        else None
                    ),
                    "median": (
                        round(float(finite.median()), 4)
                        if len(finite)
                        else None
                    ),
                    "min": (
                        float(finite.min()) if len(finite) else None
                    ),
                    "max": (
                        float(finite.max()) if len(finite) else None
                    ),
                    "potential_outliers_iqr": _count_iqr_outliers(series),
                    "infinite_values": int(
                        np.isinf(numeric.to_numpy(dtype=float, na_value=np.nan)).sum()
                    ),
                }
            )

        column_profiles.append(profile)

        if missing_count > 0:
            severity = "high" if missing_percentage >= 50 else "warning"
            findings.append(
                {
                    "type": "missing_values",
                    "severity": severity,
                    "column": str(column),
                    "evidence": (
                        f"{missing_count} of {row_count} rows are missing "
                        f"({missing_percentage}%)."
                    ),
                    "recommendation": (
                        "Investigate why values are missing before deciding "
                        "whether to impute, retain, or remove records."
                    ),
                }
            )

        if len(non_missing) > 0 and unique_count == 1:
            findings.append(
                {
                    "type": "constant_column",
                    "severity": "warning",
                    "column": str(column),
                    "evidence": (
                        f"The column has only one distinct non-missing value "
                        f"across {len(non_missing)} populated rows."
                    ),
                    "recommendation": (
                        "Check whether the column provides useful information "
                        "for your analysis or model."
                    ),
                }
            )

        if "potential_outliers_iqr" in profile:
            outlier_count = profile["potential_outliers_iqr"]
            if outlier_count > 0:
                findings.append(
                    {
                        "type": "potential_outliers",
                        "severity": "warning",
                        "column": str(column),
                        "evidence": (
                            f"{outlier_count} values fall outside the "
                            "1.5 × IQR range."
                        ),
                        "recommendation": (
                            "Inspect these values in context. Extreme values "
                            "may be valid observations rather than errors."
                        ),
                    }
                )

    if duplicate_rows > 0:
        findings.append(
            {
                "type": "duplicate_rows",
                "severity": "warning",
                "column": None,
                "evidence": (
                    f"{duplicate_rows} rows repeat an earlier row "
                    "across all columns."
                ),
                "recommendation": (
                    "Check whether repeated records are legitimate before "
                    "removing anything."
                ),
            }
        )

    if total_missing == 0 and duplicate_rows == 0 and not findings:
        findings.append(
            {
                "type": "no_basic_issues_detected",
                "severity": "info",
                "column": None,
                "evidence": (
                    "No missing cells, duplicate rows, constant columns, "
                    "or IQR outliers were flagged by these checks."
                ),
                "recommendation": (
                    "Continue with domain-specific validation and "
                    "machine-learning readiness checks."
                ),
            }
        )

    return {
        "overview": overview,
        "columns": column_profiles,
        "findings": findings,
    }
