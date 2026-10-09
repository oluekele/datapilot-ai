"""Chart building for the Visualization Studio.

Charts are described by a :class:`ChartSpec` so a chart can be validated,
rendered, exported, and recorded in a report for reproducibility. Rendering
uses matplotlib's object API (no pyplot global state), which keeps it safe
to call from concurrent Streamlit sessions.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from io import BytesIO
from typing import Any

import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.figure import Figure

from datapilot.exploration import classify_column, correlation_matrix

CHART_TYPES = {
    "histogram": "Histogram",
    "box": "Box plot",
    "bar": "Bar chart",
    "scatter": "Scatter plot",
    "line": "Line chart",
    "correlation_heatmap": "Correlation heatmap",
}

AGGREGATIONS = ("count", "mean", "median", "sum", "min", "max")
EXPORT_FORMATS = {"png": "image/png", "svg": "image/svg+xml"}

# Fixed categorical order, validated for colour-vision deficiency on adjacent
# pairs. Colours follow the group, never its rank, and are never cycled.
CATEGORICAL = (
    "#2a78d6",
    "#eb6834",
    "#1baf7a",
    "#eda100",
    "#e87ba4",
    "#008300",
    "#4a3aa7",
    "#e34948",
)
OTHER_COLOR = "#8c8b86"
SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e4e3df"

# Scatter points overlap, so every pair of colours must stay distinguishable;
# only the first three slots pass that check. Other forms allow all eight.
MAX_GROUPS = {"scatter": 3, "box": 8, "bar": 8, "line": 8, "histogram": 3}

DIVERGING = LinearSegmentedColormap.from_list(
    "datapilot_diverging", ["#2a78d6", "#f0efec", "#e34948"]
)


@dataclass
class ColumnFilter:
    """Keep rows whose column matches the filter."""

    column: str
    values: list[Any] | None = None
    min_value: float | None = None
    max_value: float | None = None


@dataclass
class ChartSpec:
    """A reproducible description of one chart."""

    chart_type: str
    x: str | None = None
    y: str | None = None
    group: str | None = None
    aggregation: str = "count"
    bins: int = 20
    title: str = ""
    filters: list[ColumnFilter] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def apply_filters(df: pd.DataFrame, filters: list[ColumnFilter]) -> pd.DataFrame:
    """Return the rows that pass every filter. The input is not modified."""
    mask = pd.Series(True, index=df.index)

    for item in filters:
        if item.column not in df.columns:
            raise ValueError(f"Filter column '{item.column}' does not exist.")
        series = df[item.column]
        if item.values is not None:
            mask &= series.isin(item.values)
        if item.min_value is not None:
            mask &= pd.to_numeric(series, errors="coerce") >= item.min_value
        if item.max_value is not None:
            mask &= pd.to_numeric(series, errors="coerce") <= item.max_value

    return df.loc[mask]


def validate_spec(df: pd.DataFrame, spec: ChartSpec) -> None:
    """Raise ValueError with a readable message if the spec cannot be drawn."""
    if spec.chart_type not in CHART_TYPES:
        raise ValueError(f"Unknown chart type: {spec.chart_type}")

    for role in ("x", "y", "group"):
        column = getattr(spec, role)
        if column is not None and column not in df.columns:
            raise ValueError(f"Column '{column}' does not exist.")

    if spec.aggregation not in AGGREGATIONS:
        raise ValueError(f"Unsupported aggregation: {spec.aggregation}")

    def kind(column: str | None) -> str | None:
        return classify_column(df[column]) if column else None

    chart = spec.chart_type
    if chart == "histogram":
        if kind(spec.x) != "numeric":
            raise ValueError("A histogram needs a numeric x column.")
        if not 2 <= spec.bins <= 200:
            raise ValueError("bins must be between 2 and 200.")
    elif chart == "box":
        if kind(spec.y) != "numeric":
            raise ValueError("A box plot needs a numeric y column.")
    elif chart == "bar":
        if spec.x is None:
            raise ValueError("A bar chart needs an x column to group by.")
        if spec.aggregation != "count" and kind(spec.y) != "numeric":
            raise ValueError(
                f"Aggregating with '{spec.aggregation}' needs a numeric y column."
            )
    elif chart == "scatter":
        if kind(spec.x) != "numeric" or kind(spec.y) != "numeric":
            raise ValueError("A scatter plot needs numeric x and y columns.")
    elif chart == "line":
        if spec.x is None or kind(spec.y) != "numeric":
            raise ValueError("A line chart needs an x column and a numeric y column.")
    elif chart == "correlation_heatmap":
        numeric = [c for c in df.columns if classify_column(df[c]) == "numeric"]
        if len(numeric) < 2:
            raise ValueError("A correlation heatmap needs two numeric columns.")

    if spec.group is not None and chart == "correlation_heatmap":
        raise ValueError("A correlation heatmap cannot be grouped.")
    if spec.group is not None and spec.group in (spec.x, spec.y):
        raise ValueError("The group column must differ from the axes.")


def _fold_groups(series: pd.Series, limit: int) -> tuple[pd.Series, list[str]]:
    """Keep the most frequent groups and fold the rest into 'Other'."""
    labels = series.astype("string").fillna("(missing)")
    order = labels.value_counts().index.tolist()
    if len(order) <= limit:
        return labels, [str(value) for value in order]
    keep = order[:limit]
    folded = labels.where(labels.isin(keep), "Other")
    return folded, [str(value) for value in keep] + ["Other"]


def _group_colors(groups: list[str]) -> dict[str, str]:
    colors = {}
    for index, name in enumerate(groups):
        colors[name] = OTHER_COLOR if name == "Other" else CATEGORICAL[index]
    return colors


def _new_figure() -> tuple[Figure, Any]:
    figure = Figure(figsize=(8, 4.8), dpi=110, facecolor=SURFACE)
    axes = figure.add_subplot(1, 1, 1)
    axes.set_facecolor(SURFACE)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axes.spines[side].set_color(GRID)
        axes.spines[side].set_linewidth(0.8)
    axes.tick_params(colors=TEXT_SECONDARY, labelsize=9, length=0)
    axes.grid(True, color=GRID, linewidth=0.6)
    axes.set_axisbelow(True)
    return figure, axes


def _label_axes(axes: Any, spec: ChartSpec, x_label: str, y_label: str) -> None:
    axes.set_xlabel(x_label, color=TEXT_SECONDARY, fontsize=10)
    axes.set_ylabel(y_label, color=TEXT_SECONDARY, fontsize=10)
    axes.set_title(
        spec.title or default_title(spec),
        color=TEXT_PRIMARY,
        fontsize=12,
        loc="left",
        pad=12,
    )


def _legend(axes: Any, title: str) -> None:
    legend = axes.legend(
        title=title,
        frameon=False,
        fontsize=9,
        title_fontsize=9,
        labelcolor=TEXT_PRIMARY,
    )
    legend.get_title().set_color(TEXT_SECONDARY)


def default_title(spec: ChartSpec) -> str:
    """A descriptive title derived from the spec."""
    chart = spec.chart_type
    if chart == "histogram":
        title = f"Distribution of {spec.x}"
    elif chart == "box":
        title = f"{spec.y} by {spec.x}" if spec.x else f"Spread of {spec.y}"
    elif chart == "bar":
        if spec.aggregation == "count":
            title = f"Row count by {spec.x}"
        else:
            title = f"{spec.aggregation.capitalize()} {spec.y} by {spec.x}"
    elif chart == "scatter":
        title = f"{spec.y} vs {spec.x}"
    elif chart == "line":
        title = f"{spec.y} over {spec.x}"
    else:
        title = "Correlation between numeric columns"
    if spec.group and chart != "box":
        title += f", by {spec.group}"
    return title


def build_chart(df: pd.DataFrame, spec: ChartSpec) -> Figure:
    """Render a chart for ``spec`` from the filtered data."""
    validate_spec(df, spec)
    data = apply_filters(df, spec.filters)
    if data.empty:
        raise ValueError("No rows remain after applying the filters.")

    figure, axes = _new_figure()
    chart = spec.chart_type

    if chart == "histogram":
        _draw_histogram(axes, data, spec)
    elif chart == "box":
        _draw_box(axes, data, spec)
    elif chart == "bar":
        _draw_bar(axes, data, spec)
    elif chart == "scatter":
        _draw_scatter(axes, data, spec)
    elif chart == "line":
        _draw_line(axes, data, spec)
    else:
        _draw_heatmap(figure, axes, data, spec)

    figure.tight_layout()
    return figure


def _draw_histogram(axes: Any, data: pd.DataFrame, spec: ChartSpec) -> None:
    values = pd.to_numeric(data[spec.x], errors="coerce").replace(
        [np.inf, -np.inf], np.nan
    )
    finite = values.dropna()
    if finite.empty:
        raise ValueError(f"'{spec.x}' has no finite values to plot.")
    edges = np.histogram_bin_edges(finite, bins=spec.bins)

    if spec.group:
        labels, groups = _fold_groups(data[spec.group], MAX_GROUPS["histogram"])
        colors = _group_colors(groups)
        for name in groups:
            subset = values[labels == name].dropna()
            axes.hist(
                subset,
                bins=edges,
                histtype="step",
                linewidth=2,
                color=colors[name],
                label=name,
            )
        _legend(axes, spec.group)
    else:
        axes.hist(
            finite,
            bins=edges,
            color=CATEGORICAL[0],
            edgecolor=SURFACE,
            linewidth=1,
        )
    _label_axes(axes, spec, spec.x, "Rows")


def _draw_box(axes: Any, data: pd.DataFrame, spec: ChartSpec) -> None:
    values = pd.to_numeric(data[spec.y], errors="coerce")
    style = {
        "patch_artist": True,
        "widths": 0.5,
        "medianprops": {"color": TEXT_PRIMARY, "linewidth": 2},
        "whiskerprops": {"color": TEXT_SECONDARY},
        "capprops": {"color": TEXT_SECONDARY},
        "flierprops": {
            "marker": "o",
            "markersize": 4,
            "markerfacecolor": TEXT_SECONDARY,
            "markeredgecolor": "none",
            "alpha": 0.6,
        },
    }

    if spec.x:
        labels, groups = _fold_groups(data[spec.x], MAX_GROUPS["box"])
        series = [values[labels == name].dropna() for name in groups]
        boxes = axes.boxplot(series, tick_labels=groups, **style)
        for patch in boxes["boxes"]:
            patch.set(facecolor=CATEGORICAL[0], alpha=0.35, edgecolor=CATEGORICAL[0])
        x_label = spec.x
    else:
        boxes = axes.boxplot([values.dropna()], tick_labels=[spec.y], **style)
        boxes["boxes"][0].set(
            facecolor=CATEGORICAL[0], alpha=0.35, edgecolor=CATEGORICAL[0]
        )
        x_label = ""
    axes.grid(False, axis="x")
    _label_axes(axes, spec, x_label, spec.y)


def _aggregate(frame: pd.DataFrame, keys: list[str], spec: ChartSpec) -> pd.Series:
    if spec.aggregation == "count":
        return frame.groupby(keys, observed=True).size()
    values = pd.to_numeric(frame[spec.y], errors="coerce")
    return values.groupby([frame[k] for k in keys], observed=True).agg(
        spec.aggregation
    )


def _draw_bar(axes: Any, data: pd.DataFrame, spec: ChartSpec) -> None:
    frame = data.copy()
    frame[spec.x], categories = _fold_groups(frame[spec.x], 15)
    y_label = "Rows" if spec.aggregation == "count" else (
        f"{spec.aggregation} of {spec.y}"
    )

    if spec.group:
        frame[spec.group], groups = _fold_groups(frame[spec.group], MAX_GROUPS["bar"])
        table = _aggregate(frame, [spec.x, spec.group], spec).unstack(fill_value=0)
        table = table.reindex(index=categories, columns=groups, fill_value=0)
        colors = _group_colors(groups)
        width = 0.8 / len(groups)
        positions = np.arange(len(categories))
        for index, name in enumerate(groups):
            axes.bar(
                positions + (index - (len(groups) - 1) / 2) * width,
                table[name].to_numpy(),
                width=width,
                color=colors[name],
                edgecolor=SURFACE,
                linewidth=1,
                label=name,
            )
        axes.set_xticks(positions, categories)
        _legend(axes, spec.group)
    else:
        series = _aggregate(frame, [spec.x], spec).reindex(categories)
        axes.bar(
            np.arange(len(series)),
            series.to_numpy(),
            width=0.7,
            color=CATEGORICAL[0],
            edgecolor=SURFACE,
            linewidth=1,
        )
        axes.set_xticks(np.arange(len(series)), categories)

    axes.grid(False, axis="x")
    if len(categories) > 6:
        for label in axes.get_xticklabels():
            label.set_rotation(35)
            label.set_horizontalalignment("right")
    _label_axes(axes, spec, spec.x, y_label)


def _draw_scatter(axes: Any, data: pd.DataFrame, spec: ChartSpec) -> None:
    frame = data[[c for c in (spec.x, spec.y, spec.group) if c]].copy()
    frame[spec.x] = pd.to_numeric(frame[spec.x], errors="coerce")
    frame[spec.y] = pd.to_numeric(frame[spec.y], errors="coerce")
    frame = frame.replace([np.inf, -np.inf], np.nan).dropna(subset=[spec.x, spec.y])
    if frame.empty:
        raise ValueError("No complete x/y pairs to plot.")

    alpha = 0.75 if len(frame) <= 2000 else 0.35
    style = {"s": 22, "alpha": alpha, "edgecolors": SURFACE, "linewidths": 0.8}

    if spec.group:
        labels, groups = _fold_groups(frame[spec.group], MAX_GROUPS["scatter"])
        colors = _group_colors(groups)
        for name in groups:
            subset = frame[labels == name]
            axes.scatter(
                subset[spec.x], subset[spec.y], color=colors[name], label=name, **style
            )
        _legend(axes, spec.group)
    else:
        axes.scatter(frame[spec.x], frame[spec.y], color=CATEGORICAL[0], **style)
    _label_axes(axes, spec, spec.x, spec.y)


def _draw_line(axes: Any, data: pd.DataFrame, spec: ChartSpec) -> None:
    frame = data.dropna(subset=[spec.x]).copy()
    if spec.aggregation == "count":
        y_label = "Rows"
    else:
        y_label = f"{spec.aggregation} of {spec.y}"

    if spec.group:
        frame[spec.group], groups = _fold_groups(frame[spec.group], MAX_GROUPS["line"])
        table = _aggregate(frame, [spec.x, spec.group], spec).unstack()
        colors = _group_colors(groups)
        for name in groups:
            if name in table.columns:
                series = table[name].dropna().sort_index()
                axes.plot(
                    series.index, series.to_numpy(), color=colors[name],
                    linewidth=2, label=name,
                )
        _legend(axes, spec.group)
    else:
        series = _aggregate(frame, [spec.x], spec).sort_index()
        axes.plot(series.index, series.to_numpy(), color=CATEGORICAL[0], linewidth=2)
    _label_axes(axes, spec, spec.x, y_label)


def _draw_heatmap(
    figure: Figure, axes: Any, data: pd.DataFrame, spec: ChartSpec
) -> None:
    matrix = correlation_matrix(data, method="pearson", min_periods=3)
    if matrix.empty:
        raise ValueError("Not enough numeric data for a correlation heatmap.")

    size = max(6.0, min(12.0, 0.6 * len(matrix) + 3))
    figure.set_size_inches(size, size * 0.85)
    image = axes.imshow(matrix.to_numpy(), cmap=DIVERGING, vmin=-1, vmax=1)
    labels = [str(c) for c in matrix.columns]
    axes.set_xticks(range(len(labels)), labels, rotation=45, ha="right")
    axes.set_yticks(range(len(labels)), labels)
    axes.grid(False)

    if len(labels) <= 12:
        for i in range(len(labels)):
            for j in range(len(labels)):
                value = matrix.iat[i, j]
                if pd.notna(value):
                    axes.text(
                        j, i, f"{value:.2f}", ha="center", va="center",
                        fontsize=8, color=TEXT_PRIMARY,
                    )

    colorbar = figure.colorbar(image, ax=axes, fraction=0.046, pad=0.04)
    colorbar.ax.tick_params(colors=TEXT_SECONDARY, labelsize=8)
    colorbar.outline.set_visible(False)
    _label_axes(axes, spec, "", "")


def figure_to_bytes(figure: Figure, fmt: str = "png") -> bytes:
    """Serialize a figure for download."""
    if fmt not in EXPORT_FORMATS:
        raise ValueError(f"Unsupported export format: {fmt}")
    buffer = BytesIO()
    figure.savefig(buffer, format=fmt, bbox_inches="tight", facecolor=SURFACE)
    return buffer.getvalue()


def describe_spec(spec: ChartSpec) -> str:
    """Plain-language description of a chart's settings, for reports."""
    parts = [CHART_TYPES[spec.chart_type]]
    if spec.x:
        parts.append(f"x = {spec.x}")
    if spec.y:
        parts.append(f"y = {spec.y}")
    if spec.group:
        parts.append(f"grouped by {spec.group}")
    if spec.chart_type in ("bar", "line"):
        parts.append(f"aggregation = {spec.aggregation}")
    if spec.chart_type == "histogram":
        parts.append(f"{spec.bins} bins")
    for item in spec.filters:
        if item.values is not None:
            shown = ", ".join(str(v) for v in item.values[:5])
            if len(item.values) > 5:
                shown += ", …"
            parts.append(f"filter {item.column} in [{shown}]")
        if item.min_value is not None or item.max_value is not None:
            parts.append(
                f"filter {item.min_value} ≤ {item.column} ≤ {item.max_value}"
            )
    return "; ".join(parts)
