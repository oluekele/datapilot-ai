
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

_NORMALIZE_HEADER = '''
def normalize_header(value, index):
    """Match DataPilot's column-name normalisation ("Monthly charge" -> "monthly_charge")."""
    text = str(value).strip().lstrip("\\ufeff").lower()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_") or f"column_{index + 1}"
    return f"column_{text}" if text[0].isdigit() else text
'''


def generate_training_script(
    *,
    task: str,
    target: str | None,
    features: list[str],
    numeric_features: list[str],
    categorical_features: list[str],
    estimator_import: str,
    estimator_code: str,
    dense: bool,
    max_categories: int,
    test_size: float = 0.2,
    random_state: int = 42,
    model_filename: str = "model.joblib",
) -> str:
    """Generate a standalone script that reproduces a TRAIN run.

    The script mirrors the worker's choices: the same features, the same
    preprocessing (fitted on training rows only, inside the pipeline), the
    same estimator and hyperparameters, split and random seed.
    """
    if task not in {"classification", "regression", "clustering"}:
        raise ValueError(
            "task must be 'classification', 'regression' or 'clustering'."
        )
    if task != "clustering" and (not isinstance(target, str) or not target):
        raise ValueError("target must be a non-empty column name.")

    sparse_line = "    sparse_threshold=0,\n" if dense else ""
    header = f'''"""
DataPilot AI generated training script ({task}).

Reproduces the model DataPilot trained: same features, preprocessing,
estimator, split and random seed. Review it before using it in production.
The source CSV is only read, never modified.
"""

import re

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
{estimator_import}

DATA_PATH = "your_dataset.csv"
MODEL_PATH = {model_filename!r}
TARGET = {target!r}
FEATURES = {features!r}
NUMERIC_FEATURES = {numeric_features!r}
CATEGORICAL_FEATURES = {categorical_features!r}
TEST_SIZE = {test_size!r}
RANDOM_STATE = {random_state!r}
{_NORMALIZE_HEADER}

def load_data():
    df = pd.read_csv(DATA_PATH)
    df.columns = [normalize_header(c, i) for i, c in enumerate(df.columns)]
    needed = FEATURES + ([TARGET] if TARGET else [])
    missing = [c for c in needed if c not in df.columns]
    if missing:
        raise ValueError(f"Columns not found in {{DATA_PATH}}: {{missing}}")
    for column in NUMERIC_FEATURES:
        df[column] = pd.to_numeric(df[column], errors="coerce").astype("float64")
    for column in CATEGORICAL_FEATURES:
        df[column] = df[column].map(lambda v: v if pd.isna(v) else str(v))
    return df


def build_pipeline():
    transformers = []
    if NUMERIC_FEATURES:
        transformers.append(("numeric", Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]), NUMERIC_FEATURES))
    if CATEGORICAL_FEATURES:
        transformers.append(("categorical", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore",
                                      max_categories={max_categories!r})),
        ]), CATEGORICAL_FEATURES))
    preprocessor = ColumnTransformer(
        transformers=transformers,
        remainder="drop",
{sparse_line}    )
    model = {estimator_code}
    return Pipeline([("preprocessor", preprocessor), ("model", model)])
'''

    if task == "clustering":
        body = '''

def main():
    from sklearn.metrics import silhouette_score

    df = load_data()
    X = df[FEATURES]
    pipeline = build_pipeline()
    labels = pipeline.fit_predict(X)
    transformed = pipeline.named_steps["preprocessor"].transform(X)
    print("Cluster sizes:", pd.Series(labels).value_counts().sort_index().to_dict())
    print("Silhouette:", silhouette_score(
        transformed, labels, sample_size=min(5000, len(labels)),
        random_state=RANDOM_STATE))
    df.assign(cluster=labels).to_csv("dataset_with_clusters.csv", index=False)
    joblib.dump(pipeline, MODEL_PATH)
'''
    else:
        if task == "classification":
            labels = '''    y = df[TARGET]
    if pd.api.types.is_numeric_dtype(y) and (y % 1 == 0).all():
        y = y.astype("int64")
    elif not pd.api.types.is_numeric_dtype(y):
        y = y.astype(str)
    counts = y.value_counts()
    test_count = int(np.ceil(len(y) * TEST_SIZE))
    can_stratify = counts.min() >= 2 and min(test_count, len(y) - test_count) >= len(counts)
    stratify = y if can_stratify else None
'''
            evaluation = '''    from sklearn.metrics import classification_report
    print(classification_report(y_test, predictions, zero_division=0))
'''
        else:
            labels = '''    y = pd.to_numeric(df[TARGET], errors="coerce").astype("float64")
    stratify = None
'''
            evaluation = '''    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    print("R²:", r2_score(y_test, predictions))
    print("MAE:", mean_absolute_error(y_test, predictions))
    print("RMSE:", np.sqrt(mean_squared_error(y_test, predictions)))
'''
        body = f'''

def main():
    from sklearn.model_selection import train_test_split

    df = load_data()
    df = df.loc[df[TARGET].notna()].copy()
{labels}    X = df[FEATURES]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=stratify,
    )
    pipeline = build_pipeline()
    pipeline.fit(X_train, y_train)  # preprocessing is fitted on training rows only
    predictions = pipeline.predict(X_test)
    print("Training rows:", len(X_train), "Test rows:", len(X_test))
{evaluation}    joblib.dump(pipeline, MODEL_PATH)
    # Only load model files you trust: joblib.load can execute code.
'''

    return header + body + '''

if __name__ == "__main__":
    main()
'''
