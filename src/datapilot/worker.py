"""Batch entry point used by the SaaS job runner.

Reads one JSON job description on stdin and writes one JSON object on stdout:
``{"ok": true, "result": {...}, "artifacts": [...]}`` or
``{"ok": false, "error": "..."}``. Errors reported this way are safe to show to
the user; anything else is a crash and the caller should show a generic
message. See docs/api-contract.md, "Worker protocol".

The caller owns storage, decryption, and access control. This process only
reads ``input_path``, writes ``output_path`` (REPAIR) and writes artifact
files directly inside ``output_dir`` (EXPLORE, ANALYZE, VISUALIZE, TRAIN).
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import pandas as pd

from datapilot.exploration import column_kinds
from datapilot.loader import DatasetLoadError, LoaderConfig, load_dataset
from datapilot.profiler import profile_dataset
from datapilot.repairs import apply_repairs, build_repair_plan
from datapilot.reports import _json_safe, build_quality_report

MIB = 1024 * 1024


def health_score(profile: dict[str, Any]) -> int:
    """A coarse 0-100 heuristic for the dashboard; not a statistical measure."""
    overview = profile["overview"]
    rows = overview["rows"] or 1
    penalty = min(40.0, overview["missing_percentage"])
    penalty += min(20.0, overview["duplicate_rows"] / rows * 100)
    for finding in profile.get("findings", []):
        penalty += 5 if finding.get("severity") == "high" else 1
    return max(0, min(100, round(100 - penalty)))


def _shape(df: pd.DataFrame) -> dict[str, int]:
    return {
        "rows": len(df),
        "columns": int(df.shape[1]),
        "missing_cells": int(df.isna().sum().sum()),
        "duplicate_rows": int(df.duplicated().sum()),
    }


def _load(job: dict[str, Any]) -> pd.DataFrame:
    config = LoaderConfig(max_file_bytes=int(job.get("max_file_mb", 10)) * MIB)
    data = Path(job["input_path"]).read_bytes()
    return load_dataset(data, job["filename"], config).dataframe


def run_profile(job: dict[str, Any]) -> dict[str, Any]:
    df = _load(job)
    profile = profile_dataset(df)
    plan = build_repair_plan(df)
    return {
        "overview": profile["overview"],
        "columns": profile["columns"],
        "findings": profile["findings"],
        "repairPlan": plan,
        "healthScore": health_score(profile),
        "columnKinds": column_kinds(df),
        "reportMarkdown": build_quality_report(
            profile, dataset_name=job.get("dataset_name", job["filename"]),
            repair_plan=plan,
        ),
    }


def run_repair(job: dict[str, Any]) -> dict[str, Any]:
    df = _load(job)
    repaired, applied = apply_repairs(
        df, list(job.get("actions", [])), dict(job.get("methods") or {})
    )
    repaired.to_csv(job["output_path"], index=False)
    return {"applied": applied, "before": _shape(df), "after": _shape(repaired)}


def _operation(name: str) -> Callable[..., Any]:
    """Adapt an operation ``run(df, params, writer, dataset_name)``.

    Operation modules (statistics, plotting, scikit-learn) are imported only
    when that operation runs, so PROFILE and REPAIR jobs start quickly.
    """

    def handler(job: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        from datapilot.artifacts import ArtifactWriter

        if name == "TRAIN":
            from datapilot.training import run_train as run
        else:
            from datapilot import operations

            run = {"EXPLORE": operations.run_explore, "ANALYZE": operations.run_analyze,
                   "VISUALIZE": operations.run_visualize}[name]
        writer = ArtifactWriter(job.get("output_dir") or "")
        df = _load(job)
        result = run(df, job.get("params"), writer,
                     str(job.get("dataset_name") or job["filename"]))
        return result, writer.artifacts

    return handler




HANDLERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "PROFILE": run_profile,
    "REPAIR": run_repair,
    "EXPLORE": _operation("EXPLORE"),
    "ANALYZE": _operation("ANALYZE"),
    "VISUALIZE": _operation("VISUALIZE"),
    "TRAIN": _operation("TRAIN"),
}


def main() -> int:
    job = json.load(sys.stdin)
    handler = HANDLERS.get(job.get("type"))
    if handler is None:
        out: dict[str, Any] = {"ok": False, "error": "Unsupported job type."}
    else:
        try:
            output = handler(job)
            result, artifacts = output if isinstance(output, tuple) else (output, [])
            out = {"ok": True, "result": _json_safe(result),
                   "artifacts": _json_safe(artifacts)}
        except (DatasetLoadError, ValueError) as exc:
            out = {"ok": False, "error": str(exc)[:480]}
    json.dump(out, sys.stdout, allow_nan=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
