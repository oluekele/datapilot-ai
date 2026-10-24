"""EXPLORE, ANALYZE and VISUALIZE operations for the SaaS worker.

Each ``run_*`` function takes the loaded DataFrame, the raw ``params`` object
from the job, an :class:`~datapilot.artifacts.ArtifactWriter` and the dataset
name. It returns a compact, JSON-friendly result (stored in Postgres) and
writes larger outputs (charts, full tables, reports) as artifacts.

The statistics come from :mod:`datapilot.exploration` and
:mod:`datapilot.analysis`; the charts from :mod:`datapilot.visualization`.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any

import numpy as np
import pandas as pd

from datapilot import __version__
from datapilot.analysis import (
    association_test,
    compare_groups,
    correlation_test,
    descriptive_statistics,
    grouped_summary,
)
from datapilot.artifacts import ArtifactWriter
from datapilot.charts import horizontal_bars, matrix_heatmap
from datapilot.exploration import (
    CORRELATION_METHODS,
    category_frequencies,
    classify_columns,
    column_kinds,
    correlation_matrix,
    dataset_summary,
    describe_correlation,
    missing_summary,
    numeric_distribution,
)
from datapilot.params import ParamError, Params
from datapilot.reports import _json_safe, _markdown_table, _timestamp
from datapilot.visualization import (
    AGGREGATIONS as CHART_AGGREGATIONS,
)
from datapilot.visualization import (
    CHART_TYPES,
    EXPORT_FORMATS,
    ChartSpec,
    ColumnFilter,
    apply_filters,
    build_chart,
    default_title,
    describe_spec,
    validate_spec,
)

MAX_RESULT_ROWS = 200
MAX_AUTO_NUMERIC = 12
MAX_AUTO_CATEGORICAL = 8
MAX_EXPLORE_COLUMNS = 20
MAX_HEATMAP_COLUMNS = 25
MAX_CHARTS = 12
MAX_FILTERS = 10
MAX_FILTER_VALUES = 100
MAX_GROUPS = 50
SCATTER_SAMPLE = 20_000
CORRELATION_SAMPLE = 20_000
TOP_CORRELATIONS = 20

# ---------------------------------------------------------------- column kinds


# ---------------------------------------------------------------- helpers


def _records(frame: pd.DataFrame, limit: int = MAX_RESULT_ROWS) -> list[dict]:
    if not isinstance(frame.index, pd.RangeIndex):
        frame = frame.reset_index()
    return _json_safe(frame.head(limit).to_dict("records"))


def _chart(
    writer: ArtifactWriter,
    df: pd.DataFrame,
    spec: ChartSpec,
    stem: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Render a ChartSpec to PNG; skip charts the data cannot support."""
    try:
        figure = build_chart(df, spec)
    except ValueError:
        return None
    title = spec.title or default_title(spec)
    meta = {"spec": spec.to_dict(), "description": describe_spec(spec)}
    meta.update(metadata or {})
    return writer.add_figure(figure, stem, title, metadata=meta)[0]


def _xlsx(sheets: dict[str, pd.DataFrame]) -> bytes:
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as excel:
        for name, frame in sheets.items():
            frame.to_excel(excel, sheet_name=name[:31], index=False)
    return buffer.getvalue()


def _report_header(title: str, dataset_name: str) -> list[str]:
    return [
        f"# {title}",
        "",
        f"- Dataset: {dataset_name}",
        f"- Generated: {_timestamp()} UTC by DataPilot AI {__version__}",
        "",
    ]


# ---------------------------------------------------------------- EXPLORE


def run_explore(
    df: pd.DataFrame, raw_params: Any, writer: ArtifactWriter, dataset_name: str
) -> dict[str, Any]:
    params = Params(raw_params, df)
    method = params.choice("correlationMethod", CORRELATION_METHODS, "pearson")
    requested = params.columns("columns", max_items=MAX_EXPLORE_COLUMNS)
    if df.empty:
        raise ValueError("The dataset has no rows to explore.")

    kinds = column_kinds(df)
    if requested is not None:
        numeric = [c for c in requested if kinds[c] == "numeric"]
        categorical = [c for c in requested if kinds[c] in ("categorical", "boolean")]
        unsupported = [c for c in requested if c not in numeric + categorical]
        if unsupported:
            raise ValueError(
                "Distribution charts need numeric, categorical or boolean "
                f"columns; '{unsupported[0]}' is {kinds[unsupported[0]]}."
            )
    else:
        numeric = [c for c, k in kinds.items() if k == "numeric"][:MAX_AUTO_NUMERIC]
        categorical = [
            c for c, k in kinds.items() if k in ("categorical", "boolean")
        ][:MAX_AUTO_CATEGORICAL]

    summary = dataset_summary(df)
    summary["column_kinds"] = kinds
    summary["kind_counts"] = {
        kind: sum(1 for value in kinds.values() if value == kind)
        for kind in sorted(set(kinds.values()))
    }
    missing = missing_summary(df)
    missing_by_column = missing["by_column"]
    missing_nonzero = missing_by_column[missing_by_column["missing"] > 0]

    distributions = []
    for column in numeric:
        stats = numeric_distribution(df, column)
        stats.pop("column", None)
        distributions.append({"column": column, "stats": stats})

    categories = []
    for column in categorical:
        frequencies = category_frequencies(df, column, top_n=15)
        categories.append({"column": column, "frequencies": _records(frequencies)})

    matrix, correlations, sample_rows = _correlations(df, method)

    # ---- charts
    for column in numeric:
        _chart(writer, df, ChartSpec("histogram", x=column, bins=30),
               f"histogram-{column}", {"column": column})
    for column in categorical:
        _chart(writer, df, ChartSpec("bar", x=column, aggregation="count",
                                     title=f"Most frequent values of {column}"),
               f"bar-{column}", {"column": column})

    if not matrix.empty:
        matrix = _heatmap_subset(matrix)
        writer.add_figure(
            matrix_heatmap(matrix, f"Correlation between numeric columns ({method})"),
            f"correlation-heatmap-{method}",
            f"Correlation heatmap ({method})",
            metadata={"method": method, "columns": list(map(str, matrix.columns))},
        )

    if not missing_nonzero.empty:
        top_missing = missing_nonzero.head(30)
        writer.add_figure(
            horizontal_bars(
                top_missing["column"].tolist(),
                top_missing["missing_percentage"].astype(float).tolist(),
                "Missing values by column",
                "% of rows missing",
            ),
            "missing-values",
            "Missing values by column",
            metadata={"columns_with_missing": len(missing_nonzero)},
        )

    # ---- workbook
    summary_rows = [
        {"field": "rows", "value": summary["rows"]},
        {"field": "columns", "value": summary["columns"]},
        {"field": "complete_rows", "value": summary["complete_rows"]},
        {"field": "complete_row_percentage", "value": summary["complete_row_percentage"]},
        {"field": "rows_with_missing", "value": missing["rows_with_missing"]},
        {"field": "correlation_method", "value": method},
    ] + [{"field": f"kind: {k}", "value": v} for k, v in summary["kind_counts"].items()]
    kinds_frame = pd.DataFrame(
        [{"column": c, "kind": k} for c, k in kinds.items()]
    )
    distribution_frame = pd.DataFrame(
        [
            {"column": d["column"]}
            | {k: v for k, v in d["stats"].items() if k not in ("histogram", "notes")}
            | {"notes": " ".join(d["stats"].get("notes", []))}
            for d in distributions
        ]
    )
    frequency_frame = pd.DataFrame(
        [
            {"column": c["column"]} | row
            for c in categories
            for row in c["frequencies"]
        ]
    )
    workbook = _xlsx(
        {
            "Summary": pd.DataFrame(summary_rows),
            "Column kinds": kinds_frame,
            "Missing": missing_by_column,
            "Distributions": distribution_frame,
            "Frequencies": frequency_frame,
            "Correlations": correlations,
        }
    )
    writer.add_bytes(workbook, "eda-workbook", "xlsx", "TABLE",
                     "Exploratory analysis workbook",
                     {"sheets": ["Summary", "Column kinds", "Missing",
                                 "Distributions", "Frequencies", "Correlations"]})

    result = {
        "summary": summary,
        "missing": {
            "columns_with_missing": missing["columns_with_missing"],
            "rows_with_missing": missing["rows_with_missing"],
            "rows_with_missing_percentage": missing["rows_with_missing_percentage"],
            "by_column": _records(missing_nonzero, 50),
        },
        "distributions": distributions,
        "categories": categories,
        "correlations": {
            "method": method,
            "sample_rows": sample_rows,
            "top": _records(correlations, TOP_CORRELATIONS),
        },
    }

    writer.add_text(
        _explore_markdown(result, dataset_name, writer), "eda-report", "md",
        "REPORT", "Exploratory data analysis report",
    )
    return result


def _correlations(
    df: pd.DataFrame, method: str
) -> tuple[pd.DataFrame, pd.DataFrame, int | None]:
    """Correlation matrix and ranked pairs, computed once.

    pandas' pairwise-complete correlation is slow on wide, large frames, so
    above ``CORRELATION_SAMPLE`` rows a random sample is used (the standard
    error of r is then below 0.01). ``sample_rows`` reports it.
    """
    numeric = [c for c, k in classify_columns(df).items() if k == "numeric"]
    data = df[numeric]
    sample_rows = None
    if len(data) > CORRELATION_SAMPLE:
        data = data.sample(CORRELATION_SAMPLE, random_state=42)
        sample_rows = CORRELATION_SAMPLE
    data = data.astype("float64").replace([np.inf, -np.inf], np.nan)
    columns = ["column_a", "column_b", "correlation", "strength", "n"]
    if data.shape[1] < 2:
        return pd.DataFrame(), pd.DataFrame(columns=columns), sample_rows
    matrix = correlation_matrix(data, method=method)
    valid = data.notna().to_numpy(dtype=np.int64)
    counts = valid.T @ valid
    values = matrix.to_numpy()
    upper_i, upper_j = np.triu_indices(len(numeric), k=1)
    keep = ~np.isnan(values[upper_i, upper_j])
    upper_i, upper_j = upper_i[keep], upper_j[keep]
    order = np.argsort(-np.abs(values[upper_i, upper_j]), kind="stable")
    order = order[:MAX_RESULT_ROWS]
    pairs = pd.DataFrame(
        [
            {
                "column_a": numeric[i],
                "column_b": numeric[j],
                "correlation": round(float(values[i, j]), 4),
                "strength": describe_correlation(float(values[i, j])),
                "n": int(counts[i, j]),
            }
            for i, j in zip(upper_i[order], upper_j[order], strict=True)
        ],
        columns=columns,
    )
    return matrix, pairs, sample_rows


def _heatmap_subset(matrix: pd.DataFrame) -> pd.DataFrame:
    """Keep the columns with the strongest correlations when there are many."""
    if len(matrix) <= MAX_HEATMAP_COLUMNS:
        return matrix
    strength = matrix.abs().where(~np.eye(len(matrix), dtype=bool)).max()
    keep = strength.sort_values(ascending=False).index[:MAX_HEATMAP_COLUMNS]
    keep = [c for c in matrix.columns if c in set(keep)]
    return matrix.loc[keep, keep]


def _explore_markdown(
    result: dict[str, Any], dataset_name: str, writer: ArtifactWriter
) -> str:
    summary = result["summary"]
    missing = result["missing"]
    lines = _report_header("Exploratory Data Analysis", dataset_name)
    lines += [
        "## Overview",
        "",
        f"- Rows: {summary['rows']}",
        f"- Columns: {summary['columns']}",
        (
            f"- Complete rows: {summary['complete_rows']} "
            f"({summary['complete_row_percentage']}%)"
        ),
        "- Column kinds: " + ", ".join(
            f"{k} {v}" for k, v in summary["kind_counts"].items()
        ),
        "",
        "## Missing values",
        "",
    ]
    if missing["by_column"]:
        lines.append(
            f"{missing['columns_with_missing']} column(s) and "
            f"{missing['rows_with_missing']} row(s) "
            f"({missing['rows_with_missing_percentage']}%) have missing values."
        )
        lines += ["", *_markdown_table(missing["by_column"][:30]), ""]
    else:
        lines += ["No missing values.", ""]

    if result["distributions"]:
        lines += ["## Numeric distributions", ""]
        rows = []
        notes = []
        for item in result["distributions"]:
            stats = item["stats"]
            rows.append({
                "column": item["column"],
                **{k: stats.get(k) for k in
                   ("count", "missing", "mean", "median", "std", "min", "max",
                    "skewness")},
            })
            notes += [f"- **{item['column']}**: {n}" for n in stats.get("notes", [])]
        lines += [*_markdown_table(rows), ""]
        if notes:
            lines += notes + [""]

    if result["categories"]:
        lines += ["## Categorical frequencies", ""]
        for item in result["categories"]:
            lines += [f"### {item['column']}", "",
                      *_markdown_table(item["frequencies"][:10]), ""]

    correlations = result["correlations"]
    lines += [f"## Strongest correlations ({correlations['method']})", ""]
    if correlations.get("sample_rows"):
        sample = correlations["sample_rows"]
        lines += [f"Computed on a random sample of {sample:,} rows.", ""]
    if correlations["top"]:
        lines += [
            *_markdown_table(correlations["top"]),
            "",
            "Correlation does not imply causation.",
            "",
        ]
    else:
        lines += ["Fewer than two numeric columns: no correlations computed.", ""]

    charts = [a for a in writer.artifacts if a["kind"] == "CHART"]
    if charts:
        lines += ["## Charts", ""]
        lines += [f"![{a['title']}]({a['file']})" for a in charts]
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- ANALYZE

ANALYZE_TESTS = (
    "descriptive",
    "grouped_summary",
    "compare_groups",
    "association",
    "correlation",
)


def _require_groups(df: pd.DataFrame, column: str, limit: int = MAX_GROUPS) -> None:
    count = int(df[column].nunique(dropna=True))
    if count > limit:
        raise ValueError(
            f"'{column}' has {count} distinct values; choose a grouping column "
            f"with at most {limit} groups."
        )


def run_analyze(
    df: pd.DataFrame, raw_params: Any, writer: ArtifactWriter, dataset_name: str
) -> dict[str, Any]:
    params = Params(raw_params, df)
    test = params.choice("test", ANALYZE_TESTS, required=True)
    if df.empty:
        raise ValueError("The dataset has no rows to analyse.")
    alpha = params.number("alpha", 0.05, 0.0, 0.5, exclusive=True)

    table: pd.DataFrame | None = None
    chart: ChartSpec | None = None
    details: dict[str, Any]

    if test == "descriptive":
        columns = params.columns("columns", max_items=50)
        if columns is None:
            numeric = [c for c, k in classify_columns(df).items() if k == "numeric"]
            if not numeric:
                raise ValueError("The dataset has no numeric columns to describe.")
            columns = numeric[:50]
        table = descriptive_statistics(df, columns)
        title = "Descriptive statistics"
        summary = _describe_descriptive(table)
        details = {"columns": columns}

    elif test == "grouped_summary":
        group = params.column("groupColumn", required=True)
        value = params.column("valueColumn", required=True)
        _require_groups(df, group)
        table = grouped_summary(
            df, group, value, aggregations=("count", "mean", "median", "std",
                                            "min", "max")
        )
        title = f"{value} by {group}"
        summary = _describe_grouped(table, group, value)
        details = {"group_column": group, "value_column": value,
                   "groups": len(table)}
        chart = ChartSpec("box", x=group, y=value)

    elif test == "compare_groups":
        group = params.column("groupColumn", required=True)
        value = params.column("valueColumn", required=True)
        output = compare_groups(df, group, value, alpha=alpha)
        table = output["group_summary"]
        title = output["title"]
        summary = _summary_from(output)
        details = _details_from(output, ("group_column", "value_column",
                                         "normality_checks", "levene_p_value"))
        chart = ChartSpec("box", x=group, y=value)

    elif test == "association":
        column_a = params.column("columnA", required=True)
        column_b = params.column("columnB", required=True)
        output = association_test(df, column_a, column_b, alpha=alpha)
        table = output["contingency_table"]
        table.columns = [str(c) for c in table.columns]
        title = output["title"]
        summary = _summary_from(output)
        details = _details_from(output, ("column_a", "column_b", "n"))
        if table.shape[1] <= 8:
            chart = ChartSpec("bar", x=column_a, group=column_b,
                              title=f"{column_a} by {column_b} (row counts)")
        else:
            writer.add_figure(
                matrix_heatmap(output["contingency_table"],
                               f"{column_a} vs {column_b} (row counts)",
                               diverging=False, value_format="{:.0f}",
                               x_label=column_b, y_label=column_a),
                f"heatmap-{column_a}-vs-{column_b}",
                f"{column_a} vs {column_b} (counts)",
            )

    else:
        column_x = params.column("columnX", required=True)
        column_y = params.column("columnY", required=True)
        method = params.choice("method", CORRELATION_METHODS, "pearson")
        output = correlation_test(df, column_x, column_y, method=method, alpha=alpha)
        effect = output["effect_size"]
        table = pd.DataFrame([{
            "column_x": column_x, "column_y": column_y, "method": method,
            "n": output["n"], "coefficient": effect["value"],
            "ci_low": effect["ci_low"], "ci_high": effect["ci_high"],
            "p_value": output["primary_p_value"],
        }])
        title = output["title"]
        summary = _summary_from(output)
        details = _details_from(output, ("column_x", "column_y", "method", "n"))
        chart = ChartSpec("scatter", x=column_x, y=column_y,
                          title=f"{column_y} vs {column_x}")

    stem = title if test == "descriptive" else f"{test}-{title}"
    if table is not None:
        writer.add_csv(table, stem, f"{title} – table")
    if chart is not None:
        data = df
        if chart.chart_type == "scatter" and len(df) > SCATTER_SAMPLE:
            data = df.sample(SCATTER_SAMPLE, random_state=42)
        _chart(writer, data, chart, f"{test}-chart-{title}")

    result = {
        "test": test,
        "title": title,
        "summary": summary,
        "details": details,
    }
    if table is not None:
        result["table"] = _records(table)
        if len(table) > MAX_RESULT_ROWS:
            result["details"]["table_truncated"] = True
    writer.add_text(_analysis_markdown(result, dataset_name), f"{test}-summary",
                    "md", "REPORT", f"{title} – summary")
    return _json_safe(result)


def _details_from(output: dict[str, Any], extra: tuple[str, ...]) -> dict[str, Any]:
    keys = ("primary_test", "primary_p_value", "significant", "alpha", "tests",
            "effect_size", "assumptions", "warnings", "interpretation", "caveat")
    return {key: output[key] for key in keys + extra if key in output}


def _summary_from(output: dict[str, Any]) -> str:
    parts = [output["interpretation"]]
    warnings = output.get("warnings") or []
    if warnings:
        parts.append("Caution: " + " ".join(warnings))
    parts.append(output["caveat"])
    return " ".join(parts)


def _describe_descriptive(table: pd.DataFrame) -> str:
    parts = [f"Descriptive statistics for {len(table)} numeric column(s)."]
    if "skewness" in table:
        skewed = table.loc[table["skewness"].abs() >= 1, "column"].tolist()
        if skewed:
            parts.append(
                "Strongly skewed (the median is a better typical value than "
                f"the mean): {', '.join(map(str, skewed[:10]))}."
            )
    with_missing = table.loc[table["missing"] > 0, "column"].tolist()
    if with_missing:
        parts.append(
            f"{len(with_missing)} column(s) have missing values, which are "
            "excluded from these statistics."
        )
    return " ".join(parts)


def _describe_grouped(table: pd.DataFrame, group: str, value: str) -> str:
    if table.empty:
        return f"No complete rows were found for {value} by {group}."
    ordered = table.sort_values("mean")
    low, high = ordered.iloc[0], ordered.iloc[-1]
    text = (
        f"Across {len(table)} groups of {group}, the mean {value} ranges from "
        f"{low['mean']:.4g} ({low[group]}) to {high['mean']:.4g} ({high[group]})."
    )
    small = table.loc[table["count"] < 30, group].astype(str).tolist()
    if small:
        text += (
            f" {len(small)} group(s) have fewer than 30 rows, so their averages "
            "are imprecise."
        )
    return text + (
        " This is a description, not a test: use compare_groups to check "
        "whether the differences are statistically meaningful."
    )


def _analysis_markdown(result: dict[str, Any], dataset_name: str) -> str:
    lines = _report_header(f"Analysis: {result['title']}", dataset_name)
    lines += ["## Summary", "", result["summary"], ""]
    details = result["details"]
    if details.get("tests"):
        lines += ["## Tests", "", *_markdown_table(details["tests"]), ""]
    if details.get("effect_size"):
        lines += ["## Effect size", "", *_markdown_table([details["effect_size"]]), ""]
    if result.get("table"):
        lines += ["## Table", "", *_markdown_table(result["table"][:50]), ""]
    for heading, key in (("Assumptions", "assumptions"), ("Warnings", "warnings")):
        if details.get(key):
            lines += [f"## {heading}", "", *[f"- {item}" for item in details[key]], ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- VISUALIZE

SPEC_KEYS = {"chartType", "x", "y", "group", "aggregation", "bins", "title",
             "filters"}


def _parse_filter(df: pd.DataFrame, raw: Any, position: str) -> ColumnFilter:
    if not isinstance(raw, dict):
        raise ParamError(f"{position}: each filter must be an object.")
    params = Params(raw, df)
    column = params.column("column", required=True)
    values = raw.get("values")
    if values is not None:
        if not isinstance(values, list) or not values:
            raise ValueError(f"{position}: filter 'values' must be a non-empty list.")
        if len(values) > MAX_FILTER_VALUES:
            raise ValueError(
                f"{position}: a filter accepts at most {MAX_FILTER_VALUES} values."
            )
        if any(isinstance(v, (dict, list)) for v in values):
            raise ValueError(f"{position}: filter values must be plain values.")
    minimum = params.number("minValue", None, -np.inf, np.inf)
    maximum = params.number("maxValue", None, -np.inf, np.inf)
    if values is None and minimum is None and maximum is None:
        raise ValueError(f"{position}: a filter needs values, minValue or maxValue.")
    if minimum is not None and maximum is not None and minimum > maximum:
        raise ValueError(f"{position}: minValue is greater than maxValue.")
    if (minimum is not None or maximum is not None) and not (
        pd.api.types.is_numeric_dtype(df[column])
    ):
        raise ValueError(f"{position}: range filters need a numeric column.")
    return ColumnFilter(column, values, minimum, maximum)


def parse_chart_spec(df: pd.DataFrame, raw: Any, index: int) -> ChartSpec:
    position = f"Chart {index + 1}"
    if not isinstance(raw, dict):
        raise ParamError(f"{position}: each chart must be an object.")
    params = Params(raw, df)
    try:
        chart_type = params.choice("chartType", CHART_TYPES, required=True)
        x = params.column("x")
        y = params.column("y")
        group = params.column("group")
        aggregation = params.choice("aggregation", CHART_AGGREGATIONS, "count")
        bins = params.integer("bins", 20, 2, 200)
        title = raw.get("title") or ""
        if not isinstance(title, str):
            raise ParamError("'title' must be text.")
    except ValueError as exc:
        raise ValueError(f"{position}: {exc}") from None
    raw_filters = raw.get("filters") or []
    if not isinstance(raw_filters, list) or len(raw_filters) > MAX_FILTERS:
        raise ValueError(f"{position}: 'filters' must be a list of at most "
                         f"{MAX_FILTERS} filters.")
    filters = [_parse_filter(df, item, position) for item in raw_filters]
    spec = ChartSpec(chart_type, x=x, y=y, group=group, aggregation=aggregation,
                     bins=bins, title=title.strip()[:150], filters=filters)
    try:
        validate_spec(df, spec)
    except ValueError as exc:
        raise ValueError(f"{position}: {exc}") from None
    return spec


def run_visualize(
    df: pd.DataFrame, raw_params: Any, writer: ArtifactWriter, dataset_name: str
) -> dict[str, Any]:
    params = Params(raw_params, df)
    raw_charts = params.items("charts", 1, MAX_CHARTS)
    formats = params.strings("formats", EXPORT_FORMATS, max_items=2) or ["png"]
    specs = [parse_chart_spec(df, raw, i) for i, raw in enumerate(raw_charts)]

    charts = []
    for index, spec in enumerate(specs):
        position = f"Chart {index + 1}"
        data = apply_filters(df, spec.filters)
        if data.empty:
            raise ValueError(f"{position}: no rows remain after applying the filters.")
        description = describe_spec(spec)
        if spec.chart_type == "scatter" and len(data) > SCATTER_SAMPLE:
            data = data.sample(SCATTER_SAMPLE, random_state=42)
            description += f"; random sample of {SCATTER_SAMPLE:,} rows"
        unfiltered = ChartSpec(**{**spec.__dict__, "filters": []})
        try:
            figure = build_chart(data, unfiltered)
        except ValueError as exc:
            raise ValueError(f"{position}: {exc}") from None
        title = spec.title or default_title(spec)
        writer.add_figure(
            figure,
            f"{index + 1:02d}-{spec.chart_type}-{title}",
            title,
            formats=formats,
            metadata={"spec": spec.to_dict(), "description": description,
                      "rows_plotted": len(data)},
        )
        charts.append({"title": title, "description": description})
    return {"charts": charts}
