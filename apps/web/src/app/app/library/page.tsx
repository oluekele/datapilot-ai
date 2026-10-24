import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ArtifactLibrary } from "@/components/library/artifact-library";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <>
      <PageHeader eyebrow="WORKSPACE / LIBRARY" title="Every output," emphasis="ready to download.">
        Charts, tables, trained models, reports and code produced by your analyses, newest first. Select several to download them as one ZIP.
      </PageHeader>
      <ArtifactLibrary />
    </>
  );
}
