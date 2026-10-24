"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, X } from "lucide-react";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/_ui/Button";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { invalidateForResource } from "@/lib/realtime/invalidation";

type Receipt = { id: string; transactionId: string; contentType: string; size: number; createdAt: string };

const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";

// A big photo is shrunk in the browser first (long side 2000 px, JPEG) so it fits the 3 MB limit.
async function fitForUpload(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES / 2 && file.type !== "image/heic") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function ReceiptsSection({ transactionId }: { transactionId: string }) {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const key = ["transactions", transactionId, "receipts"];

  const { data: receipts = [] } = useQuery<Receipt[]>({
    queryKey: key,
    queryFn: async () => (await apiClient.get<{ data: Receipt[] }>(`/transactions/${transactionId}/receipts`)).data.data,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    invalidateForResource(qc, "transactions");
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = await fitForUpload(file);
      if (body.size > MAX_BYTES) throw new Error("That photo is over 3 MB. Pick a smaller one.");
      await apiClient.post(`/transactions/${transactionId}/receipts`, body, { headers: { "Content-Type": "application/octet-stream" } });
    },
    onSuccess: () => {
      refresh();
      toast.success("Receipt added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/receipts/${id}`),
    onSuccess: () => {
      refresh();
      toast.success("Receipt removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section>
      <div className="section-head">
        <h2>Receipts</h2>
        <Button type="button" variant="secondary" className="h-9 px-4 rounded-full text-[13px]" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <Camera size={14} />
          {upload.isPending ? "Adding..." : "Add photo"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="Add a receipt photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload.mutate(file);
          }}
        />
      </div>
      {receipts.length === 0 ? (
        <p className="text-[14px]" style={{ color: "var(--ink-2)" }}>
          No receipts yet. Photos are encrypted and only you can open them.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {receipts.map((r, i) => (
            <div key={r.id} className="relative aspect-square overflow-hidden rounded-xl" style={{ background: "var(--card-2)" }}>
              <a href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer" aria-label={`Open receipt ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/receipts/${r.id}`} alt={`Receipt ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
              </a>
              <button
                type="button"
                aria-label={`Remove receipt ${i + 1}`}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full"
                style={{ background: "color-mix(in srgb, var(--ink) 70%, transparent)", color: "var(--card)" }}
                onClick={async () => {
                  const ok = await confirm({ title: "Remove this receipt?", description: "The photo is deleted for good.", confirmLabel: "Remove", destructive: true });
                  if (ok) remove.mutate(r.id);
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {dialog}
    </section>
  );
}
