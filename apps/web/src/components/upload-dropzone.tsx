"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { Button, ErrorNotice } from "@/components/ui";
import { uploadWithProgress } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const ACCEPT = ".csv,.xlsx";
const ALLOWED = /\.(csv|xlsx)$/i;

type UploadDropzoneProps = {
  maxFileMb: number;
  disabledReason: string | null;
  onUploaded: (datasetId: string) => void;
};

export function UploadDropzone({ maxFileMb, disabledReason, onUploaded }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const disabled = disabledReason !== null;
  const uploading = progress !== null;

  function choose(candidate: File | undefined): void {
    setError(null);
    setLocalError(null);
    if (!candidate) return;
    if (!ALLOWED.test(candidate.name)) {
      setLocalError("Please choose a .csv or .xlsx file.");
      return;
    }
    if (maxFileMb > 0 && candidate.size > maxFileMb * 1024 * 1024) {
      setLocalError(`This file is ${formatBytes(candidate.size)}. Your plan allows files up to ${maxFileMb} MB.`);
      return;
    }
    setFile(candidate);
    setName(candidate.name.replace(/\.(csv|xlsx)$/i, ""));
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (disabled || uploading) return;
    choose(event.dataTransfer.files[0]);
  }

  async function upload(): Promise<void> {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    if (name.trim()) form.append("name", name.trim());
    setProgress(0);
    setError(null);
    try {
      const result = await uploadWithProgress<{ id: string }>("/datasets", form, setProgress);
      setFile(null);
      setName("");
      onUploaded(result.id);
    } catch (err) {
      setError(err);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="upload-panel">
      <div
        className={`dropzone ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="tour-icon" aria-hidden="true">↥</div>
        {disabled ? (
          <>
            <b>Uploading is paused</b>
            <p>{disabledReason} <Link href="/app/billing">View billing →</Link></p>
          </>
        ) : file ? (
          <div className="upload-selected">
            <b>{file.name}</b>
            <small>{formatBytes(file.size)}</small>
            <label className="field inline-field">
              <span>Dataset name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={uploading} />
            </label>
            {uploading ? (
              <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} aria-label="Upload progress">
                <i><em style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></i>
                <small>{progress !== null && progress >= 1 ? "Processing upload…" : `Uploading ${Math.round((progress ?? 0) * 100)}%`}</small>
              </div>
            ) : (
              <div className="button-row">
                <Button onClick={() => void upload()}>Upload & profile <span aria-hidden="true">→</span></Button>
                <Button variant="ghost" onClick={() => setFile(null)}>Choose another</Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <b>Drop a CSV or Excel file here</b>
            <p>
              or{" "}
              <button type="button" className="link-button" onClick={() => inputRef.current?.click()}>browse your computer</button>
              {" "}· .csv / .xlsx{maxFileMb > 0 ? ` up to ${maxFileMb} MB` : ""}
            </p>
            <small className="muted">The original is stored unchanged as the RAW version, then profiled automatically.</small>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Choose a dataset file"
          disabled={disabled || uploading}
          onChange={(event) => choose(event.target.files?.[0])}
        />
      </div>
      {localError && <p className="field-error" role="alert">{localError}</p>}
      <ErrorNotice error={error} title="Upload failed" />
    </div>
  );
}
