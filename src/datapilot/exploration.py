"""Exploratory data analysis helpers for DataPilot AI.

Every function here is read-only: it summarizes a DataFrame without
modifying it. Results are plain dictionaries and DataFrames so they can be
displayed in the interface, tested directly, and exported in reports.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
import pandas as pd

ColumnKind = Literal["numeric", "categorical", "boolean", "datetime", "text"]

# Object columns with more distinct values than this share of rows are
# treated as free text (IDs, comments) rather than categories.
TEXT_UNIQUE_RATIO = 0.5
TEXT_MIN_UNIQUE = 50

CORRELATION_METHODS = ("pearson", "spearman")


def _require_dataframe(df: object) -> None:
    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be a pandas DataFrame.")


def _require_column(df: pd.DataFrame, column: str) -> None:
    if column not in df.columns:
        raise ValueError(f"Column '{column}' does not exist in the dataset.")


def classify_column(series: pd.Series) -> ColumnKind:
    """Classify a column by how it can sensibly be analysed."""
    if pd.api.types.is_bool_dtype(series):
        return "boolean"

    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"

    if pd.api.types.is_numeric_dtype(series):
        non_missing = series.dropna()
        if len(non_missing) and set(non_missing.unique()) <= {0, 1}:
            return "boolean"
        return "numeric"

    non_missing = series.dropna()
    unique_count = int(non_missing.nunique())
    if (
        unique_count >= TEXT_MIN_UNIQUE
        and unique_count > TEXT_UNIQUE_RATIO * len(non_missing)
    ):
        return "text"

    return "categorical"


def classify_columns(df: pd.DataFrame) -> dict[str, ColumnKind]:
    """Return the analysis kind of every column."""
    _require_dataframe(df)
    return {str(column): classify_column(df[column]) for column in df.columns}


def columns_of_kind(df: pd.DataFrame, *kinds: ColumnKind) -> list[str]:
    """List the columns whose analysis kind is one of ``kinds``."""
    return [
        column
        for column, kind in classify_columns(df).items()
        if kind in kinds
    ]


def dataset_summary(df: pd.DataFrame) -> dict[str, Any]:
    """Summarize dataset shape, column kinds, and completeness."""
    _require_dataframe(df)

    kinds = classify_columns(df)
    kind_counts = {
        kind: sum(1 for value in kinds.values() if value == kind)
        for kind in ("numeric", "categorical", "boolean", "datetime", "text")
    }

    rows = len(df)
    complete_rows = int(df.notna().all(axis=1).sum()) if rows else 0

    return {
        "rows": int(rows),
        "columns": int(df.shape[1]),
        "column_kinds": kinds,
        "kind_counts": kind_counts,
        "complete_rows": complete_rows,
        "complete_row_percentage": (
            round(complete_rows / rows * 100, 2) if rows else 0.0
        ),
    }


def numeric_distribution(
    df: pd.DataFrame,
    column: str,
    bins: int = 20,
) -> dict[str, Any]:
    """Describe the distribution of one numeric column."""
    _require_dataframe(df)
    _require_column(df, column)

    series = df[column]
    if not pd.api.types.is_numeric_dtype(series) or pd.api.types.is_bool_dtype(
        series
    ):
        raise ValueError(f"Column '{column}' is not numeric.")

    if bins < 2:
        raise ValueError("bins must be at least 2.")

    values = pd.to_numeric(series, errors="coerce").replace(
        [np.inf, -np.inf], np.nan
    ).dropna()

    result: dict[str, Any] = {
        "column": column,
        "count": len(values),
        "missing": int(series.isna().sum()),
    }

    if values.empty:
        result["histogram"] = []
        result["notes"] = ["The column has no finite values to describe."]
        return result

    quantiles = values.quantile([0.05, 0.25, 0.5, 0.75, 0.95])
    result.update(
        {
            "mean": float(values.mean()),
            "std": float(values.std()) if len(values) > 1 else None,
            "min": float(values.min()),
            "p05": float(quantiles[0.05]),
            "q1": float(quantiles[0.25]),
            "median": float(quantiles[0.5]),
            "q3": float(quantiles[0.75]),
            "p95": float(quantiles[0.95]),
            "max": float(values.max()),
            "skewness": float(values.skew()) if len(values) > 2 else None,
            "kurtosis": float(values.kurt()) if len(values) > 3 else None,
        }
    )

    counts, edges = np.histogram(values, bins=bins)
    result["histogram"] = [
        {
            "bin_start": float(edges[i]),
            "bin_end": float(edges[i + 1]),
            "count": int(counts[i]),
        }
        for i in range(len(counts))
    ]

    notes: list[str] = []
    skewness = result["skewness"]
    if skewness is not None and abs(skewness) >= 1:
        direction = "right" if skewness > 0 else "left"
        notes.append(
            f"The distribution is strongly {direction}-skewed "
            f"(skewness {skewness:.2f}); the median may describe a typical "
            "value better than the mean."
        )
    if len(values) < 30:
        notes.append(
            "Fewer than 30 values: distribution shape estimates are unstable."
        )
    result["notes"] = notes

    return result


def category_frequencies(
    df: pd.DataFrame,
    column: str,
    top_n: int = 15,
    include_missing: bool = True,
) -> pd.DataFrame:
    """Return value counts for a column, folding the tail into 'Other'."""
    _require_dataframe(df)
    _require_column(df, column)

    if top_n < 1:
        raise ValueError("top_n must be at least 1.")

    counts = df[column].value_counts(dropna=not include_missing)
    counts.index = [
        "(missing)" if pd.isna(value) else str(value) for value in counts.index
    ]

    if len(counts) > top_n:
        head = counts.iloc[:top_n]
        other = int(counts.iloc[top_n:].sum())
        counts = pd.concat([head, pd.Series({"(other values)": other})])

    total = int(counts.sum())
    frame = pd.DataFrame(
        {
            "value": counts.index.astype(str),
            "count": counts.to_numpy(dtype=int),
        }
    )
    frame["percentage"] = (
        (frame["count"] / total * 100).round(2) if total else 0.0
    )
    return frame.reset_index(drop=True)


def missing_summary(df: pd.DataFrame) -> dict[str, Any]:
    """Summarize where values are missing, by column and by row."""
    _require_dataframe(df)

    rows = len(df)
    by_column = pd.DataFrame(
        {
            "column": df.columns.astype(str),
            "missing": df.isna().sum().to_numpy(dtype=int),
        }
    )
    by_column["missing_percentage"] = (
        (by_column["missing"] / rows * 100).round(2) if rows else 0.0
    )
    by_column = by_column.sort_values(
        "missing", ascending=False, kind="stable"
    ).reset_index(drop=True)

    rows_with_missing = int(df.isna().any(axis=1).sum()) if rows else 0

    return {
        "by_column": by_column,
        "columns_with_missing": int((by_column["missing"] > 0).sum()),
        "rows_with_missing": rows_with_missing,
        "rows_with_missing_percentage": (
            round(rows_with_missing / rows * 100, 2) if rows else 0.0
        ),
    }


def correlation_matrix(
    df: pd.DataFrame,
    method: str = "pearson",
    min_periods: int = 10,
) -> pd.DataFrame:
    """Pairwise correlations between numeric columns."""
    _require_dataframe(df)

    if method not in CORRELATION_METHODS:
        raise ValueError(
            f"method must be one of {', '.join(CORRELATION_METHODS)}."
        )

    numeric = df[columns_of_kind(df, "numeric")]
    numeric = numeric.replace([np.inf, -np.inf], np.nan)

    if numeric.shape[1] < 2:
        return pd.DataFrame()

    return numeric.corr(method=method, min_periods=min_periods)


def top_correlations(
    df: pd.DataFrame,
    method: str = "pearson",
    limit: int = 10,
    min_periods: int = 10,
) -> pd.DataFrame:
    """Rank the strongest pairwise correlations by absolute value."""
    matrix = correlation_matrix(df, method=method, min_periods=min_periods)
    if matrix.empty:
        return pd.DataFrame(
            columns=["column_a", "column_b", "correlation", "strength", "n"]
        )

    columns = list(matrix.columns)
    # Complete pairs for every column pair at once, instead of a dropna per pair.
    valid = df[columns].replace([np.inf, -np.inf], np.nan).notna().to_numpy(int)
    pair_counts = valid.T @ valid

    pairs = []
    for i, column_a in enumerate(columns):
        for j in range(i + 1, len(columns)):
            column_b = columns[j]
            value = matrix.iat[i, j]
            if pd.isna(value):
                continue
            n = int(pair_counts[i, j])
            pairs.append(
                {
                    "column_a": column_a,
                    "column_b": column_b,
                    "correlation": round(float(value), 4),
                    "strength": describe_correlation(float(value)),
                    "n": n,
                }
            )

    frame = pd.DataFrame(
        pairs,
        columns=["column_a", "column_b", "correlation", "strength", "n"],
    )
    if frame.empty:
        return frame

    order = frame["correlation"].abs().sort_values(ascending=False).index
    return frame.loc[order].head(limit).reset_index(drop=True)


def describe_correlation(value: float) -> str:
    """Give a conventional verbal label for a correlation coefficient."""
    magnitude = abs(value)
    if magnitude >= 0.7:
        label = "strong"
    elif magnitude >= 0.4:
        label = "moderate"
    elif magnitude >= 0.2:
        label = "weak"
    else:
        return "negligible"
    direction = "positive" if value > 0 else "negative"
    return f"{label} {direction}"


def compare_columns(
    df: pd.DataFrame,
    column_a: str,
    column_b: str,
    top_n: int = 10,
) -> dict[str, Any]:
    """Describe the relationship between two columns based on their kinds."""
    _require_dataframe(df)
    _require_column(df, column_a)
    _require_column(df, column_b)

    if column_a == column_b:
        raise ValueError("Choose two different columns to compare.")

    kind_a = classify_column(df[column_a])
    kind_b = classify_column(df[column_b])
    pair = df[[column_a, column_b]].dropna()

    result: dict[str, Any] = {
        "column_a": column_a,
        "column_b": column_b,
        "kind_a": kind_a,
        "kind_b": kind_b,
        "complete_pairs": len(pair),
        "caveat": (
            "An association between two columns does not show that one "
            "causes the other."
        ),
    }

    if kind_a == "numeric" and kind_b == "numeric":
        result["comparison"] = "numeric_vs_numeric"
        if len(pair) >= 3:
            pearson = float(pair[column_a].corr(pair[column_b]))
            spearman = float(
                pair[column_a].corr(pair[column_b], method="spearman")
            )
            result["pearson"] = None if np.isnan(pearson) else pearson
            result["spearman"] = None if np.isnan(spearman) else spearman
        return result

    numeric_column = None
    group_column = None
    if kind_a == "numeric" and kind_b in ("categorical", "boolean"):
        numeric_column, group_column = column_a, column_b
    elif kind_b == "numeric" and kind_a in ("categorical", "boolean"):
        numeric_column, group_column = column_b, column_a

    if numeric_column is not None:
        result["comparison"] = "numeric_by_group"
        result["group_column"] = group_column
        result["value_column"] = numeric_column
        grouped = (
            pair.groupby(group_column, observed=True)[numeric_column]
            .agg(["count", "mean", "median", "std", "min", "max"])
            .sort_values("count", ascending=False)
            .head(top_n)
            .reset_index()
        )
        result["table"] = grouped
        return result

    if kind_a in ("categorical", "boolean") and kind_b in (
        "categorical",
        "boolean",
    ):
        result["comparison"] = "category_vs_category"
        top_a = pair[column_a].value_counts().head(top_n).index
        top_b = pair[column_b].value_counts().head(top_n).index
        subset = pair[pair[column_a].isin(top_a) & pair[column_b].isin(top_b)]
        result["table"] = pd.crosstab(subset[column_a], subset[column_b])
        if len(top_a) < pair[column_a].nunique() or len(top_b) < pair[
            column_b
        ].nunique():
            result["note"] = (
                f"Only the {top_n} most frequent values of each column "
                "are shown."
            )
        return result

    result["comparison"] = "unsupported"
    result["note"] = (
        f"Comparing a {kind_a} column with a {kind_b} column is not "
        "supported yet."
    )
    return result


def exploration_snapshot(
    df: pd.DataFrame,
    correlation_method: str = "pearson",
    correlation_limit: int = 10,
) -> dict[str, Any]:
    """Collect the headline exploration results for a report."""
    summary = dataset_summary(df)
    missing = missing_summary(df)
    correlations = top_correlations(
        df, method=correlation_method, limit=correlation_limit
    )
    return {
        "summary": summary,
        "missing": {
            "columns_with_missing": missing["columns_with_missing"],
            "rows_with_missing": missing["rows_with_missing"],
            "rows_with_missing_percentage": missing[
                "rows_with_missing_percentage"
            ],
            "by_column": missing["by_column"][
                missing["by_column"]["missing"] > 0
            ].to_dict("records"),
        },
        "correlation_method": correlation_method,
        "top_correlations": correlations.to_dict("records"),
    }


# Name fragments that suggest an identifier column (used by column_kinds).
ID_NAME_TERMS = ("id", "uuid", "identifier", "key", "code", "number")


def column_kinds(df: pd.DataFrame) -> dict[str, str]:
    """Column kinds for the UI pickers, as listed in the API contract.

    ``exploration.classify_columns`` returns numeric / categorical / boolean /
    datetime / text. Two kinds are derived on top of it:

    * ``empty`` – every value is missing.
    * ``identifier`` – text or categorical columns (or integer columns whose
      name looks like an ID) where nearly every non-missing value is unique.
    """
    kinds: dict[str, str] = dict(classify_columns(df))
    for column in df.columns:
        name = str(column)
        series = df[column]
        observed = series.dropna()
        if observed.empty:
            kinds[name] = "empty"
            continue
        kind = kinds[name]
        if kind == "datetime" or kind == "boolean" or len(observed) < 20:
            continue
        unique_ratio = observed.nunique() / len(observed)
        if unique_ratio < 0.98:
            continue
        tokens = name.lower().replace("-", "_").replace(" ", "_").split("_")
        if kind in ("text", "categorical") or (
            kind == "numeric"
            and pd.api.types.is_integer_dtype(series)
            and any(term in tokens for term in ID_NAME_TERMS)
        ):
            kinds[name] = "identifier"
    return kinds
