"""Smoke tests that run every page of the Streamlit app headlessly."""

from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

from datapilot.loader import load_dataset
from datapilot.modules import OPTIONAL_KEYS
from datapilot.workspace import Workspace

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples" / "customer_churn.csv"
PAGES = {
    "health": "app_pages/health.py",
    "exploration": "app_pages/exploration.py",
    "analysis": "app_pages/analysis.py",
    "visualization": "app_pages/visualization.py",
    "ml_readiness": "app_pages/ml_readiness.py",
    "reports": "app_pages/reports.py",
}


def make_app(modules=OPTIONAL_KEYS, with_data=True):
    app = AppTest.from_file(str(ROOT / "app.py"), default_timeout=60)
    for key in OPTIONAL_KEYS:
        app.session_state[f"dp_module_{key}"] = key in modules
    if with_data:
        loaded = load_dataset(EXAMPLE.read_bytes(), EXAMPLE.name)
        app.session_state["dp_workspace"] = Workspace(dataset=loaded)
    return app


def assert_no_errors(app):
    assert not app.exception, [e.value for e in app.exception]


def test_overview_without_data():
    app = make_app(with_data=False).run()

    assert_no_errors(app)
    assert any("upload" in info.value.lower() for info in app.info)


def test_core_only_workflow_hides_optional_pages():
    app = make_app(modules=()).run()
    app.switch_page(PAGES["reports"]).run()
    assert_no_errors(app)

    # Disabled modules are not registered as pages at all.
    with pytest.raises(ValueError, match="Could not find a navigation page"):
        app.switch_page(PAGES["analysis"])


@pytest.mark.parametrize("module", list(PAGES))
def test_every_page_renders_with_data(module):
    app = make_app().run()
    app.switch_page(PAGES[module]).run()

    assert_no_errors(app)


@pytest.mark.parametrize("view", [
    "summary", "distributions", "categories", "missing", "correlations", "compare",
])
def test_every_exploration_view_renders(view):
    app = make_app()
    app.session_state["explore_view"] = view
    app.run()
    app.switch_page(PAGES["exploration"]).run()

    assert_no_errors(app)


@pytest.mark.parametrize("chart_type", [
    "histogram", "box", "bar", "scatter", "line", "correlation_heatmap",
])
def test_every_chart_type_renders(chart_type):
    app = make_app()
    app.session_state["viz_type"] = chart_type
    app.run()
    app.switch_page(PAGES["visualization"]).run()

    assert_no_errors(app)
    assert not app.info, [i.value for i in app.info]


@pytest.mark.parametrize("analysis", ["groups", "association", "correlation"])
def test_statistical_tests_run_and_save_to_report(analysis):
    app = make_app()
    app.session_state["analysis_kind"] = analysis
    app.run()
    app.switch_page(PAGES["analysis"]).run()
    app.button[0].click().run()  # form submit: "Run test"
    assert_no_errors(app)

    add = next(b for b in app.button if b.label == "Add to report")
    add.click().run()
    assert_no_errors(app)
    assert len(app.session_state["dp_workspace"].analyses) == 1


def test_repairs_ml_and_report_downloads_survive_reruns():
    app = make_app().run()
    app.switch_page(PAGES["health"]).run()
    apply_button = app.button(key="apply_repairs")
    assert apply_button.disabled  # Inactive until a repair is selected.

    repair_boxes = [b for b in app.checkbox if b.key and b.key.startswith("repair_")]
    repair_boxes[0].check().run()
    assert not app.button(key="apply_repairs").disabled
    assert app.button(key="apply_repairs").label == "Apply selected repairs (1)"
    assert any("1 of" in c.value for c in app.caption)

    for box in app.checkbox:
        if box.key and box.key.startswith("repair_"):
            box.check()
    app.run()
    app.button(key="apply_repairs").click().run()
    assert_no_errors(app)
    assert any("Applied" in s.value for s in app.success)
    workspace = app.session_state["dp_workspace"]
    assert workspace.repaired is not None
    # Applying is explicit, so every module switches to the repaired copy...
    assert workspace.variant == "repaired"
    assert app.segmented_control(key="dp_data_variant").value == "repaired"

    # ...and the sidebar switch can return every module to the original.
    app.segmented_control(key="dp_data_variant").set_value("original").run()
    assert app.session_state["dp_workspace"].variant == "original"
    app.switch_page(PAGES["exploration"]).run()
    assert any("original" in c.value for c in app.caption)

    app.segmented_control(key="dp_data_variant").set_value("repaired").run()
    assert app.session_state["dp_workspace"].variant == "repaired"
    assert any("Using the repaired data" in i.value for i in app.info)

    app.switch_page(PAGES["ml_readiness"]).run()
    app.selectbox(key="ml_target").set_value("churned")
    next(b for b in app.button if "Run ML" in b.label).click().run()
    assert_no_errors(app)
    assert app.session_state["dp_workspace"].ml_result is not None

    app.switch_page(PAGES["reports"]).run()
    assert_no_errors(app)
    # Reports no longer depend on the ML button being pressed in the same run.
    app.run()
    labels = {b.proto.label for b in app.get("download_button")}
    assert {"Report (.md)", "Results (.json)", "Workbook (.xlsx)",
            "Everything (.zip)"} <= labels
    preview = "\n".join(m.value for m in app.markdown)
    assert "ML readiness" in preview
    assert "data version used:** repaired" in preview.lower()


def test_missing_values_and_outliers_can_be_repaired_from_the_page():
    # Mirrors a dataset whose only issues are gaps and outliers: previously
    # nothing could be selected and no repair button was shown.
    rows = ["gpa,stress,hours"]
    for i in range(60):
        gpa = "" if i % 10 == 0 else f"{2 + (i % 20) / 10:.1f}"
        hours = "40" if i == 59 else str(5 + i % 4)
        rows.append(f"{gpa},{i % 7},{hours}")
    loaded = load_dataset("\n".join(rows).encode(), "students.csv")

    app = make_app(with_data=False)
    app.session_state["dp_workspace"] = Workspace(dataset=loaded)
    app.run()
    app.switch_page(PAGES["health"]).run()
    assert app.button(key="apply_repairs").disabled

    app.checkbox(key="repair_missing::gpa").check().run()
    app.selectbox(key="repair_method_missing::gpa").set_value("fill_mean").run()
    app.checkbox(key="repair_outliers::hours").check().run()
    assert app.button(key="apply_repairs").label == "Apply selected repairs (2)"

    app.button(key="apply_repairs").click().run()
    assert_no_errors(app)

    repaired = app.session_state["dp_workspace"].repaired
    assert repaired["gpa"].isna().sum() == 0
    assert repaired["hours"].max() < 40
    assert len(repaired) == 60
    message = app.success[0].value
    assert "filled 6 values with the mean" in message
    assert "capped 1 values" in message
