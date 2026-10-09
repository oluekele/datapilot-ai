import streamlit as st

from app_support import data_variant_caption, require_workspace, show_findings
from datapilot.ml_readiness import run_baseline
from datapilot.pipeline_generator import generate_pipeline_code

workspace = require_workspace()
df = workspace.active_df
data_variant_caption(workspace)

with st.form("ml_form"):
    with st.container(horizontal=True):
        target = st.selectbox(
            "What do you want to predict?", list(df.columns), key="ml_target"
        )
        task = st.segmented_control(
            "Prediction task",
            ["classification", "regression"],
            format_func=str.capitalize,
            default="classification",
            required=True,
            key="ml_task",
        )
    test_size = st.slider(
        "Test set percentage",
        min_value=10,
        max_value=40,
        value=20,
        step=5,
        help="The remaining labelled rows are used for training.",
        key="ml_test_size",
    )
    submitted = st.form_submit_button(
        "Run ML readiness diagnostics", type="primary", icon=":material/play_arrow:"
    )

if submitted:
    try:
        with st.spinner("Training baseline models…"):
            result = run_baseline(
                df=df, target=target, task=task, test_size=test_size / 100
            )
        workspace.save_ml_result(
            result,
            {"target": target, "task": task, "test_size": test_size / 100,
             "random_state": 42},
        )
    except (ValueError, TypeError) as exc:
        st.error(str(exc))

result = workspace.ml_result
if result is None:
    st.caption("Run the diagnostics to see baseline results and leakage warnings.")
    st.stop()

st.subheader(f"Baseline results · {result['target']} ({result['task']})")
if workspace.ml_settings and workspace.ml_settings["data_variant"] != workspace.variant:
    st.warning(
        f"These results were computed on the {workspace.ml_settings['data_variant']} "
        "data. Run again to use the current data.",
        icon=":material/history:",
    )

with st.container(horizontal=True):
    st.metric("Labelled rows", f"{result['labelled_rows']:,}", border=True)
    st.metric("Training rows", f"{result['training_rows']:,}", border=True)
    st.metric("Test rows", f"{result['test_rows']:,}", border=True)

st.dataframe(
    [
        {
            "Model": name,
            "Status": model["status"],
            **(
                model.get("metrics", {})
                if model["status"] == "success"
                else {"Reason": model.get("reason", "")}
            ),
        }
        for name, model in result["models"].items()
    ],
    hide_index=True,
    width="stretch",
)
st.caption(
    "Compare every model against the dummy baseline. A model that barely "
    "beats it has learned little."
)

st.subheader("Readiness and leakage warnings")
if result["findings"]:
    show_findings(result["findings"])
else:
    st.success("No heuristic warnings were generated.")

with st.expander("Evaluation limitations"):
    for limitation in result["limitations"]:
        st.markdown(f"- {limitation}")

st.subheader("Reproducible training pipeline")
pipeline_code = generate_pipeline_code(target=result["target"], task=result["task"])
st.code(pipeline_code, language="python")
st.download_button(
    "Download Python pipeline",
    data=pipeline_code.encode("utf-8"),
    file_name="datapilot_pipeline.py",
    mime="text/x-python",
    icon=":material/download:",
    on_click="ignore",
)
st.caption("The ML results are included in the report when the ML section is selected.")
