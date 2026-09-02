"use client";

// Modal de Iniciar Sesión / Crear Cuenta / Recuperar Contraseña —
// mismo criterio de "un solo diálogo con toggle entre modos" que
// _SignInDialog en Flutter (projects_screen.dart), y el mismo mapeo de
// errores de Firebase Auth a mensajes en español, para que la
// experiencia sea consistente entre la app y la web.
//
// Al crear cuenta: pide la contraseña dos veces (valida que coincidan
// ANTES de llamar a Firebase, sin gastar un intento) y manda el email
// de verificación (sendEmailVerification) — ver EmailVerificationGate
// en AppShell.tsx, que es quien realmente exige esa verificación
// antes de dejar usar la app (solo para cuentas nuevas, ver el
// comentario del cutoff ahí).

import { useState, type FormEvent } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
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
      return "No hay ninguna cuenta con ese email.";
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

type Mode = "login" | "register" | "reset";

export function LoginModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setResetEmailSent(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "reset") {
      setIsSubmitting(true);
      try {
        await sendPasswordResetEmail(auth, email);
        setResetEmailSent(true);
      } catch (err) {
        setError(authErrorMessage(err as AuthError));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (mode === "register" && password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "register") {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        // No bloquea el cierre del modal si esto falla — la cuenta ya
        // se creó igual; el usuario siempre tiene "Reenviar email"
        // disponible en la pantalla de verificación (EmailVerificationGate).
        try {
          await sendEmailVerification(credential.user);
        } catch {
          // silencioso a propósito, ver comentario de arriba
        }
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
          {mode === "register"
            ? "Crear cuenta"
            : mode === "reset"
              ? "Recuperar contraseña"
              : "Iniciar sesión"}
        </h2>
        <p className="mt-1 text-xs text-white/50">
          {mode === "reset"
            ? "Te mandamos un link para elegir una contraseña nueva."
            : "Podés seguir usando My Studio sin cuenta — esto es opcional, para sincronizar tus proyectos a la nube más adelante."}
        </p>

        {mode === "reset" && resetEmailSent ? (
          <div className="mt-8 flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
              ✓
            </div>
            <p className="text-sm text-white/70">
              Listo — revisá <span className="text-white">{email}</span> para continuar.
            </p>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="mt-2 rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
            >
              Volver a Iniciar Sesión
            </button>
          </div>
        ) : (
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

            {mode !== "reset" && (
              <div>
                <label htmlFor="login-password" className="mb-1.5 block text-xs text-white/60">
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
            )}

            {mode === "register" && (
              <div>
                <label htmlFor="login-password-confirm" className="mb-1.5 block text-xs text-white/60">
                  Confirmar contraseña
                </label>
                <input
                  id="login-password-confirm"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClasses}
                  placeholder="••••••••"
                />
              </div>
            )}

            {mode === "login" && (
              <button
                type="button"
                onClick={() => switchMode("reset")}
                className="self-end text-xs text-white/40 transition-colors hover:text-white/70"
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}

            {error && (
              <p className="text-xs text-red-400" role="alert">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => switchMode(mode === "register" ? "login" : "register")}
              className="self-start text-xs text-neon-cyan/80 transition-colors hover:text-neon-cyan"
            >
              {mode === "register" ? "¿Ya tenés cuenta? Iniciá sesión" : "¿No tenés cuenta? Creá una"}
            </button>

            <div className="mt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={mode === "reset" ? () => switchMode("login") : onClose}
                className="rounded-full px-4 py-2 text-sm text-white/60 transition-colors hover:text-white"
              >
                {mode === "reset" ? "Volver" : "Cancelar"}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-50 disabled:hover:border-neon-cyan/40 disabled:hover:shadow-none"
              >
                {isSubmitting
                  ? "..."
                  : mode === "register"
                    ? "Crear Cuenta"
                    : mode === "reset"
                      ? "Enviar link"
                      : "Entrar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
