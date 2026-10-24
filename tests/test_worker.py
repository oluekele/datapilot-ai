import io
import json
from pathlib import Path

import pandas as pd

from datapilot import worker

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "customer_churn.csv"


def run(monkeypatch, job):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(job)))
    out = io.StringIO()
    monkeypatch.setattr("sys.stdout", out)
    assert worker.main() == 0
    return json.loads(out.getvalue())


def test_profile_returns_plan_score_and_report(monkeypatch):
    out = run(monkeypatch, {"type": "PROFILE", "input_path": str(EXAMPLE), "filename": "c.csv"})
    assert out["ok"]
    result = out["result"]
    assert result["overview"]["rows"] == 403
    assert 0 <= result["healthScore"] <= 100
    assert any(item["id"] == "drop_duplicate_rows" for item in result["repairPlan"])
    assert "Dataset Quality Report" in result["reportMarkdown"]


def test_repair_writes_new_file_and_keeps_input(monkeypatch, tmp_path):
    before = EXAMPLE.read_bytes()
    output = tmp_path / "out.csv"
    out = run(monkeypatch, {
        "type": "REPAIR", "input_path": str(EXAMPLE), "filename": "c.csv",
        "output_path": str(output), "actions": ["drop_duplicate_rows"],
    })
    assert out["ok"]
    assert out["result"]["after"]["rows"] == 400
    assert len(pd.read_csv(output)) == 400
    assert EXAMPLE.read_bytes() == before


def test_user_errors_are_reported_not_raised(monkeypatch, tmp_path):
    bad = tmp_path / "x.txt"
    bad.write_text("a,b\n1,2\n")
    out = run(monkeypatch, {"type": "PROFILE", "input_path": str(bad), "filename": "x.txt"})
    assert out == {"ok": False, "error": "Unsupported file type. Upload a .csv or .xlsx file."}

    out = run(monkeypatch, {
        "type": "REPAIR", "input_path": str(EXAMPLE), "filename": "c.csv",
        "output_path": str(tmp_path / "o.csv"), "actions": ["not-a-repair"],
    })
    assert out["ok"] is False and "Unknown" in out["error"]
