import pandas as pd
import pytest

from datapilot.loader import load_dataset
from datapilot.modules import CORE_KEYS, resolve_modules
from datapilot.repairs import apply_repairs
from datapilot.workspace import ORIGINAL, REPAIRED, Workspace


@pytest.fixture
def workspace():
    loaded = load_dataset(b"name,score\nAda,1\nBen,2\nBen,2\n", "people.csv")
    return Workspace(dataset=loaded)


def test_core_modules_are_always_enabled():
    assert resolve_modules([]) == list(CORE_KEYS)
    assert resolve_modules(None) == ["health", "reports"]


def test_modules_keep_display_order():
    assert resolve_modules(["visualization", "exploration"]) == [
        "health",
        "exploration",
        "visualization",
        "reports",
    ]


def test_unknown_module_is_rejected():
    with pytest.raises(ValueError, match="Unknown"):
        resolve_modules(["astrology"])


def test_original_data_is_used_until_user_opts_in(workspace):
    repaired, applied = apply_repairs(
        workspace.dataset.dataframe, ["drop_duplicate_rows"]
    )
    workspace.set_repaired(repaired, applied)

    assert workspace.variant == ORIGINAL
    assert len(workspace.active_df) == 3

    workspace.use_repaired = True

    assert workspace.variant == REPAIRED
    assert len(workspace.active_df) == 2
    assert len(workspace.dataset.dataframe) == 3


def test_profiles_are_cached_per_variant(workspace):
    first = workspace.profile()

    assert workspace.profile() is first
    assert first["overview"]["duplicate_rows"] == 1

    repaired, applied = apply_repairs(
        workspace.dataset.dataframe, ["drop_duplicate_rows"]
    )
    workspace.set_repaired(repaired, applied)
    workspace.use_repaired = True

    assert workspace.profile()["overview"]["duplicate_rows"] == 0


def test_discarding_repairs_returns_to_original(workspace):
    repaired, applied = apply_repairs(
        workspace.dataset.dataframe, ["drop_duplicate_rows"]
    )
    workspace.set_repaired(repaired, applied)
    workspace.use_repaired = True

    workspace.discard_repairs()

    assert workspace.variant == ORIGINAL
    assert workspace.applied_repairs == []


def test_saved_items_record_data_variant(workspace):
    workspace.save_analysis({"title": "t"})
    workspace.save_chart({"title": "c"})
    workspace.save_ml_result({"target": "score"}, {"test_size": 0.2})

    assert workspace.analyses[0]["data_variant"] == ORIGINAL
    assert "saved_at" in workspace.charts[0]
    assert workspace.ml_settings["data_variant"] == ORIGINAL


def test_workspace_does_not_change_loaded_dataframe(workspace):
    original = workspace.dataset.dataframe.copy(deep=True)

    workspace.profile()

    pd.testing.assert_frame_equal(workspace.dataset.dataframe, original)


def test_cached_results_are_separate_per_variant(workspace):
    calls = []

    def count_rows(frame):
        calls.append(1)
        return len(frame)

    assert workspace.cached(("rows",), count_rows) == 3
    assert workspace.cached(("rows",), count_rows) == 3
    assert len(calls) == 1

    repaired, applied = apply_repairs(
        workspace.dataset.dataframe, ["drop_duplicate_rows"]
    )
    workspace.set_repaired(repaired, applied)
    workspace.use_repaired = True

    assert workspace.cached(("rows",), count_rows) == 2
    assert len(calls) == 2
