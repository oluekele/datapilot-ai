
import ast

import pytest

from datapilot.pipeline_generator import generate_pipeline_code


@pytest.mark.parametrize(
    "task",
    ["classification", "regression"],
)
def test_generated_pipeline_is_valid_python(task):
    code = generate_pipeline_code("customer outcome", task)

    ast.parse(code)

    assert "train_test_split" in code
    assert "SimpleImputer" in code
    assert "OneHotEncoder" in code
    assert "pipeline.fit(X_train, y_train)" in code


def test_generated_pipeline_contains_requested_target():
    code = generate_pipeline_code("customer_left", "classification")

    assert "TARGET = 'customer_left'" in code
    assert "LogisticRegression" in code


def test_invalid_task_is_rejected():
    with pytest.raises(ValueError, match="task must be"):
        generate_pipeline_code("price", "clustering")


def test_empty_target_is_rejected():
    with pytest.raises(ValueError, match="non-empty"):
        generate_pipeline_code("", "regression")