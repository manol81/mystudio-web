"use client";

// Modal de "Publicar en Comunidad" — se abre desde una tarjeta de
// ProjectsDashboard. El post en sí apunta al MISMO respaldo .mystudio
// que ya vive en Storage (storagePath del proyecto, la misma fuente
// que ya usan "▶ Escuchar" y "↓ Descargar") — eso es lo que habilita
// el visor multipista completo (ver PostCard.tsx).
//
// Además, acá se genera el preview LIVIANO (MP3) que consume el feed
// para no tener que bajar el .mystudio completo en cada scroll (ver
// docs/social_architecture.md Sección 1 y audioPreviewExport.ts) —
// mezclar + codificar pasa en el navegador de quien publica, una sola
// vez, DESPUÉS de crear el post (el path/regla de Storage del preview
// dependen de que el doc ya exista). Si esto falla por lo que sea, el
// post ya publicado sigue funcionando igual — cae de vuelta al visor
// completo, no se pierde la publicación por un preview que no salió.

import { useState, type FormEvent } from "react";
import { ref, getDownloadURL, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { attachCommunityPreview, publishProjectToCommunity } from "@/lib/CommunityService";
import { buildCommunityPreview } from "@/lib/audioPreviewExport";
import { SAMPLE_GENRES } from "@/lib/sampleTaxonomy";
import { isValidUsername, setUsername as saveUsername } from "@/lib/UserProfileService";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function PublishModal({
  project,
  onClose,
}: {
  project: { cloudId: string; title: string; storagePath: string };
  onClose: () => void;
}) {
  const { user, profile } = useAuth();
  const [title, setTitle] = useState(project.title || "Sin título");
  const [genre, setGenre] = useState<string>(SAMPLE_GENRES[0]);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<
    "idle" | "publishing" | "generating-preview" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);

  const [nickname, setNicknameInput] = useState("");
  const [nicknameStatus, setNicknameStatus] = useState<"idle" | "saving" | "error">("idle");
  const [nicknameError, setNicknameError] = useState<string | null>(null);

  const isBusy = status === "publishing" || status === "generating-preview" || status === "success";

  async function handleSaveNickname(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = nickname.trim();
    if (!isValidUsername(trimmed)) {
      setNicknameError("3 a 20 caracteres: letras, números o guión bajo, sin espacios.");
      setNicknameStatus("error");
      return;
    }
    setNicknameStatus("saving");
    setNicknameError(null);
    try {
      await saveUsername(user.uid, trimmed);
      // `profile` se actualiza solo vía el listener en tiempo real de
      // AuthContext — apenas llegue el cambio, este modal re-renderiza
      // y pasa directo al formulario normal de publicar.
    } catch (err) {
      setNicknameError(err instanceof Error ? err.message : String(err));
      setNicknameStatus("error");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !profile?.username) return;
    setStatus("publishing");
    setErrorMessage(null);
    let postId: string;
    let audioUrl: string;
    try {
      audioUrl = await getDownloadURL(ref(storage, project.storagePath));
      postId = await publishProjectToCommunity({
        authorId: user.uid,
        authorName: profile.username,
        projectId: project.cloudId,
        title: title.trim() || "Sin título",
        audioUrl,
        genre,
        description: description.trim(),
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus("error");
      return;
    }

    // El post YA existe en este punto — cualquier error de acá en
    // adelante no debe bloquear el "éxito": la publicación es real,
    // solo falta (o no) el preview liviano.
    setStatus("generating-preview");
    setPreviewProgress(0);
    // Variable LOCAL además del setState: setPreviewFailed(true) no se
    // refleja en `previewFailed` dentro de esta misma ejecución (los
    // setState son asíncronos) — para decidir el delay del cierre
    // automático más abajo hace falta el valor real, no el de render.
    let didPreviewFail = false;
    try {
      const { blob, durationSeconds } = await buildCommunityPreview(audioUrl, setPreviewProgress);
      const previewRef = ref(storage, `community_previews/${user.uid}/${postId}`);
      await uploadBytes(previewRef, blob, { contentType: "audio/mpeg" });
      const previewUrl = await getDownloadURL(previewRef);
      await attachCommunityPreview(postId, previewUrl, durationSeconds);
    } catch (err) {
      // NO bloquea el "éxito" — ver el comentario del encabezado, el
      // post publicado sigue siendo válido sin preview. Pero sí se
      // avisa en la UI (a diferencia de antes, que quedaba en
      // silencio total y hacía muy difícil notar/diagnosticar que
      // había fallado).
      console.error("No se pudo generar el preview liviano de la publicación:", err);
      didPreviewFail = true;
      setPreviewFailed(true);
    }

    setStatus("success");
    setTimeout(onClose, didPreviewFail ? 2600 : 1100);
  }

  // Todavía no llegó la primera respuesta del perfil (ensureUserProfile
  // recién está creando el doc) — un usuario logueado SIEMPRE termina
  // teniendo perfil, así que esto es solo un instante de carga, nunca
  // un estado final.
  if (!profile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
      </div>
    );
  }

  // Sin nickname todavía: se pide ACÁ, antes de mostrar el formulario
  // de publicar — nunca se publica nada a nombre del email real.
  if (!profile.username) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="font-display text-xl font-semibold text-white">Elegí tu nickname</h2>
          <p className="mt-1 text-xs text-white/50">
            Antes de publicar necesitás un nombre público — nunca vamos a mostrar tu email en la
            Comunidad.
          </p>
          <form onSubmit={handleSaveNickname} className="mt-6 flex flex-col gap-4">
            <input
              type="text"
              required
              autoFocus
              value={nickname}
              onChange={(e) => setNicknameInput(e.target.value)}
              className={inputClasses}
              placeholder="tu_nombre"
              maxLength={20}
            />
            {nicknameStatus === "error" && nicknameError && (
              <p className="text-xs text-red-400" role="alert">
                {nicknameError}
              </p>
            )}
            <div className="mt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={nicknameStatus === "saving"}
                className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={nicknameStatus === "saving"}
                className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-50"
              >
                {nicknameStatus === "saving" ? "Guardando..." : "Continuar"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
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
            {previewFailed && (
              <p className="max-w-xs text-xs text-white/40">
                El preview liviano no se pudo generar — tu publicación de todas formas se ve en el
                feed, abriendo el proyecto completo al escucharla.
              </p>
            )}
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
                {status === "publishing"
                  ? "Publicando..."
                  : status === "generating-preview"
                    ? `Generando preview... ${Math.round(previewProgress * 100)}%`
                    : "Publicar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
