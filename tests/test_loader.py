import io

import pandas as pd
import pytest

from datapilot.loader import (
    DatasetLoadError,
    LoaderConfig,
    load_dataset,
)


def test_load_valid_csv():
    content = b"name,age\nAda,30\nGrace,35\n"

    result = load_dataset(content, "people.csv")

    assert result.file_type == "csv"
    assert result.original_rows == 2
    assert result.original_columns == 2
    assert list(result.dataframe.columns) == ["name", "age"]
    assert result.dataframe.iloc[0]["name"] == "Ada"


def test_normalizes_column_names():
    content = b"Customer Name,Total ($)\nAda,100\n"

    result = load_dataset(content, "orders.csv")

    assert list(result.dataframe.columns) == [
        "customer_name",
        "total",
    ]


def test_duplicate_normalized_names_are_rejected():
    content = b"Customer Name,customer-name\nAda,Ada\n"

    with pytest.raises(DatasetLoadError, match="duplicated"):
        load_dataset(content, "duplicate.csv")


def test_empty_file_is_rejected():
    with pytest.raises(DatasetLoadError, match="empty"):
        load_dataset(b"", "empty.csv")


def test_header_only_file_is_rejected():
    with pytest.raises(DatasetLoadError, match="no data rows"):
        load_dataset(b"name,age\n", "headers.csv")


def test_unsupported_extension_is_rejected():
    with pytest.raises(DatasetLoadError, match="Unsupported"):
        load_dataset(b"hello", "data.json")


def test_file_size_limit():
    config = LoaderConfig(max_file_bytes=10)

    with pytest.raises(DatasetLoadError, match="exceeds"):
        load_dataset(
            b"name\nthis content is too long\n",
            "large.csv",
            config,
        )


def test_row_limit():
    config = LoaderConfig(max_rows=2)
    content = b"name\nAda\nGrace\nLinus\n"

    with pytest.raises(DatasetLoadError, match="row limit"):
        load_dataset(content, "people.csv", config)


def test_column_limit():
    config = LoaderConfig(max_columns=2)
    content = b"a,b,c\n1,2,3\n"

    with pytest.raises(DatasetLoadError, match="columns"):
        load_dataset(content, "wide.csv", config)


def test_utf8_bom_is_supported():
    content = "\ufeffName,Age\nAda,30\n".encode("utf-8")

    result = load_dataset(content, "bom.csv")

    assert list(result.dataframe.columns) == ["name", "age"]


def test_semicolon_delimiter_is_supported():
    content = b"name;age\nAda;30\n"

    result = load_dataset(content, "people.csv")

    assert result.dataframe.iloc[0]["name"] == "Ada"
    assert result.dataframe.iloc[0]["age"] == 30


def test_binary_file_object_is_supported():
    content = io.BytesIO(b"name,age\nAda,30\n")

    result = load_dataset(content, "people.csv")

    assert len(result.dataframe) == 1


def test_valid_excel_file():
    workbook = io.BytesIO()

    sample = pd.DataFrame({
        "Customer Name": ["Ada", "Grace"],
        "Age": [30, 35],
    })

    with pd.ExcelWriter(workbook, engine="openpyxl") as writer:
        sample.to_excel(
            writer,
            index=False,
            sheet_name="Customers",
        )

    result = load_dataset(
        workbook.getvalue(),
        "customers.xlsx",
    )

    assert result.file_type == "xlsx"
    assert result.original_rows == 2
    assert list(result.dataframe.columns) == [
        "customer_name",
        "age",
    ]


def test_invalid_excel_file_is_rejected():
    with pytest.raises(DatasetLoadError, match="valid XLSX"):
        load_dataset(b"not an Excel workbook", "bad.xlsx")