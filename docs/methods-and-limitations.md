# Methods and limitations

This document records the methods DataPilot AI uses, the thresholds behind
its warnings, and the limits of what its output can tell you.

## Loading

- CSV (delimiter and encoding detected) and XLSX (first worksheet only).
- Default limits: 10 MiB file size, 100,000 rows, 200 columns. Excel archives
  are checked for decompression bombs before they are parsed.
- Column names are normalized to `snake_case`. If two names normalize to the
  same value, the file is rejected rather than having a column silently
  renamed.

## Column kinds

Column kinds decide which summaries and tests apply.

| Kind | Rule |
| --- | --- |
| boolean | Boolean dtype, or numeric with only the values 0 and 1 |
| datetime | Datetime dtype |
| numeric | Any other numeric dtype |
| text | Non-numeric, with ≥ 50 distinct values that make up more than 50% of non-missing rows (IDs, free text) |
| categorical | Everything else |

## Dataset health

- **Outliers:** values outside 1.5 × IQR, computed when there are at least four
  finite values. These are flags for review, not errors.
- **Constant columns:** exactly one distinct non-missing value.
- **Duplicates:** exact matches across all columns.
- **Repairs:** nothing changes until you select a repair. Applying repairs
  produces a separate copy of the data and keeps the original.
  - Duplicate rows, constant columns, and untrimmed text can be removed or
    cleaned.
  - Missing values: numeric columns can be filled with the median or mean, and
    text columns with the most frequent value or `Unknown`. Alternatively,
    rows with a missing value can be removed. Fills on integer columns are
    rounded so the column stays an integer.
  - Outliers can be capped at the 1.5 × IQR bounds or have their rows removed.
    These repairs are marked high risk because outliers are often real
    observations.
  - Repairs always run in the same order: trim text, remove duplicates,
    remove constant columns, handle missing values, then handle outliers.
    The same selection therefore always gives the same result.
  - Leakage: filling or capping uses statistics from every row. If you train a
    model on the repaired copy, test rows have influenced the training data.
    The ML readiness pipeline already imputes using training data only, so
    you can leave missing values unrepaired when the goal is modelling.

## Exploration

- Pearson correlation measures linear association. Spearman measures
  monotonic association and is more robust to outliers.
- Correlations need at least 10 complete pairs. Each correlation reports `n`,
  the number of complete pairs behind it.
- Verbal labels (|r|): < 0.2 negligible, < 0.4 weak, < 0.7 moderate,
  otherwise strong. These are conventions, not universal standards.

## Statistical analysis

| Question | Primary test | Robustness check | Effect size |
| --- | --- | --- | --- |
| Do two groups differ on a numeric outcome? | Welch's t-test | Mann–Whitney U | Cohen's d |
| Do 3+ groups differ? | One-way ANOVA | Kruskal–Wallis | η² |
| Are two categorical columns associated? | Chi-square test of independence | — | Cramér's V |
| Do two numeric columns move together? | Pearson or Spearman | — | r, with a Fisher-z CI |

- **Assumption checks:** Shapiro–Wilk normality per group (n ≤ 5,000) and
  Levene's test (median-centred) for equal variances.
- **When the robustness check becomes primary:** if any group has n < 30
  *and* departs from normality, the rank-based test is reported as the
  primary result.
- **Warnings:** groups with n < 30, more than 20% of chi-square cells with an
  expected count below 5, and fewer than 30 complete pairs for a correlation.
- Group comparisons are limited to 10 groups. A significant ANOVA does not
  say which groups differ; pairwise follow-up tests with a multiple-testing
  correction are not yet implemented.

### What the results cannot tell you

- Correlation and group differences in observational data do not show
  causation.
- A p-value above α does not show that groups are the same or that no
  relationship exists.
- Independence of observations is assumed and cannot be checked
  automatically. Repeated measurements of the same subject violate it.
- Running many tests and reporting only the significant ones inflates false
  positives. Reports include every analysis you saved, and you should save
  every test you ran.

## Visualization

- Colours use a fixed categorical order that is checked for colour-vision
  deficiency. A group keeps its colour regardless of rank.
- Scatter plots and grouped histograms colour up to three groups. Bar, line,
  and box charts colour up to eight. Remaining groups fold into a grey
  "Other".
- Charts are static images, so they can be downloaded and embedded in
  reports.

## ML readiness

- Preprocessing (median and most-frequent imputation, scaling, one-hot
  encoding) is fitted inside a scikit-learn `Pipeline` on training data only.
- Baselines: a dummy model, plus logistic regression (classification) or a
  random forest (regression), evaluated on a single stratified holdout split.
- Leakage warnings are name- and statistics-based heuristics and need domain
  review.
- A single holdout score is not a performance guarantee. Use cross-validation
  and an untouched test set before relying on a model.

## Known limitations and planned work

- Excel files: only the first worksheet is read.
- No PDF export yet. Markdown, JSON, CSV, XLSX, and ZIP are supported.
- No post-hoc pairwise tests or multiple-testing correction yet.
- Datetime columns are not yet resampled for time-series line charts.
- Session results are kept in memory and are lost when the browser tab
  closes.
