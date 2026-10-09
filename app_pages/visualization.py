import re

import pandas as pd
import streamlit as st

from app_support import data_variant_caption, require_workspace, show_figure
from datapilot.exploration import classify_columns
from datapilot.visualization import (
    AGGREGATIONS,
    CHART_TYPES,
    ChartSpec,
    ColumnFilter,
    build_chart,
    default_title,
    describe_spec,
)

workspace = require_workspace()
df = workspace.active_df
data_variant_caption(workspace)

kinds = workspace.cached(("kinds",), classify_columns)
numeric = [c for c, k in kinds.items() if k == "numeric"]
groupable = [c for c, k in kinds.items() if k in ("categorical", "boolean")]
orderable = [c for c, k in kinds.items() if k in ("numeric", "datetime")]
NONE = "(none)"

controls, canvas = st.columns([1, 2], gap="large")

with controls:
    chart_type = st.selectbox(
        "Chart type",
        list(CHART_TYPES),
        format_func=CHART_TYPES.get,
        key="viz_type",
    )
    x = y = group = None
    aggregation = "count"
    bins = 20

    if chart_type == "histogram":
        x = st.selectbox("Numeric column", numeric, key="viz_hist_x")
        bins = st.slider("Bins", 5, 80, 20, key="viz_bins")
        group = st.selectbox("Compare groups", [NONE, *groupable], key="viz_hist_g")
    elif chart_type == "box":
        y = st.selectbox("Numeric column", numeric, key="viz_box_y")
        x = st.selectbox("Split by", [NONE, *groupable], key="viz_box_x")
    elif chart_type == "bar":
        x = st.selectbox("Categories (x)", groupable or list(df.columns), key="viz_bar_x")
        aggregation = st.selectbox("Measure", AGGREGATIONS, key="viz_bar_agg")
        if aggregation != "count":
            y = st.selectbox("Numeric value (y)", numeric, key="viz_bar_y")
        group = st.selectbox("Group by", [NONE, *groupable], key="viz_bar_g")
    elif chart_type == "scatter":
        x = st.selectbox("x", numeric, key="viz_sc_x")
        y = st.selectbox("y", numeric, index=1 if len(numeric) > 1 else 0,key="viz_sc_y")
        group = st.selectbox(
            "Colour by",
            [NONE, *groupable],
            key="viz_sc_g",
            help="Up to three groups get their own colour; the rest are shown "
            "as 'Other' so colours stay distinguishable.",
        )
    elif chart_type == "line":
        x = st.selectbox("x (ordered)", orderable or list(df.columns), key="viz_ln_x")
        aggregation = st.selectbox(
            "Measure", [a for a in AGGREGATIONS if a != "count"], key="viz_ln_agg"
        )
        y = st.selectbox("Numeric value (y)", numeric, key="viz_ln_y")
        group = st.selectbox("Group by", [NONE, *groupable], key="viz_ln_g")

    x = None if x == NONE else x
    group = None if group == NONE else group

    filter_columns = st.multiselect(
        "Filters",
        [c for c in df.columns if kinds[c] in ("numeric", "categorical", "boolean")],
        key="viz_filter_cols",
    )
    filters = []
    for column in filter_columns:
        if kinds[column] == "numeric":
            values = pd.to_numeric(df[column], errors="coerce").dropna()
            if values.empty or values.min() == values.max():
                continue
            low, high = st.slider(
                column,
                float(values.min()),
                float(values.max()),
                (float(values.min()), float(values.max())),
                key=f"viz_f_{column}",
            )
            filters.append(ColumnFilter(column, min_value=low, max_value=high))
        else:
            options = df[column].dropna().unique().tolist()[:200]
            chosen = st.multiselect(
                column, options, default=options, key=f"viz_f_{column}"
            )
            filters.append(ColumnFilter(column, values=chosen))

    spec = ChartSpec(
        chart_type, x=x, y=y, group=group, aggregation=aggregation,
        bins=bins, filters=filters,
    )
    title = st.text_input(
        "Title", placeholder=default_title(spec), key="viz_title"
    )
    spec.title = title.strip()

with canvas:
    try:
        figure = build_chart(df, spec)
    except ValueError as exc:
        st.info(str(exc), icon=":material/info:")
        st.stop()

    final_title = spec.title or default_title(spec)
    stem = re.sub(r"[^a-z0-9]+", "_", final_title.lower()).strip("_") or "chart"
    png = show_figure(figure, stem, key="viz_chart")
    st.caption(describe_spec(spec))

    def _save() -> None:
        workspace.save_chart(
            {
                "title": final_title,
                "description": describe_spec(spec),
                "spec": spec.to_dict(),
                "png": png,
            }
        )
        st.toast("Chart added to the report.")

    st.button("Add to report", icon=":material/note_add:", on_click=_save)

if workspace.charts:
    st.subheader("Charts saved for the report")
    for index, chart in enumerate(list(workspace.charts)):
        with st.container(border=True, horizontal=True, vertical_alignment="center"):
            st.image(chart["png"], width=160)
            st.markdown(f"**{chart['title']}**  \n{chart['description']}")
            if st.button("Remove", key=f"viz_remove_{index}", icon=":material/delete:"):
                workspace.charts.pop(index)
                st.rerun()
