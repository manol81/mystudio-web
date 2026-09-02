"use client";

// Modal de "Reportar publicación" — mismo criterio visual que
// PublishModal/LoginModal. A diferencia de bloquear (que es instantáneo
// y no necesita confirmación de nadie más), reportar queda pendiente de
// revisión manual — ver `reports` en firestore.rules, que ni siquiera
// el propio reportante puede releer después de crearlo.

import { useState, type FormEvent } from "react";
import { reportPost, REPORT_REASONS } from "@/lib/CommunityService";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function ReportModal({
  postId,
  reportedAuthorId,
  reporterId,
  onClose,
}: {
  postId: string;
  reportedAuthorId: string;
  reporterId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].value);
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBusy = status === "sending" || status === "success";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);
    try {
      await reportPost({ postId, reportedAuthorId, reporterId, reason, details: details.trim() });
      setStatus("success");
      setTimeout(onClose, 1100);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={isBusy ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-white">🚩 Reportar publicación</h2>
        <p className="mt-1 text-xs text-white/50">
          Lo vamos a revisar. No le avisamos al autor quién lo reportó.
        </p>

        {status === "success" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">Gracias, ya lo recibimos.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="report-reason" className="mb-1.5 block text-xs text-white/60">
                Motivo
              </label>
              <select
                id="report-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputClasses}
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="report-details" className="mb-1.5 block text-xs text-white/60">
                Detalle (opcional)
              </label>
              <textarea
                id="report-details"
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className={`${inputClasses} resize-none`}
                placeholder="Contanos qué pasó..."
              />
            </div>

            {status === "error" && (
              <p className="text-xs text-red-400" role="alert">
                No se pudo enviar: {errorMessage}
              </p>
            )}

            <div className="mt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isBusy}
                className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-50"
              >
                {status === "sending" ? "Enviando..." : "Reportar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
