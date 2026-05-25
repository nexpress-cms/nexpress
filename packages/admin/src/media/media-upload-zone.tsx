"use client";

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import { Check, Loader2, Upload, X } from "lucide-react";

import { Button } from "../ui/button.js";
import { cn } from "../ui/utils.js";

interface MediaUploadZoneProps {
  folderId?: string;
  onUploadComplete: () => void;
  onClose: () => void;
}

type UploadState = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "success" | "error";
  error?: string;
};

export function MediaUploadZone({ folderId, onUploadComplete, onClose }: MediaUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const isUploading = useMemo(
    () => uploads.some((upload) => upload.status === "uploading"),
    [uploads],
  );

  async function queueFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);

    if (files.length === 0) {
      return;
    }

    const nextUploads = files.map((file) => ({
      id: createUploadId(file),
      name: file.name,
      progress: 0,
      status: "uploading" as const,
    }));

    setUploads((current) => [...nextUploads, ...current]);

    const results = await Promise.all(
      files.map((file, index) => uploadFile(file, nextUploads[index].id, folderId, setUploads)),
    );

    if (results.some(Boolean)) {
      onUploadComplete();
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;

    if (files) {
      void queueFiles(files);
    }

    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    if (event.dataTransfer.files.length > 0) {
      void queueFiles(event.dataTransfer.files);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div
        className={cn(
          "rounded-xl border border-dashed px-6 py-12 text-center transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-border/80 bg-muted/25",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="mx-auto flex min-w-0 max-w-md flex-col items-center gap-4">
          <div className="rounded-full border border-border/70 bg-background p-4 text-muted-foreground">
            <Upload className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-2">
            <h3 className="break-words text-lg font-semibold text-foreground">
              Drop files to upload
            </h3>
            <p className="break-words text-sm text-muted-foreground">
              Drag images, videos, or documents here, or choose files from your device.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
          <Button className="w-full sm:w-auto" onClick={() => inputRef.current?.click()}>
            <Upload className="size-3.5" />
            Choose files
          </Button>
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <div className="grid min-w-0 gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h4 className="break-words font-medium text-foreground">Upload queue</h4>
            <p className="break-words text-sm text-muted-foreground">
              Progress updates appear here while files are processing.
            </p>
          </div>
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={onClose}
            disabled={isUploading}
          >
            Close
          </Button>
        </div>

        {uploads.length === 0 ? (
          <div className="break-words rounded-xl border border-border/70 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            No uploads started yet.
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="min-w-0 rounded-xl border border-border/70 bg-background/70 p-4"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-foreground">{upload.name}</p>
                    <p className="break-words text-sm text-muted-foreground">
                      {upload.status === "error"
                        ? (upload.error ?? "Upload failed")
                        : upload.status === "success"
                          ? "Upload complete"
                          : `${upload.progress}% uploaded`}
                    </p>
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/30 text-muted-foreground">
                    {upload.status === "uploading" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : upload.status === "success" ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <X className="h-4 w-4 text-destructive" />
                    )}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      upload.status === "error"
                        ? "bg-destructive"
                        : upload.status === "success"
                          ? "bg-emerald-500"
                          : "bg-primary",
                    )}
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function uploadFile(
  file: File,
  uploadId: string,
  folderId: string | undefined,
  setUploads: Dispatch<SetStateAction<UploadState[]>>,
) {
  return new Promise<boolean>((resolve) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();

    formData.append("file", file);

    if (folderId) {
      formData.append("folderId", folderId);
    }

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const progress = Math.round((event.loaded / event.total) * 100);

      setUploads((current) =>
        current.map((upload) => (upload.id === uploadId ? { ...upload, progress } : upload)),
      );
    });

    request.addEventListener("load", () => {
      const success = request.status >= 200 && request.status < 300;

      setUploads((current) =>
        current.map((upload) =>
          upload.id === uploadId
            ? {
                ...upload,
                progress: success ? 100 : upload.progress,
                status: success ? "success" : "error",
                error: success ? undefined : getUploadError(request.responseText),
              }
            : upload,
        ),
      );

      resolve(success);
    });

    request.addEventListener("error", () => {
      setUploads((current) =>
        current.map((upload) =>
          upload.id === uploadId
            ? {
                ...upload,
                status: "error",
                error: "Network error while uploading.",
              }
            : upload,
        ),
      );

      resolve(false);
    });

    request.open("POST", "/api/media/upload");
    const csrfToken = readCsrfCookie();
    if (csrfToken) {
      request.setRequestHeader("X-CSRF-Token", csrfToken);
    }
    request.withCredentials = true;
    request.send(formData);
  });
}

function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const raw of document.cookie.split(";")) {
    const [name, ...rest] = raw.trim().split("=");
    if (name === "np-csrf") {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function getUploadError(responseText: string) {
  try {
    const parsed = JSON.parse(responseText) as unknown;

    if (isRecord(parsed) && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    return responseText || "Upload failed.";
  }

  return "Upload failed.";
}

function createUploadId(file: File) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
