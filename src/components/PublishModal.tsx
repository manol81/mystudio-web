"use client";

// Modal de "Publicar en Comunidad" — se abre desde una tarjeta de
// ProjectsDashboard. Publicar NO reexporta ni recodifica nada: reusa
// el MISMO respaldo .mystudio que ya vive en Storage (storagePath del
// proyecto, la misma fuente que ya usan "▶ Escuchar" y "↓ Descargar")
// y solo agrega un documento liviano a community_posts apuntando a esa
// URL de descarga. La reproducción real en el feed pasa por
// ProjectViewer (mismo motor multipista), no por un <audio> plano —
// ver el comentario en PostCard.tsx.

import { useState, type FormEvent } from "react";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { publishProjectToCommunity } from "@/lib/CommunityService";
import { SAMPLE_GENRES } from "@/lib/sampleTaxonomy";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function PublishModal({
  project,
  onClose,
}: {
  project: { cloudId: string; title: string; storagePath: string };
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState(project.title || "Sin título");
  const [genre, setGenre] = useState<string>(SAMPLE_GENRES[0]);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "publishing" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBusy = status === "publishing" || status === "success";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setStatus("publishing");
    setErrorMessage(null);
    try {
      const audioUrl = await getDownloadURL(ref(storage, project.storagePath));
      await publishProjectToCommunity({
        authorId: user.uid,
        authorName: user.displayName ?? user.email ?? "Usuario",
        projectId: project.cloudId,
        title: title.trim() || "Sin título",
        audioUrl,
        genre,
        description: description.trim(),
      });
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
        className="w-full max-w-md rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-white">
          🌐 Publicar en Comunidad
        </h2>
        <p className="mt-1 text-xs text-white/50">
          Tu proyecto va a aparecer en el feed público, visible para cualquiera.
        </p>

        {status === "success" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">¡Publicado en la comunidad!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="publish-title" className="mb-1.5 block text-xs text-white/60">
                Título
              </label>
              <input
                id="publish-title"
                type="text"
                required
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClasses}
                placeholder="Nombre de tu canción"
              />
            </div>

            <div>
              <label htmlFor="publish-genre" className="mb-1.5 block text-xs text-white/60">
                Género
              </label>
              <select
                id="publish-genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className={inputClasses}
              >
                {SAMPLE_GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="publish-description" className="mb-1.5 block text-xs text-white/60">
                Descripción (opcional)
              </label>
              <textarea
                id="publish-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={`${inputClasses} resize-none`}
                placeholder="Contá algo sobre este arreglo..."
              />
            </div>

            {status === "error" && (
              <p className="text-xs text-red-400" role="alert">
                No se pudo publicar: {errorMessage}
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
                {status === "publishing" ? "Publicando..." : "Publicar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
