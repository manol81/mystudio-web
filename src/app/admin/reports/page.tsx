"use client";

// Panel de administrador — revisar reportes de publicaciones. Mismo
// criterio de gating (useAdminCheck) que /admin/upload-sample.
//
// "Descargar proyecto reclamado": el reporte solo guarda el postId
// (ver AdminService.ts) — al tocarlo se resuelve el post primero y
// recién ahí se dispara la descarga real, con un <a href> normal
// (navegación del navegador, no fetch/JS — mismo criterio que el
// botón "↓ Descargar" de ProjectsDashboard, sin problema de CORS).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useAdminCheck } from "@/lib/useAdminCheck";
import {
  fetchReportedPost,
  fetchReports,
  updateReportStatus,
  type Report,
} from "@/lib/AdminService";
import { REPORT_REASONS, formatRelativeTime } from "@/lib/CommunityService";

function reasonLabel(value: string): string {
  return REPORT_REASONS.find((r) => r.value === value)?.label ?? value;
}

function statusLabel(status: string): { text: string; className: string } {
  switch (status) {
    case "reviewed":
      return { text: "Revisado", className: "text-neon-cyan" };
    case "dismissed":
      return { text: "Descartado", className: "text-white/40" };
    default:
      return { text: "Pendiente", className: "text-yellow-400" };
  }
}

export default function AdminReportsPage() {
  const { user } = useAuth();
  const adminCheck = useAdminCheck();

  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (adminCheck !== "authorized") return;
    (async () => {
      try {
        setReports(await fetchReports());
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [adminCheck]);

  async function handleStatusChange(reportId: string, status: "reviewed" | "dismissed") {
    setUpdatingId(reportId);
    try {
      await updateReportStatus(reportId, status);
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status } : r)));
    } catch {
      // el estado en pantalla no cambia — el admin ve que no se aplicó
      // y puede reintentar.
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDownloadProject(report: Report) {
    setDownloadingId(report.id);
    try {
      const post = await fetchReportedPost(report.postId);
      if (!post) {
        window.alert("La publicación reportada ya no existe (puede haber sido borrada).");
        return;
      }
      const link = document.createElement("a");
      link.href = post.audioUrl;
      link.rel = "noopener noreferrer";
      link.click();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "No se pudo obtener el proyecto.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <Link
          href="/admin"
          className="text-xs text-white/40 transition-colors duration-200 hover:text-white/70"
        >
          ← Panel de Admin
        </Link>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          🚩 Reportes
        </h1>
      </div>

      {adminCheck === "checking" && (
        <p className="text-xs text-white/40">Verificando permisos...</p>
      )}

      {adminCheck === "signed-out" && (
        <p className="max-w-sm text-sm text-white/60">
          Iniciá sesión desde la página principal para continuar.
        </p>
      )}

      {adminCheck === "unauthorized" && (
        <p className="max-w-sm text-sm text-red-400">
          Tu cuenta ({user?.email}) no tiene permisos de administrador.
        </p>
      )}

      {adminCheck === "authorized" && (
        <div className="w-full max-w-2xl text-left">
          {isLoading ? (
            <p className="text-center text-xs text-white/40">Cargando reportes...</p>
          ) : loadError ? (
            <p className="text-center text-xs text-red-400">No se pudieron cargar los reportes.</p>
          ) : reports.length === 0 ? (
            <p className="text-center text-xs text-white/40">No hay reportes todavía.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {reports.map((report) => {
                const status = statusLabel(report.status);
                return (
                  <li
                    key={report.id}
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-graphite p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-sm font-semibold text-white">
                          {reasonLabel(report.reason)}
                        </p>
                        <p className="mt-0.5 text-xs text-white/40">
                          {formatRelativeTime(report.createdAt)} · reportado por{" "}
                          <span className="font-mono">{report.reporterId.slice(0, 8)}…</span>
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-semibold ${status.className}`}>
                        {status.text}
                      </span>
                    </div>

                    {report.details && (
                      <p className="whitespace-pre-wrap text-xs text-white/60">{report.details}</p>
                    )}

                    <p className="text-[11px] text-white/30">
                      Publicación:{" "}
                      <span className="font-mono">{report.postId}</span> · autor reportado:{" "}
                      <span className="font-mono">{report.reportedAuthorId.slice(0, 8)}…</span>
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownloadProject(report)}
                        disabled={downloadingId === report.id}
                        className="rounded-full border border-neon-cyan/30 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan disabled:opacity-50"
                      >
                        {downloadingId === report.id ? "..." : "↓ Descargar proyecto reclamado"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange(report.id, "reviewed")}
                        disabled={updatingId === report.id || report.status === "reviewed"}
                        className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/70 transition-colors duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan disabled:opacity-40"
                      >
                        Marcar revisado
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange(report.id, "dismissed")}
                        disabled={updatingId === report.id || report.status === "dismissed"}
                        className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/70 transition-colors duration-200 hover:border-red-400/50 hover:text-red-300 disabled:opacity-40"
                      >
                        Descartar
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
