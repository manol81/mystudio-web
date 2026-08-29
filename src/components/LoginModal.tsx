"use client";

// Modal de Iniciar Sesión / Crear Cuenta — mismo criterio de "un solo
// diálogo con toggle entre los dos modos" que _SignInDialog en Flutter
// (projects_screen.dart), y el mismo mapeo de errores de Firebase Auth
// a mensajes en español, para que la experiencia sea consistente entre
// la app y la web.

import { useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  AuthError,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

function authErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "auth/invalid-email":
      return "El email no es válido.";
    case "auth/weak-password":
      return "La contraseña es muy débil (mínimo 6 caracteres).";
    case "auth/email-already-in-use":
      return "Ya existe una cuenta con ese email.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email o contraseña incorrectos.";
    case "auth/network-request-failed":
      return "Error de conexión. Probá de nuevo.";
    case "auth/configuration-not-found":
    case "auth/operation-not-allowed":
      return "La autenticación por Email/Contraseña no está habilitada en este proyecto de Firebase todavía (Firebase Console → Authentication → Sign-in method).";
    default:
      return "No se pudo completar la acción. Probá de nuevo.";
  }
}

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]";

export function LoginModal({ onClose }: { onClose: () => void }) {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isRegisterMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      onClose();
    } catch (err) {
      setError(authErrorMessage(err as AuthError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-white">
          {isRegisterMode ? "Crear cuenta" : "Iniciar sesión"}
        </h2>
        <p className="mt-1 text-xs text-white/50">
          Podés seguir usando My Studio sin cuenta — esto es opcional, para
          sincronizar tus proyectos a la nube más adelante.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-xs text-white/60">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClasses}
              placeholder="vos@ejemplo.com"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1.5 block text-xs text-white/60"
            >
              Contraseña
            </label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClasses}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setIsRegisterMode((prev) => !prev);
              setError(null);
            }}
            className="self-start text-xs text-neon-cyan/80 transition-colors hover:text-neon-cyan"
          >
            {isRegisterMode
              ? "¿Ya tenés cuenta? Iniciá sesión"
              : "¿No tenés cuenta? Creá una"}
          </button>

          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-50 disabled:hover:border-neon-cyan/40 disabled:hover:shadow-none"
            >
              {isSubmitting
                ? "..."
                : isRegisterMode
                  ? "Crear Cuenta"
                  : "Entrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
