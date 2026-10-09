import streamlit as st

from app_support import (
    WORKFLOW_PRESETS,
    apply_preset,
    data_variant_caption,
    enabled_modules,
    get_workspace,
)
from datapilot.modules import MODULES

st.write(
    "Upload a dataset, then switch on only the modules you need. Dataset "
    "health and reports are always available; exploration, statistics, "
    "visualization, and ML readiness run only when you enable them."
)

workspace = get_workspace()
if workspace is None:
    st.info(
        "Start by uploading a CSV or XLSX file in the sidebar.",
        icon=":material/upload_file:",
    )
else:
    loaded = workspace.dataset
    with st.container(horizontal=True):
        st.metric("Rows", f"{loaded.original_rows:,}", border=True)
        st.metric("Columns", f"{loaded.original_columns:,}", border=True)
        st.metric("Format", loaded.file_type.upper(), border=True)
    data_variant_caption(workspace)

st.subheader("Workflow presets")
st.caption("Presets switch the optional modules in the sidebar. Adjust them any time.")
with st.container(horizontal=True):
    for name in WORKFLOW_PRESETS:
        st.button(name, on_click=apply_preset, args=(name,), key=f"preset_{name}")

st.subheader("Modules")
enabled = set(enabled_modules())
columns = st.columns(3)
for index, module in enumerate(MODULES):
    with columns[index % 3].container(border=True, height="stretch"):
        status = (
            ":gray-badge[Core]"
            if module.core
            else ":green-badge[Enabled]"
            if module.key in enabled
            else ":gray-badge[Off]"
        )
        st.markdown(f"**{module.icon} {module.title}** {status}")
        st.caption(module.description)

with st.expander(":material/shield: How DataPilot AI handles your data"):
    st.markdown(
        "- **Local-first:** the dataset is processed on this machine and is "
        "not sent to any external service.\n"
        "- **No silent changes:** repairs are suggestions until you select and "
        "apply them, and the original data is always kept.\n"
        "- **Responsible statistics:** tests show their assumptions, effect "
        "sizes, and small-sample warnings; correlation is never presented as "
        "causation.\n"
        "- **Reproducible reports:** exports record the settings, data version, "
        "and limitations of each analysis."
    )
