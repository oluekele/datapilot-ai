
import streamlit as st
import pandas as pd

st.set_page_config(
    page_title="DataPilot AI",
    page_icon="🔬",
    layout="wide",
)

st.title("🔬 DataPilot AI")
st.subheader("Understand your data before training your model.")

st.write(
    "Upload a CSV or Excel dataset to inspect its structure "
    "and discover potential data-quality problems."
)

uploaded_file = st.file_uploader(
    "Choose a dataset",
    type=["csv", "xlsx"],
)

if uploaded_file is not None:
    try:
        if uploaded_file.name.lower().endswith(".csv"):
            df = pd.read_csv(uploaded_file)
        else:
            df = pd.read_excel(uploaded_file)

        st.success("Dataset loaded successfully.")

        col1, col2, col3 = st.columns(3)

        col1.metric("Rows", f"{len(df):,}")
        col2.metric("Columns", f"{len(df.columns):,}")
        col3.metric(
            "Missing cells",
            f"{int(df.isna().sum().sum()):,}",
        )

        st.subheader("Dataset preview")
        st.dataframe(df.head(10), width="stretch")

        st.subheader("Column information")

        summary = pd.DataFrame({
            "Column": df.columns.astype(str),
            "Data type": df.dtypes.astype(str).values,
            "Missing values": df.isna().sum().values,
            "Missing (%)": (
                df.isna().mean().mul(100).round(2).values
            ),
            "Unique values": df.nunique().values,
        })

        st.dataframe(summary, width="stretch")

    except Exception as exc:
        st.error(
            "The file could not be read. "
            "Check the file format and try again."
        )
        st.caption(f"Technical details: {exc}")
else:
    st.info("Upload a sample CSV or Excel file to get started.")
