"""Statistical analysis helpers for DataPilot AI.

Each test returns a dictionary describing what was run, the result, the
assumptions behind it, and warnings that affect interpretation. Results are
evidence to weigh, not verdicts: a p-value never shows causation, and a
non-significant result does not show that groups are the same.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from datapilot.exploration import (
    classify_column,
    columns_of_kind,
    describe_correlation,
)

SMALL_SAMPLE = 30
SHAPIRO_MAX_N = 5000
AGGREGATIONS = ("count", "mean", "median", "std", "min", "max", "sum")


def _require_dataframe(df: object) -> None:
    if not isinstance(df, pd.DataFrame):
        raise TypeError("df must be a pandas DataFrame.")


def _require_column(df: pd.DataFrame, column: str) -> None:
    if column not in df.columns:
        raise ValueError(f"Column '{column}' does not exist in the dataset.")


def _require_numeric(df: pd.DataFrame, column: str) -> None:
    _require_column(df, column)
    if classify_column(df[column]) != "numeric":
        raise ValueError(f"Column '{column}' must be numeric for this analysis.")


def _validate_alpha(alpha: float) -> None:
    if not 0 < alpha < 1:
        raise ValueError("alpha must be between 0 and 1.")


def _finite(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").replace(
        [np.inf, -np.inf], np.nan
    ).dropna()


def _significance_sentence(p_value: float, alpha: float) -> str:
    if p_value < alpha:
        return (
            f"p = {p_value:.4g} is below α = {alpha}: the data are unlikely "
            "under the null hypothesis."
        )
    return (
        f"p = {p_value:.4g} is not below α = {alpha}: the data do not provide "
        "strong evidence against the null hypothesis. This does not show "
        "that the null hypothesis is true."
    )


def _normality_check(values: pd.Series, label: str) -> dict[str, Any]:
    """Run a Shapiro–Wilk check where it is informative."""
    n = len(values)
    if n < 3:
        return {"group": label, "n": n, "status": "too few values"}
    if n > SHAPIRO_MAX_N:
        return {
            "group": label,
            "n": n,
            "status": "skipped (large sample; rely on the central limit theorem)",
        }
    if values.nunique() < 3:
        return {"group": label, "n": n, "status": "too few distinct values"}
    statistic, p_value = stats.shapiro(values)
    return {
        "group": label,
        "n": n,
        "statistic": float(statistic),
        "p_value": float(p_value),
        "status": "no evidence against normality"
        if p_value >= 0.05
        else "departs from normality",
    }


def descriptive_statistics(
    df: pd.DataFrame,
    columns: list[str] | None = None,
) -> pd.DataFrame:
    """Descriptive statistics for numeric columns."""
    _require_dataframe(df)

    if columns is None:
        columns = columns_of_kind(df, "numeric")
    for column in columns:
        _require_numeric(df, column)

    records = []
    for column in columns:
        values = _finite(df[column])
        n = len(values)
        record: dict[str, Any] = {
            "column": column,
            "n": n,
            "missing": int(df[column].isna().sum()),
        }
        if n:
            sem = float(values.std() / np.sqrt(n)) if n > 1 else None
            record.update(
                {
                    "mean": float(values.mean()),
                    "std": float(values.std()) if n > 1 else None,
                    "sem": sem,
                    "min": float(values.min()),
                    "q1": float(values.quantile(0.25)),
                    "median": float(values.median()),
                    "q3": float(values.quantile(0.75)),
                    "max": float(values.max()),
                    "iqr": float(values.quantile(0.75) - values.quantile(0.25)),
                    "skewness": float(values.skew()) if n > 2 else None,
                }
            )
            if sem is not None:
                t_critical = stats.t.ppf(0.975, df=n - 1)
                record["mean_ci95_low"] = record["mean"] - t_critical * sem
                record["mean_ci95_high"] = record["mean"] + t_critical * sem
        records.append(record)

    return pd.DataFrame(records)


def grouped_summary(
    df: pd.DataFrame,
    group_column: str,
    value_column: str,
    aggregations: tuple[str, ...] = ("count", "mean", "median", "std"),
) -> pd.DataFrame:
    """Summarize a numeric column within each group of another column."""
    _require_dataframe(df)
    _require_column(df, group_column)
    _require_numeric(df, value_column)

    if group_column == value_column:
        raise ValueError("Choose different group and value columns.")

    unknown = set(aggregations) - set(AGGREGATIONS)
    if unknown:
        raise ValueError(f"Unsupported aggregation(s): {sorted(unknown)}")
    if not aggregations:
        raise ValueError("Choose at least one aggregation.")

    subset = df[[group_column, value_column]].dropna()
    return (
        subset.groupby(group_column, observed=True)[value_column]
        .agg(list(aggregations))
        .reset_index()
    )


def compare_groups(
    df: pd.DataFrame,
    group_column: str,
    value_column: str,
    alpha: float = 0.05,
    max_groups: int = 10,
) -> dict[str, Any]:
    """Compare a numeric outcome across groups.

    Two groups: Welch's t-test plus the Mann–Whitney U test.
    More groups: one-way ANOVA plus the Kruskal–Wallis test.
    """
    _require_dataframe(df)
    _require_column(df, group_column)
    _require_numeric(df, value_column)
    _validate_alpha(alpha)

    if group_column == value_column:
        raise ValueError("Choose different group and value columns.")

    subset = df[[group_column, value_column]].dropna()
    groups = {
        str(name): _finite(frame[value_column])
        for name, frame in subset.groupby(group_column, observed=True)
    }
    groups = {name: values for name, values in groups.items() if len(values)}

    if len(groups) < 2:
        raise ValueError(
            "At least two groups with values are needed for a comparison."
        )
    if len(groups) > max_groups:
        raise ValueError(
            f"'{group_column}' has {len(groups)} groups; comparisons are "
            f"limited to {max_groups}. Choose a column with fewer categories."
        )
    if any(len(values) < 2 for values in groups.values()):
        raise ValueError("Every group needs at least two values.")

    warnings: list[str] = []
    small = [name for name, values in groups.items() if len(values) < SMALL_SAMPLE]
    if small:
        warnings.append(
            f"Small groups (n < {SMALL_SAMPLE}): {', '.join(small)}. Tests have "
            "low power and normality matters more."
        )

    normality = [
        _normality_check(values, name) for name, values in groups.items()
    ]
    non_normal = [
        check["group"]
        for check in normality
        if check["status"] == "departs from normality"
    ]

    group_values = list(groups.values())
    _, levene_p = stats.levene(*group_values, center="median")

    summary = pd.DataFrame(
        [
            {
                "group": name,
                "n": len(values),
                "mean": float(values.mean()),
                "median": float(values.median()),
                "std": float(values.std()),
            }
            for name, values in groups.items()
        ]
    )

    assumptions = [
        (
            "Observations are independent of each other (not checked "
            "automatically: repeated measurements of the same subject "
            "violate it)."
        ),
        (
            f"Equal variances (Levene's test p = {levene_p:.4g}; Welch's "
            "t-test does not require this)."
        ),
        "Approximately normal values within each group, or large groups.",
    ]

    if len(groups) == 2:
        (name_a, a), (name_b, b) = groups.items()
        t_stat, t_p = stats.ttest_ind(a, b, equal_var=False)
        u_stat, u_p = stats.mannwhitneyu(a, b, alternative="two-sided")
        pooled = np.sqrt(
            ((len(a) - 1) * a.var() + (len(b) - 1) * b.var())
            / (len(a) + len(b) - 2)
        )
        cohens_d = float((a.mean() - b.mean()) / pooled) if pooled else None

        primary_test = "Welch's t-test"
        primary_p = float(t_p)
        if non_normal and small:
            primary_test = "Mann–Whitney U test"
            primary_p = float(u_p)
            warnings.append(
                "Some groups are small and depart from normality, so the "
                "Mann–Whitney U test is the primary result."
            )

        tests = [
            {
                "test": "Welch's t-test",
                "statistic": float(t_stat),
                "p_value": float(t_p),
                "null_hypothesis": "The group means are equal.",
            },
            {
                "test": "Mann–Whitney U test",
                "statistic": float(u_stat),
                "p_value": float(u_p),
                "null_hypothesis": (
                    "Values from one group are equally likely to be larger "
                    "or smaller than values from the other."
                ),
            },
        ]
        effect = {
            "name": "Cohen's d",
            "value": cohens_d,
            "interpretation": _describe_cohens_d(cohens_d),
        }
        direction = (
            f"Mean {value_column} is {a.mean():.4g} for {name_a} and "
            f"{b.mean():.4g} for {name_b}."
        )
    else:
        f_stat, f_p = stats.f_oneway(*group_values)
        h_stat, h_p = stats.kruskal(*group_values)
        all_values = pd.concat(group_values)
        grand_mean = all_values.mean()
        ss_between = sum(
            len(values) * (values.mean() - grand_mean) ** 2
            for values in group_values
        )
        ss_total = float(((all_values - grand_mean) ** 2).sum())
        eta_squared = float(ss_between / ss_total) if ss_total else None

        primary_test = "One-way ANOVA"
        primary_p = float(f_p)
        if non_normal and small:
            primary_test = "Kruskal–Wallis test"
            primary_p = float(h_p)
            warnings.append(
                "Some groups are small and depart from normality, so the "
                "Kruskal–Wallis test is the primary result."
            )
        if levene_p < 0.05:
            warnings.append(
                "Group variances differ (Levene's test), which weakens the "
                "ANOVA result. Prefer the Kruskal–Wallis result."
            )

        tests = [
            {
                "test": "One-way ANOVA",
                "statistic": float(f_stat),
                "p_value": float(f_p),
                "null_hypothesis": "All group means are equal.",
            },
            {
                "test": "Kruskal–Wallis test",
                "statistic": float(h_stat),
                "p_value": float(h_p),
                "null_hypothesis": "All groups come from the same distribution.",
            },
        ]
        effect = {
            "name": "Eta squared",
            "value": eta_squared,
            "interpretation": _describe_eta_squared(eta_squared),
        }
        direction = (
            "A significant result says at least one group differs; it does "
            "not say which. Follow up with pairwise comparisons and correct "
            "for multiple testing."
        )

    interpretation = " ".join(
        [
            f"{primary_test}: {_significance_sentence(primary_p, alpha)}",
            direction,
            f"Effect size: {effect['interpretation']}.",
        ]
    )

    return {
        "analysis": "group_comparison",
        "title": f"{value_column} by {group_column}",
        "group_column": group_column,
        "value_column": value_column,
        "alpha": alpha,
        "primary_test": primary_test,
        "primary_p_value": primary_p,
        "significant": primary_p < alpha,
        "tests": tests,
        "effect_size": effect,
        "group_summary": summary,
        "normality_checks": normality,
        "levene_p_value": float(levene_p),
        "assumptions": assumptions,
        "warnings": warnings,
        "interpretation": interpretation,
        "caveat": (
            "Group differences in observational data do not show that group "
            "membership causes the difference."
        ),
    }


def association_test(
    df: pd.DataFrame,
    column_a: str,
    column_b: str,
    alpha: float = 0.05,
    max_categories: int = 20,
) -> dict[str, Any]:
    """Chi-square test of independence between two categorical columns."""
    _require_dataframe(df)
    _require_column(df, column_a)
    _require_column(df, column_b)
    _validate_alpha(alpha)

    if column_a == column_b:
        raise ValueError("Choose two different columns.")

    for column in (column_a, column_b):
        kind = classify_column(df[column])
        if kind not in ("categorical", "boolean"):
            raise ValueError(
                f"Column '{column}' is {kind}; the chi-square test needs "
                "categorical columns."
            )

    subset = df[[column_a, column_b]].dropna()
    table = pd.crosstab(subset[column_a], subset[column_b])

    if table.shape[0] < 2 or table.shape[1] < 2:
        raise ValueError("Each column needs at least two observed categories.")
    if max(table.shape) > max_categories:
        raise ValueError(
            f"Too many categories (limit {max_categories} per column) for a "
            "readable test."
        )

    chi2, p_value, dof, expected = stats.chi2_contingency(table)
    n = int(table.to_numpy().sum())
    min_dim = min(table.shape) - 1
    cramers_v = float(np.sqrt(chi2 / (n * min_dim))) if n and min_dim else None

    warnings: list[str] = []
    low_expected = float((expected < 5).mean() * 100)
    if low_expected > 20:
        warnings.append(
            f"{low_expected:.0f}% of cells have an expected count below 5, so "
            "the chi-square approximation may be unreliable. Consider merging "
            "rare categories or using Fisher's exact test for 2×2 tables."
        )
    if n < SMALL_SAMPLE:
        warnings.append(f"Only {n} complete rows: results are fragile.")

    return {
        "analysis": "association",
        "title": f"{column_a} vs {column_b}",
        "column_a": column_a,
        "column_b": column_b,
        "alpha": alpha,
        "primary_test": "Chi-square test of independence",
        "primary_p_value": float(p_value),
        "significant": float(p_value) < alpha,
        "tests": [
            {
                "test": "Chi-square test of independence",
                "statistic": float(chi2),
                "p_value": float(p_value),
                "degrees_of_freedom": int(dof),
                "null_hypothesis": "The two columns are independent.",
            }
        ],
        "effect_size": {
            "name": "Cramér's V",
            "value": cramers_v,
            "interpretation": _describe_cramers_v(cramers_v),
        },
        "contingency_table": table,
        "n": n,
        "assumptions": [
            "Each row is an independent observation.",
            "Expected counts are at least 5 in most cells.",
        ],
        "warnings": warnings,
        "interpretation": (
            f"{_significance_sentence(float(p_value), alpha)} "
            f"Effect size: {_describe_cramers_v(cramers_v)}."
        ),
        "caveat": (
            "An association between two columns does not show that one "
            "causes the other."
        ),
    }


def correlation_test(
    df: pd.DataFrame,
    column_x: str,
    column_y: str,
    method: str = "pearson",
    alpha: float = 0.05,
) -> dict[str, Any]:
    """Test the correlation between two numeric columns."""
    _require_dataframe(df)
    _require_numeric(df, column_x)
    _require_numeric(df, column_y)
    _validate_alpha(alpha)

    if column_x == column_y:
        raise ValueError("Choose two different columns.")
    if method not in ("pearson", "spearman"):
        raise ValueError("method must be 'pearson' or 'spearman'.")

    pair = df[[column_x, column_y]].replace([np.inf, -np.inf], np.nan).dropna()
    n = len(pair)
    if n < 3:
        raise ValueError("At least three complete pairs are needed.")
    if pair[column_x].nunique() < 2 or pair[column_y].nunique() < 2:
        raise ValueError("Both columns need more than one distinct value.")

    if method == "pearson":
        result = stats.pearsonr(pair[column_x], pair[column_y])
        test_name = "Pearson correlation"
        assumptions = [
            "The relationship is roughly linear.",
            "No extreme outliers dominate the relationship.",
            "Pairs are independent observations.",
        ]
    else:
        result = stats.spearmanr(pair[column_x], pair[column_y])
        test_name = "Spearman rank correlation"
        assumptions = [
            (
                "The relationship is monotonic (consistently increasing or "
                "decreasing), not necessarily linear."
            ),
            "Pairs are independent observations.",
        ]

    coefficient = float(result.statistic)
    p_value = float(result.pvalue)

    ci_low = ci_high = None
    if n > 3 and abs(coefficient) < 1:
        z = np.arctanh(coefficient)
        margin = stats.norm.ppf(1 - alpha / 2) / np.sqrt(n - 3)
        ci_low, ci_high = float(np.tanh(z - margin)), float(np.tanh(z + margin))

    warnings: list[str] = []
    if n < SMALL_SAMPLE:
        warnings.append(
            f"Only {n} complete pairs: the coefficient is imprecise."
        )

    strength = describe_correlation(coefficient)
    interpretation = (
        f"{test_name} r = {coefficient:.3f} ({strength}). "
        f"{_significance_sentence(p_value, alpha)}"
    )
    if ci_low is not None:
        interpretation += (
            f" Approximate {int((1 - alpha) * 100)}% confidence interval: "
            f"{ci_low:.3f} to {ci_high:.3f}."
        )

    return {
        "analysis": "correlation",
        "title": f"{column_x} vs {column_y} ({method})",
        "column_x": column_x,
        "column_y": column_y,
        "method": method,
        "alpha": alpha,
        "primary_test": test_name,
        "primary_p_value": p_value,
        "significant": p_value < alpha,
        "tests": [
            {
                "test": test_name,
                "statistic": coefficient,
                "p_value": p_value,
                "null_hypothesis": "There is no correlation.",
            }
        ],
        "effect_size": {
            "name": "Correlation coefficient",
            "value": coefficient,
            "interpretation": strength,
            "ci_low": ci_low,
            "ci_high": ci_high,
        },
        "n": n,
        "assumptions": assumptions,
        "warnings": warnings,
        "interpretation": interpretation,
        "caveat": (
            "Correlation does not imply causation. A third variable may drive "
            "both columns."
        ),
    }


def _describe_cohens_d(value: float | None) -> str:
    if value is None:
        return "not available"
    magnitude = abs(value)
    if magnitude < 0.2:
        label = "negligible"
    elif magnitude < 0.5:
        label = "small"
    elif magnitude < 0.8:
        label = "medium"
    else:
        label = "large"
    return f"{label} (Cohen's d = {value:.3f})"


def _describe_eta_squared(value: float | None) -> str:
    if value is None:
        return "not available"
    if value < 0.01:
        label = "negligible"
    elif value < 0.06:
        label = "small"
    elif value < 0.14:
        label = "medium"
    else:
        label = "large"
    return f"{label} (η² = {value:.3f})"


def _describe_cramers_v(value: float | None) -> str:
    if value is None:
        return "not available"
    if value < 0.1:
        label = "negligible"
    elif value < 0.3:
        label = "weak"
    elif value < 0.5:
        label = "moderate"
    else:
        label = "strong"
    return f"{label} association (Cramér's V = {value:.3f})"
