import numpy as np
import pandas as pd
import pytest

from datapilot.exploration import (
    category_frequencies,
    classify_columns,
    compare_columns,
    correlation_matrix,
    dataset_summary,
    describe_correlation,
    exploration_snapshot,
    missing_summary,
    numeric_distribution,
    top_correlations,
)


@pytest.fixture
def mixed_df():
    rng = np.random.default_rng(0)
    n = 60
    x = rng.normal(size=n)
    return pd.DataFrame(
        {
            "x": x,
            "y": x * 2 + rng.normal(scale=0.1, size=n),
            "noise": rng.normal(size=n),
            "city": ["Lagos", "Abuja", "Kano"] * 20,
            "churned": [0, 1] * 30,
            "signup": pd.date_range("2024-01-01", periods=n),
            "comment": [f"note {i}" for i in range(n)],
        }
    )


def test_classify_columns(mixed_df):
    kinds = classify_columns(mixed_df)

    assert kinds == {
        "x": "numeric",
        "y": "numeric",
        "noise": "numeric",
        "city": "categorical",
        "churned": "boolean",
        "signup": "datetime",
        "comment": "text",
    }


def test_dataset_summary_counts_kinds_and_complete_rows():
    df = pd.DataFrame({"a": [1.5, None, 3.0], "b": ["x", "y", "x"]})

    summary = dataset_summary(df)

    assert summary["rows"] == 3
    assert summary["complete_rows"] == 2
    assert summary["kind_counts"]["numeric"] == 1
    assert summary["kind_counts"]["categorical"] == 1


def test_numeric_distribution_reports_skew_and_histogram():
    df = pd.DataFrame({"amount": [1] * 40 + [2] * 10 + [100]})

    result = numeric_distribution(df, "amount", bins=5)

    assert result["count"] == 51
    assert sum(b["count"] for b in result["histogram"]) == 51
    assert result["median"] == 1
    assert any("right-skewed" in note for note in result["notes"])


def test_numeric_distribution_rejects_text_column(mixed_df):
    with pytest.raises(ValueError, match="not numeric"):
        numeric_distribution(mixed_df, "city")


def test_numeric_distribution_handles_all_missing():
    df = pd.DataFrame({"a": [np.nan, np.nan]})

    result = numeric_distribution(df, "a")

    assert result["count"] == 0
    assert result["histogram"] == []


def test_category_frequencies_folds_tail_and_counts_missing():
    df = pd.DataFrame({"c": ["a"] * 5 + ["b"] * 3 + ["c", "d", None]})

    table = category_frequencies(df, "c", top_n=2)

    assert list(table["value"]) == ["a", "b", "(other values)"]
    assert table["count"].sum() == 11
    assert table.loc[2, "count"] == 3  # c, d, and missing


def test_missing_summary():
    df = pd.DataFrame({"a": [1, None, None], "b": [1, 2, None]})

    result = missing_summary(df)

    assert result["columns_with_missing"] == 2
    assert result["rows_with_missing"] == 2
    assert result["by_column"].iloc[0]["column"] == "a"


def test_correlations_rank_strongest_pair_first(mixed_df):
    top = top_correlations(mixed_df, limit=3)

    assert {top.iloc[0]["column_a"], top.iloc[0]["column_b"]} == {"x", "y"}
    assert top.iloc[0]["strength"] == "strong positive"
    assert top.iloc[0]["n"] == 60


def test_correlation_matrix_excludes_boolean_columns(mixed_df):
    matrix = correlation_matrix(mixed_df)

    assert "churned" not in matrix.columns
    assert set(matrix.columns) == {"x", "y", "noise"}


def test_correlation_rejects_unknown_method(mixed_df):
    with pytest.raises(ValueError, match="method"):
        correlation_matrix(mixed_df, method="kendall-ish")


def test_correlation_with_one_numeric_column_is_empty():
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})

    assert top_correlations(df).empty


@pytest.mark.parametrize(
    ("value", "label"),
    [(0.05, "negligible"), (-0.3, "weak negative"), (0.85, "strong positive")],
)
def test_describe_correlation(value, label):
    assert describe_correlation(value) == label


def test_compare_numeric_by_group(mixed_df):
    result = compare_columns(mixed_df, "x", "city")

    assert result["comparison"] == "numeric_by_group"
    assert result["group_column"] == "city"
    assert len(result["table"]) == 3
    assert "causes" in result["caveat"]


def test_compare_two_categories(mixed_df):
    result = compare_columns(mixed_df, "city", "churned")

    assert result["comparison"] == "category_vs_category"
    assert result["table"].to_numpy().sum() == 60


def test_compare_same_column_is_rejected(mixed_df):
    with pytest.raises(ValueError, match="different"):
        compare_columns(mixed_df, "x", "x")


def test_snapshot_does_not_modify_input(mixed_df):
    original = mixed_df.copy(deep=True)

    snapshot = exploration_snapshot(mixed_df, correlation_method="spearman")

    pd.testing.assert_frame_equal(mixed_df, original)
    assert snapshot["correlation_method"] == "spearman"
    assert snapshot["top_correlations"]
