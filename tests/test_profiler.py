
import pandas as pd
import pytest

from datapilot.profiler import profile_dataset


def test_overview_counts_missing_and_duplicate_rows():
    df = pd.DataFrame(
        {
            "name": ["Ada", "Ben", "Ben"],
            "score": [80, None, None],
        }
    )

    result = profile_dataset(df)

    assert result["overview"]["rows"] == 3
    assert result["overview"]["columns"] == 2
    assert result["overview"]["missing_cells"] == 2
    assert result["overview"]["duplicate_rows"] == 1


def test_missing_values_are_reported():
    df = pd.DataFrame({"age": [20, None, 30, None]})

    result = profile_dataset(df)
    finding_types = {f["type"] for f in result["findings"]}

    assert "missing_values" in finding_types

    finding = next(
        f for f in result["findings"]
        if f["type"] == "missing_values"
    )
    assert finding["column"] == "age"
    assert "2 of 4 rows" in finding["evidence"]


def test_constant_column_is_flagged():
    df = pd.DataFrame({"country": ["Nigeria", "Nigeria", None]})

    result = profile_dataset(df)

    assert any(
        f["type"] == "constant_column" and f["column"] == "country"
        for f in result["findings"]
    )


def test_iqr_outlier_is_flagged():
    df = pd.DataFrame(
        {"amount": [10, 11, 12, 13, 14, 15, 1000]}
    )

    result = profile_dataset(df)

    profile = result["columns"][0]
    assert profile["potential_outliers_iqr"] == 1

    assert any(
        f["type"] == "potential_outliers"
        for f in result["findings"]
    )


def test_clean_dataset_returns_informational_finding():
    df = pd.DataFrame(
        {
            "age": [20, 25, 30, 35],
            "score": [60, 70, 80, 90],
        }
    )

    result = profile_dataset(df)

    assert result["overview"]["missing_cells"] == 0
    assert result["overview"]["duplicate_rows"] == 0
    assert result["findings"][0]["type"] == "no_basic_issues_detected"


def test_empty_dataframe_is_supported():
    df = pd.DataFrame()

    result = profile_dataset(df)

    assert result["overview"]["rows"] == 0
    assert result["overview"]["columns"] == 0
    assert result["overview"]["missing_percentage"] == 0.0


def test_non_dataframe_input_is_rejected():
    with pytest.raises(TypeError):
        profile_dataset([1, 2, 3])