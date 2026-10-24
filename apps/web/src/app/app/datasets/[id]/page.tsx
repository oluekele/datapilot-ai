import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingBlock } from "@/components/page-header";
import { DatasetView } from "./dataset-view";

export const metadata: Metadata = { title: "Dataset" };

export default async function DatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingBlock label="Loading dataset…" />}>
      <DatasetView datasetId={id} />
    </Suspense>
  );
}
