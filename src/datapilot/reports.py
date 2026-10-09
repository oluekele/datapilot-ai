"""Report generation and export helpers for DataPilot AI."""

from __future__ import annotations

import json
import re
import zipfile
from datetime import UTC, datetime
from io import BytesIO, StringIO
from typing import Any

import numpy as np
import pandas as pd

from datapilot import __version__

REPORT_SECTIONS = {
    "health": "Dataset health",
    "repairs": "Repairs",
    "exploration": "Data exploration",
    "analysis": "Statistical analysis",
    "charts": "Visualizations",
    "ml": "ML readiness",
}


def _json_safe(value: Any) -> Any:
    """Convert common pandas/NumPy values to JSON-safe Python values."""
    if isinstance(value, pd.DataFrame):
        if not isinstance(value.index, pd.RangeIndex):
            value = value.reset_index()
        return _json_safe(value.to_dict("records"))

    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]

    if isinstance(value, (np.integer,)):
        return int(value)

    if isinstance(value, (np.floating,)):
        return float(value) if np.isfinite(value) else None

    if isinstance(value, (np.bool_,)):
        return bool(value)

    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()

    if value is pd.NA or value is pd.NaT:
        return None

    if isinstance(value, float) and not np.isfinite(value):
        return None

    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    return str(value)


def _column_records(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize column profiles into a list of dictionaries."""
    columns = profile.get("columns", [])

    if isinstance(columns, dict):
        records = []
        for name, details in columns.items():
            if isinstance(details, dict):
                records.append({"column": str(name), **details})
            else:
                records.append({"column": str(name), "profile": details})
        return records

    if isinstance(columns, list):
        records = []
        for item in columns:
            if isinstance(item, dict):
                records.append(item.copy())
            else:
                records.append({"profile": item})
        return records

    return []


def export_profile_csv(profile: dict[str, Any]) -> str:
    """Return the column profiles as CSV text."""
    records = _column_records(profile)
    frame = pd.DataFrame(records)

    output = StringIO()
    frame.to_csv(output, index=False)
    return output.getvalue()


def export_profile_json(
    profile: dict[str, Any],
    dataset_name: str = "uploaded dataset",
) -> str:
    """Return the profiling summary as formatted JSON."""
    payload = {
        "report_version": "1.0",
        "dataset_name": dataset_name,
        "generated_at": datetime.now(UTC).isoformat(),
        "overview": profile.get("overview", {}),
        "columns": _column_records(profile),
        "findings": profile.get("findings", []),
    }

    return json.dumps(
        _json_safe(payload),
        indent=2,
        ensure_ascii=False,
        allow_nan=False,
    )


def build_ml_summary(baseline_result: dict[str, Any]) -> dict[str, Any]:
    """Extract report-safe ML results from a completed baseline run."""
    summary: dict[str, Any] = {}

    for key in ("target", "task", "labelled_rows", "training_rows", "test_rows"):
        if key in baseline_result:
            summary[key] = baseline_result[key]

    models = baseline_result.get("models")
    if isinstance(models, dict):
        successful_models: dict[str, Any] = {}
        failed_models: dict[str, str] = {}

        for model_name, model_result in models.items():
            if not isinstance(model_result, dict):
                continue

            if model_result.get("status") == "success":
                metrics = model_result.get("metrics")
                if isinstance(metrics, dict) and metrics:
                    successful_models[str(model_name)] = metrics

            elif "reason" in model_result:
                failed_models[str(model_name)] = str(model_result["reason"])

        if successful_models:
            summary["successful_model_metrics"] = successful_models

        if failed_models:
            summary["failed_models"] = failed_models

    for source_key, summary_key in (
        ("findings", "warnings"),
        ("limitations", "limitations"),
        ("excluded_all_missing_features", "excluded_all_missing_features"),
        ("excluded_high_cardinality_features", "excluded_high_cardinality_features"),
    ):
        value = baseline_result.get(source_key)
        if value:
            summary[summary_key] = value

    return summary


def _append_ml_summary(
    lines: list[str],
    ml_summary: dict[str, Any],
) -> None:
    """Append a readable ML baseline section to report lines."""
    for key in ("target", "task", "labelled_rows", "training_rows", "test_rows"):
        if key in ml_summary:
            label = key.replace("_", " ").capitalize()
            lines.append(f"- **{label}:** {_json_safe(ml_summary[key])}")

    metrics = ml_summary.get("successful_model_metrics")
    if isinstance(metrics, dict) and metrics:
        lines.extend(["", "### Successful model metrics", ""])

        for model_name, model_metrics in metrics.items():
            lines.append(f"- **{model_name}**")

            if isinstance(model_metrics, dict):
                for metric_name, metric_value in model_metrics.items():
                    label = str(metric_name).replace("_", " ")
                    lines.append(f"  - {label}: {_json_safe(metric_value)}")
            else:
                lines.append(f"  - {_json_safe(model_metrics)}")

    failed_models = ml_summary.get("failed_models")
    if isinstance(failed_models, dict) and failed_models:
        lines.extend(["", "### Failed models", ""])
        for model_name, reason in failed_models.items():
            lines.append(f"- **{model_name}:** {_json_safe(reason)}")

    warnings = ml_summary.get("warnings")
    if warnings:
        lines.extend(["", "### ML warnings", ""])

        if isinstance(warnings, list):
            for warning in warnings:
                if isinstance(warning, dict):
                    title = warning.get("title") or warning.get("type") or "Warning"
                    detail = (
                        warning.get("message")
                        or warning.get("description")
                        or warning.get("evidence")
                        or ""
                    )
                    lines.append(f"- **{title}:** {detail}")
                else:
                    lines.append(f"- {_json_safe(warning)}")
        else:
            lines.append(f"- {_json_safe(warnings)}")

    for key in (
        "excluded_all_missing_features",
        "excluded_high_cardinality_features",
        "limitations",
    ):
        value = ml_summary.get(key)
        if value:
            label = key.replace("_", " ").capitalize()
            lines.append(f"- **{label}:** {_json_safe(value)}")


def _timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _cell(value: Any) -> str:
    """Format a value for a Markdown table cell."""
    value = _json_safe(value)
    if value is None:
        return ""
    if isinstance(value, float):
        value = round(value, 4)
    return str(value).replace("|", "\\|").replace("\n", " ")


def _markdown_table(records: list[dict[str, Any]]) -> list[str]:
    keys = list(dict.fromkeys(key for record in records for key in record))
    lines = [
        "| " + " | ".join(str(key) for key in keys) + " |",
        "| " + " | ".join("---" for _ in keys) + " |",
    ]
    for record in records:
        lines.append(
            "| " + " | ".join(_cell(record.get(key)) for key in keys) + " |"
        )
    return lines


def _append_overview(lines: list[str], profile: dict[str, Any]) -> None:
    overview = profile.get("overview", {})
    if isinstance(overview, dict) and overview:
        for key, value in overview.items():
            label = str(key).replace("_", " ").capitalize()
            lines.append(f"- **{label}:** {_json_safe(value)}")
    else:
        lines.append("No overview information was supplied by the profiler.")


def _append_column_table(lines: list[str], profile: dict[str, Any]) -> None:
    columns = _column_records(profile)
    if columns:
        lines.extend(_markdown_table(columns))
    else:
        lines.append("No column-level profiles were available.")


def _append_findings(lines: list[str], profile: dict[str, Any]) -> None:
    findings = profile.get("findings", [])
    if not findings:
        lines.append("No findings were returned by the profiler.")
        return

    for finding in findings:
        if isinstance(finding, dict):
            title = finding.get("title") or finding.get("type") or "Finding"
            detail = (
                finding.get("message")
                or finding.get("description")
                or finding.get("evidence")
                or ""
            )
            column = finding.get("column")
            if column:
                title = f"{title} ({column})"
            severity = finding.get("severity")
            prefix = f"**{title}**"
            if severity:
                prefix += f" — severity: {severity}"
            lines.append(f"- {prefix}: {detail}")
        else:
            lines.append(f"- {finding}")


def _append_repair_plan(
    lines: list[str],
    repair_plan: list[dict[str, Any]] | None,
) -> None:
    if not repair_plan:
        lines.append("No repair plan was supplied.")
        return

    for item in repair_plan:
        if not isinstance(item, dict):
            lines.append(f"- {item}")
            continue

        title = (
            item.get("title")
            or item.get("action")
            or item.get("action_id")
            or "Recommendation"
        )
        detail = (
            item.get("description")
            or item.get("evidence")
            or item.get("recommendation")
            or ""
        )
        lines.append(f"- **{title}:** {detail}")


def build_quality_report(
    profile: dict[str, Any],
    dataset_name: str = "uploaded dataset",
    repair_plan: list[dict[str, Any]] | None = None,
    ml_summary: dict[str, Any] | None = None,
) -> str:
    """Build a readable Markdown dataset-quality report."""
    lines = [
        "# DataPilot AI — Dataset Quality Report",
        "",
        f"**Dataset:** {dataset_name}",
        f"**Generated (UTC):** {_timestamp()}",
        "",
        "## 1. Dataset overview",
        "",
    ]
    _append_overview(lines, profile)

    lines.extend(["", "## 2. Column profiles", ""])
    _append_column_table(lines, profile)

    lines.extend(["", "## 3. Findings", ""])
    _append_findings(lines, profile)

    lines.extend(["", "## 4. Repair recommendations", ""])
    _append_repair_plan(lines, repair_plan)

    lines.extend(["", "## 5. ML baseline summary", ""])

    if ml_summary:
        _append_ml_summary(lines, ml_summary)
    else:
        lines.append(
            "No ML baseline summary was supplied. "
            "This does not mean the dataset is ML-ready."
        )

    lines.extend([
        "",
        "## 6. Interpretation and limitations",
        "",
        "- Outlier flags are warnings, not proof of invalid data.",
        "- Potential leakage warnings are heuristic and require review.",
        (
            "- A clean quality report does not guarantee suitable data "
            "for every analytical task."
        ),
        "- Review recommendations before changing or removing data.",
        (
            "- For supervised ML, fit imputation and other preprocessing "
            "on training data only."
        ),
        "",
        "---",
        "Generated locally by DataPilot AI.",
        "",
    ])

    return "\n".join(lines)


def summarize_analysis(result: dict[str, Any]) -> dict[str, Any]:
    """Reduce a statistical analysis result to report-safe fields."""
    keys = (
        "analysis",
        "title",
        "primary_test",
        "primary_p_value",
        "significant",
        "alpha",
        "n",
        "tests",
        "effect_size",
        "group_summary",
        "contingency_table",
        "assumptions",
        "warnings",
        "interpretation",
        "caveat",
        "data_variant",
        "saved_at",
    )
    return {key: _json_safe(result[key]) for key in keys if key in result}


def summarize_chart(chart: dict[str, Any]) -> dict[str, Any]:
    """Keep a chart's settings for a report, without the image bytes."""
    return {
        key: _json_safe(value)
        for key, value in chart.items()
        if key not in ("png", "svg")
    }


def chart_filename(index: int, chart: dict[str, Any]) -> str:
    """A stable, filesystem-safe image name for a saved chart."""
    title = str(chart.get("title") or chart.get("spec", {}).get("chart_type") or "")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50] or "chart"
    return f"charts/{index:02d}-{slug}.png"


def _append_exploration(lines: list[str], exploration: dict[str, Any]) -> None:
    summary = exploration.get("summary", {})
    kinds = summary.get("kind_counts", {})
    lines.append(
        f"- **Rows:** {summary.get('rows', 0)} · **Columns:** "
        f"{summary.get('columns', 0)} · **Complete rows:** "
        f"{summary.get('complete_rows', 0)} "
        f"({summary.get('complete_row_percentage', 0.0)}%)"
    )
    if kinds:
        described = ", ".join(
            f"{count} {kind}" for kind, count in kinds.items() if count
        )
        lines.append(f"- **Column kinds:** {described}")

    missing = exploration.get("missing", {})
    lines.append(
        f"- **Rows with any missing value:** "
        f"{missing.get('rows_with_missing', 0)} "
        f"({missing.get('rows_with_missing_percentage', 0.0)}%)"
    )
    if missing.get("by_column"):
        lines.extend(["", "### Missing values by column", ""])
        lines.extend(_markdown_table(missing["by_column"]))

    method = exploration.get("correlation_method", "pearson")
    lines.extend(["", f"### Strongest correlations ({method})", ""])
    correlations = exploration.get("top_correlations") or []
    if correlations:
        lines.extend(_markdown_table(correlations))
        lines.extend([
            "",
            (
                "Correlation describes association only; it does not show "
                "that one column causes another."
            ),
        ])
    else:
        lines.append("Fewer than two numeric columns: no correlations computed.")


def _append_analyses(lines: list[str], analyses: list[dict[str, Any]]) -> None:
    for index, raw in enumerate(analyses, start=1):
        result = summarize_analysis(raw)
        lines.extend(["", f"### {index}. {result.get('title', 'Analysis')}", ""])
        lines.append(f"- **Primary test:** {result.get('primary_test', '')}")
        if result.get("primary_p_value") is not None:
            lines.append(
                f"- **p-value:** {result['primary_p_value']:.4g} "
                f"(α = {result.get('alpha')})"
            )
        effect = result.get("effect_size") or {}
        if effect:
            lines.append(
                f"- **{effect.get('name', 'Effect size')}:** "
                f"{effect.get('interpretation', '')}"
            )
        if result.get("data_variant"):
            lines.append(f"- **Data used:** {result['data_variant']}")
        if result.get("interpretation"):
            lines.extend(["", result["interpretation"]])
        table = result.get("group_summary") or result.get("contingency_table")
        if table:
            lines.extend([""] + _markdown_table(table))
        for heading, key in (("Assumptions", "assumptions"), ("Warnings", "warnings")):
            items = result.get(key) or []
            if items:
                lines.extend(["", f"**{heading}**", ""])
                lines.extend(f"- {item}" for item in items)
        if result.get("caveat"):
            lines.extend(["", f"_{result['caveat']}_"])


def _append_charts(lines: list[str], charts: list[dict[str, Any]]) -> None:
    for index, chart in enumerate(charts, start=1):
        lines.append(
            f"{index}. **{chart.get('title', 'Chart')}** — "
            f"{chart.get('description', '')} "
            f"(data: {chart.get('data_variant', 'original')}; image: "
            f"`{chart_filename(index, chart)}` in the ZIP bundle)"
        )


def _append_repairs(
    lines: list[str],
    repair_plan: list[dict[str, Any]] | None,
    applied_repairs: list[dict[str, Any]] | None,
) -> None:
    lines.extend(["### Recommendations", ""])
    _append_repair_plan(lines, repair_plan)
    lines.extend(["", "### Applied with user approval", ""])
    if applied_repairs:
        for item in applied_repairs:
            detail = item.get("detail") or f"{item.get('changed_count', 0)} change(s)"
            method = f" (method: {item['method']})" if item.get("method") else ""
            lines.append(
                f"- **{item.get('title', item.get('id'))}:** {detail}{method}"
            )
    else:
        lines.append("No repairs were applied. The original data was analysed.")


def build_integrated_report(
    *,
    dataset_name: str,
    sections: list[str],
    reproducibility: dict[str, Any] | None = None,
    profile: dict[str, Any] | None = None,
    repair_plan: list[dict[str, Any]] | None = None,
    applied_repairs: list[dict[str, Any]] | None = None,
    exploration: dict[str, Any] | None = None,
    analyses: list[dict[str, Any]] | None = None,
    charts: list[dict[str, Any]] | None = None,
    ml_summary: dict[str, Any] | None = None,
) -> str:
    """Build a Markdown report containing only the selected sections."""
    unknown = set(sections) - set(REPORT_SECTIONS)
    if unknown:
        raise ValueError(f"Unknown report section(s): {sorted(unknown)}")

    lines = [
        "# DataPilot AI — Data Analysis Report",
        "",
        f"**Dataset:** {dataset_name}",
        f"**Generated (UTC):** {_timestamp()}",
        f"**DataPilot AI version:** {__version__}",
        "",
        "## Contents",
        "",
    ]
    ordered = [key for key in REPORT_SECTIONS if key in sections]
    lines.extend(
        f"{number}. {REPORT_SECTIONS[key]}"
        for number, key in enumerate(ordered, start=1)
    )

    for number, key in enumerate(ordered, start=1):
        lines.extend(["", f"## {number}. {REPORT_SECTIONS[key]}", ""])

        if key == "health":
            if profile:
                _append_overview(lines, profile)
                lines.extend(["", "### Column profiles", ""])
                _append_column_table(lines, profile)
                lines.extend(["", "### Findings", ""])
                _append_findings(lines, profile)
            else:
                lines.append("No dataset health profile was available.")
        elif key == "repairs":
            _append_repairs(lines, repair_plan, applied_repairs)
        elif key == "exploration":
            if exploration:
                _append_exploration(lines, exploration)
            else:
                lines.append("No exploration results were available.")
        elif key == "analysis":
            if analyses:
                _append_analyses(lines, analyses)
            else:
                lines.append("No analyses were saved to the report.")
        elif key == "charts":
            if charts:
                _append_charts(lines, charts)
            else:
                lines.append("No charts were saved to the report.")
        elif key == "ml":
            if ml_summary:
                _append_ml_summary(lines, ml_summary)
            else:
                lines.append(
                    "No ML baseline was run. This does not mean the dataset "
                    "is ML-ready."
                )

    lines.extend(["", "## Reproducibility", ""])
    if reproducibility:
        for key, value in reproducibility.items():
            label = str(key).replace("_", " ").capitalize()
            lines.append(f"- **{label}:** {_json_safe(value)}")
    else:
        lines.append("No analysis settings were recorded.")

    lines.extend([
        "",
        "## Interpretation and limitations",
        "",
        "- Findings and outlier flags are warnings, not proof of invalid data.",
        "- Correlation and group differences do not establish causation.",
        (
            "- Statistical tests depend on their stated assumptions; a "
            "non-significant result does not show that no effect exists."
        ),
        (
            "- Running several tests increases the chance of a false positive; "
            "treat isolated significant results with caution."
        ),
        "- Leakage warnings are heuristic and require domain review.",
        "",
        "---",
        "Generated locally by DataPilot AI. No data left this machine.",
        "",
    ])
    return "\n".join(lines)


def build_integrated_json(
    *,
    dataset_name: str,
    sections: list[str],
    reproducibility: dict[str, Any] | None = None,
    profile: dict[str, Any] | None = None,
    repair_plan: list[dict[str, Any]] | None = None,
    applied_repairs: list[dict[str, Any]] | None = None,
    exploration: dict[str, Any] | None = None,
    analyses: list[dict[str, Any]] | None = None,
    charts: list[dict[str, Any]] | None = None,
    ml_summary: dict[str, Any] | None = None,
) -> str:
    """Machine-readable counterpart of :func:`build_integrated_report`."""
    unknown = set(sections) - set(REPORT_SECTIONS)
    if unknown:
        raise ValueError(f"Unknown report section(s): {sorted(unknown)}")

    payload: dict[str, Any] = {
        "report_version": "2.0",
        "datapilot_version": __version__,
        "dataset_name": dataset_name,
        "generated_at": datetime.now(UTC).isoformat(),
        "sections": [key for key in REPORT_SECTIONS if key in sections],
        "reproducibility": reproducibility or {},
    }
    if "health" in sections and profile:
        payload["health"] = {
            "overview": profile.get("overview", {}),
            "columns": _column_records(profile),
            "findings": profile.get("findings", []),
        }
    if "repairs" in sections:
        payload["repairs"] = {
            "recommendations": repair_plan or [],
            "applied": applied_repairs or [],
        }
    if "exploration" in sections and exploration:
        payload["exploration"] = exploration
    if "analysis" in sections:
        payload["analyses"] = [summarize_analysis(a) for a in analyses or []]
    if "charts" in sections:
        payload["charts"] = [summarize_chart(c) for c in charts or []]
    if "ml" in sections and ml_summary:
        payload["ml"] = ml_summary

    return json.dumps(
        _json_safe(payload), indent=2, ensure_ascii=False, allow_nan=False
    )


def _sheet_frame(records: Any) -> pd.DataFrame:
    safe = _json_safe(records)
    if isinstance(safe, dict):
        safe = [{"field": k, "value": json.dumps(v) if isinstance(v, (dict, list))
                 else v} for k, v in safe.items()]
    frame = pd.DataFrame(safe or [])
    for column in frame.columns:
        if frame[column].map(lambda v: isinstance(v, (dict, list))).any():
            frame[column] = frame[column].map(
                lambda v: json.dumps(v) if isinstance(v, (dict, list)) else v
            )
    return frame


def export_workbook(
    *,
    profile: dict[str, Any] | None = None,
    exploration: dict[str, Any] | None = None,
    analyses: list[dict[str, Any]] | None = None,
    ml_summary: dict[str, Any] | None = None,
    reproducibility: dict[str, Any] | None = None,
) -> bytes:
    """Export report tables as an Excel workbook, one sheet per table."""
    sheets: dict[str, pd.DataFrame] = {}
    if reproducibility:
        sheets["Reproducibility"] = _sheet_frame(reproducibility)
    if profile:
        sheets["Overview"] = _sheet_frame(profile.get("overview", {}))
        sheets["Columns"] = _sheet_frame(_column_records(profile))
        sheets["Findings"] = _sheet_frame(profile.get("findings", []))
    if exploration:
        sheets["Missing values"] = _sheet_frame(
            exploration.get("missing", {}).get("by_column", [])
        )
        sheets["Correlations"] = _sheet_frame(
            exploration.get("top_correlations", [])
        )
    if analyses:
        sheets["Analyses"] = _sheet_frame(
            [
                {
                    "title": a.get("title"),
                    "primary_test": a.get("primary_test"),
                    "p_value": a.get("primary_p_value"),
                    "alpha": a.get("alpha"),
                    "effect_size": (a.get("effect_size") or {}).get(
                        "interpretation"
                    ),
                    "warnings": " ".join(a.get("warnings") or []),
                    "interpretation": a.get("interpretation"),
                    "data_variant": a.get("data_variant"),
                }
                for a in analyses
            ]
        )
    if ml_summary:
        sheets["ML"] = _sheet_frame(ml_summary)
    if not sheets:
        sheets["Report"] = pd.DataFrame({"note": ["No report content selected."]})

    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name[:31], index=False)
    return buffer.getvalue()


def export_bundle(
    files: dict[str, str | bytes],
    charts: list[dict[str, Any]] | None = None,
) -> bytes:
    """Package report files and chart images into a ZIP archive."""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
        for index, chart in enumerate(charts or [], start=1):
            if chart.get("png"):
                bundle.writestr(chart_filename(index, chart), chart["png"])
    return buffer.getvalue()
