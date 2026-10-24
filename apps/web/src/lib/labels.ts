// Human-friendly labels for enum-like values coming from the API.

import type { AnalyzeTest, ArtifactKind, ChartType, ColumnKind, JobType, TrainTask } from "@/lib/types";

export const jobTypeLabels: Record<JobType, string> = {
  PROFILE: "Profile",
  REPAIR: "Repair",
  EXPLORE: "Explore",
  ANALYZE: "Analyse",
  VISUALIZE: "Visualise",
  TRAIN: "Train",
};

export const jobTypeLabel = (type: string): string => jobTypeLabels[type as JobType] ?? type.toLowerCase();

export const artifactKinds: Array<{ kind: ArtifactKind; label: string; plural: string; icon: string }> = [
  { kind: "CHART", label: "Chart", plural: "Charts", icon: "◩" },
  { kind: "TABLE", label: "Table", plural: "Tables", icon: "▦" },
  { kind: "MODEL", label: "Model", plural: "Models", icon: "⬡" },
  { kind: "REPORT", label: "Report", plural: "Reports", icon: "▤" },
  { kind: "CODE", label: "Code", plural: "Code", icon: "‹›" },
  { kind: "DATA", label: "Data", plural: "Data", icon: "◫" },
];

export const artifactKindMeta = (kind: ArtifactKind) => artifactKinds.find((k) => k.kind === kind) ?? artifactKinds[0];

export const columnKindLabels: Record<ColumnKind, string> = {
  numeric: "numeric",
  categorical: "category",
  boolean: "yes/no",
  datetime: "date/time",
  text: "free text",
  identifier: "identifier",
  empty: "empty",
};

export const analyzeTests: Array<{ test: AnalyzeTest; label: string; description: string; needs: string }> = [
  {
    test: "descriptive",
    label: "Descriptive statistics",
    description: "Count, mean, spread and range of numeric columns — the first numbers to look at.",
    needs: "Optionally choose numeric columns (default: all).",
  },
  {
    test: "grouped_summary",
    label: "Grouped summary",
    description: "Summarise a numeric value for each group, e.g. average sales per region.",
    needs: "A category column to group by and a numeric value column.",
  },
  {
    test: "compare_groups",
    label: "Compare groups",
    description: "Tests whether a numeric value genuinely differs between groups (t-test / ANOVA or their rank-based alternatives).",
    needs: "A category column defining the groups and a numeric value column.",
  },
  {
    test: "association",
    label: "Association (chi-square)",
    description: "Tests whether two category columns are related, e.g. whether churn depends on plan type.",
    needs: "Two category columns.",
  },
  {
    test: "correlation",
    label: "Correlation test",
    description: "Measures how strongly two numeric columns move together and whether that is statistically significant.",
    needs: "Two numeric columns.",
  },
];

export const chartTypes: Array<{ type: ChartType; label: string; description: string }> = [
  { type: "histogram", label: "Histogram", description: "Shape of one numeric column's distribution." },
  { type: "box", label: "Box plot", description: "Median, spread and outliers of a numeric column, optionally per category." },
  { type: "bar", label: "Bar chart", description: "Counts or an aggregate of a value per category." },
  { type: "scatter", label: "Scatter plot", description: "Relationship between two numeric columns." },
  { type: "line", label: "Line chart", description: "A value over time or another ordered column." },
  { type: "correlation_heatmap", label: "Correlation heatmap", description: "Correlations between all numeric columns at once." },
];

export const trainTasks: Array<{ task: TrainTask; label: string; description: string }> = [
  { task: "classification", label: "Classification", description: "Predict a category, e.g. churn yes/no or product type." },
  { task: "regression", label: "Regression", description: "Predict a number, e.g. price, demand or duration." },
  { task: "clustering", label: "Clustering", description: "Find natural groups of similar rows — no target needed." },
];

export type AlgorithmInfo = { id: string; label: string; description: string };

export const algorithms: Record<TrainTask, AlgorithmInfo[]> = {
  classification: [
    { id: "logistic_regression", label: "Logistic regression", description: "Fast, interpretable linear baseline." },
    { id: "decision_tree", label: "Decision tree", description: "Simple if/then rules; easy to explain, can overfit." },
    { id: "random_forest", label: "Random forest", description: "Many trees voting together; strong, robust default." },
    { id: "gradient_boosting", label: "Gradient boosting", description: "Trees built to fix each other's mistakes; often most accurate." },
    { id: "knn", label: "k-nearest neighbours", description: "Predicts from the most similar rows." },
    { id: "svm", label: "Support vector machine", description: "Finds the widest boundary between classes." },
    { id: "naive_bayes", label: "Naive Bayes", description: "Very fast probabilistic baseline." },
  ],
  regression: [
    { id: "linear_regression", label: "Linear regression", description: "Straight-line baseline; very interpretable." },
    { id: "ridge", label: "Ridge regression", description: "Linear model that tames correlated features." },
    { id: "lasso", label: "Lasso regression", description: "Linear model that can drop unhelpful features." },
    { id: "decision_tree", label: "Decision tree", description: "Simple if/then rules; easy to explain, can overfit." },
    { id: "random_forest", label: "Random forest", description: "Many trees averaged; strong, robust default." },
    { id: "gradient_boosting", label: "Gradient boosting", description: "Trees built to fix each other's mistakes; often most accurate." },
    { id: "knn", label: "k-nearest neighbours", description: "Predicts from the most similar rows." },
    { id: "svr", label: "Support vector regression", description: "Fits a tolerant band around the data." },
  ],
  clustering: [
    { id: "kmeans", label: "k-means", description: "Splits rows into k round, similar-sized groups." },
    { id: "agglomerative", label: "Agglomerative", description: "Merges similar rows step by step into groups." },
    { id: "gaussian_mixture", label: "Gaussian mixture", description: "Soft, oval-shaped groups that may overlap." },
  ],
};

const metricInfo: Record<string, { label: string; explain: string; lowerIsBetter?: boolean }> = {
  accuracy: { label: "Accuracy", explain: "Share of test rows predicted correctly." },
  balanced_accuracy: { label: "Balanced accuracy", explain: "Accuracy averaged per class, fair when classes are imbalanced." },
  f1_weighted: { label: "F1 (weighted)", explain: "Balances precision and recall for every class, weighted by class size. 1.0 is perfect." },
  f1: { label: "F1", explain: "Balance of precision and recall. 1.0 is perfect." },
  precision_weighted: { label: "Precision (weighted)", explain: "Of the rows predicted as a class, how many really were." },
  recall_weighted: { label: "Recall (weighted)", explain: "Of the rows in a class, how many the model found." },
  roc_auc: { label: "ROC AUC", explain: "How well the model ranks positives above negatives. 0.5 is chance, 1.0 is perfect." },
  r2: { label: "R²", explain: "Share of the target's variation the model explains. 1.0 is perfect, 0 is no better than the average." },
  rmse: { label: "RMSE", explain: "Typical prediction error in the target's own units; lower is better.", lowerIsBetter: true },
  mae: { label: "MAE", explain: "Average absolute prediction error in the target's units; lower is better.", lowerIsBetter: true },
  mse: { label: "MSE", explain: "Average squared prediction error; lower is better.", lowerIsBetter: true },
  mape: { label: "MAPE", explain: "Average percentage error; lower is better.", lowerIsBetter: true },
  silhouette: { label: "Silhouette", explain: "How well separated the clusters are, from −1 to 1. Higher is better." },
  davies_bouldin: { label: "Davies–Bouldin", explain: "Average similarity between clusters; lower is better.", lowerIsBetter: true },
  calinski_harabasz: { label: "Calinski–Harabasz", explain: "Ratio of between- to within-cluster spread; higher is better." },
};

export const metricLabel = (key: string): string => metricInfo[key]?.label ?? key.replace(/_/g, " ");
export const metricExplanation = (key: string): string | null => metricInfo[key]?.explain ?? null;
export const metricLowerIsBetter = (key: string): boolean => metricInfo[key]?.lowerIsBetter ?? false;
