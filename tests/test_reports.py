import json

import pytest

from datapilot.reports import (
    build_ml_summary,
    build_quality_report,
    export_profile_csv,
    export_profile_json,
)


@pytest.fixture
def sample_profile():
    return {
        "overview": {
            "rows": 100,
            "columns": 3,
            "duplicate_rows": 2,
        },
        "columns": [
            {
                "column": "age",
                "dtype": "int64",
                "missing_count": 4,
                "missing_pct": 4.0,
            },
            {
                "column": "score",
                "dtype": "float64",
                "missing_count": 0,
                "missing_pct": 0.0,
            },
        ],
        "findings": [
            {
                "title": "Missing values",
                "severity": "medium",
                "message": "The age column has missing values.",
            }
        ],
    }


def test_csv_export_contains_column_names(sample_profile):
    csv_text = export_profile_csv(sample_profile)

    assert "column" in csv_text
    assert "age" in csv_text
    assert "score" in csv_text


def test_json_export_is_valid(sample_profile):
    json_text = export_profile_json(
        sample_profile,
        dataset_name="sample.csv",
    )
    data = json.loads(json_text)

    assert data["dataset_name"] == "sample.csv"
    assert data["overview"]["rows"] == 100
    assert len(data["columns"]) == 2


def test_json_export_handles_non_finite_values():
    profile = {
        "overview": {"mean": float("nan")},
        "columns": [],
        "findings": [],
    }

    data = json.loads(export_profile_json(profile))

    assert data["overview"]["mean"] is None


def test_markdown_report_contains_expected_sections(sample_profile):
    report = build_quality_report(
        sample_profile,
        dataset_name="sample.csv",
        repair_plan=[
            {
                "title": "Review missing values",
                "evidence": "4 rows are missing age.",
            }
        ],
    )

    assert "# DataPilot AI" in report
    assert "sample.csv" in report
    assert "Dataset overview" in report
    assert "Column profiles" in report
    assert "Findings" in report
    assert "Repair recommendations" in report
    assert "4 rows are missing age." in report


def test_ml_baseline_results_are_included_in_report(sample_profile):
    baseline_result = {
        "target": "churned",
        "task": "classification",
        "labelled_rows": 100,
        "training_rows": 80,
        "test_rows": 20,
        "models": {
            "logistic_regression": {
                "status": "success",
                "metrics": {"accuracy": 0.9, "f1_weighted": 0.88},
            },
            "random_forest": {
                "status": "failed",
                "reason": "Insufficient data",
            },
        },
        "findings": [
            {
                "type": "possible_leakage",
                "severity": "warning",
                "evidence": "The feature may reveal the target.",
            }
        ],
        "limitations": ["A single holdout score is not a guarantee."],
    }

    report = build_quality_report(
        profile=sample_profile,
        dataset_name="sample.csv",
        ml_summary=build_ml_summary(baseline_result),
    )

    assert "**Target:** churned" in report
    assert "**Task:** classification" in report
    assert "**logistic_regression**" in report
    assert "accuracy: 0.9" in report
    assert "f1 weighted: 0.88" in report
    assert "**random_forest:** Insufficient data" in report
    assert "possible_leakage" in report
    assert "The feature may reveal the target." in report
    assert "A single holdout score is not a guarantee." in report


def test_empty_profile_still_generates_report():
    report = build_quality_report({})

    assert "Dataset Quality Report" in report
    assert "No findings" in report


# Integrated (multi-module) reports ----------------------------------------

import io
import zipfile

import pandas as pd

from datapilot.analysis import compare_groups
from datapilot.exploration import exploration_snapshot
from datapilot.reports import (
    build_integrated_json,
    build_integrated_report,
    export_bundle,
    export_workbook,
)


@pytest.fixture
def analysis_result():
    df = pd.DataFrame(
        {"g": ["a"] * 30 + ["b"] * 30, "v": list(range(30)) + list(range(20, 50))}
    )
    result = compare_groups(df, "g", "v")
    result["data_variant"] = "original"
    return result


@pytest.fixture
def snapshot():
    df = pd.DataFrame(
        {"x": range(20), "y": [v * 2 for v in range(20)], "z": [None] + [1] * 19}
    )
    return exploration_snapshot(df)


def test_integrated_report_contains_only_selected_sections(
    sample_profile, analysis_result
):
    report = build_integrated_report(
        dataset_name="sample.csv",
        sections=["health", "analysis"],
        profile=sample_profile,
        analyses=[analysis_result],
        reproducibility={"alpha": 0.05},
    )

    assert "## 1. Dataset health" in report
    assert "## 2. Statistical analysis" in report
    assert "v by g" in report
    assert "Cohen's d" in report
    assert "ML readiness" not in report
    assert "Visualizations" not in report
    assert "**Alpha:** 0.05" in report
    assert "do not establish causation" in report


def test_integrated_report_explains_empty_sections():
    report = build_integrated_report(
        dataset_name="d.csv",
        sections=["analysis", "charts", "ml", "repairs"],
    )

    assert "No analyses were saved" in report
    assert "No charts were saved" in report
    assert "does not mean the dataset is ML-ready" in report
    assert "No repairs were applied" in report


def test_integrated_report_rejects_unknown_section():
    with pytest.raises(ValueError, match="Unknown report section"):
        build_integrated_report(dataset_name="d", sections=["horoscope"])


def test_integrated_report_includes_exploration_and_charts(snapshot):
    report = build_integrated_report(
        dataset_name="d.csv",
        sections=["exploration", "charts"],
        exploration=snapshot,
        charts=[{"title": "Ages", "description": "Histogram; x = age"}],
    )

    assert "Strongest correlations (pearson)" in report
    assert "strong positive" in report
    assert "charts/01-ages.png" in report


def test_integrated_json_is_valid_and_serializes_tables(
    sample_profile, analysis_result, snapshot
):
    text = build_integrated_json(
        dataset_name="sample.csv",
        sections=["health", "exploration", "analysis", "charts"],
        profile=sample_profile,
        exploration=snapshot,
        analyses=[analysis_result],
        charts=[{"title": "c", "png": b"\x89PNG", "spec": {"chart_type": "bar"}}],
    )
    data = json.loads(text)

    assert data["sections"] == ["health", "exploration", "analysis", "charts"]
    assert data["analyses"][0]["group_summary"][0]["group"] == "a"
    assert "png" not in data["charts"][0]
    assert data["health"]["overview"]["rows"] == 100


def test_workbook_has_one_sheet_per_table(sample_profile, analysis_result, snapshot):
    content = export_workbook(
        profile=sample_profile,
        exploration=snapshot,
        analyses=[analysis_result],
        reproducibility={"alpha": 0.05},
    )
    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None)

    assert {"Reproducibility", "Overview", "Columns", "Findings", "Analyses"} <= set(
        sheets
    )
    assert sheets["Analyses"].loc[0, "title"] == "v by g"


def test_bundle_contains_files_and_chart_images():
    content = export_bundle(
        {"report.md": "# Report", "profile.json": "{}"},
        charts=[{"title": "Income by city", "png": b"\x89PNGdata"}],
    )

    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        names = set(bundle.namelist())
        assert names == {
            "report.md",
            "profile.json",
            "charts/01-income-by-city.png",
        }
        assert bundle.read("charts/01-income-by-city.png") == b"\x89PNGdata"
