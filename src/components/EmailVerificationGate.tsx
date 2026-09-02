"use client";

// Exige email verificado para usar la app — SOLO para cuentas creadas
// DESPUÉS de EMAIL_VERIFICATION_CUTOFF. Ninguna cuenta existente antes
// de este cambio tenía forma de verificar su email (la función no
// existía), así que aplicar esto retroactivamente dejaría afuera a
// cualquier usuario ya registrado, admins incluidos — decisión
// explícita de alcance, no un descuido.
//
// Vive en AppShell.tsx (envuelve el área de contenido, no el Sidebar
// entero) para que quien está esperando verificar igual pueda cerrar
// sesión o cambiar de cuenta desde el pie del Sidebar.

import { useState, type ReactNode } from "react";
import { sendEmailVerification } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";

const EMAIL_VERIFICATION_CUTOFF = new Date("2026-09-02T13:47:35Z");

export function EmailVerificationGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [isResending, setIsResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  if (loading || !user) return <>{children}</>;

  const createdAt = user.metadata.creationTime ? new Date(user.metadata.creationTime) : null;
  const isNewAccount = createdAt !== null && createdAt >= EMAIL_VERIFICATION_CUTOFF;
  const needsVerification = isNewAccount && !user.emailVerified;

  if (!needsVerification) return <>{children}</>;

  async function handleResend() {
    if (!auth.currentUser || isResending) return;
    setIsResending(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setResent(true);
    } catch {
      // silencioso — el botón queda disponible para reintentar
    } finally {
      setIsResending(false);
    }
  }

  async function handleCheckAgain() {
    if (!auth.currentUser || isChecking) return;
    setIsChecking(true);
    // reload() actualiza el estado persistido (emailVerified incluido)
    // con lo último del servidor; recién después recargamos la
    // página para que AuthContext vuelva a inicializar tomando ESE
    // estado ya actualizado, en vez de arriesgarse a leer el cacheado.
    await auth.currentUser.reload();
    window.location.reload();
  }

  return (
    <div className="flex h-full flex-1 items-center justify-center px-6 text-center">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-white/10 bg-graphite p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
          ✉️
        </div>
        <h1 className="font-display text-lg font-semibold text-white">Verificá tu email</h1>
        <p className="text-sm text-white/60">
          Te mandamos un link de confirmación a <span className="text-white/80">{user.email}</span>.
          Tocalo para activar tu cuenta — recién ahí vas a poder usar My Studio.
        </p>

        {resent && <p className="text-xs text-neon-cyan">Te lo volvimos a mandar.</p>}

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleCheckAgain}
            disabled={isChecking}
            className="rounded-full bg-neon-cyan px-5 py-2 font-display text-sm font-semibold text-onyx-black transition-all duration-200 hover:shadow-[0_0_20px_rgba(102,252,241,0.5)] disabled:opacity-50"
          >
            {isChecking ? "..." : "Ya lo confirmé"}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={isResending}
            className="rounded-full border border-white/20 px-5 py-2 text-sm text-white/70 transition-colors duration-200 hover:border-white/40 disabled:opacity-50"
          >
            {isResending ? "Enviando..." : "Reenviar email"}
          </button>
        </div>
      </div>
    </div>
  );
}
