"use client";

// Mis Proyectos — antes vivía en la raíz ("/"), que ahora es el Feed
// de la Comunidad (ver src/app/page.tsx). El branding "MY STUDIO" y la
// cuenta (email + Cerrar Sesión) ya no hacen falta acá: viven en el
// Sidebar global (ver AppSidebar.tsx), visible en cualquier página.

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { ProjectsDashboard } from "@/components/ProjectsDashboard";

export default function ProjectsPage() {
  const { user, loading } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Mis <span className="text-neon-cyan">Proyectos</span>
        </h1>
        <p className="mt-2 max-w-md text-sm text-white/50">
          Tus arreglos sincronizados desde la app y desde el Web Arranger.
        </p>
      </div>

      {loading ? null : user ? (
        <div className="flex w-full max-w-2xl flex-col items-center gap-6">
          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Botón universal de "Nuevo Proyecto": lleva al Arranger
                con ?new=1, que dispara el diálogo de configuración
                inicial (Título/BPM/Compás) ANTES de mostrar la grilla —
                ver el gate en arranger/page.tsx. */}
            <Link
              href="/arranger?new=1"
              className="rounded-full bg-neon-cyan px-6 py-2.5 font-display text-sm font-semibold text-onyx-black transition-all duration-200 hover:shadow-[0_0_20px_rgba(102,252,241,0.5)] active:scale-95"
            >
              + Crear Nuevo Proyecto
            </Link>
          </div>

          <ProjectsDashboard />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-graphite p-8">
          <p className="text-sm text-white/60">Iniciá sesión para ver tus proyectos.</p>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
          >
            Iniciar Sesión
          </button>
        </div>
      )}

      {isModalOpen && <LoginModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
