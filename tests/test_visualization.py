import numpy as np
import pandas as pd
import pytest
from matplotlib.figure import Figure

from datapilot.visualization import (
    CATEGORICAL,
    OTHER_COLOR,
    ChartSpec,
    ColumnFilter,
    apply_filters,
    build_chart,
    default_title,
    describe_spec,
    figure_to_bytes,
    validate_spec,
)


@pytest.fixture
def df():
    rng = np.random.default_rng(7)
    n = 90
    return pd.DataFrame(
        {
            "age": rng.integers(18, 70, n).astype(float),
            "income": rng.normal(50000, 10000, n),
            "city": ["Lagos", "Abuja", "Kano", "Ibadan", "Enugu"] * 18,
            "month": list(range(1, 10)) * 10,
        }
    )


@pytest.mark.parametrize(
    "spec",
    [
        ChartSpec("histogram", x="age"),
        ChartSpec("histogram", x="age", group="city"),
        ChartSpec("box", y="income"),
        ChartSpec("box", x="city", y="income"),
        ChartSpec("bar", x="city"),
        ChartSpec("bar", x="city", y="income", aggregation="mean"),
        ChartSpec("bar", x="city", y="income", aggregation="sum", group="month"),
        ChartSpec("scatter", x="age", y="income"),
        ChartSpec("scatter", x="age", y="income", group="city"),
        ChartSpec("line", x="month", y="income", aggregation="mean"),
        ChartSpec("line", x="month", y="income", aggregation="mean", group="city"),
        ChartSpec("correlation_heatmap"),
    ],
    ids=lambda spec: f"{spec.chart_type}-{spec.group or 'single'}",
)
def test_every_chart_type_renders_and_exports(df, spec):
    figure = build_chart(df, spec)

    assert isinstance(figure, Figure)
    png = figure_to_bytes(figure, "png")
    assert png.startswith(b"\x89PNG")
    assert b"<svg" in figure_to_bytes(figure, "svg")


def test_scatter_folds_extra_groups_into_gray_other(df):
    figure = build_chart(df, ChartSpec("scatter", x="age", y="income", group="city"))
    axes = figure.axes[0]
    labels = [text.get_text() for text in axes.get_legend().get_texts()]

    assert len(labels) == 4
    assert labels[-1] == "Other"
    colors = [
        tuple(collection.get_facecolor()[0][:3]) for collection in axes.collections
    ]
    assert colors[0] == pytest.approx(_rgb(CATEGORICAL[0]))
    assert colors[-1] == pytest.approx(_rgb(OTHER_COLOR))


def _rgb(hex_color):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4))


@pytest.mark.parametrize(
    ("spec", "message"),
    [
        (ChartSpec("histogram", x="city"), "numeric x"),
        (ChartSpec("scatter", x="city", y="income"), "numeric x and y"),
        (ChartSpec("bar", x="city", y="city", aggregation="mean"), "numeric y"),
        (ChartSpec("pie", x="city"), "Unknown chart type"),
        (ChartSpec("bar", x="missing_column"), "does not exist"),
        (ChartSpec("scatter", x="age", y="income", group="age"), "must differ"),
        (ChartSpec("histogram", x="age", bins=1), "bins"),
    ],
)
def test_invalid_specs_are_rejected(df, spec, message):
    with pytest.raises(ValueError, match=message):
        validate_spec(df, spec)


def test_filters_select_rows_without_modifying_input(df):
    original = df.copy(deep=True)
    filters = [
        ColumnFilter("city", values=["Lagos", "Kano"]),
        ColumnFilter("age", min_value=30, max_value=50),
    ]

    result = apply_filters(df, filters)

    assert set(result["city"]) <= {"Lagos", "Kano"}
    assert result["age"].between(30, 50).all()
    pd.testing.assert_frame_equal(df, original)


def test_filters_that_remove_every_row_raise(df):
    spec = ChartSpec(
        "histogram", x="age", filters=[ColumnFilter("age", min_value=1000)]
    )

    with pytest.raises(ValueError, match="No rows remain"):
        build_chart(df, spec)


def test_titles_and_descriptions_are_readable():
    spec = ChartSpec(
        "bar",
        x="city",
        y="income",
        aggregation="mean",
        filters=[ColumnFilter("city", values=["Lagos"])],
    )

    assert default_title(spec) == "Mean income by city"
    description = describe_spec(spec)
    assert "Bar chart" in description
    assert "aggregation = mean" in description
    assert "filter city in [Lagos]" in description


def test_custom_title_is_used(df):
    figure = build_chart(df, ChartSpec("histogram", x="age", title="Ages"))

    assert figure.axes[0].get_title(loc="left") == "Ages"


def test_unsupported_export_format(df):
    figure = build_chart(df, ChartSpec("histogram", x="age"))

    with pytest.raises(ValueError, match="format"):
        figure_to_bytes(figure, "gif")
