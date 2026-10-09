"""Safe, reusable CSV and XLSX loading for DataPilot AI."""

from __future__ import annotations

import csv
import io
import math
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePath
from typing import BinaryIO, Protocol, runtime_checkable

import pandas as pd

MIB = 1024 * 1024


@runtime_checkable
class SupportsGetValue(Protocol):
    """Buffered upload object, such as Streamlit's UploadedFile."""

    def getvalue(self) -> bytes | bytearray:
        """Return the complete buffered payload."""
        ...


@dataclass(frozen=True)
class LoaderConfig:
    """Configurable resource and validation limits."""

    max_file_bytes: int = 10 * MIB
    max_rows: int = 100_000
    max_columns: int = 200

    # Protection against unusually large XLSX ZIP archives.
    max_xlsx_uncompressed_bytes: int = 100 * MIB
    max_xlsx_entries: int = 5_000


@dataclass
class LoadedDataset:
    """Dataset plus basic information about how it was loaded."""

    dataframe: pd.DataFrame
    filename: str
    file_type: str
    original_rows: int
    original_columns: int
    normalized_columns: list[str]


class DatasetLoadError(Exception):
    """Expected input or validation error safe to show to a user."""



def _read_bytes(
    source: bytes | bytearray | BinaryIO | SupportsGetValue,
    max_bytes: int,
) -> bytes:
    """Read input with a bounded read for ordinary file streams."""

    if isinstance(source, (bytes, bytearray)):
        data = bytes(source)

    elif isinstance(source, SupportsGetValue):
        # Streamlit uploads are already buffered in memory.
        try:
            data = bytes(source.getvalue())
        except Exception as exc:
            raise DatasetLoadError(
                "Could not read the uploaded file."
            ) from exc

    elif hasattr(source, "read"):
        try:
            old_position = (
                source.tell() if hasattr(source, "tell") else None
            )

            # Read at most one byte beyond the configured limit.
            data = source.read(max_bytes + 1)

            if old_position is not None and hasattr(source, "seek"):
                source.seek(old_position)

            if not isinstance(data, (bytes, bytearray)):
                raise DatasetLoadError(
                    "The file must be opened in binary mode."
                )

            data = bytes(data)

        except DatasetLoadError:
            raise
        except Exception as exc:
            raise DatasetLoadError(
                "Could not read the uploaded file."
            ) from exc

    else:
        raise DatasetLoadError(
            "Unsupported input. Supply file bytes or a binary file object."
        )

    if len(data) > max_bytes:
        raise DatasetLoadError(
            f"The file exceeds the {max_bytes / MIB:.0f} "
            "MiB upload limit."
        )

    return data


def _is_missing_header_value(value: object) -> bool:
    """Return whether a header cell is empty or a scalar null."""

    if value is None or value is pd.NA or value is pd.NaT:
        return True

    return isinstance(value, float) and math.isnan(value)


def _is_blank_header_value(value: object) -> bool:
    """Return whether a header cell has no usable text."""

    return _is_missing_header_value(value) or not str(value).strip()


def _normalize_header(value: object, index: int) -> str:
    """Convert a column heading into a stable, code-friendly name."""

    if _is_missing_header_value(value):
        text = ""

    else:
        text = str(value).strip()

    # Remove a UTF-8 BOM if it occurs in a header.
    text = text.lstrip("\ufeff")

    # Examples:
    # "Customer Name" -> "customer_name"
    # "Total ($)" -> "total"
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")

    if not text:
        text = f"column_{index + 1}"

    # Prefix names that begin with a number.
    if text[0].isdigit():
        text = f"column_{text}"

    return text


def _validate_and_normalize_headers(
    raw_headers: list[object],
) -> list[str]:
    """Reject ambiguous duplicate names after normalization."""

    if not raw_headers:
        raise DatasetLoadError(
            "The file does not contain a header row."
        )

    normalized = [
        _normalize_header(value, index)
        for index, value in enumerate(raw_headers)
    ]

    seen: set[str] = set()
    duplicates: set[str] = set()

    for name in normalized:
        if name in seen:
            duplicates.add(name)
        seen.add(name)

    if duplicates:
        names = ", ".join(sorted(duplicates))
        raise DatasetLoadError(
            "Column names are duplicated or become ambiguous "
            f"after normalization: {names}. Rename these columns "
            "so every column has a unique name, then upload again."
        )

    return normalized


def _infer_value_types(dataframe: pd.DataFrame) -> pd.DataFrame:
    """Recover numeric columns after reading headers as data."""

    inferred = dataframe.copy()

    for column in inferred.columns:
        series = inferred[column]
        converted = pd.to_numeric(series, errors="coerce")

        if converted.notna().equals(series.notna()):
            inferred[column] = converted

    return inferred.convert_dtypes()


def _check_xlsx_archive(
    data: bytes,
    config: LoaderConfig,
) -> None:
    """Check XLSX ZIP structure before parsing workbook contents."""

    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise DatasetLoadError(
            "This file is not a valid XLSX workbook. "
            "Please upload a genuine .xlsx file."
        )

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()

            if len(entries) > config.max_xlsx_entries:
                raise DatasetLoadError(
                    "The workbook contains too many internal files."
                )

            total_uncompressed = sum(
                entry.file_size for entry in entries
            )

            if (
                total_uncompressed
                > config.max_xlsx_uncompressed_bytes
            ):
                raise DatasetLoadError(
                    "The uncompressed workbook exceeds the "
                    "configured safety limit."
                )

            # Basic structure check; not a complete security audit.
            if "[Content_Types].xml" not in archive.namelist():
                raise DatasetLoadError(
                    "The XLSX workbook has an invalid structure."
                )

            if "xl/workbook.xml" not in archive.namelist():
                raise DatasetLoadError(
                    "The XLSX workbook does not contain a workbook."
                )

    except DatasetLoadError:
        raise
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        raise DatasetLoadError(
            "The Excel workbook is damaged or cannot be inspected."
        ) from exc


def _detect_csv_settings(data: bytes) -> tuple[str, str]:
    """Choose a supported text encoding and likely CSV delimiter."""

    decoded = None
    chosen_encoding = None

    # UTF-8 with BOM, ordinary UTF-8, then a common Windows fallback.
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            decoded = data.decode(encoding)
            chosen_encoding = encoding
            break
        except UnicodeDecodeError:
            continue

    if decoded is None or chosen_encoding is None:
        raise DatasetLoadError(
            "The CSV encoding is not supported. "
            "Save the file as UTF-8 CSV and try again."
        )

    sample = decoded[:50_000]

    try:
        dialect = csv.Sniffer().sniff(
            sample,
            delimiters=",;\t|",
        )
        delimiter = dialect.delimiter
    except csv.Error:
        # Comma-separated files are the default.
        delimiter = ","

    return chosen_encoding, delimiter


def _parse_csv(
    data: bytes,
    config: LoaderConfig,
) -> tuple[pd.DataFrame, list[object]]:
    """Parse CSV without letting pandas silently rename headers."""

    encoding, delimiter = _detect_csv_settings(data)

    try:
        raw = pd.read_csv(
            io.BytesIO(data),
            header=None,
            sep=delimiter,
            encoding=encoding,
            engine="python",
            on_bad_lines="error",
            nrows=config.max_rows + 2,
            skip_blank_lines=True,
        )

    except pd.errors.EmptyDataError as exc:
        raise DatasetLoadError(
            "The CSV file is empty."
        ) from exc
    except (pd.errors.ParserError, UnicodeError, ValueError) as exc:
        raise DatasetLoadError(
            "The CSV could not be parsed. Check its delimiter, "
            "quoting, encoding and row structure."
        ) from exc
    except Exception as exc:
        raise DatasetLoadError(
            "An unexpected error occurred while reading the CSV."
        ) from exc

    if raw.empty or raw.shape[1] == 0:
        raise DatasetLoadError(
            "The CSV does not contain a usable header or data."
        )

    raw_headers = raw.iloc[0].tolist()
    dataframe = raw.iloc[1:].reset_index(drop=True)

    return dataframe, raw_headers


def _parse_xlsx(
    data: bytes,
    config: LoaderConfig,
) -> tuple[pd.DataFrame, list[object]]:
    """Read the first worksheet, applying row and column limits."""

    _check_xlsx_archive(data, config)

    try:
        raw = pd.read_excel(
            io.BytesIO(data),
            sheet_name=0,
            header=None,
            nrows=config.max_rows + 2,
            engine="openpyxl",
        )

    except ImportError as exc:
        raise DatasetLoadError(
            "Excel support is unavailable. Install openpyxl."
        ) from exc
    except Exception as exc:
        raise DatasetLoadError(
            "The Excel workbook could not be read. "
            "Check that it is a valid, unencrypted .xlsx file."
        ) from exc

    if raw.empty or raw.shape[1] == 0:
        raise DatasetLoadError(
            "The first worksheet is empty."
        )

    raw_headers = raw.iloc[0].tolist()
    dataframe = raw.iloc[1:].reset_index(drop=True)

    return dataframe, raw_headers


def load_dataset(
    source: bytes | bytearray | BinaryIO | SupportsGetValue,
    filename: str,
    config: LoaderConfig | None = None,
) -> LoadedDataset:
    """
    Load a CSV or XLSX dataset with resource and schema checks.

    The first row is treated as the header. For XLSX files, the
    first worksheet is used.

    Raises DatasetLoadError for expected input and validation errors.
    """

    config = config or LoaderConfig()

    if (
        config.max_file_bytes <= 0
        or config.max_rows <= 0
        or config.max_columns <= 0
        or config.max_xlsx_uncompressed_bytes <= 0
        or config.max_xlsx_entries <= 0
    ):
        raise ValueError("All loader limits must be positive.")

    if not filename or not filename.strip():
        raise DatasetLoadError(
            "A filename is required."
        )

    extension = PurePath(filename).suffix.lower()

    if extension not in {".csv", ".xlsx"}:
        raise DatasetLoadError(
            "Unsupported file type. Upload a .csv or .xlsx file."
        )

    data = _read_bytes(source, config.max_file_bytes)

    if not data:
        raise DatasetLoadError(
            "The uploaded file is empty."
        )

    if len(data) > config.max_file_bytes:
        raise DatasetLoadError(
            f"The file exceeds the {config.max_file_bytes / MIB:.0f} "
            "MiB upload limit."
        )

    if extension == ".csv":
        dataframe, raw_headers = _parse_csv(data, config)
        file_type = "csv"
    else:
        dataframe, raw_headers = _parse_xlsx(data, config)
        file_type = "xlsx"

    column_count = len(raw_headers)

    if column_count > config.max_columns:
        raise DatasetLoadError(
            f"The dataset has {column_count} columns; "
            f"the limit is {config.max_columns}."
        )

    if len(dataframe) > config.max_rows:
        raise DatasetLoadError(
            f"The dataset exceeds the {config.max_rows:,}-row limit."
        )

    # A completely blank header row cannot identify the columns.
    if all(_is_blank_header_value(value) for value in raw_headers):
        raise DatasetLoadError(
            "The header row is empty. Add a header to every column."
        )

    normalized = _validate_and_normalize_headers(raw_headers)

    dataframe.columns = normalized
    dataframe = _infer_value_types(dataframe)

    # Reject files with a header but no meaningful data records.
    if dataframe.empty:
        raise DatasetLoadError(
            "The file contains headers but no data rows."
        )

    if dataframe.dropna(how="all").empty:
        raise DatasetLoadError(
            "The file contains no non-empty data rows."
        )

    return LoadedDataset(
        dataframe=dataframe,
        filename=PurePath(filename).name,
        file_type=file_type,
        original_rows=len(dataframe),
        original_columns=column_count,
        normalized_columns=normalized,
    )
