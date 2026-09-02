"use client";

// Modal de "Editar Perfil" — por ahora solo el nickname público (el
// nombre que aparece en publicaciones y comentarios de la Comunidad,
// en vez del email real). Mismo criterio visual que el resto de los
// modales (LoginModal, PublishModal, ReportModal).

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { isValidUsername, setUsername as saveUsername } from "@/lib/UserProfileService";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile } = useAuth();
  const [username, setUsernameInput] = useState(profile?.username ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBusy = status === "saving" || status === "success";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = username.trim();
    if (!isValidUsername(trimmed)) {
      setErrorMessage("3 a 20 caracteres: letras, números o guión bajo, sin espacios.");
      setStatus("error");
      return;
    }
    setStatus("saving");
    setErrorMessage(null);
    try {
      await saveUsername(user.uid, trimmed);
      setStatus("success");
      setTimeout(onClose, 900);
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
        <h2 className="font-display text-xl font-semibold text-white">Editar Perfil</h2>
        <p className="mt-1 text-xs text-white/50">
          Tu nickname es el nombre que ven los demás en la Comunidad — nunca tu email.
        </p>

        {status === "success" ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">¡Guardado!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="profile-username" className="mb-1.5 block text-xs text-white/60">
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

            {status === "error" && errorMessage && (
              <p className="text-xs text-red-400" role="alert">
                {errorMessage}
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
                {status === "saving" ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
