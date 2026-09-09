"use client";

// Pedir sumarse a una canción: elegir qué instrumento aportás y
// escribirle al autor.
//
// Acá no se graba ni se sube audio. Lo que se pide es el permiso: si el
// autor acepta, el colaborador escucha el tema con el paquete liviano
// de pistas, graba lo suyo EN LA APP, que es donde la latencia está
// resuelta, y se lo manda. Ver CollabService.ts.

import { useEffect, useState, type FormEvent } from "react";
import { Handshake } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { COLLAB_ROLES } from "@/lib/collabRoles";
import {
  cancelCollaboration,
  fetchMyRequest,
  MAX_COLLAB_MESSAGE,
  requestCollaboration,
  type CollabRequest,
} from "@/lib/CollabService";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function CollabRequestModal({
  postId,
  postTitle,
  postAuthorId,
  wantedRoles,
  onClose,
}: {
  postId: string;
  postTitle: string;
  postAuthorId: string;
  wantedRoles: string[];
  onClose: () => void;
}) {
  const { user, profile } = useAuth();
  // Si el autor pidió instrumentos concretos, esos van primero: es lo
  // que de verdad le falta a la canción.
  const options = wantedRoles.length > 0 ? wantedRoles : [...COLLAB_ROLES];
  const [role, setRole] = useState(options[0] ?? "Libre");
  const [message, setMessage] = useState("");
  const [existing, setExisting] = useState<CollabRequest | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "sending" | "sent" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMyRequest(postId, user.uid)
      .then((found) => {
        if (cancelled) return;
        setExisting(found);
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [postId, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || status === "sending") return;
    setStatus("sending");
    setErrorMessage(null);
    try {
      await requestCollaboration({
        postId,
        postAuthorId,
        requesterUid: user.uid,
        requesterName: profile?.username ?? "Usuario",
        role,
        message: message.trim(),
      });
      setStatus("sent");
      setTimeout(onClose, 1600);
    } catch (err) {
      console.error("No se pudo enviar el pedido de colaboración:", err);
      setErrorMessage("No se pudo enviar el pedido. Probá de nuevo en un momento.");
      setStatus("error");
    }
  }

  async function handleCancel() {
    if (!user) return;
    setStatus("sending");
    try {
      await cancelCollaboration(postId, user.uid);
      setExisting(null);
      setStatus("idle");
    } catch (err) {
      console.error("No se pudo cancelar el pedido:", err);
      setStatus("idle");
    }
  }

  const isBusy = status === "sending" || status === "sent";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={isBusy ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Handshake size={18} className="text-neon-cyan" />
          <h2 className="font-display text-xl font-semibold text-white">Sumarte a esta canción</h2>
        </div>
        <p className="mt-1 truncate text-xs text-white/40">{postTitle}</p>

        {status === "loading" ? (
          <div className="mt-8 h-24 animate-pulse rounded-xl bg-white/5" />
        ) : status === "sent" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">Pedido enviado.</p>
            <p className="max-w-xs text-xs text-white/40">
              Cuando el autor responda lo vas a ver en tu Bandeja de Entrada.
            </p>
          </div>
        ) : existing ? (
          <div className="mt-6 flex flex-col gap-4">
            <div className="rounded-xl border border-white/10 bg-onyx-black p-4">
              <p className="text-sm text-white/70">
                Ya pediste sumarte en{" "}
                <span className="font-semibold text-white">{existing.role}</span>.
              </p>
              <p className="mt-1 text-xs text-white/40">
                {existing.status === "pending"
                  ? "Esperando la respuesta del autor."
                  : existing.status === "accepted"
                    ? "El autor aceptó. Grabá tu pista en la app y mandásela."
                    : "El autor no lo tomó esta vez."}
              </p>
            </div>
            <div className="flex justify-end gap-3">
              {existing.status === "pending" && (
                <button
                  type="button"
                  onClick={() => void handleCancel()}
                  disabled={isBusy}
                  className="rounded-full px-4 py-2 text-sm text-white/50 transition-colors hover:text-red-300 disabled:opacity-40"
                >
                  Cancelar mi pedido
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-neon-cyan/40 bg-onyx-black px-5 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan"
              >
                Entendido
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <span className="mb-1.5 block text-xs text-white/60">¿Qué vas a aportar?</span>
              <div className="flex flex-wrap gap-1.5">
                {options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRole(option)}
                    disabled={isBusy}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors duration-200 disabled:opacity-40 ${
                      role === option
                        ? "border-neon-cyan bg-neon-cyan/10 text-neon-cyan"
                        : "border-white/15 text-white/50 hover:border-white/35 hover:text-white/80"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="collab-message" className="mb-1.5 block text-xs text-white/60">
                Contale qué tenés en mente (opcional)
              </label>
              <textarea
                id="collab-message"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_COLLAB_MESSAGE))}
                rows={3}
                disabled={isBusy}
                className={`${inputClasses} resize-none`}
                placeholder="Se me ocurre una base de batería tranquila para la estrofa…"
              />
            </div>

            <div className="rounded-lg border border-white/10 bg-onyx-black/60 p-3 text-[11px] leading-relaxed text-white/45">
              Si el autor acepta, vas a poder escuchar el tema pista por pista y grabar lo tuyo
              desde la app, con el metrónomo y la latencia ya compensada. Después se lo mandás y
              él decide si lo suma.
            </div>

            {status === "error" && errorMessage && (
              <p className="text-xs text-red-400" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="mt-1 flex items-center justify-end gap-3">
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
                {status === "sending" ? "Enviando..." : "Pedir sumarme"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
