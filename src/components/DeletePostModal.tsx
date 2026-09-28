"use client";

// Confirmación para borrar la publicación PROPIA — mismo criterio
// visual que ReportModal/PublishModal.
//
// Por qué un modal y no un simple "¿Seguro?" en el menú: lo que se
// pierde no es obvio desde afuera. Se van los comentarios y los "me
// gusta" que dejó la gente, y los pedidos de colaboración con su
// conversación adentro. Lo que NO se va —el proyecto, que sigue
// sincronizado y se puede volver a publicar— también hay que decirlo,
// porque es justo el miedo que frena a alguien que quiere despublicar
// algo que no le gustó cómo quedó.

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { deleteOwnPost } from "@/lib/CommunityService";

export function DeletePostModal({
  post,
  uid,
  onDeleted,
  onClose,
}: {
  post: { id: string; authorId: string; title: string };
  uid: string;
  onDeleted: (postId: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "deleting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isBusy = status === "deleting";

  async function handleDelete() {
    setStatus("deleting");
    setErrorMessage(null);
    try {
      await deleteOwnPost(post, uid);
      // El padre es el que saca la tarjeta del feed: este modal no
      // sabe en qué lista está.
      onDeleted(post.id);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={isBusy ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-white">
          <AlertTriangle size={20} className="text-amber-400" />
          Eliminar publicación
        </h2>
        <p className="mt-3 text-sm text-white/70">
          Se va a sacar <span className="font-semibold text-white">{post.title}</span> de la
          Comunidad, con sus comentarios, sus &laquo;me gusta&raquo; y los pedidos de
          colaboración que haya recibido. No se puede deshacer.
        </p>
        <p className="mt-3 rounded-lg border border-white/10 bg-onyx-black px-3 py-2 text-xs text-white/50">
          Tu proyecto no se toca: sigue guardado en tu cuenta y lo podés volver a publicar
          cuando quieras.
        </p>

        {status === "error" && (
          <p className="mt-4 text-xs text-red-400" role="alert">
            No se pudo eliminar: {errorMessage}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isBusy}
            className="rounded-full border border-red-400/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-red-300 transition-all duration-300 hover:border-red-400 hover:shadow-[0_0_18px_rgba(248,113,113,0.35)] disabled:opacity-50"
          >
            {isBusy ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}
