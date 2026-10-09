import pandas as pd
import streamlit as st

from app_support import require_workspace, show_findings
from datapilot.repairs import apply_repairs, build_repair_plan
from datapilot.workspace import ORIGINAL, REPAIRED

workspace = require_workspace()
loaded = workspace.dataset
df = loaded.dataframe
profile = workspace.profile(ORIGINAL)
overview = profile["overview"]

st.caption(
    f"{loaded.filename} · {loaded.file_type.upper()} · first worksheet used "
    "for Excel files · column names normalized to snake_case"
)

with st.container(horizontal=True):
    st.metric("Rows", f"{overview['rows']:,}", border=True)
    st.metric("Columns", f"{overview['columns']:,}", border=True)
    st.metric(
        "Missing cells",
        f"{overview['missing_cells']:,}",
        f"{overview['missing_percentage']:.2f}% of cells",
        delta_color="off",
        border=True,
    )
    st.metric("Duplicate rows", f"{overview['duplicate_rows']:,}", border=True)
    st.metric(
        "Memory", f"{overview['memory_usage_bytes'] / 1024:,.1f} KB", border=True
    )

st.subheader("Preview")
st.dataframe(df.head(20), width="stretch")

st.subheader("Column profiles")
st.dataframe(
    pd.DataFrame(profile["columns"]),
    width="stretch",
    hide_index=True,
    column_config={
        "missing_percentage": st.column_config.ProgressColumn(
            "Missing (%)", min_value=0, max_value=100, format="%.1f%%"
        ),
        "is_constant": st.column_config.CheckboxColumn("Constant"),
    },
)

st.subheader("Findings")
show_findings(profile["findings"])

st.download_button(
    "Download normalized dataset (.csv)",
    data=df.to_csv(index=False).encode("utf-8"),
    file_name="datapilot_normalized.csv",
    mime="text/csv",
    icon=":material/download:",
    on_click="ignore",
)

st.subheader("Repair recommendations")
repair_plan = build_repair_plan(df)

if not repair_plan:
    st.success("No supported repair opportunities were detected.")
else:
    def _clear_repair_message() -> None:
        st.session_state.pop("dp_repair_message", None)

    def _apply_selected(selected_ids: list[str], methods: dict[str, str]) -> None:
        try:
            repaired, applied = apply_repairs(df, selected_ids, methods)
        except (ValueError, TypeError) as exc:
            st.session_state.dp_repair_message = ("error", str(exc))
            return
        workspace.set_repaired(repaired, applied)
        # Applying is an explicit choice, so switch every module to the result.
        workspace.use_repaired = True
        changes = "; ".join(f"{item['title']}: {item['detail']}" for item in applied)
        st.session_state.dp_repair_message = (
            "success",
            (
                f"Applied {len(applied)} repair(s) to a copy of the data — "
                f"{changes}. The repaired copy has {len(repaired):,} rows × "
                f"{repaired.shape[1]} columns and is now used by every module. "
                "Review it below."
            ),
        )

    st.caption(
        "Tick **Select this repair** on each change you want, choose how to "
        "apply it where offered, then click **Apply selected repairs**. The "
        "original data is always kept; repairs produce a separate copy."
    )

    GROUPS = {
        "Missing values": ("handle_missing_values",),
        "Outliers": ("handle_outliers",),
        "Duplicates, constant columns, and text": (
            "drop_duplicate_rows",
            "drop_constant_column",
            "trim_whitespace",
        ),
    }
    selected: list[str] = []
    methods: dict[str, str] = {}
    for group, actions in GROUPS.items():
        items = [item for item in repair_plan if item["action"] in actions]
        if not items:
            continue
        st.markdown(f"**{group}** ({len(items)})")
        for item in items:
            with st.container(border=True):
                st.markdown(f"**{item['title']}** · risk: {item['risk']}")
                st.caption(f"{item['evidence']} {item['recommendation']}")
                chosen = st.checkbox(
                    "Select this repair",
                    key=f"repair_{item['id']}",
                    on_change=_clear_repair_message,
                )
                if chosen:
                    selected.append(item["id"])
                    if "methods" in item:
                        methods[item["id"]] = st.selectbox(
                            "How?",
                            list(item["methods"]),
                            format_func=item["methods"].get,
                            key=f"repair_method_{item['id']}",
                            on_change=_clear_repair_message,
                        )
                        st.caption(f":material/info: {item['note']}")

    with st.container(horizontal=True, vertical_alignment="center"):
        st.button(
            f"Apply selected repairs ({len(selected)})",
            type="primary",
            icon=":material/build:",
            disabled=not selected,
            on_click=_apply_selected,
            args=(selected, methods),
            key="apply_repairs",
        )
        if selected:
            st.caption(
                f":material/check_circle: {len(selected)} of "
                f"{len(repair_plan)} repair(s) selected"
            )
        else:
            st.caption("Select at least one repair to enable the button.")

    message = st.session_state.get("dp_repair_message")
    if message:
        kind, text = message
        if kind == "success":
            st.success(text, icon=":material/check_circle:")
        else:
            st.error(text, icon=":material/error:")

if workspace.repaired is not None:
    with st.container(border=True):
        st.markdown("**:material/build: Repaired copy: before and after**")
        repaired_overview = workspace.profile(REPAIRED)["overview"]
        repaired_outliers = sum(
            column.get("potential_outliers_iqr", 0)
            for column in workspace.profile(REPAIRED)["columns"]
        )
        original_outliers = sum(
            column.get("potential_outliers_iqr", 0) for column in profile["columns"]
        )
        with st.container(horizontal=True):
            for label, after, before in (
                ("Rows", repaired_overview["rows"], overview["rows"]),
                ("Columns", repaired_overview["columns"], overview["columns"]),
                (
                    "Missing cells",
                    repaired_overview["missing_cells"],
                    overview["missing_cells"],
                ),
                (
                    "Duplicate rows",
                    repaired_overview["duplicate_rows"],
                    overview["duplicate_rows"],
                ),
                ("Outlier flags", repaired_outliers, original_outliers),
            ):
                st.metric(
                    label,
                    f"{after:,}",
                    delta=f"{after - before:+,} vs original" if after != before else None,
                    delta_color="off",
                    border=True,
                )
        st.dataframe(workspace.applied_repairs, width="stretch", hide_index=True)
        if workspace.variant == REPAIRED:
            st.caption(
                ":material/check_circle: Every module is using this repaired copy. "
                "Switch to **Original** under **Data version** in the sidebar to "
                "go back; the original is never changed."
            )
        else:
            st.caption(
                "The other modules are using the **original** data. Select "
                "**Repaired** under **Data version** in the sidebar to use this copy."
            )
        st.dataframe(workspace.repaired.head(20), width="stretch")

        with st.container(horizontal=True):
            st.download_button(
                "Download repaired dataset (.csv)",
                data=workspace.repaired.to_csv(index=False).encode("utf-8"),
                file_name="datapilot_repaired.csv",
                mime="text/csv",
                icon=":material/download:",
                on_click="ignore",
            )
            if st.button("Discard repairs", icon=":material/undo:"):
                workspace.discard_repairs()
                st.session_state.pop("dp_data_variant", None)
                st.session_state.pop("dp_repair_message", None)
                st.rerun()
