"""DataPilot AI — a local-first, modular data-analysis workspace.

Run with:  streamlit run app.py
"""

import streamlit as st

from app_support import (
    WORKSPACE_KEY,
    enabled_modules,
    get_workspace,
    module_key,
    repair_summary,
    sync_data_variant,
)
from datapilot.loader import DatasetLoadError, load_dataset
from datapilot.modules import MODULES
from datapilot.workspace import ORIGINAL, REPAIRED, Workspace

st.set_page_config(
    page_title="DataPilot AI",
    page_icon=":material/analytics:",
    layout="wide",
)

for module in MODULES:
    if not module.core:
        st.session_state.setdefault(module_key(module.key), False)
st.session_state.setdefault("dp_upload_id", None)
st.session_state.setdefault("dp_load_error", None)

with st.sidebar:
    st.title(":material/analytics: DataPilot AI")
    st.caption("Your local data intelligence workspace")

    uploaded = st.file_uploader(
        "Dataset",
        type=["csv", "xlsx"],
        help="Files are processed on this machine and never uploaded elsewhere.",
    )

    if uploaded is None:
        if st.session_state.dp_upload_id is not None:
            st.session_state.pop(WORKSPACE_KEY, None)
            st.session_state.dp_upload_id = None
            st.session_state.dp_load_error = None
    elif uploaded.file_id != st.session_state.dp_upload_id:
        # A new file starts a fresh workspace; nothing carries over.
        st.session_state.dp_upload_id = uploaded.file_id
        st.session_state.pop(WORKSPACE_KEY, None)
        st.session_state.pop("dp_last_analysis", None)
        for state_key in list(st.session_state):
            if str(state_key).startswith("repair_"):
                del st.session_state[state_key]
        st.session_state.pop("dp_repair_message", None)
        try:
            with st.spinner("Validating and loading dataset…"):
                loaded = load_dataset(source=uploaded, filename=uploaded.name)
            st.session_state[WORKSPACE_KEY] = Workspace(dataset=loaded)
            st.session_state.dp_load_error = None
        except DatasetLoadError as exc:
            st.session_state.dp_load_error = str(exc)

    if st.session_state.dp_load_error:
        st.error(st.session_state.dp_load_error, icon=":material/error:")

    workspace = get_workspace()
    if workspace is not None:
        df = workspace.active_df
        st.caption(
            f":material/table: **{workspace.name}** · {len(df):,} rows × "
            f"{df.shape[1]:,} columns"
        )
        if workspace.repaired is not None:
            st.session_state.dp_data_variant = workspace.variant
            st.segmented_control(
                "Data version",
                [ORIGINAL, REPAIRED],
                format_func=lambda v: {
                    ORIGINAL: ":material/database: Original",
                    REPAIRED: ":material/build: Repaired",
                }[v],
                required=True,
                key="dp_data_variant",
                on_change=sync_data_variant,
                args=(workspace,),
                help="Every module uses the version selected here. Saved "
                "analyses, charts, and reports record which version they used.",
            )
            st.caption(f":material/build: {repair_summary(workspace)}")

    st.subheader("Choose your workflow")
    for module in MODULES:
        if module.core:
            st.checkbox(
                module.title,
                value=True,
                disabled=True,
                help=f"{module.description} Always on.",
            )
        else:
            st.checkbox(
                module.title,
                key=module_key(module.key),
                help=module.description,
            )
    st.caption(f"Selected modules: {len(enabled_modules())}")

PAGE_FILES = {
    "health": "app_pages/health.py",
    "exploration": "app_pages/exploration.py",
    "analysis": "app_pages/analysis.py",
    "visualization": "app_pages/visualization.py",
    "ml_readiness": "app_pages/ml_readiness.py",
    "reports": "app_pages/reports.py",
}
modules_by_key = {module.key: module for module in MODULES}

pages = [
    st.Page(
        "app_pages/home.py",
        title="Overview",
        icon=":material/home:",
        default=True,
    )
]
for key in enabled_modules():
    module = modules_by_key[key]
    pages.append(
        st.Page(PAGE_FILES[key], title=module.title, icon=module.icon)
    )

page = st.navigation(pages, position="top")
st.title(page.title)
page.run()
