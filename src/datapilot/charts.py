"""Chart helpers shared by the EXPLORE, ANALYZE and TRAIN operations.

They reuse the palette and axes styling from :mod:`datapilot.visualization`
so every generated image looks like the Visualization Studio's charts. All
figures use matplotlib's object API (no pyplot global state).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.figure import Figure

from datapilot.visualization import (
    CATEGORICAL,
    DIVERGING,
    GRID,
    SURFACE,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    _new_figure,
)

SEQUENTIAL = LinearSegmentedColormap.from_list(
    "datapilot_sequential", ["#f0efec", CATEGORICAL[0]]
)


def style_axes(axes: Any) -> None:
    axes.set_facecolor(SURFACE)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axes.spines[side].set_color(GRID)
        axes.spines[side].set_linewidth(0.8)
    axes.tick_params(colors=TEXT_SECONDARY, labelsize=9, length=0)
    axes.grid(True, color=GRID, linewidth=0.6)
    axes.set_axisbelow(True)


def finish(axes: Any, title: str, x_label: str = "", y_label: str = "") -> None:
    axes.set_xlabel(x_label, color=TEXT_SECONDARY, fontsize=10)
    axes.set_ylabel(y_label, color=TEXT_SECONDARY, fontsize=10)
    axes.set_title(title, color=TEXT_PRIMARY, fontsize=12, loc="left", pad=12)


def new_figure(width: float = 8, height: float = 4.8) -> tuple[Figure, Any]:
    figure, axes = _new_figure()
    figure.set_size_inches(width, height)
    return figure, axes


def horizontal_bars(
    labels: list[str],
    values: list[float],
    title: str,
    x_label: str,
    highlight: int | None = None,
    errors: list[float] | None = None,
) -> Figure:
    """Ranked horizontal bars, largest at the top."""
    count = max(1, len(labels))
    figure, axes = new_figure(8, max(2.6, min(10.0, 0.38 * count + 1.4)))
    positions = np.arange(len(labels))[::-1]
    colors = [
        CATEGORICAL[1] if index == highlight else CATEGORICAL[0]
        for index in range(len(labels))
    ]
    axes.barh(
        positions, values, color=colors, height=0.65, edgecolor=SURFACE,
        xerr=errors, error_kw={"ecolor": TEXT_SECONDARY, "elinewidth": 1},
    )
    axes.set_yticks(positions, [_short(label) for label in labels])
    axes.grid(False, axis="y")
    finish(axes, title, x_label)
    figure.tight_layout()
    return figure


def matrix_heatmap(
    matrix: pd.DataFrame,
    title: str,
    diverging: bool = True,
    value_format: str = "{:.2f}",
    x_label: str = "",
    y_label: str = "",
) -> Figure:
    """Annotated heatmap of a labelled matrix (correlations, counts)."""
    rows, cols = matrix.shape
    size = max(5.5, min(12.0, 0.55 * max(rows, cols) + 3))
    figure, axes = new_figure(size, size * 0.85)
    values = matrix.to_numpy(dtype=float)
    if diverging:
        image = axes.imshow(values, cmap=DIVERGING, vmin=-1, vmax=1)
    else:
        image = axes.imshow(values, cmap=SEQUENTIAL, vmin=0)
    x_labels = [_short(c, 24) for c in matrix.columns]
    if max((len(label) for label in x_labels), default=0) > 4:
        axes.set_xticks(range(cols), x_labels, rotation=45, ha="right")
    else:
        axes.set_xticks(range(cols), x_labels)
    axes.set_yticks(range(rows), [_short(r, 24) for r in matrix.index])
    axes.grid(False)
    if max(rows, cols) <= 15:
        finite = values[np.isfinite(values)]
        top = float(finite.max()) if finite.size else 0.0
        for i in range(rows):
            for j in range(cols):
                value = values[i, j]
                if np.isfinite(value):
                    dark = not diverging and top and value > 0.6 * top
                    axes.text(
                        j, i, value_format.format(value), ha="center",
                        va="center", fontsize=8,
                        color=SURFACE if dark else TEXT_PRIMARY,
                    )
    colorbar = figure.colorbar(image, ax=axes, fraction=0.046, pad=0.04)
    colorbar.ax.tick_params(colors=TEXT_SECONDARY, labelsize=8)
    colorbar.outline.set_visible(False)
    finish(axes, title, x_label, y_label)
    figure.tight_layout()
    return figure


def _short(label: Any, limit: int = 32) -> str:
    text = str(label)
    return text if len(text) <= limit else text[: limit - 1] + "…"
