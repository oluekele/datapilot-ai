
import pandas as pd
import pytest

from datapilot.repairs import apply_repairs, build_repair_plan


def test_duplicate_rows_are_detected_and_removed():
    df = pd.DataFrame(
        {"name": ["Ada", "Ben", "Ben"], "score": [90, 80, 80]}
    )

    plan = build_repair_plan(df)
    assert any(item["id"] == "drop_duplicate_rows" for item in plan)

    repaired, applied = apply_repairs(df, ["drop_duplicate_rows"])

    assert len(repaired) == 2
    assert len(df) == 3  # The original was not changed.
    assert applied[0]["changed_count"] == 1


def test_constant_column_can_be_removed():
    df = pd.DataFrame(
        {"city": ["Lagos", "Lagos"], "age": [20, 30]}
    )

    repaired, _ = apply_repairs(df, ["drop_constant::city"])

    assert "city" not in repaired.columns
    assert "city" in df.columns


def test_whitespace_can_be_trimmed():
    df = pd.DataFrame({"name": [" Ada ", "Ben", None]})

    repaired, applied = apply_repairs(
        df, ["trim_whitespace::name"]
    )

    assert repaired.loc[0, "name"] == "Ada"
    assert repaired.loc[1, "name"] == "Ben"
    assert pd.isna(repaired.loc[2, "name"])
    assert applied[0]["changed_count"] == 1


def test_missing_numeric_values_filled_with_median_by_default():
    df = pd.DataFrame({"age": [20.0, None, 30.0, 100.0]})

    repaired, applied = apply_repairs(df, ["missing::age"])

    assert repaired["age"].tolist() == [20.0, 30.0, 30.0, 100.0]
    assert applied[0]["method"] == "Fill with the median"
    assert applied[0]["changed_count"] == 1
    assert df["age"].isna().sum() == 1  # The original was not changed.


@pytest.mark.parametrize(
    ("method", "expected"),
    [("fill_mean", [10.0, 20.0, 15.0]), ("drop_rows", [10.0, 20.0])],
)
def test_missing_numeric_methods(method, expected):
    df = pd.DataFrame({"score": [10.0, 20.0, None]})

    repaired, _ = apply_repairs(df, ["missing::score"], {"missing::score": method})

    assert repaired["score"].tolist() == expected


@pytest.mark.parametrize(
    ("method", "expected"),
    [("fill_mode", ["a", "a", "b", "a"]), ("fill_unknown", ["a", "a", "b", "Unknown"])],
)
def test_missing_text_methods(method, expected):
    df = pd.DataFrame({"city": ["a", "a", "b", None]})

    repaired, _ = apply_repairs(df, ["missing::city"], {"missing::city": method})

    assert repaired["city"].tolist() == expected


def test_integer_column_keeps_integer_dtype_when_filled():
    df = pd.DataFrame({"n": pd.array([1, 2, None, 4], dtype="Int64")})

    repaired, _ = apply_repairs(df, ["missing::n"], {"missing::n": "fill_mean"})

    assert str(repaired["n"].dtype) == "Int64"
    assert repaired["n"].tolist() == [1, 2, 2, 4]


def test_method_not_offered_for_column_is_rejected():
    df = pd.DataFrame({"city": ["a", None]})

    with pytest.raises(ValueError, match="not available"):
        apply_repairs(df, ["missing::city"], {"missing::city": "fill_median"})


def test_outliers_are_capped_at_iqr_bounds():
    df = pd.DataFrame({"amount": [10, 11, 12, 13, 14, 15, 1000]})
    plan = build_repair_plan(df)
    item = next(i for i in plan if i["id"] == "outliers::amount")
    assert item["risk"] == "high"

    repaired, applied = apply_repairs(df, ["outliers::amount"])

    assert len(repaired) == 7
    assert repaired["amount"].max() < 1000
    assert repaired["amount"].iloc[:6].tolist() == [10, 11, 12, 13, 14, 15]
    assert applied[0]["changed_count"] == 1
    assert df["amount"].max() == 1000


def test_outlier_rows_can_be_removed():
    df = pd.DataFrame({"amount": [10, 11, 12, 13, 14, 15, 1000], "id": range(7)})

    repaired, _ = apply_repairs(
        df, ["outliers::amount"], {"outliers::amount": "drop_rows"}
    )

    assert repaired["id"].tolist() == [0, 1, 2, 3, 4, 5]


def test_repairs_run_in_fixed_order_whatever_the_selection_order():
    df = pd.DataFrame({"name": [" Ada", "Ada", "Ben"], "x": [1.0, 1.0, None]})
    ids = ["missing::x", "drop_duplicate_rows", "trim_whitespace::name"]
    df_dupes = df.copy()
    df_dupes.loc[3] = ["Ben", None]

    first, _ = apply_repairs(df_dupes, ids)
    second, _ = apply_repairs(df_dupes, list(reversed(ids)))

    pd.testing.assert_frame_equal(first, second)


def test_unknown_action_is_rejected():
    df = pd.DataFrame({"age": [20, 30]})

    with pytest.raises(ValueError, match="Unknown"):
        apply_repairs(df, ["not_a_real_repair"])


def test_no_repairs_are_applied_when_none_are_selected():
    df = pd.DataFrame({"age": [20, 30]})

    repaired, applied = apply_repairs(df, [])

    pd.testing.assert_frame_equal(repaired, df)
    assert applied == []