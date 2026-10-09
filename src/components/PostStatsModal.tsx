"use client";

// Estadísticas de una publicación propia — beneficio PRO (2026-10-09).
// Las reproducciones las cuenta la Cloud Function onPlayCreated; el país
// es la región del idioma del navegador de quien escuchó (aproximado, ver
// recordPlay). Las reglas solo dejan leerlas al autor si es PRO.

import { useEffect, useState } from "react";
import { fetchPostStats, type CommunityPost, type PostStats } from "@/lib/CommunityService";

const regionNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["es"], { type: "region" })
    : null;

function countryName(code: string): string {
  if (code === "??") return "Sin dato";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function PostStatsModal({
  post,
  commentsCount,
  onClose,
}: {
  post: CommunityPost;
  commentsCount: number;
  onClose: () => void;
}) {
  const [stats, setStats] = useState<PostStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPostStats(post.id)
      .then((s) => alive && setStats(s))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [post.id]);

  const top = stats?.countries.slice(0, 8) ?? [];
  const max = top[0]?.plays ?? 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
          Estadísticas · PRO
        </p>
        <h2 className="mt-1 truncate font-display text-lg font-semibold text-white">{post.title}</h2>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Escuchas", stats?.total ?? post.playsCount],
            ["Me gusta", post.likesCount],
            ["Comentarios", commentsCount],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl bg-onyx-black px-2 py-3">
              <p className="font-display text-xl font-bold text-white">{value as number}</p>
              <p className="text-[10px] uppercase tracking-wide text-white/40">{label as string}</p>
            </div>
          ))}
        </div>

        <h3 className="mt-5 text-xs font-semibold text-white/60">Desde dónde la escucharon</h3>
        {error ? (
          <p className="mt-2 text-xs text-red-400">No se pudieron cargar: {error}</p>
        ) : !stats ? (
          <p className="mt-2 text-xs text-white/40">Cargando…</p>
        ) : top.length === 0 ? (
          <p className="mt-2 text-xs text-white/40">Todavía nadie la escuchó desde que se cuentan las escuchas.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {top.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate text-white/70">{countryName(c.code)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className="block h-full rounded-full bg-neon-cyan/70"
                    style={{ width: `${Math.max(4, (c.plays / max) * 100)}%` }}
                  />
                </span>
                <span className="w-8 text-right text-white/50">{c.plays}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[10px] text-white/30">
          El país sale del idioma del navegador de quien escuchó: es aproximado. Cada persona cuenta
          una vez por visita.
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-white/60 hover:text-white"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
