"use client";

// Bandeja de Entrada — lo que recibieron TUS publicaciones: comentarios
// y me gusta. Hasta 2026-09 era un placeholder que decía "llega en una
// próxima etapa", y esa era la razón de fondo por la que nadie volvía
// al feed: publicabas y no había ninguna señal de vuelta.
//
// No hay servidor que empuje notificaciones (ver NotificationsService.ts):
// se derivan de una consulta al abrir esta pantalla.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, MessageSquare } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import {
  fetchNotifications,
  markNotificationsSeen,
  type CommunityNotification,
} from "@/lib/NotificationsService";

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "hace un momento";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return date.toLocaleDateString("es-AR");
}

function formatAudioTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function InboxPage() {
  const { user, profile, loading } = useAuth();
  const [notifications, setNotifications] = useState<CommunityNotification[] | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const seenAt = profile?.notificationsSeenAt ?? null;
      const list = await fetchNotifications(user.uid, seenAt);
      setNotifications(list);
      // Se marcan como leídas DESPUÉS de traerlas: si se hiciera antes,
      // esta misma carga ya las mostraría todas como vistas y el
      // resaltado de lo nuevo no se vería nunca.
      if (list.some((n) => n.isUnread)) await markNotificationsSeen(user.uid);
    } catch (err) {
      console.error("No se pudieron cargar las notificaciones:", err);
      setError("No se pudieron cargar las novedades. Probá de nuevo en un momento.");
      setNotifications([]);
    }
    // profile?.notificationsSeenAt a propósito NO está en las
    // dependencias: se actualiza al marcar como leído y volvería a
    // disparar la carga en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    // En microtask, mismo criterio que AuthContext: el linter de React
    // trata `load()` como un setState síncrono dentro del efecto,
    // aunque el estado recién se toca después de la consulta.
    queueMicrotask(() => void load());
  }, [load]);

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-white/30">
          <MessageSquare size={26} />
        </div>
        <h1 className="font-display text-2xl font-bold text-white">
          Bandeja de <span className="text-neon-cyan">Entrada</span>
        </h1>
        <p className="max-w-sm text-sm text-white/50">
          Iniciá sesión para ver los comentarios y me gusta que recibieron tus publicaciones.
        </p>
        <button
          type="button"
          onClick={() => setIsLoginOpen(true)}
          className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
        >
          Iniciar Sesión
        </button>
        {isLoginOpen && <LoginModal onClose={() => setIsLoginOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold text-white">
        Bandeja de <span className="text-neon-cyan">Entrada</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Lo que recibieron tus publicaciones en la Comunidad.
      </p>

      {error && (
        <p className="mt-6 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      {notifications === null ? (
        <div className="mt-8 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-graphite p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-white/30">
            <MessageSquare size={22} />
          </div>
          <p className="text-sm text-white/60">Todavía no hay novedades.</p>
          <p className="max-w-xs text-xs text-white/40">
            Cuando alguien comente o le guste alguna de tus publicaciones, lo vas a ver acá.
          </p>
          <Link
            href="/"
            className="mt-2 rounded-full border border-neon-cyan/40 bg-onyx-black px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan"
          >
            Ir a la Comunidad
          </Link>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <Link
                href={`/p/${n.postId}`}
                className={`flex items-start gap-3 rounded-xl border p-4 transition-colors duration-200 ${
                  n.isUnread
                    ? "border-neon-cyan/30 bg-neon-cyan/5 hover:border-neon-cyan/50"
                    : "border-white/10 bg-graphite hover:border-white/20"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    n.kind === "comment"
                      ? "bg-neon-cyan/15 text-neon-cyan"
                      : "bg-red-400/15 text-red-300"
                  }`}
                >
                  {n.kind === "comment" ? <MessageCircle size={16} /> : <Heart size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white/80">
                    {n.kind === "comment" ? (
                      <>
                        <span className="font-semibold text-white">{n.actorName}</span> comentó en{" "}
                        <span className="text-white/60">{n.postTitle}</span>
                      </>
                    ) : (
                      <>
                        Le gustó <span className="text-white/60">{n.postTitle}</span>
                      </>
                    )}
                  </p>
                  {n.kind === "comment" && n.text && (
                    <p className="mt-1 line-clamp-2 text-xs text-white/50">
                      {n.timestampInAudio != null && (
                        <span className="mr-1.5 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-cyan">
                          {formatAudioTime(n.timestampInAudio)}
                        </span>
                      )}
                      {n.text}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-white/30">{formatRelativeTime(n.createdAt)}</p>
                </div>
                {n.isUnread && (
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-neon-cyan" aria-label="Sin leer" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
