"""Write job artifacts (charts, tables, models, reports, code) to a directory.

The worker hands every operation an :class:`ArtifactWriter` bound to the
job's ``output_dir``. Files are only ever written directly inside that
directory under sanitized, unique names; the writer records the manifest the
API needs to store each file.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd
from matplotlib.figure import Figure

from datapilot.reports import _json_safe
from datapilot.visualization import EXPORT_FORMATS, SURFACE

KINDS = ("CHART", "TABLE", "MODEL", "REPORT", "CODE", "DATA")
CHART_DPI = 150
MAX_STEM = 80

CONTENT_TYPES = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "csv": "text/csv",
    "md": "text/markdown",
    "py": "text/x-python",
    "json": "application/json",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "joblib": "application/octet-stream",
}


def slugify(text: str, fallback: str = "file") -> str:
    """A lowercase, filesystem-safe name fragment."""
    slug = re.sub(r"[^a-z0-9_]+", "-", str(text).lower()).strip("-_")
    return slug[:MAX_STEM].strip("-_") or fallback


class ArtifactWriter:
    """Collects artifacts written into one output directory."""

    def __init__(self, output_dir: str | Path) -> None:
        if not output_dir:
            raise ValueError("The job has no output directory.")
        self.directory = Path(output_dir).resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.artifacts: list[dict[str, Any]] = []
        self._used: set[str] = set()

    def _path(self, stem: str, extension: str) -> tuple[str, Path]:
        base = slugify(stem)
        name = f"{base}.{extension}"
        counter = 2
        while name in self._used or (self.directory / name).exists():
            name = f"{base}-{counter}.{extension}"
            counter += 1
        path = (self.directory / name).resolve()
        if path.parent != self.directory:  # defence in depth; slugify forbids "/"
            raise ValueError("Unsafe artifact name.")
        self._used.add(name)
        return name, path

    def _record(
        self,
        name: str,
        kind: str,
        title: str,
        extension: str,
        metadata: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if kind not in KINDS:
            raise ValueError(f"Unknown artifact kind: {kind}")
        entry = {
            "file": name,
            "kind": kind,
            "title": title[:200],
            "content_type": CONTENT_TYPES[extension],
            "metadata": _json_safe(metadata or {}),
        }
        self.artifacts.append(entry)
        return entry

    def add_bytes(
        self,
        data: bytes,
        stem: str,
        extension: str,
        kind: str,
        title: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        name, path = self._path(stem, extension)
        path.write_bytes(data)
        return self._record(name, kind, title, extension, metadata)

    def add_text(
        self,
        text: str,
        stem: str,
        extension: str,
        kind: str,
        title: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self.add_bytes(
            text.encode("utf-8"), stem, extension, kind, title, metadata
        )

    def add_csv(
        self,
        frame: pd.DataFrame,
        stem: str,
        title: str,
        kind: str = "TABLE",
        metadata: dict[str, Any] | None = None,
        index: bool = False,
    ) -> dict[str, Any]:
        name, path = self._path(stem, "csv")
        frame.to_csv(path, index=index)
        meta = {"rows": len(frame), "columns": int(frame.shape[1])}
        meta.update(metadata or {})
        return self._record(name, kind, title, "csv", meta)

    def add_file(
        self,
        writer: Any,
        stem: str,
        extension: str,
        kind: str,
        title: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Let ``writer(path)`` produce the file (e.g. ``joblib.dump``)."""
        name, path = self._path(stem, extension)
        writer(path)
        return self._record(name, kind, title, extension, metadata)

    def add_figure(
        self,
        figure: Figure,
        stem: str,
        title: str,
        formats: tuple[str, ...] | list[str] = ("png",),
        metadata: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Save a chart in each format, then release the figure's memory."""
        entries = []
        try:
            for fmt in formats:
                if fmt not in EXPORT_FORMATS:
                    raise ValueError(f"Unsupported export format: {fmt}")
                name, path = self._path(stem, fmt)
                figure.savefig(
                    path, format=fmt, dpi=CHART_DPI, bbox_inches="tight",
                    facecolor=SURFACE,
                )
                entries.append(self._record(name, "CHART", title, fmt, metadata))
        finally:
            figure.clear()
        return entries
