"""Validation of operation parameters sent by the API.

Every accessor raises ``ValueError`` with a message that is safe to show to
the user. Keys are the camelCase names from the API contract. Unknown keys
are ignored so the API can add optional fields without breaking the worker.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

import pandas as pd


class ParamError(ValueError):
    """A parameter is missing, has the wrong type or an invalid value."""


class Params:
    def __init__(self, raw: Any, df: pd.DataFrame | None = None) -> None:
        if raw is None:
            raw = {}
        if not isinstance(raw, dict):
            raise ParamError("Operation parameters must be a JSON object.")
        self.raw = raw
        self.df = df

    def _get(self, key: str) -> Any:
        value = self.raw.get(key)
        if isinstance(value, str) and not value.strip():
            return None
        return value

    def has(self, key: str) -> bool:
        return self._get(key) is not None

    def choice(
        self,
        key: str,
        allowed: Iterable[str],
        default: str | None = None,
        required: bool = False,
    ) -> str | None:
        allowed = tuple(allowed)
        value = self._get(key)
        if value is None:
            if required:
                raise ParamError(
                    f"'{key}' is required. Choose one of: {', '.join(allowed)}."
                )
            return default
        if not isinstance(value, str) or value not in allowed:
            raise ParamError(
                f"Unsupported {key} {value!r}. Choose one of: {', '.join(allowed)}."
            )
        return value

    def _check_column(self, key: str, value: Any) -> str:
        if not isinstance(value, str):
            raise ParamError(f"'{key}' must be a column name.")
        if self.df is not None and value not in self.df.columns:
            raise ParamError(f"Column '{value}' ({key}) does not exist in the dataset.")
        return value

    def column(self, key: str, required: bool = False) -> str | None:
        value = self._get(key)
        if value is None:
            if required:
                raise ParamError(f"'{key}' is required: choose a column.")
            return None
        return self._check_column(key, value)

    def columns(
        self, key: str, max_items: int = 50, min_items: int = 1
    ) -> list[str] | None:
        value = self._get(key)
        if value is None:
            return None
        if not isinstance(value, list):
            raise ParamError(f"'{key}' must be a list of column names.")
        if len(value) < min_items:
            raise ParamError(f"'{key}' needs at least {min_items} column(s).")
        if len(value) > max_items:
            raise ParamError(f"'{key}' accepts at most {max_items} columns.")
        result = [self._check_column(key, item) for item in value]
        if len(set(result)) != len(result):
            raise ParamError(f"'{key}' lists a column more than once.")
        return result

    def strings(
        self,
        key: str,
        allowed: Iterable[str],
        max_items: int = 20,
    ) -> list[str] | None:
        allowed = tuple(allowed)
        value = self._get(key)
        if value is None:
            return None
        if not isinstance(value, list) or not value:
            raise ParamError(f"'{key}' must be a non-empty list.")
        if len(value) > max_items:
            raise ParamError(f"'{key}' accepts at most {max_items} items.")
        for item in value:
            if not isinstance(item, str) or item not in allowed:
                raise ParamError(
                    f"Unsupported {key} item {item!r}. Choose from: "
                    f"{', '.join(allowed)}."
                )
        return list(dict.fromkeys(value))

    def number(
        self,
        key: str,
        default: float | None,
        minimum: float,
        maximum: float,
        exclusive: bool = False,
    ) -> float | None:
        value = self._get(key)
        if value is None:
            return default
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ParamError(f"'{key}' must be a number.")
        value = float(value)
        if not math.isfinite(value):
            raise ParamError(f"'{key}' must be a finite number.")
        low_ok = value > minimum if exclusive else value >= minimum
        high_ok = value < maximum if exclusive else value <= maximum
        if not (low_ok and high_ok):
            bounds = "strictly between" if exclusive else "between"
            raise ParamError(f"'{key}' must be {bounds} {minimum:g} and {maximum:g}.")
        return value

    def integer(
        self,
        key: str,
        default: int | None,
        minimum: int,
        maximum: int,
    ) -> int | None:
        value = self._get(key)
        if value is None:
            return default
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ParamError(f"'{key}' must be a whole number.")
        if isinstance(value, float) and not value.is_integer():
            raise ParamError(f"'{key}' must be a whole number.")
        value = int(value)
        if not minimum <= value <= maximum:
            raise ParamError(f"'{key}' must be between {minimum} and {maximum}.")
        return value

    def items(self, key: str, min_items: int, max_items: int) -> list[Any]:
        value = self._get(key)
        if not isinstance(value, list):
            raise ParamError(f"'{key}' must be a list.")
        if not min_items <= len(value) <= max_items:
            raise ParamError(
                f"'{key}' must contain between {min_items} and {max_items} items."
            )
        return value
