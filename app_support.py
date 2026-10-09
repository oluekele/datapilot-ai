"""Streamlit helpers shared by the entrypoint and the module pages."""

from __future__ import annotations

import streamlit as st
from matplotlib.figure import Figure

from datapilot.modules import MODULES, OPTIONAL_KEYS, resolve_modules
from datapilot.visualization import figure_to_bytes
from datapilot.workspace import REPAIRED, Workspace

WORKSPACE_KEY = "dp_workspace"

WORKFLOW_PRESETS = {
    "Quick health check": (),
    "Research": ("exploration", "analysis", "visualization"),
    "ML preparation": ("exploration", "ml_readiness"),
    "Everything": OPTIONAL_KEYS,
}

SEVERITY_ICONS = {
    "high": ":material/error:",
    "warning": ":material/warning:",
    "info": ":material/info:",
}


def module_key(key: str) -> str:
    return f"dp_module_{key}"


def enabled_modules() -> list[str]:
    """Module keys the user has switched on, plus the core modules."""
    selected = [key for key in OPTIONAL_KEYS if st.session_state.get(module_key(key))]
    return resolve_modules(selected)


def apply_preset(name: str) -> None:
    """Callback: switch the optional modules to a preset combination."""
    chosen = set(WORKFLOW_PRESETS[name])
    for key in OPTIONAL_KEYS:
        st.session_state[module_key(key)] = key in chosen


def get_workspace() -> Workspace | None:
    return st.session_state.get(WORKSPACE_KEY)


def require_workspace() -> Workspace:
    """Return the workspace, or stop the page with upload guidance."""
    workspace = get_workspace()
    if workspace is None:
        st.info(
            "Upload a CSV or Excel file in the sidebar to use this module.",
            icon=":material/upload_file:",
        )
        st.stop()
    return workspace


def repair_summary(workspace: Workspace) -> str:
    """One line describing the applied repairs and the row change."""
    titles = "; ".join(
        f"{item['title']} ({item.get('detail') or item['changed_count']})"
        for item in workspace.applied_repairs
    )
    before = len(workspace.dataset.dataframe)
    after = len(workspace.repaired) if workspace.repaired is not None else before
    return (
        f"{len(workspace.applied_repairs)} repair(s): {titles}. "
        f"Rows: {before:,} → {after:,}."
    )


def data_variant_caption(workspace: Workspace) -> None:
    """Tell the user which version of the data a module is using."""
    if workspace.variant == REPAIRED:
        st.info(
            f"**Using the repaired data.** {repair_summary(workspace)} "
            "Switch the data version in the sidebar.",
            icon=":material/build:",
        )
    elif workspace.repaired is not None:
        st.caption(
            ":material/database: Using the **original** data. A repaired copy "
            "exists; switch to it with **Data version** in the sidebar."
        )


def sync_data_variant(workspace: Workspace) -> None:
    """Callback: apply the sidebar data-version choice to the workspace."""
    workspace.use_repaired = st.session_state.dp_data_variant == REPAIRED


def show_figure(figure: Figure, file_stem: str, key: str) -> bytes:
    """Display a chart with PNG and SVG downloads. Returns the PNG bytes."""
    png = figure_to_bytes(figure, "png")
    st.image(png, width="stretch")
    with st.container(horizontal=True):
        st.download_button(
            "Download PNG",
            data=png,
            file_name=f"{file_stem}.png",
            mime="image/png",
            icon=":material/download:",
            on_click="ignore",
            key=f"{key}_png",
        )
        st.download_button(
            "Download SVG",
            data=figure_to_bytes(figure, "svg"),
            file_name=f"{file_stem}.svg",
            mime="image/svg+xml",
            icon=":material/download:",
            on_click="ignore",
            key=f"{key}_svg",
        )
    return png


def show_findings(findings: list[dict]) -> None:
    """Render profiler or ML findings as readable callouts."""
    for finding in findings:
        severity = finding.get("severity", "info")
        column = finding.get("column")
        title = str(finding.get("type", "finding")).replace("_", " ").capitalize()
        if column:
            title += f" · `{column}`"
        body = f"**{title}** — {finding.get('evidence', '')}"
        recommendation = finding.get("recommendation")
        if recommendation:
            body += f"\n\n{recommendation}"
        icon = SEVERITY_ICONS.get(severity, ":material/info:")
        if severity == "high":
            st.error(body, icon=icon)
        elif severity == "warning":
            st.warning(body, icon=icon)
        else:
            st.info(body, icon=icon)


def module_title(key: str) -> str:
    return next(module.title for module in MODULES if module.key == key)
