import ast
import dataclasses
import io
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest

from datapilot import training, worker
from datapilot.loader import LoaderConfig, load_dataset

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "customer_churn.csv"


def run(monkeypatch, job):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(job)))
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    assert worker.main() == 0
    return json.loads(out.getvalue())


def train(monkeypatch, tmp_path, params, input_path=EXAMPLE):
    return run(monkeypatch, {
        "type": "TRAIN", "input_path": str(input_path), "filename": "c.csv",
        "dataset_name": "Churn", "output_dir": str(tmp_path / "out"),
        "params": params,
    })


def by_name(out):
    return {a["file"]: a for a in out["artifacts"]}


def example_frame():
    return load_dataset(EXAMPLE.read_bytes(), "c.csv", LoaderConfig()).dataframe


def check_result_shape(result, task):
    assert result["task"] == task
    assert set(result) >= {"task", "target", "features", "rows", "findings",
                           "leaderboard", "primaryMetric", "best",
                           "featureImportance"}
    primary = result["primaryMetric"]
    scores = [r["metrics"][primary] for r in result["leaderboard"]]
    assert scores == sorted(scores, reverse=True)
    assert result["best"]["algorithm"] == result["leaderboard"][0]["algorithm"]
    for row in result["leaderboard"]:
        assert {"algorithm", "label", "metrics", "cvScore", "fitSeconds"} <= set(row)


def test_classification_all_algorithms(monkeypatch, tmp_path):
    out = train(monkeypatch, tmp_path, {"task": "classification", "target": "churned"})
    assert out["ok"], out
    result = out["result"]
    check_result_shape(result, "classification")
    assert result["primaryMetric"] == "f1_weighted"
    assert {r["algorithm"] for r in result["leaderboard"]} == set(
        training.ALGORITHMS["classification"])
    assert result["rows"] == {"train": 322, "test": 81}
    assert "customer_id" not in result["features"]
    metrics = result["best"]["metrics"]
    assert set(metrics) == {"accuracy", "balanced_accuracy", "precision_weighted",
                            "recall_weighted", "f1_weighted", "roc_auc"}
    assert all(row["cvScore"] is not None for row in result["leaderboard"])
    importance = result["featureImportance"]
    assert 0 < len(importance) <= 20
    assert {i["feature"] for i in importance} <= set(result["features"])

    files = by_name(out)
    directory = tmp_path / "out"
    assert sorted(files) == sorted(p.name for p in directory.iterdir())
    best = result["best"]["algorithm"]
    model_artifact = files[f"model-{best}.joblib"]
    assert model_artifact["kind"] == "MODEL"
    meta = model_artifact["metadata"]
    assert meta["task"] == "classification" and meta["target"] == "churned"
    assert meta["features"] == result["features"]
    assert meta["sklearn_version"] and meta["classes"] == ["0", "1"]

    for name in ("model-comparison.png", "confusion-matrix.png", "roc-curve.png",
                 "feature-importance.png"):
        assert files[name]["kind"] == "CHART"
        assert files[name]["content_type"] == "image/png"

    predictions = pd.read_csv(directory / "predictions-test-set.csv")
    assert list(predictions.columns)[:3] == ["row", "actual", "predicted"]
    assert list(predictions.columns)[3] in ("probability_1", "score_1")
    assert len(predictions) == 81
    assert files["predictions-test-set.csv"]["kind"] == "DATA"

    script = files[f"train-{best}.py"]
    assert script["kind"] == "CODE" and script["content_type"] == "text/x-python"
    code = (directory / script["file"]).read_text()
    ast.parse(code)
    assert "TARGET = 'churned'" in code
    assert meta["estimator"] in code

    card = (directory / "model-card.md").read_text()
    assert "joblib.load" in card and "trust" in card

    # The saved file is the whole pipeline: it scores raw feature columns.
    model = joblib.load(directory / model_artifact["file"])
    df = example_frame()
    raw = df[result["features"]].head(5)
    assert len(model.predict(training._to_numpy_dtypes(raw))) == 5

    # Leakage safety: imputation statistics come from training rows only.
    numeric = model.named_steps["preprocessor"].named_transformers_["numeric"]
    test_rows = set(predictions["row"] - 1)
    train_frame = df.loc[[i for i in df.index if i not in test_rows]]
    expected = [float(train_frame[c].median()) for c in meta["numeric_features"]]
    np.testing.assert_allclose(numeric.named_steps["imputer"].statistics_, expected)


def test_regression_subset_without_cv(monkeypatch, tmp_path):
    params = {"task": "regression", "target": "tenure_months",
              "algorithms": ["ridge", "random_forest"], "cvFolds": 0,
              "testSize": 0.25,
              "features": ["monthly_charge", "plan", "support_tickets", "churned"]}
    out = train(monkeypatch, tmp_path, params)
    assert out["ok"], out
    result = out["result"]
    check_result_shape(result, "regression")
    assert result["primaryMetric"] == "r2"
    assert result["features"] == params["features"]
    assert result["rows"]["test"] == 101
    assert {r["algorithm"] for r in result["leaderboard"]} == {"ridge", "random_forest"}
    assert all(r["cvScore"] is None for r in result["leaderboard"])
    assert set(result["best"]["metrics"]) == {"r2", "mae", "rmse", "mape"}
    files = by_name(out)
    assert {"predicted-vs-actual.png", "residuals.png",
            "predictions-test-set.csv", "leaderboard.csv",
            "model-card.md"} <= set(files)
    predictions = pd.read_csv(tmp_path / "out" / "predictions-test-set.csv")
    assert "residual" in predictions.columns


def test_clustering(monkeypatch, tmp_path):
    out = train(monkeypatch, tmp_path, {"task": "clustering", "nClusters": 3})
    assert out["ok"], out
    result = out["result"]
    check_result_shape(result, "clustering")
    assert result["target"] is None and result["primaryMetric"] == "silhouette"
    assert result["featureImportance"] is None
    assert {r["algorithm"] for r in result["leaderboard"]} == set(
        training.ALGORITHMS["clustering"])
    assert set(result["best"]["metrics"]) == {"silhouette", "calinski_harabasz",
                                              "davies_bouldin"}
    assert sum(c["size"] for c in result["clusters"]) == 403
    assert len(result["clusters"]) == 3
    assert [row["k"] for row in result["elbow"]] == list(range(2, 9))
    files = by_name(out)
    assert {"cluster-scatter-pca.png", "kmeans-elbow-silhouette.png",
            "model-comparison.png"} <= set(files)
    labelled = pd.read_csv(tmp_path / "out" / "dataset-with-clusters.csv")
    assert len(labelled) == 403 and "cluster" in labelled.columns
    best = result["best"]["algorithm"]
    ast.parse((tmp_path / "out" / f"train-{best}.py").read_text())


def test_slow_algorithms_are_skipped_on_large_data(monkeypatch, tmp_path):
    registry = dict(training.ALGORITHMS["classification"])
    registry["svm"] = dataclasses.replace(registry["svm"], max_rows=100)
    monkeypatch.setitem(training.ALGORITHMS, "classification", registry)
    out = train(monkeypatch, tmp_path, {
        "task": "classification", "target": "plan",
        "algorithms": ["svm", "logistic_regression"], "cvFolds": 3})
    assert out["ok"], out
    result = out["result"]
    assert [r["algorithm"] for r in result["leaderboard"]] == ["logistic_regression"]
    assert any(f["type"] == "algorithm_skipped" and "Support vector" in f["evidence"]
               for f in result["findings"])
    assert result["best"]["metrics"]["roc_auc"] is not None  # multiclass OvR

    monkeypatch.setitem(training.ALGORITHMS, "classification", {
        **registry, "logistic_regression": dataclasses.replace(
            registry["logistic_regression"], max_rows=100)})
    out = train(monkeypatch, tmp_path, {
        "task": "classification", "target": "plan",
        "algorithms": ["svm", "logistic_regression"]})
    assert out["ok"] is False and "None of the selected algorithms" in out["error"]


@pytest.mark.parametrize(
    ("params", "message"),
    [
        ({}, "'task' is required"),
        ({"task": "forecasting"}, "Unsupported task"),
        ({"task": "classification"}, "'target' is required"),
        ({"task": "classification", "target": "ghost"}, "does not exist"),
        ({"task": "clustering", "target": "churned"}, "does not use a target"),
        ({"task": "regression", "target": "plan"}, "numeric target"),
        ({"task": "classification", "target": "churned",
          "algorithms": ["xgboost"]}, "Unsupported algorithms"),
        ({"task": "regression", "target": "monthly_charge",
          "algorithms": ["svm"]}, "Unsupported algorithms"),
        ({"task": "classification", "target": "churned", "testSize": 0.9},
         "between 0.1 and 0.5"),
        ({"task": "classification", "target": "churned", "cvFolds": 2},
         "0 (no cross-validation) or 3–10"),
        ({"task": "classification", "target": "churned", "cvFolds": 3.5},
         "whole number"),
        ({"task": "clustering", "nClusters": 1}, "between 2 and 20"),
        ({"task": "classification", "target": "churned",
          "features": ["churned", "plan"]}, "cannot also be a feature"),
        ({"task": "classification", "target": "customer_id"}, "classes"),
    ],
)
def test_user_errors(monkeypatch, tmp_path, params, message):
    out = train(monkeypatch, tmp_path, params)
    assert out["ok"] is False
    assert message in out["error"], out["error"]


def test_too_few_rows(monkeypatch, tmp_path):
    small = tmp_path / "small.csv"
    small.write_text("a,b,y\n" + "".join(f"{i},{i % 3},{i % 2}\n" for i in range(12)))
    out = train(monkeypatch, tmp_path, {"task": "classification", "target": "y"},
                input_path=small)
    assert out["ok"] is False and "at least 30 rows" in out["error"]
