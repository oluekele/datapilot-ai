"""Per-session workspace state, independent of the user interface."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pandas as pd

from datapilot.loader import LoadedDataset
from datapilot.profiler import profile_dataset

ORIGINAL = "original"
REPAIRED = "repaired"


@dataclass
class Workspace:
    """The loaded dataset plus everything the user chose to keep.

    Repairs are stored as a separate copy; the original data is never
    replaced. Downstream modules use the repaired copy only when the user
    opts in with ``use_repaired``.
    """

    dataset: LoadedDataset
    repaired: pd.DataFrame | None = None
    applied_repairs: list[dict[str, Any]] = field(default_factory=list)
    use_repaired: bool = False
    ml_result: dict[str, Any] | None = None
    ml_settings: dict[str, Any] | None = None
    analyses: list[dict[str, Any]] = field(default_factory=list)
    charts: list[dict[str, Any]] = field(default_factory=list)
    _profiles: dict[str, dict[str, Any]] = field(default_factory=dict, repr=False)
    _memo: dict[tuple, Any] = field(default_factory=dict, repr=False)

    @property
    def name(self) -> str:
        return self.dataset.filename

    @property
    def variant(self) -> str:
        """Which version of the data downstream modules are using."""
        if self.use_repaired and self.repaired is not None:
            return REPAIRED
        return ORIGINAL

    @property
    def active_df(self) -> pd.DataFrame:
        if self.variant == REPAIRED:
            return self.repaired
        return self.dataset.dataframe

    def profile(self, variant: str | None = None) -> dict[str, Any]:
        """Profile a data variant once and reuse the result."""
        variant = variant or self.variant
        if variant not in self._profiles:
            frame = (
                self.repaired
                if variant == REPAIRED and self.repaired is not None
                else self.dataset.dataframe
            )
            self._profiles[variant] = profile_dataset(frame)
        return self._profiles[variant]

    def cached(self, key: tuple, compute: Callable[[pd.DataFrame], Any]) -> Any:
        """Compute a result for the active data once, then reuse it.

        Results are keyed by data variant, so switching between original and
        repaired data never returns a stale result.
        """
        full_key = (self.variant, *key)
        if full_key not in self._memo:
            self._memo[full_key] = compute(self.active_df)
        return self._memo[full_key]

    def _forget_repaired(self) -> None:
        self._profiles.pop(REPAIRED, None)
        self._memo = {k: v for k, v in self._memo.items() if k[0] != REPAIRED}

    def set_repaired(
        self,
        repaired: pd.DataFrame,
        applied: list[dict[str, Any]],
    ) -> None:
        self.repaired = repaired
        self.applied_repairs = applied
        self._forget_repaired()

    def discard_repairs(self) -> None:
        self.repaired = None
        self.applied_repairs = []
        self.use_repaired = False
        self._forget_repaired()

    def _stamp(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            **item,
            "data_variant": self.variant,
            "saved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }

    def save_analysis(self, result: dict[str, Any]) -> None:
        self.analyses.append(self._stamp(result))

    def save_chart(self, chart: dict[str, Any]) -> None:
        self.charts.append(self._stamp(chart))

    def save_ml_result(
        self,
        result: dict[str, Any],
        settings: dict[str, Any],
    ) -> None:
        self.ml_result = result
        self.ml_settings = {**settings, "data_variant": self.variant}
