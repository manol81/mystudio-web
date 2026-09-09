"use client";

// Modal de "Editar Perfil": el nickname público (el nombre que aparece
// en publicaciones y comentarios de la Comunidad, en vez del email
// real) y la presentación que se ve en el perfil público. Mismo
// criterio visual que el resto de los modales.

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  isValidUsername,
  setUsername as saveUsername,
} from "@/lib/UserProfileService";
import {
  fetchPublicProfile,
  savePublicProfile,
  MAX_BIO_LENGTH,
} from "@/lib/PublicProfileService";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const [username, setUsernameInput] = useState(profile?.username ?? "");
  const [bio, setBio] = useState("");

  // La presentación vive en el perfil PÚBLICO, que es otra colección
  // (ver PublicProfileService.ts) — hay que traerla aparte.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchPublicProfile(user.uid)
      .then((p) => {
        if (!cancelled && p) setBio(p.bio);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propagated, setPropagated] = useState<{
    posts: number;
    comments: number;
  } | null>(null);

  const isBusy = status === "saving" || status === "success";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = username.trim();
    if (!isValidUsername(trimmed)) {
      setErrorMessage(
        "3 a 20 caracteres: letras, números o guión bajo, sin espacios.",
      );
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    try {
      const result = await saveUsername(user.uid, trimmed);
      // Después del apodo, nunca antes: las reglas del perfil público
      // exigen que el nombre coincida con el privado, que es la fuente
      // de verdad.
      await savePublicProfile(user.uid, { username: trimmed, bio: bio.trim() });
      setPropagated(result);
      setStatus("success");
      setTimeout(onClose, result.posts + result.comments > 0 ? 2200 : 900);
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
        <h2 className="font-display text-xl font-semibold text-white">
          Editar Perfil
        </h2>
        <p className="mt-1 text-xs text-white/50">
          Tu nickname es el nombre que ven los demás en la Comunidad — nunca tu
          email. Al guardarlo se actualiza también en tus publicaciones y
          comentarios.
        </p>

        {status === "success" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">¡Guardado!</p>
            {propagated && propagated.posts + propagated.comments > 0 && (
              <p className="max-w-xs text-xs text-white/40">
                Actualizado también en {propagated.posts}{" "}
                {propagated.posts === 1 ? "publicación" : "publicaciones"} y{" "}
                {propagated.comments}{" "}
                {propagated.comments === 1 ? "comentario" : "comentarios"}.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label
                htmlFor="profile-username"
                className="mb-1.5 block text-xs text-white/60"
              >
                Nickname
              </label>
              <input
                id="profile-username"
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsernameInput(e.target.value)}
                className={inputClasses}
                placeholder="tu_nombre"
                maxLength={20}
              />
            </div>

            <div>
              <label htmlFor="profile-bio" className="mb-1.5 block text-xs text-white/60">
                Presentación
              </label>
              <textarea
                id="profile-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
                rows={3}
                className={`${inputClasses} resize-none`}
                placeholder="Contá qué tocás, de dónde sos, qué estás buscando…"
              />
              <p className="mt-1 text-right text-[10px] text-white/30">
                {bio.length}/{MAX_BIO_LENGTH}
              </p>
            </div>

            {user && (
              <Link
                href={`/u/${user.uid}`}
                onClick={onClose}
                className="text-xs text-neon-cyan/80 underline-offset-2 hover:underline"
              >
                Ver mi perfil público
              </Link>
            )}

            {status === "error" && errorMessage && (
              <p className="text-xs text-red-400" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-3">
              {/* Eliminación self-service — misma página que declara
                  Google Play (Data Safety → account deletion). */}
              <Link
                href="/cuenta/eliminar"
                onClick={onClose}
                className="text-xs text-red-400/70 underline-offset-2 transition-colors hover:text-red-300 hover:underline"
              >
                Eliminar mi cuenta
              </Link>
              <div className="flex items-center gap-3">
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
                  {status === "saving" ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
