"use client";

// Panel de /cuenta/eliminar — la URL pública que Google Play pide para
// "eliminación de cuenta" (Data Safety). Funciona en tres estados:
//   - invitado: explica qué se borra y ofrece iniciar sesión (o el
//     email de contacto si ya no puede entrar);
//   - logueado: contraseña + casilla de confirmación + botón;
//   - listo: confirmación.
// La lógica real vive en AccountDeletionService.ts (espejo de la app).

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import {
  ACCOUNT_DELETION_STEP_LABELS,
  WrongPasswordError,
  deleteAccount,
  type AccountDeletionStep,
} from "@/lib/AccountDeletionService";

const SUPPORT_EMAIL = "manolocenter@gmail.com";

const inputClasses =
  "w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-red-400 focus:shadow-[0_0_0_1px_rgba(248,113,113,0.4)]";

export function DeleteAccountPanel() {
  const { user, loading } = useAuth();
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<AccountDeletionStep | null>(null);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || status === "working") return;
    setStatus("working");
    setErrorMessage(null);
    try {
      await deleteAccount(user, password, setStep);
      setStatus("done");
    } catch (err) {
      setStep(null);
      setStatus("error");
      if (err instanceof WrongPasswordError) {
        setErrorMessage(err.message);
      } else if ((err as { code?: string }).code === "auth/network-request-failed") {
        setErrorMessage("Sin conexión. Revisá tu red y volvé a intentarlo.");
      } else {
        setErrorMessage(
          `No se pudo completar la eliminación. Tu cuenta sigue activa: volvé a intentarlo y, si persiste, escribinos a ${SUPPORT_EMAIL}.`,
        );
      }
    }
  }

  const whatIsDeleted = (
    <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm text-white/70">
      <li>Tu cuenta (email y contraseña) y tu perfil con el apodo.</li>
      <li>Los proyectos que sincronizaste a la nube (archivos de audio incluidos).</li>
      <li>Todas tus publicaciones en la Comunidad, con sus previews, likes y comentarios.</li>
      <li>Tus comentarios en publicaciones de otras personas y tu lista de usuarios bloqueados.</li>
    </ul>
  );

  const whatStays = (
    <p className="mt-4 text-xs leading-relaxed text-white/45">
      Lo que queda: los proyectos guardados en tu teléfono (la app sigue funcionando sin cuenta),
      los &ldquo;me gusta&rdquo; que diste en publicaciones ajenas (un registro anónimo sin ningún
      dato personal) y los reportes de moderación que hayas enviado. Los datos de facturación de
      Google Play los administra Google, no MY STUDIO.
    </p>
  );

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-white/10 bg-graphite p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neon-cyan/15 text-2xl text-neon-cyan">
          ✓
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-white">Cuenta eliminada</h2>
        <p className="mt-2 text-sm text-white/60">
          Tu cuenta y tus datos en la nube fueron borrados. Los proyectos guardados en tu teléfono
          siguen ahí. Gracias por haber usado MY STUDIO.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-graphite p-8">
      <h2 className="font-display text-lg font-semibold text-white">Qué se elimina</h2>
      {whatIsDeleted}
      {whatStays}

      <div className="my-6 h-px bg-white/10" />

      {loading ? (
        <p className="text-sm text-white/40">Cargando…</p>
      ) : !user ? (
        <div>
          <p className="text-sm text-white/70">
            Para eliminar tu cuenta, primero iniciá sesión con el mismo email y contraseña que
            usás en la app.
          </p>
          <button
            type="button"
            onClick={() => setIsLoginOpen(true)}
            className="mt-4 rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
          >
            Iniciar sesión
          </button>
          <p className="mt-5 text-xs leading-relaxed text-white/45">
            ¿No podés entrar a tu cuenta? Escribinos desde el email con el que te registraste a{" "}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Eliminar%20mi%20cuenta%20de%20MY%20STUDIO`} className="text-neon-cyan underline-offset-2 hover:underline">
              {SUPPORT_EMAIL}
            </a>{" "}
            con el asunto &ldquo;Eliminar mi cuenta&rdquo; y la borramos a mano dentro de los 30 días.
          </p>
          {isLoginOpen && <LoginModal onClose={() => setIsLoginOpen(false)} />}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm text-white/70">
            Sesión iniciada como <span className="font-medium text-white">{user.email}</span>.
            Esta acción es permanente y no se puede deshacer.
          </p>
          <div>
            <label htmlFor="delete-password" className="mb-1.5 block text-xs text-white/60">
              Contraseña (para confirmar que sos vos)
            </label>
            <input
              id="delete-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={status === "working"}
              className={inputClasses}
            />
          </div>
          <label className="flex items-start gap-3 text-sm text-white/70">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={status === "working"}
              className="mt-0.5 h-4 w-4 accent-red-500"
            />
            Entiendo que se borra todo lo listado arriba y que no se puede recuperar.
          </label>

          {status === "working" && step && (
            <p className="flex items-center gap-2 text-xs text-white/60" aria-live="polite">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              {ACCOUNT_DELETION_STEP_LABELS[step]}
            </p>
          )}
          {status === "error" && errorMessage && (
            <p className="text-xs text-red-400" role="alert">
              {errorMessage}
            </p>
          )}

          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={status === "working" || !confirmed || password.length === 0}
              className="rounded-full border border-red-500/50 bg-red-950/60 px-6 py-2 font-display text-sm font-semibold text-red-300 transition-all duration-300 hover:border-red-400 hover:shadow-[0_0_18px_rgba(248,113,113,0.35)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "working" ? "Eliminando…" : "Eliminar definitivamente"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
