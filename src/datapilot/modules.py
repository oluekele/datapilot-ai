"""The workspace modules users can enable or disable."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Module:
    key: str
    title: str
    description: str
    icon: str
    core: bool = False


MODULES: tuple[Module, ...] = (
    Module(
        "health",
        "Dataset health",
        "File validation, column types, missing values, duplicates, constant "
        "columns, outlier warnings, and repair recommendations.",
        ":material/health_and_safety:",
        core=True,
    ),
    Module(
        "exploration",
        "Data exploration",
        "Distributions, category frequencies, missing-value patterns, "
        "correlations, and column comparisons.",
        ":material/travel_explore:",
    ),
    Module(
        "analysis",
        "Statistical analysis",
        "Descriptive statistics, grouped summaries, and hypothesis tests "
        "with assumptions and caveats.",
        ":material/functions:",
    ),
    Module(
        "visualization",
        "Visualization studio",
        "Build charts with your own axes, grouping, and filters, then "
        "download them as images.",
        ":material/bar_chart:",
    ),
    Module(
        "ml_readiness",
        "ML readiness",
        "Target selection, leakage warnings, baseline models, and a "
        "reproducible training pipeline.",
        ":material/model_training:",
    ),
    Module(
        "reports",
        "Reports and export",
        "Combine selected findings into Markdown, JSON, CSV, Excel, or a "
        "ZIP bundle with charts.",
        ":material/summarize:",
        core=True,
    ),
)

MODULES_BY_KEY = {module.key: module for module in MODULES}
CORE_KEYS = tuple(module.key for module in MODULES if module.core)
OPTIONAL_KEYS = tuple(module.key for module in MODULES if not module.core)


def resolve_modules(selected: list[str] | tuple[str, ...] | None) -> list[str]:
    """Return enabled module keys in display order, always including core ones."""
    selected_set = set(selected or ())
    unknown = selected_set - set(MODULES_BY_KEY)
    if unknown:
        raise ValueError(f"Unknown module(s): {sorted(unknown)}")
    return [
        module.key
        for module in MODULES
        if module.core or module.key in selected_set
    ]
