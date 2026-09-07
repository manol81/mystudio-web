"use client";

// Modal de "Separar en Stems" — se abre desde una tarjeta de
// ProjectsDashboard, mismo patrón que PublishModal. Descarga y mezcla
// el .mystudio completo (buildCommunityPreview, que pese al nombre
// hace un mixdown entero, no recortado) y lo manda a
// StemSeparationService.separateIntoStems, hoy un STUB — ver el
// comentario de ese archivo para el plan de reemplazo por la API real.

import { useEffect, useState } from "react";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { buildCommunityPreview } from "@/lib/audioPreviewExport";
import { separateIntoStems, STEM_SEPARATION_IS_STUB } from "@/lib/StemSeparationService";

type Status = "idle" | "mixing" | "separating" | "done" | "error";

interface StemDownload {
  label: string;
  url: string;
}

export function StemSplitModal({
  project,
  onClose,
}: {
  project: { cloudId: string; title: string; storagePath: string };
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stems, setStems] = useState<StemDownload[]>([]);

  const isBusy = status === "mixing" || status === "separating";

  // Los object URLs solo tienen sentido mientras este modal existe —
  // revocarlos al desmontar libera la memoria del blob decodificado.
  useEffect(() => {
    return () => {
      for (const stem of stems) URL.revokeObjectURL(stem.url);
    };
  }, [stems]);

  async function handleStart() {
    setStatus("mixing");
    setProgress(0);
    setErrorMessage(null);
    try {
      const audioUrl = await getDownloadURL(ref(storage, project.storagePath));
      const { blob: mixdownBlob } = await buildCommunityPreview(audioUrl, setProgress);

      setStatus("separating");
      setProgress(0);
      const result = await separateIntoStems(mixdownBlob, setProgress);

      setStems(result.map((stem) => ({ label: stem.label, url: URL.createObjectURL(stem.blob) })));
      setStatus("done");
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
        className="w-full max-w-md rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-white">🎚️ Separar en Stems</h2>
        <p className="mt-1 text-xs text-white/50">
          Extrae voz, batería, bajo y resto de la mezcla de &ldquo;{project.title || "Sin título"}&rdquo;.
        </p>

        {STEM_SEPARATION_IS_STUB && (
          <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            ⚠️ Modo de prueba: todavía no está conectado un proveedor real de
            separación. Estos 4 archivos son la misma mezcla completa, solo
            para probar el flujo — no es una separación real todavía.
          </p>
        )}

        {status === "idle" && (
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleStart}
              className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
            >
              Separar
            </button>
          </div>
        )}

        {isBusy && (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
            <p className="text-sm text-white/70">
              {status === "mixing"
                ? `Descargando y mezclando el proyecto... ${Math.round(progress * 100)}%`
                : `Separando en stems... ${Math.round(progress * 100)}%`}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="mt-6 flex flex-col gap-3">
            <p className="text-xs text-red-400" role="alert">
              No se pudo completar: {errorMessage}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handleStart}
                className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {status === "done" && (
          <div className="mt-6 flex flex-col gap-3">
            {stems.map((stem, i) => (
              <div
                key={`${stem.label}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-onyx-black px-4 py-2.5"
              >
                <span className="text-sm text-white/80">{stem.label}</span>
                <a
                  href={stem.url}
                  download={`${project.title || "stem"} - ${stem.label}.mp3`}
                  className="whitespace-nowrap rounded-full border border-neon-cyan/30 px-3 py-1 text-xs font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_14px_rgba(102,252,241,0.35)]"
                >
                  ↓ Descargar
                </a>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
