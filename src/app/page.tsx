"use client";

import { useState } from "react";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { ProjectsDashboard } from "@/components/ProjectsDashboard";

export default function Home() {
  const { user, loading } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="font-display text-5xl font-bold tracking-tight text-white sm:text-6xl">
        My Studio <span className="text-neon-cyan">Cloud</span>
      </h1>

      {/* loading: todavía no llegó la primera respuesta de Firebase Auth
          — no mostramos ni el botón de invitado ni el dashboard para
          evitar un parpadeo entre los dos estados. */}
      {loading ? null : user ? (
        <div className="flex w-full max-w-2xl flex-col items-center gap-6">
          <p className="text-base text-white/80">
            Bienvenido, <span className="text-neon-cyan">{user.email}</span>
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Paso 1 — botón universal de "Nuevo Proyecto": lleva al
                Arranger con ?new=1, que dispara el diálogo de
                configuración inicial (Título/BPM/Compás) ANTES de
                mostrar la grilla — ver el gate en arranger/page.tsx. */}
            <Link
              href="/arranger?new=1"
              className="rounded-full bg-neon-cyan px-6 py-2.5 font-display text-sm font-semibold text-onyx-black transition-all duration-200 hover:shadow-[0_0_20px_rgba(102,252,241,0.5)] active:scale-95"
            >
              + Crear Nuevo Proyecto
            </Link>
            <Link
              href="/samples"
              className="rounded-full border border-white/15 px-6 py-2 text-sm text-white/70 transition-colors duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan"
            >
              🎧 Banco de Sonidos
            </Link>
          </div>

          <ProjectsDashboard />

          <button
            type="button"
            onClick={() => signOut(auth)}
            className="rounded-full border border-white/15 px-6 py-2 text-sm text-white/60 transition-colors duration-200 hover:border-red-400/50 hover:text-red-300"
          >
            Cerrar Sesión
          </button>
        </div>
      ) : (
        <>
          <p className="max-w-md text-base text-white/60">
            Sincronizá tus proyectos, accedé al banco de sonidos y llevá tu
            estudio a cualquier lado.
          </p>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="group relative rounded-full border border-neon-cyan/40 bg-graphite px-8 py-3 font-display text-sm font-semibold uppercase tracking-widest text-neon-cyan transition-all duration-300 ease-out hover:border-neon-cyan hover:shadow-[0_0_24px_rgba(102,252,241,0.45)] active:scale-95"
          >
            Iniciar Sesión
          </button>
        </>
      )}

      {isModalOpen && <LoginModal onClose={() => setIsModalOpen(false)} />}
    </main>
  );
}
