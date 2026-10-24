# DataPilot AI

> **SaaS migration in progress:** the current Streamlit app remains the local
> analysis product. A new Next.js + NestJS + PostgreSQL platform is being built
> alongside it. The SaaS foundation is for development only and is not ready for
> real accounts, billing, or sensitive uploads yet. See
> [docs/saas-architecture.md](docs/saas-architecture.md).

## SaaS platform development

Prerequisites: Node.js 20+, npm, and Docker Compose.

```bash
cp .env.example .env
# Edit .env and set POSTGRES_PASSWORD and the matching DATABASE_URL password.
npm install
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run dev
```

The Next.js app is at `http://localhost:3100`; the NestJS API is at
`http://localhost:4000/api/v1/health/live` and its database readiness check is
`http://localhost:4000/api/v1/health/ready`. The walkthrough appears on first
visit and is available again from **Product tour**. The current shell is a
product-preview only; account registration and upload workflows are not wired
to the API yet.

Never commit `.env` or place real user data in the development database. Do not
expose the Compose PostgreSQL port beyond localhost. Review the security
invariants and remaining production work in
[docs/saas-architecture.md](docs/saas-architecture.md) before deployment.

---

**A local-first, modular data-analysis workspace.** Upload a CSV or Excel file
and choose what you want to do with it: check data quality, explore patterns,
run statistical tests, build charts, assess ML readiness, or export a
reproducible report. You don't need to write any Python.

Only Dataset health and Reports are always on. The other modules run only when
you enable them, so a quick quality check stays quick.

| Module | Status | What it does |
| --- | --- | --- |
| Dataset health | Core | File validation, column types, missing values, duplicates, constant columns, IQR outlier warnings, and repairs you select and approve, including how to handle missing values and outliers, with a before/after comparison |
| Data exploration | Optional | Column kinds, distributions, category frequencies, missing-value patterns, correlations (Pearson or Spearman), and two-column comparisons |
| Statistical analysis | Optional | Descriptive statistics with confidence intervals, grouped summaries, group comparisons (Welch t / Mann–Whitney, ANOVA / Kruskal–Wallis), chi-square association, and correlation tests, each with assumptions, effect sizes, and warnings |
| Visualization studio | Optional | Histogram, box, bar, scatter, line, and correlation heatmap charts with your own axes, grouping, and filters; PNG and SVG download |
| ML readiness | Optional | Target selection, leakage heuristics, baseline classification or regression against a dummy model, and a downloadable scikit-learn pipeline |
| Reports and export | Core | Choose which sections to include, then export Markdown, JSON, CSV, an Excel workbook, or a ZIP bundle with every saved chart |

## Quick start

Requires Python 3.11 or newer.

```bash
uv sync                        # or: pip install -e ".[dev]"
uv run streamlit run app.py    # or: streamlit run app.py
```

Open the app, upload `examples/customer_churn.csv`, and choose a workflow
preset on the Overview page:

- **Quick health check:** health and reports only.
- **Research:** adds exploration, statistical analysis, and visualization.
- **ML preparation:** adds exploration and ML readiness.
- **Everything:** enables every module.

You can switch individual modules on or off in the sidebar at any time.

## Repairing data

On the **Dataset health** page, under **Repair recommendations**:

1. Tick **Select this repair** on each change you want. The repairs are
   grouped into missing values, outliers, and duplicates, constant columns,
   and text.
2. Where it's offered, choose how the repair is done under **How?**:

   | Issue | Methods |
   | --- | --- |
   | Missing numbers | Fill with the median (default) or mean, or remove the rows |
   | Missing text | Fill with the most frequent value or `Unknown`, or remove the rows |
   | Outliers (1.5 × IQR) | Cap at the bounds (default) or remove the rows. Marked high risk, because outliers are often real observations |
   | Duplicates, constant columns, untrimmed text | Remove or trim |

3. Click **Apply selected repairs (N)**. The button stays disabled until at
   least one repair is selected.

A confirmation lists every change. A before/after panel then compares rows,
missing cells, duplicates, and outlier flags with the original. Every module
switches to the repaired copy. Use **Data version** in the sidebar to switch
between the original and repaired data, or **Discard repairs** to remove the
copy.

Repairs always run in the same order: trim text, remove duplicates, remove
constant columns, handle missing values, then handle outliers. The same
selection therefore always gives the same result.

> **Training a model?** Filling missing values or capping outliers here uses
> statistics from every row, including rows that will later be test data.
> The ML readiness pipeline already fills gaps using training data only, so
> leave missing values unrepaired when the goal is modelling.

## Working principles

- **Local-first privacy.** Files are processed on your machine. Nothing is
  sent to an external service.
- **No silent changes.** Repairs stay as suggestions until you select and
  apply them. Applying them creates a separate copy and keeps the original.
  Once you apply repairs, every module uses the repaired copy and says so in
  a banner. The **Data version** switch in the sidebar takes every module
  back to the original at any time.
- **Responsible statistics.** Every test reports its assumptions, an effect
  size, and small-sample warnings. Results never present correlation or group
  differences as causation, and a non-significant result is never described
  as proof of no effect.
- **Reproducibility.** Reports record the DataPilot version, the data version
  used (original or repaired), the repairs applied, and the analysis settings.
  Each saved analysis and chart also records which data it used.
- **Scalable interface.** Optional modules compute only when you open them.
  Results are cached for each version of the data.

## Project layout

```
datapilot-ai/
├── app.py                  # Streamlit entrypoint: sidebar workflow + navigation
├── app_support.py          # Shared Streamlit helpers
├── app_pages/              # One page per module
├── src/datapilot/          # Analysis logic; no Streamlit imports
│   ├── loader.py           # Safe CSV/XLSX loading and header normalization
│   ├── profiler.py         # Dataset health profile and findings
│   ├── repairs.py          # Reviewable repair plan; apply to a copy
│   ├── exploration.py      # EDA summaries and correlations
│   ├── analysis.py         # Statistical tests with assumptions and caveats
│   ├── visualization.py    # Chart specs, filters, rendering, export
│   ├── ml_readiness.py     # Leakage checks and baseline models
│   ├── pipeline_generator.py
│   ├── reports.py          # Markdown/JSON/CSV/XLSX/ZIP exports
│   ├── modules.py          # Module registry (core vs optional)
│   └── workspace.py        # Per-session state: data versions, saved results
├── tests/                  # Unit tests + headless app tests (AppTest)
├── examples/               # Sample dataset with deliberate quality issues
└── docs/                   # Methods and limitations
```

The analysis logic lives in `src/datapilot` and does not import Streamlit, so
you can use it from notebooks or scripts:

```python
from datapilot.loader import load_dataset
from datapilot.analysis import compare_groups

df = load_dataset(open("examples/customer_churn.csv", "rb").read(), "churn.csv").dataframe
result = compare_groups(df, "plan", "monthly_charge")
print(result["interpretation"])
```

## Development

```bash
uv run pytest        # unit tests and headless tests of every app page
uv run ruff check .
```

See [docs/methods-and-limitations.md](docs/methods-and-limitations.md) for the
statistical methods, the thresholds used, and known limitations.


