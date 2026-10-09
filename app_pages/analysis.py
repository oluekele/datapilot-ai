import pandas as pd
import streamlit as st

from app_support import data_variant_caption, require_workspace
from datapilot.analysis import (
    AGGREGATIONS,
    association_test,
    compare_groups,
    correlation_test,
    descriptive_statistics,
    grouped_summary,
)
from datapilot.exploration import classify_columns

workspace = require_workspace()
df = workspace.active_df
data_variant_caption(workspace)

kinds = workspace.cached(("kinds",), classify_columns)
numeric_columns = [c for c, k in kinds.items() if k == "numeric"]
group_columns = [c for c, k in kinds.items() if k in ("categorical", "boolean")]

ANALYSES = {
    "descriptive": "Descriptive statistics",
    "grouped": "Grouped summary",
    "groups": "Compare groups",
    "association": "Association (chi-square)",
    "correlation": "Correlation test",
}
analysis = st.segmented_control(
    "Analysis",
    options=list(ANALYSES),
    format_func=ANALYSES.get,
    default="descriptive",
    required=True,
    key="analysis_kind",
)

if analysis == "descriptive":
    if not numeric_columns:
        st.info("No numeric columns to describe.")
        st.stop()
    chosen = st.multiselect(
        "Columns", numeric_columns, default=numeric_columns[:8], key="desc_cols"
    )
    if chosen:
        table = descriptive_statistics(df, chosen)
        st.dataframe(table, hide_index=True, width="stretch")
        st.caption(
            "The 95% confidence interval for the mean uses the t-distribution "
            "and assumes independent observations. For skewed columns, the "
            "median and IQR describe a typical value better than the mean."
        )
    st.stop()

if analysis == "grouped":
    if not numeric_columns or not group_columns:
        st.info("A grouped summary needs a categorical and a numeric column.")
        st.stop()
    with st.container(horizontal=True):
        group = st.selectbox("Group by", group_columns, key="grp_group")
        value = st.selectbox("Value", numeric_columns, key="grp_value")
    aggregations = st.pills(
        "Statistics",
        AGGREGATIONS,
        selection_mode="multi",
        default=["count", "mean", "median", "std"],
        key="grp_aggs",
    )
    if aggregations:
        st.dataframe(
            grouped_summary(df, group, value, tuple(aggregations)),
            hide_index=True,
            width="stretch",
        )
    st.stop()

with st.form(f"form_{analysis}"):
    if analysis == "groups":
        st.caption(
            "Two groups: Welch's t-test with a Mann–Whitney U check. Three or "
            "more: one-way ANOVA with a Kruskal–Wallis check."
        )
        if not numeric_columns or not group_columns:
            st.info("This test needs a categorical and a numeric column.")
            st.form_submit_button("Run test", disabled=True)
            st.stop()
        with st.container(horizontal=True):
            group = st.selectbox("Group column", group_columns)
            value = st.selectbox("Outcome (numeric)", numeric_columns)
    elif analysis == "association":
        st.caption("Tests whether two categorical columns are independent.")
        if len(group_columns) < 2:
            st.info("This test needs two categorical columns.")
            st.form_submit_button("Run test", disabled=True)
            st.stop()
        with st.container(horizontal=True):
            column_a = st.selectbox("First column", group_columns)
            column_b = st.selectbox("Second column", group_columns, index=1)
    else:
        st.caption("Tests whether two numeric columns move together.")
        if len(numeric_columns) < 2:
            st.info("This test needs two numeric columns.")
            st.form_submit_button("Run test", disabled=True)
            st.stop()
        with st.container(horizontal=True):
            column_x = st.selectbox("First column", numeric_columns)
            column_y = st.selectbox("Second column", numeric_columns, index=1)
            method = st.selectbox(
                "Method",
                ["pearson", "spearman"],
                format_func=str.capitalize,
                help="Spearman is safer with outliers or non-linear but "
                "monotonic relationships.",
            )

    alpha = st.select_slider(
        "Significance level (α)",
        options=[0.01, 0.05, 0.10],
        value=0.05,
        help="Choose α before looking at results, not after.",
    )
    submitted = st.form_submit_button(
        "Run test", type="primary", icon=":material/play_arrow:"
    )

if submitted:
    try:
        if analysis == "groups":
            result = compare_groups(df, group, value, alpha=alpha)
        elif analysis == "association":
            result = association_test(df, column_a, column_b, alpha=alpha)
        else:
            result = correlation_test(df, column_x, column_y, method, alpha=alpha)
        st.session_state.dp_last_analysis = result
    except ValueError as exc:
        st.session_state.pop("dp_last_analysis", None)
        st.error(str(exc))

result = st.session_state.get("dp_last_analysis")
expected = {"groups": "group_comparison", "association": "association",
            "correlation": "correlation"}[analysis]

if result and result["analysis"] == expected:
    with st.container(border=True):
        st.subheader(result["title"])
        effect = result["effect_size"]
        with st.container(horizontal=True):
            st.metric("Primary test", result["primary_test"], border=True)
            st.metric("p-value", f"{result['primary_p_value']:.4g}", border=True)
            st.metric(
                effect["name"],
                "—" if effect["value"] is None else f"{effect['value']:.3f}",
                border=True,
            )
        st.markdown(result["interpretation"])
        for warning in result["warnings"]:
            st.warning(warning, icon=":material/warning:")
        st.caption(f":material/info: {result['caveat']}")

        if "group_summary" in result:
            st.dataframe(result["group_summary"], hide_index=True, width="stretch")
        if "contingency_table" in result:
            st.dataframe(result["contingency_table"], width="stretch")

        with st.expander("Assumptions and all test results"):
            for assumption in result["assumptions"]:
                st.markdown(f"- {assumption}")
            st.dataframe(pd.DataFrame(result["tests"]), hide_index=True)
            if result.get("normality_checks"):
                st.markdown("**Normality checks (Shapiro–Wilk)**")
                st.dataframe(
                    pd.DataFrame(result["normality_checks"]), hide_index=True
                )

        def _save() -> None:
            workspace.save_analysis(st.session_state.dp_last_analysis)
            st.toast("Analysis added to the report.")

        st.button(
            "Add to report", icon=":material/note_add:", on_click=_save
        )

if workspace.analyses:
    st.caption(
        f":material/summarize: {len(workspace.analyses)} analysis result(s) "
        "saved for the report. Running many tests raises the chance of a "
        "false positive; report every test you ran, not only the significant ones."
    )
