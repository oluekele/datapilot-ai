
import numpy as np
import pandas as pd
import pytest

from datapilot.ml_readiness import inspect_target, run_baseline


def make_classification_data():
    return pd.DataFrame(
        {
            "age": list(range(20, 50)),
            "income": [20000 + i * 1000 for i in range(30)],
            "city": ["Lagos", "Abuja", "Kano"] * 10,
            "customer_left": [0, 1] * 15,
        }
    )


def test_classification_baseline_runs():
    df = make_classification_data()

    result = run_baseline(
        df,
        target="customer_left",
        task="classification",
    )

    assert result["task"] == "classification"
    assert result["target"] == "customer_left"
    assert result["training_rows"] + result["test_rows"] == 30
    assert result["models"]["dummy_baseline"]["status"] == "success"
    assert result["models"]["logistic_regression"]["status"] == "success"

    metrics = result["models"]["logistic_regression"]["metrics"]
    assert "accuracy" in metrics
    assert "f1_weighted" in metrics


def test_regression_baseline_runs():
    df = pd.DataFrame(
        {
            "size": np.arange(1, 31),
            "rooms": [2, 3, 4] * 10,
            "price": np.arange(1, 31) * 10000.0,
        }
    )

    result = run_baseline(
        df,
        target="price",
        task="regression",
    )

    assert result["models"]["dummy_baseline"]["status"] == "success"
    assert result["models"]["random_forest"]["status"] == "success"

    metrics = result["models"]["random_forest"]["metrics"]
    assert "mae" in metrics
    assert "rmse" in metrics
    assert "r2" in metrics


def test_missing_target_rows_are_excluded():
    df = make_classification_data()
    df.loc[0, "customer_left"] = np.nan

    result = run_baseline(
        df,
        target="customer_left",
        task="classification",
    )

    assert result["labelled_rows"] == 29
    assert any(
        finding["type"] == "missing_target"
        for finding in result["findings"]
    )


def test_suspicious_feature_name_is_flagged():
    df = make_classification_data()
    df["future_result"] = np.arange(len(df))

    findings = inspect_target(
        df,
        target="customer_left",
        task="classification",
    )

    assert any(
        finding["type"] == "possible_temporal_leakage"
        and finding["column"] == "future_result"
        for finding in findings
    )


def test_missing_target_column_is_rejected():
    df = make_classification_data()

    with pytest.raises(ValueError, match="does not exist"):
        run_baseline(df, target="unknown_target", task="classification")


def test_regression_rejects_text_target():
    df = pd.DataFrame(
        {
            "age": range(20),
            "outcome": ["yes", "no"] * 10,
        }
    )

    with pytest.raises(ValueError, match="numeric target"):
        run_baseline(df, target="outcome", task="regression")


def test_invalid_task_is_rejected():
    df = make_classification_data()

    with pytest.raises(ValueError, match="task must be"):
        run_baseline(
            df,
            target="customer_left",
            task="clustering",
        )


def test_input_data_is_not_modified():
    df = make_classification_data()
    original = df.copy(deep=True)

    run_baseline(
        df,
        target="customer_left",
        task="classification",
    )

    pd.testing.assert_frame_equal(df, original)

def test_baseline_runs_on_loader_nullable_dtypes():
    # The loader returns Int64/Float64/string dtypes containing pd.NA, which
    # scikit-learn imputers cannot handle without conversion.
    from datapilot.loader import load_dataset

    rows = ["age,city,score,left"]
    for i in range(40):
        city = "" if i % 7 == 0 else ["Lagos", "Abuja"][i % 2]
        score = "" if i % 5 == 0 else str(i * 1.5)
        rows.append(f"{20 + i},{city},{score},{i % 2}")
    df = load_dataset("\n".join(rows).encode(), "people.csv").dataframe
    assert str(df["age"].dtype) == "Int64"

    for task, target in (("classification", "left"), ("regression", "score")):
        result = run_baseline(df, target=target, task=task)
        assert all(
            model["status"] == "success" for model in result["models"].values()
        ), result["models"]
