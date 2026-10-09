import pandas as pd
import streamlit as st

from app_support import data_variant_caption, require_workspace, show_figure
from datapilot.exploration import (
    category_frequencies,
    classify_columns,
    compare_columns,
    dataset_summary,
    missing_summary,
    numeric_distribution,
    top_correlations,
)
from datapilot.visualization import ChartSpec, build_chart

workspace = require_workspace()
df = workspace.active_df
data_variant_caption(workspace)

kinds = workspace.cached(("kinds",), classify_columns)
numeric_columns = [c for c, k in kinds.items() if k == "numeric"]
category_columns = [c for c, k in kinds.items() if k in ("categorical", "boolean")]

VIEWS = {
    "summary": ":material/dataset: Summary",
    "distributions": ":material/equalizer: Distributions",
    "categories": ":material/category: Categories",
    "missing": ":material/grid_off: Missing values",
    "correlations": ":material/scatter_plot: Correlations",
    "compare": ":material/compare_arrows: Compare columns",
}
view = st.segmented_control(
    "View",
    options=list(VIEWS),
    format_func=VIEWS.get,
    default="summary",
    required=True,
    key="explore_view",
    label_visibility="collapsed",
)

if view == "summary":
    summary = workspace.cached(("summary",), dataset_summary)
    with st.container(horizontal=True):
        st.metric("Rows", f"{summary['rows']:,}", border=True)
        st.metric("Columns", f"{summary['columns']:,}", border=True)
        st.metric(
            "Complete rows",
            f"{summary['complete_rows']:,}",
            f"{summary['complete_row_percentage']}% of rows",
            delta_color="off",
            border=True,
        )
    st.markdown("**Column kinds**")
    st.caption(
        "Kinds decide which summaries and tests apply. Numeric columns with "
        "only 0/1 values are treated as boolean; text with many unique values "
        "(IDs, comments) is excluded from category analysis."
    )
    st.dataframe(
        pd.DataFrame(
            {"column": list(kinds), "kind": list(kinds.values())}
        ),
        hide_index=True,
        width="stretch",
    )

elif view == "distributions":
    if not numeric_columns:
        st.info("No numeric columns to describe.")
        st.stop()
    with st.container(horizontal=True, vertical_alignment="bottom"):
        column = st.selectbox("Numeric column", numeric_columns, key="explore_dist")
        bins = st.slider("Bins", 5, 60, 20, key="explore_bins")
    result = numeric_distribution(df, column, bins=bins)
    if result["count"] == 0:
        st.info(result["notes"][0])
        st.stop()
    with st.container(horizontal=True):
        for label, key in (
            ("Mean", "mean"),
            ("Median", "median"),
            ("Std. dev.", "std"),
            ("Skewness", "skewness"),
        ):
            value = result.get(key)
            st.metric(label, "—" if value is None else f"{value:,.3g}", border=True)
    for note in result["notes"]:
        st.caption(f":material/info: {note}")
    figure = build_chart(df, ChartSpec("histogram", x=column, bins=bins))
    show_figure(figure, f"distribution_{column}", key="explore_hist")
    with st.expander("Percentiles"):
        st.dataframe(
            pd.DataFrame(
                [{k: result[k] for k in ("min", "p05", "q1", "median", "q3", "p95", "max")}]
            ),
            hide_index=True,
        )

elif view == "categories":
    if not category_columns:
        st.info("No categorical columns to count.")
        st.stop()
    with st.container(horizontal=True, vertical_alignment="bottom"):
        column = st.selectbox("Categorical column", category_columns, key="explore_cat")
        top_n = st.slider("Show top", 3, 30, 15, key="explore_top_n")
    table = category_frequencies(df, column, top_n=top_n)
    left, right = st.columns([2, 3])
    left.dataframe(
        table,
        hide_index=True,
        width="stretch",
        column_config={
            "percentage": st.column_config.ProgressColumn(
                "Share", min_value=0, max_value=100, format="%.1f%%"
            )
        },
    )
    with right:
        figure = build_chart(df, ChartSpec("bar", x=column))
        show_figure(figure, f"frequencies_{column}", key="explore_bar")

elif view == "missing":
    result = workspace.cached(("missing",), missing_summary)
    with st.container(horizontal=True):
        st.metric("Columns with gaps", result["columns_with_missing"], border=True)
        st.metric(
            "Rows with any gap",
            f"{result['rows_with_missing']:,}",
            f"{result['rows_with_missing_percentage']}% of rows",
            delta_color="off",
            border=True,
        )
    if result["columns_with_missing"] == 0:
        st.success("No missing values.")
    else:
        st.dataframe(
            result["by_column"][result["by_column"]["missing"] > 0],
            hide_index=True,
            width="stretch",
            column_config={
                "missing_percentage": st.column_config.ProgressColumn(
                    "Missing (%)", min_value=0, max_value=100, format="%.1f%%"
                )
            },
        )
        st.caption(
            "Check whether gaps are random or tied to particular records "
            "before deciding how to handle them."
        )

elif view == "correlations":
    if len(numeric_columns) < 2:
        st.info("At least two numeric columns are needed for correlations.")
        st.stop()
    method = st.segmented_control(
        "Method",
        ["pearson", "spearman"],
        format_func=str.capitalize,
        default="pearson",
        required=True,
        key="explore_corr_method",
        help="Pearson measures linear association; Spearman measures monotonic "
        "association and is less sensitive to outliers.",
    )
    top = workspace.cached(
        ("top_correlations", method),
        lambda frame: top_correlations(frame, method=method, limit=15),
    )
    st.caption(
        ":material/info: Correlation describes association only. It does not "
        "show that one column causes another, and a third variable may "
        "drive both."
    )
    st.dataframe(top, hide_index=True, width="stretch")
    if len(numeric_columns) <= 25:
        figure = build_chart(df, ChartSpec("correlation_heatmap"))
        show_figure(figure, "correlation_heatmap", key="explore_heatmap")
    else:
        st.caption("The heatmap is hidden for more than 25 numeric columns.")

elif view == "compare":
    candidates = [c for c, k in kinds.items() if k != "text"]
    if len(candidates) < 2:
        st.info("At least two non-text columns are needed.")
        st.stop()
    with st.container(horizontal=True):
        column_a = st.selectbox("First column", candidates, key="explore_cmp_a")
        column_b = st.selectbox(
            "Second column",
            [c for c in candidates if c != column_a],
            key="explore_cmp_b",
        )
    result = compare_columns(df, column_a, column_b)
    st.caption(
        f"{result['kind_a']} vs {result['kind_b']} · "
        f"{result['complete_pairs']:,} complete pairs"
    )
    comparison = result["comparison"]
    if comparison == "numeric_vs_numeric":
        with st.container(horizontal=True):
            for label, key in (("Pearson r", "pearson"), ("Spearman ρ", "spearman")):
                value = result.get(key)
                st.metric(label, "—" if value is None else f"{value:.3f}", border=True)
        figure = build_chart(df, ChartSpec("scatter", x=column_a, y=column_b))
        show_figure(figure, f"{column_a}_vs_{column_b}", key="explore_scatter")
    elif comparison == "numeric_by_group":
        st.dataframe(result["table"], hide_index=True, width="stretch")
        figure = build_chart(
            df,
            ChartSpec("box", x=result["group_column"], y=result["value_column"]),
        )
        show_figure(figure, f"{column_a}_by_{column_b}", key="explore_box")
    elif comparison == "category_vs_category":
        st.dataframe(result["table"], width="stretch")
    if result.get("note"):
        st.caption(result["note"])
    st.caption(f":material/info: {result['caveat']}")
    st.caption("For significance tests, enable the Statistical analysis module.")
