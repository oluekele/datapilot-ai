import streamlit as st

from app_support import data_variant_caption, enabled_modules, require_workspace
from datapilot import __version__
from datapilot.exploration import exploration_snapshot
from datapilot.repairs import build_repair_plan
from datapilot.reports import (
    REPORT_SECTIONS,
    build_integrated_json,
    build_integrated_report,
    build_ml_summary,
    export_bundle,
    export_profile_csv,
    export_workbook,
)

workspace = require_workspace()
data_variant_caption(workspace)
modules = enabled_modules()

# Sections are offered only for modules the user enabled.
SECTION_MODULES = {
    "health": "health",
    "repairs": "health",
    "exploration": "exploration",
    "analysis": "analysis",
    "charts": "visualization",
    "ml": "ml_readiness",
}
available = [key for key, module in SECTION_MODULES.items() if module in modules]
defaults = [
    key
    for key in available
    if key in ("health", "repairs", "exploration")
    or (key == "analysis" and workspace.analyses)
    or (key == "charts" and workspace.charts)
    or (key == "ml" and workspace.ml_result)
]

sections = st.pills(
    "Include in the report",
    available,
    selection_mode="multi",
    format_func=REPORT_SECTIONS.get,
    default=defaults,
    key="report_sections",
)

with st.container(horizontal=True):
    st.metric("Analyses saved", len(workspace.analyses), border=True)
    st.metric("Charts saved", len(workspace.charts), border=True)
    st.metric("ML baseline", "Run" if workspace.ml_result else "Not run", border=True)

correlation_method = "pearson"
if "exploration" in sections:
    correlation_method = st.segmented_control(
        "Correlation method for the exploration section",
        ["pearson", "spearman"],
        format_func=str.capitalize,
        default="pearson",
        required=True,
        key="report_corr_method",
    )

if not sections:
    st.info("Select at least one section to build a report.")
    st.stop()

dataset = workspace.dataset
df = workspace.active_df
profile = workspace.profile()
exploration = (
    workspace.cached(
        ("snapshot", correlation_method),
        lambda frame: exploration_snapshot(frame, correlation_method),
    )
    if "exploration" in sections
    else None
)
ml_summary = build_ml_summary(workspace.ml_result) if workspace.ml_result else None

reproducibility = {
    "datapilot_version": __version__,
    "dataset": dataset.filename,
    "file_type": dataset.file_type,
    "rows_loaded": dataset.original_rows,
    "columns_loaded": dataset.original_columns,
    "data_version_used": workspace.variant,
    "rows_analysed": len(df),
    "modules_enabled": ", ".join(modules),
    "repairs_applied": ", ".join(r["title"] for r in workspace.applied_repairs)
    or "none",
}
if exploration:
    reproducibility["correlation_method"] = correlation_method
if workspace.ml_settings and "ml" in sections:
    for key, value in workspace.ml_settings.items():
        reproducibility[f"ml_{key}"] = value

content = {
    "dataset_name": dataset.filename,
    "sections": sections,
    "reproducibility": reproducibility,
    "profile": profile,
    "repair_plan": build_repair_plan(dataset.dataframe),
    "applied_repairs": workspace.applied_repairs,
    "exploration": exploration,
    "analyses": workspace.analyses,
    "charts": workspace.charts,
    "ml_summary": ml_summary,
}
markdown = build_integrated_report(**content)
json_text = build_integrated_json(**content)
profile_csv = export_profile_csv(profile)
charts = workspace.charts if "charts" in sections else []

st.subheader("Download")
with st.container(horizontal=True):
    st.download_button(
        "Report (.md)",
        data=markdown,
        file_name="datapilot_report.md",
        mime="text/markdown",
        icon=":material/description:",
        type="primary",
        on_click="ignore",
    )
    st.download_button(
        "Results (.json)",
        data=json_text,
        file_name="datapilot_report.json",
        mime="application/json",
        icon=":material/data_object:",
        on_click="ignore",
    )
    st.download_button(
        "Column profiles (.csv)",
        data=profile_csv,
        file_name="datapilot_column_profiles.csv",
        mime="text/csv",
        icon=":material/table:",
        on_click="ignore",
    )
    st.download_button(
        "Workbook (.xlsx)",
        data=export_workbook(
            profile=profile if "health" in sections else None,
            exploration=exploration,
            analyses=workspace.analyses if "analysis" in sections else None,
            ml_summary=ml_summary if "ml" in sections else None,
            reproducibility=reproducibility,
        ),
        file_name="datapilot_report.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        icon=":material/grid_on:",
        on_click="ignore",
    )
    st.download_button(
        "Everything (.zip)",
        data=export_bundle(
            {
                "datapilot_report.md": markdown,
                "datapilot_report.json": json_text,
                "datapilot_column_profiles.csv": profile_csv,
            },
            charts=charts,
        ),
        file_name="datapilot_report.zip",
        mime="application/zip",
        icon=":material/folder_zip:",
        on_click="ignore",
        help="The report, JSON, CSV, and every saved chart as PNG.",
    )

st.subheader("Preview")
with st.container(border=True, height=600):
    st.markdown(markdown)
