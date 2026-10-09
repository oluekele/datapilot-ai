
from __future__ import annotations


def generate_pipeline_code(target: str, task: str) -> str:
    """Generate an inspectable, reusable scikit-learn training script."""
    if not isinstance(target, str) or not target.strip():
        raise ValueError("target must be a non-empty column name.")

    if task not in {"classification", "regression"}:
        raise ValueError(
            "task must be 'classification' or 'regression'."
        )

    # repr safely represents the target as a Python string literal.
    target_literal = repr(target)

    if task == "classification":
        model_import = "from sklearn.linear_model import LogisticRegression"
        model_definition = (
            "model = LogisticRegression(max_iter=1000, random_state=42)"
        )
        stratify_code = (
            "stratify = y if y.value_counts().min() >= 2 else None"
        )
        split_stratify = "stratify=stratify"
        evaluation = (
            "from sklearn.metrics import accuracy_score, f1_score\n"
            "predictions = pipeline.predict(X_test)\n"
            'print("Accuracy:", accuracy_score(y_test, predictions))\n'
            'print("Weighted F1:", f1_score(y_test, predictions, '
            "average='weighted', zero_division=0))"
        )
    else:
        model_import = (
            "from sklearn.ensemble import RandomForestRegressor"
        )
        model_definition = (
            "model = RandomForestRegressor("
            "n_estimators=100, random_state=42, n_jobs=-1)"
        )
        stratify_code = "stratify = None"
        split_stratify = "stratify=stratify"
        evaluation = (
            "from sklearn.metrics import mean_absolute_error, "
            "mean_squared_error, r2_score\n"
            "import numpy as np\n"
            "predictions = pipeline.predict(X_test)\n"
            'print("MAE:", mean_absolute_error(y_test, predictions))\n'
            'print("RMSE:", np.sqrt(mean_squared_error(y_test, predictions)))\n'
            'print("R²:", r2_score(y_test, predictions))'
        )

    return f'''"""
DataPilot AI generated preprocessing and baseline pipeline.

Review the dataset, target, and split strategy before using this script.
This script expects a CSV file and does not modify the source file.
"""

import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
{model_import}


DATA_PATH = "your_dataset.csv"
TARGET = {target_literal}
RANDOM_STATE = 42
TEST_SIZE = 0.2


def main():
    df = pd.read_csv(DATA_PATH)

    if TARGET not in df.columns:
        raise ValueError(f"Target column {{TARGET!r}} was not found.")

    df = df.loc[df[TARGET].notna()].copy()
    if df[TARGET].nunique() < 2:
        raise ValueError("The target needs at least two distinct values.")

    X = df.drop(columns=[TARGET])
    y = df[TARGET]

    all_missing = X.columns[X.isna().all()].tolist()
    X = X.drop(columns=all_missing)

    if X.shape[1] == 0:
        raise ValueError("No usable feature columns remain.")

    numeric_columns = X.select_dtypes(include="number").columns.tolist()
    categorical_columns = [
        column for column in X.columns
        if column not in numeric_columns
    ]

    numeric_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore")),
    ])

    transformers = []
    if numeric_columns:
        transformers.append(
            ("numeric", numeric_pipeline, numeric_columns)
        )
    if categorical_columns:
        transformers.append(
            ("categorical", categorical_pipeline, categorical_columns)
        )

    preprocessor = ColumnTransformer(
        transformers=transformers,
        remainder="drop",
    )

    {stratify_code}

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        {split_stratify},
    )

    {model_definition}

    pipeline = Pipeline([
        ("preprocessor", preprocessor),
        ("model", model),
    ])

    pipeline.fit(X_train, y_train)

    print("Training rows:", len(X_train))
    print("Test rows:", len(X_test))
    print("Excluded all-missing features:", all_missing)

    {evaluation}


if __name__ == "__main__":
    main()
'''