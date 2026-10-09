import numpy as np
import pandas as pd
import pytest

from datapilot.analysis import (
    association_test,
    compare_groups,
    correlation_test,
    descriptive_statistics,
    grouped_summary,
)


@pytest.fixture
def groups_df():
    rng = np.random.default_rng(42)
    return pd.DataFrame(
        {
            "group": ["control"] * 50 + ["treatment"] * 50,
            "score": np.concatenate(
                [rng.normal(50, 5, 50), rng.normal(58, 5, 50)]
            ),
            "region": (["north", "south"] * 50),
        }
    )


def test_descriptive_statistics_include_confidence_interval():
    df = pd.DataFrame({"a": [1.0, 2.0, 3.0, 4.0, 5.0], "b": list("vwxyz")})

    table = descriptive_statistics(df)

    assert list(table["column"]) == ["a"]
    row = table.iloc[0]
    assert row["mean"] == 3.0
    assert row["median"] == 3.0
    assert row["mean_ci95_low"] < 3.0 < row["mean_ci95_high"]


def test_descriptive_statistics_rejects_text_column():
    df = pd.DataFrame({"b": ["x", "y"]})

    with pytest.raises(ValueError, match="numeric"):
        descriptive_statistics(df, ["b"])


def test_grouped_summary(groups_df):
    table = grouped_summary(groups_df, "group", "score", ("count", "mean"))

    assert list(table["group"]) == ["control", "treatment"]
    assert list(table["count"]) == [50, 50]


def test_grouped_summary_rejects_unknown_aggregation(groups_df):
    with pytest.raises(ValueError, match="Unsupported"):
        grouped_summary(groups_df, "group", "score", ("mode",))


def test_two_group_comparison_detects_difference(groups_df):
    result = compare_groups(groups_df, "group", "score")

    assert result["primary_test"] == "Welch's t-test"
    assert result["significant"] is True
    assert result["effect_size"]["name"] == "Cohen's d"
    assert "large" in result["effect_size"]["interpretation"]
    assert {t["test"] for t in result["tests"]} == {
        "Welch's t-test",
        "Mann–Whitney U test",
    }
    assert any("independent" in a for a in result["assumptions"])
    assert "causes" in result["caveat"]


def test_no_difference_is_not_described_as_proof(groups_df):
    df = groups_df.copy()
    rng = np.random.default_rng(1)
    df["score"] = rng.normal(50, 5, len(df))

    result = compare_groups(df, "region", "score")

    if not result["significant"]:
        assert "does not show" in result["interpretation"]


def test_multi_group_comparison_uses_anova():
    df = pd.DataFrame(
        {
            "g": ["a"] * 40 + ["b"] * 40 + ["c"] * 40,
            "v": list(range(40)) + list(range(10, 50)) + list(range(20, 60)),
        }
    )

    result = compare_groups(df, "g", "v")

    assert result["primary_test"] == "One-way ANOVA"
    assert result["effect_size"]["name"] == "Eta squared"
    assert "which" in result["interpretation"]


def test_small_groups_trigger_warning():
    df = pd.DataFrame(
        {"g": ["a"] * 5 + ["b"] * 5, "v": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
    )

    result = compare_groups(df, "g", "v")

    assert any("Small groups" in w for w in result["warnings"])


def test_too_many_groups_rejected():
    df = pd.DataFrame({"g": list(range(30)) * 2, "v": range(60)})
    df["g"] = df["g"].astype(str)

    with pytest.raises(ValueError, match="limited to"):
        compare_groups(df, "g", "v")


def test_single_group_rejected():
    df = pd.DataFrame({"g": ["a"] * 5, "v": range(5)})

    with pytest.raises(ValueError, match="two groups"):
        compare_groups(df, "g", "v")


def test_invalid_alpha_rejected(groups_df):
    with pytest.raises(ValueError, match="alpha"):
        compare_groups(groups_df, "group", "score", alpha=1.5)


def test_association_test_detects_dependence():
    df = pd.DataFrame(
        {
            "plan": ["basic"] * 60 + ["premium"] * 60,
            "churned": ["yes"] * 45 + ["no"] * 15 + ["yes"] * 10 + ["no"] * 50,
        }
    )

    result = association_test(df, "plan", "churned")

    assert result["significant"] is True
    assert result["effect_size"]["name"] == "Cramér's V"
    assert result["n"] == 120
    assert result["contingency_table"].shape == (2, 2)


def test_association_test_warns_on_sparse_table():
    df = pd.DataFrame(
        {"a": ["x", "y", "x", "y", "x", "x"], "b": ["p", "q", "p", "p", "q", "p"]}
    )

    result = association_test(df, "a", "b")

    assert any("expected count" in w for w in result["warnings"])


def test_association_test_rejects_numeric_column(groups_df):
    with pytest.raises(ValueError, match="categorical"):
        association_test(groups_df, "score", "group")


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_correlation_test(method):
    x = np.arange(50, dtype=float)
    df = pd.DataFrame({"x": x, "y": x * 3 + np.sin(x)})

    result = correlation_test(df, "x", "y", method=method)

    assert result["effect_size"]["value"] > 0.9
    assert result["significant"] is True
    assert result["n"] == 50
    assert "causation" in result["caveat"]


def test_correlation_test_includes_confidence_interval():
    rng = np.random.default_rng(3)
    x = rng.normal(size=100)
    df = pd.DataFrame({"x": x, "y": x + rng.normal(size=100)})

    result = correlation_test(df, "x", "y")
    effect = result["effect_size"]

    assert effect["ci_low"] < effect["value"] < effect["ci_high"]


def test_correlation_test_rejects_constant_column():
    df = pd.DataFrame({"x": [1.0, 2.0, 3.0, 4.0], "y": [5.0] * 4})

    with pytest.raises(ValueError, match="distinct"):
        correlation_test(df, "x", "y")


def test_analysis_does_not_modify_input(groups_df):
    original = groups_df.copy(deep=True)

    compare_groups(groups_df, "group", "score")
    association_test(groups_df, "group", "region")

    pd.testing.assert_frame_equal(groups_df, original)
